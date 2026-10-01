"""
Live smoke test: runs real questions through the answer engine and the real
LLM gateway, against the fictional sample profile in tests/fakes.py.
Spends a few real provider calls. Usage: uv run python -m scripts.smoke_answers
"""

import asyncio
import sys
import time

from src.app.answers.engine import AnswerEngine
from src.app.api.deps import gateway
from src.app.schemas.answers import GenerateAnswerRequest, JobContext
from tests.fakes import FakeRest

QUESTIONS = [
    ("Tell us about a project you're proud of.", None),
    ("Why are you interested in this role?", JobContext(company="Example AI", role="Product Engineer")),
    ("Describe your experience with React.", None),
    ("Do you have experience with Kubernetes?", None),
    ("Tell me about a time you had a conflict with a coworker.", None),
    ("What is your greatest strength?", None),
]


async def main() -> int:
    engine = AnswerEngine(gateway)
    failures = 0
    for question, job in QUESTIONS:
        start = time.time()
        try:
            r = await engine.answer(FakeRest(), GenerateAnswerRequest(question=question, job_context=job))
        except Exception as e:  # noqa: BLE001 - report and continue
            failures += 1
            print(f"\nQ: {question}\n  ERROR {type(e).__name__}: {e}")
            continue
        print(f"\nQ: {question}\n  [{r.status} | {r.confidence} | {r.category}/{r.intent} | "
              f"{r.provider or 'no LLM'} {r.model or ''} | {time.time() - start:.1f}s]")
        print("  " + (r.answer or f"MISSING: {r.missing_information}"))
        print("  sources: " + ", ".join(s.label for s in r.used_sources))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
