"""
Answer quality eval: runs the quality set (scripts/answer_quality_set.py)
through the real engine and providers, checks each answer's constraints and
grounding automatically, and reports pass rate, flagged hallucinations, format
errors, tokens, latency and cost. Read the answers too: usefulness needs a
human.

It makes real model calls (small cost): run it deliberately.

Usage (from llm/):
    uv run python -m scripts.eval_answers [--provider gemini] [--model gemini-3.6-flash] [--mode single|batch|both]
        [--out results.json]

Compare a fast model with the strong one (same provider) before routing a stage to it, e.g.:
    --provider anthropic --model claude-opus-5-5   vs   --provider anthropic --model claude-haiku-4-5
"""

import argparse
import asyncio
import json
import os
import re
import time
from typing import Any, Dict, List

from .answer_quality_set import ANSWERED, CASES, EITHER, QualityCase

_NAME = re.compile(r"(?<![.!?:]\s)(?<!^)(?<![\"'(\n])\b([A-Z][A-Za-z0-9+#.&/-]*[A-Za-z0-9+#])")
_NUMBER = re.compile(r"\d[\d,.]*")
# Words the prompt itself asks for (a complete letter opens "Dear Hiring Manager,").
_ALLOWED_NAMES = {"I", "I'm", "I've", "I'd", "Dear", "Hiring", "Manager", "Sincerely", "Regards", "Best"}


def _numbers(text: str) -> set:
    return {n.replace(",", "").rstrip(".") for n in _NUMBER.findall(text or "")}


def corpus_text(tables: Dict[str, Any], job: Dict[str, Any], question: str) -> str:
    return json.dumps(tables, default=str) + " " + json.dumps(job) + " " + question


def check(case: QualityCase, status: str, answer: str, corpus: str) -> List[str]:
    """The constraints `answer` breaks (empty: it passes)."""
    problems: List[str] = []
    if case.status != EITHER and status != case.status:
        problems.append(f"status {status}, expected {case.status}")
    if status != ANSWERED:
        return problems
    low = answer.lower()
    if case.must_include and not any(term.lower() in low for term in case.must_include):
        problems.append(f"mentions none of {case.must_include}")
    for term in case.must_not_include:
        if term.lower() in low:
            problems.append(f"says {term!r}")
    if case.max_length and len(answer) > case.max_length:
        problems.append(f"{len(answer)} chars > {case.max_length}")
    if case.min_words and len(answer.split()) < case.min_words:
        problems.append(f"{len(answer.split())} words < {case.min_words}")
    if case.options and answer not in case.options:
        problems.append(f"not an option: {answer!r}")
    invented_numbers = _numbers(answer) - _numbers(corpus)
    if invented_numbers:
        problems.append(f"ungrounded numbers {sorted(invented_numbers)}")
    known = corpus.lower()
    invented_names = sorted({m.group(1) for m in _NAME.finditer(answer)
                             if m.group(1).lower() not in known and m.group(1) not in _ALLOWED_NAMES})
    if invented_names:
        problems.append(f"ungrounded names {invented_names}")
    return problems


