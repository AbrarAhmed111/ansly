"""
Live answer benchmark: the long-answer scenarios against the real configured
providers, with the fictional candidate and job from scripts/benchmark_data.py.
Reports what the providers reported (tokens, cached tokens, reasoning tokens),
cost where core/pricing.py knows the model, and measured latency.

It makes real model calls and costs real (small) money: run it deliberately.

Usage (from llm/):
    uv run python -m scripts.benchmark_live [--provider gemini] [--repeat 2] [--json out.json]

Modes:
  one_by_one  C's long questions answered one at a time, as clicking Generate
              on each field does (saved answer adapted, the rest generated)
  together    the same questions in one "Answer the rest together" request
  s5 / s10    10 long questions at most 5 / 10 per call

Wall time for one_by_one is the sum of the requests' times: it leaves out the
user's own pauses between fields, so it understates their real wait.
"""

import argparse
import asyncio
import json
import os
import statistics
import time
from typing import Any, Dict, List


def _parse() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--provider", help="only this provider (e.g. gemini, groq, anthropic)")
    parser.add_argument("--repeat", type=int, default=1)
    parser.add_argument("--modes", default="one_by_one,together,s5,s10")
    parser.add_argument("--json")
    return parser.parse_args()


async def _run(args: argparse.Namespace) -> Dict[str, Any]:
    from src.app.answers.adapt import adapt_saved_answer, adaptation_reason
    from src.app.answers.engine import AnswerEngine, _answer_cache
    from src.app.answers.profile_context import invalidate_profile_cache
    from src.app.answers.similarity import best_match
    from src.app.core import llm_usage
    from src.app.gateway import LLMGateway
    from src.app.schemas.answers import GenerateAnswerRequest
    from tests.fakes import FakeRest

    from . import benchmark_data as data
    from .benchmark_tokens import _field, _job, fill_all

    gateway = LLMGateway(max_attempts=4)
    engine = AnswerEngine(gateway)

    async def one_by_one(rest: FakeRest) -> None:
        saved = await rest.select("saved_answers")
        for q, k, o, m in data.SCENARIO_C_QUESTIONS:
            request = GenerateAnswerRequest(question=q, job_context=_job(data.LONG_JOB), field=_field(k, o, m))
            match, _ = best_match(q, saved)
            if match is not None:
                reason = adaptation_reason(match, request)
                if reason:
                    analysis = engine.analyze(request)
                    await adapt_saved_answer(gateway, match, request, reason, analysis.category, analysis.intent)
                continue
            await engine.answer(rest, request, user_id=data.USER_ID)

    ten = data.SCENARIO_C_QUESTIONS + data.SCENARIO_C_EXTRA
    modes = {
        "one_by_one": one_by_one,
        "together": lambda rest: fill_all(engine, rest, data.SCENARIO_C_QUESTIONS, data.LONG_JOB, check_saved=True),
        "s5": lambda rest: fill_all(engine, rest, ten, data.LONG_JOB, group_size=5, check_saved=True),
        "s10": lambda rest: fill_all(engine, rest, ten, data.LONG_JOB, group_size=10, check_saved=True),
    }
    results: Dict[str, Any] = {}
    for name in [m.strip() for m in args.modes.split(",") if m.strip()]:
        runs: List[Dict[str, Any]] = []
        for _ in range(args.repeat):
            _answer_cache.clear()
            invalidate_profile_cache(data.USER_ID)
            rest = FakeRest(data.tables())
            with llm_usage.collect() as calls:
                started = time.perf_counter()
                await modes[name](rest)
                wall = (time.perf_counter() - started) * 1000
            runs.append({
                "wall_ms": round(wall), "calls": len(calls),
                "input_tokens": sum(c.prompt_tokens for c in calls),
                "cached_tokens": sum(c.cache_read_tokens for c in calls),
                "output_tokens": sum(c.output_tokens for c in calls),
                "thinking_tokens": sum(c.thinking_tokens or 0 for c in calls),
                "total_tokens": sum(c.total_tokens for c in calls),
                "cost_usd": round(sum(c.cost_usd or 0 for c in calls), 6),
                "unpriced_calls": sum(1 for c in calls if c.cost_usd is None),
                "failed_calls": sum(1 for c in calls if not c.ok),
                "models": sorted({f"{c.provider}/{c.model}" for c in calls}),
                "call_ms": [c.duration_ms for c in calls],
            })
        results[name] = {"runs": runs, "median_wall_ms": statistics.median(r["wall_ms"] for r in runs)}
    return results


def main() -> None:
    args = _parse()
    if args.provider:
        # Before settings load: the gateway reads the provider order once.
        os.environ["GATEWAY_PROVIDER_ORDER"] = args.provider
    results = asyncio.run(_run(args))
    for name, r in results.items():
        last = r["runs"][-1]
        print(f"{name:<11} wall={r['median_wall_ms']:>7,.0f}ms calls={last['calls']} in={last['input_tokens']:,} "
              f"cached={last['cached_tokens']:,} out={last['output_tokens']:,} thinking={last['thinking_tokens']:,} "
              f"total={last['total_tokens']:,} cost=${last['cost_usd']:.5f} unpriced={last['unpriced_calls']} "
              f"failed={last['failed_calls']} {','.join(last['models'])} per-call ms={last['call_ms']}")
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(results, f, indent=2)


if __name__ == "__main__":
    main()