async def run(mode: str) -> List[Dict[str, Any]]:
    from src.app.answers.engine import AnswerEngine, _answer_cache
    from src.app.answers.profile_context import invalidate_profile_cache
    from src.app.core import llm_usage
    from src.app.gateway import GatewayUnavailableError, LLMGateway
    from src.app.schemas.answers import (
        AnswerStyle,
        BatchItem,
        FieldContext,
        GenerateAnswerRequest,
        GenerateBatchRequest,
        JobContext,
    )
    from tests.fakes import FakeRest

    from . import benchmark_data as data

    engine = AnswerEngine(LLMGateway(max_attempts=4))
    job_raw = {"company": data.TYPICAL_JOB["company"], "role": data.TYPICAL_JOB["title"],
               "description": data.TYPICAL_JOB["description"]}
    job = JobContext(**job_raw)
    tables = data.tables()
    fields = {c.id: FieldContext(kind=c.field_kind, max_length=c.max_length, options=c.options) for c in CASES}
    rows: List[Dict[str, Any]] = []

    def record(case: QualityCase, how: str, response: Any, calls: List[Any], ms: float) -> None:
        corpus = corpus_text(tables, job_raw, case.question)
        rows.append({
            "id": case.id, "kind": case.kind, "mode": how, "status": response.status, "answer": response.answer,
            "problems": check(case, response.status, response.answer, corpus),
            "tokens": sum(c.total_tokens for c in calls), "cost_usd": sum(c.cost_usd or 0 for c in calls),
            "ms": round(ms), "models": sorted({c.model for c in calls}),
            # Billed outputs that failed the format check (the gateway then tried another deployment).
            "unusable_outputs": sum(not c.ok for c in calls),
        })

    if mode in ("single", "both"):
        for case in CASES:
            _answer_cache.clear()
            invalidate_profile_cache(data.USER_ID)
            request = GenerateAnswerRequest(question=case.question, job_context=job, field=fields[case.id],
                                            style=AnswerStyle())
            with llm_usage.collect() as calls:
                started = time.perf_counter()
                try:
                    response = await engine.answer(FakeRest(tables), request, user_id=data.USER_ID)
                except GatewayUnavailableError as e:
                    rows.append({"id": case.id, "kind": case.kind, "mode": "single", "status": "error", "answer": "",
                                 "problems": [f"no valid output: {str(e)[-80:]}"], "models": [],
                                 "tokens": sum(c.total_tokens for c in calls),
                                 "cost_usd": sum(c.cost_usd or 0 for c in calls),
                                 "ms": round((time.perf_counter() - started) * 1000),
                                 "unusable_outputs": sum(not c.ok for c in calls)})
                    continue
            record(case, "single", response, calls, (time.perf_counter() - started) * 1000)
    if mode in ("batch", "both"):
        _answer_cache.clear()
        invalidate_profile_cache(data.USER_ID)
        rest = FakeRest(tables)
        request = GenerateBatchRequest(job_context=job, style=AnswerStyle(), items=[
            BatchItem(id=c.id, question=c.question, field=fields[c.id]) for c in CASES])
        with llm_usage.collect() as calls:
            started = time.perf_counter()
            results = await engine.complete_batch(rest, await engine.plan_batch(rest, request, data.USER_ID))
            ms = (time.perf_counter() - started) * 1000
        by_id = {r.id: r for r in results}
        for i, case in enumerate(CASES):
            # The batch's calls and time are shared: reported once, on the first row.
            record(case, "batch", by_id[case.id], calls if i == 0 else [], ms if i == 0 else 0)
    return rows


def summarize(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for mode in sorted({r["mode"] for r in rows}):
        mine = [r for r in rows if r["mode"] == mode]
        flagged = [r for r in mine if any(p.startswith("ungrounded") for p in r["problems"])]
        out[mode] = {
            "cases": len(mine), "passed": sum(not r["problems"] for r in mine),
            "hallucination_flags": len(flagged),
            "format_errors": sum(any("chars >" in p or "not an option" in p or "words <" in p for p in r["problems"])
                                 for r in mine),
            "errors": sum(r["status"] == "error" for r in mine),
            "unusable_outputs": sum(r.get("unusable_outputs", 0) for r in mine),
            "tokens": sum(r["tokens"] for r in mine), "cost_usd": round(sum(r["cost_usd"] for r in mine), 6),
            "ms": sum(r["ms"] for r in mine), "models": sorted({m for r in mine for m in r["models"]}),
        }
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--provider")
    parser.add_argument("--model", help="the provider's model for this run (sets <PROVIDER>_MODEL)")
    parser.add_argument("--mode", default="both", choices=["single", "batch", "both"])
    parser.add_argument("--out")
    args = parser.parse_args()
    # Before settings load: the gateway reads these once.
    if args.provider:
        os.environ["GATEWAY_PROVIDER_ORDER"] = args.provider
        if args.model:
            os.environ[f"{args.provider.upper()}_MODEL"] = args.model
            os.environ[f"{args.provider.upper()}_FALLBACK_MODEL"] = ""
    rows = asyncio.run(run(args.mode))
    for r in rows:
        mark = "ok  " if not r["problems"] else "FAIL"
        print(f"{mark} {r['mode']:<6} {r['id']:<22} {r['status'][:10]:<10} {'; '.join(r['problems'])}")
    print(json.dumps(summarize(rows), indent=2))
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(rows, f, indent=2)


if __name__ == "__main__":
    main()
