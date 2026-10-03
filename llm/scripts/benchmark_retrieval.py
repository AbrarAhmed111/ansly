"""
Retrieval quality benchmark: does semantic fallback find evidence that keyword
retrieval misses, and does it bring in noise?

A fictional profile whose records describe things in other words than the
questions use ("worked across teams" vs "collaborated with product, QA and
design"), plus control questions keyword retrieval should get right. Each case
lists the records that truly answer it. For every case the benchmark runs the
production path: keyword + metadata retrieval (answers/profile_context.py); then,
only when that is low-confidence and the category qualifies, semantic search
and the re-ranked evidence (answers/engine.py's fallback rule).

Reported per case and overall: keyword hit, semantic hit, final selection hit,
irrelevant records included, precision@k and recall@k (k = records selected).

Usage (from llm/):
    uv run python -m scripts.benchmark_retrieval                 # keyword only
    uv run python -m scripts.benchmark_retrieval --provider gemini   # + real embeddings (costs a few tokens)
"""

import argparse
import asyncio
import os
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Set

from src.app.answers.classifier import classify_question
from src.app.answers.profile_context import build_context
from src.app.answers.semantic import SEMANTIC_BOOST, SEMANTIC_CATEGORIES

USER_ID = "22222222-2222-2222-2222-222222222222"


def _exp(i: int, company: str, title: str, description: str, highlights: List[str], tech: List[str]) -> Dict[str, Any]:
    return {"id": f"00000000-0000-0000-0000-00000000000{i}", "company": company, "title": title,
            "start_date": f"20{14 + i}-01-01", "end_date": None if i == 1 else f"20{15 + i}-12-31",
            "is_current": i == 1, "description": description, "highlights": highlights, "technologies": tech,
            "sort_order": i}


def _proj(i: int, name: str, description: str, highlights: List[str], tech: List[str]) -> Dict[str, Any]:
    return {"id": f"00000000-0000-0000-0000-0000000001{i:02d}", "name": name, "role": "Creator",
            "description": description, "highlights": highlights, "technologies": tech, "sort_order": i,
            "start_date": None, "end_date": None}


EXPERIENCES = [
    _exp(1, "Orbital Freight", "Senior Engineer",
         "Own the shipment tracking platform end to end.",
         ["Collaborated with product, QA and design to ship a new carrier onboarding flow",
          "Led implementation of the rate engine from design through deployment"],
         ["Python", "Django", "PostgreSQL"]),
    _exp(2, "Tidewater Bank", "Software Engineer",
         "Built internal tools for the payments operations group.",
         ["Presented technical tradeoffs to product leadership before the ledger migration",
          "Reduced reconciliation time from two days to four hours"],
         ["Java", "Spring", "Oracle"]),
    _exp(3, "Northgate Games", "Junior Developer",
         "Worked on the matchmaking service.",
         ["Rewrote the queue service after a weekend outage and wrote the postmortem",
          "Paired with senior engineers on load testing"],
         ["Go", "Redis"]),
]
PROJECTS = [
    _proj(1, "Ledgerly", "Open-source double-entry bookkeeping library.", ["400 GitHub stars"], ["TypeScript"]),
    _proj(2, "TrailCam", "Wildlife camera image classifier for a local nature reserve.", ["Volunteer project"],
          ["Python", "PyTorch"]),
]
FACTS = [
    {"id": "00000000-0000-0000-0000-000000000201", "category": "general",
     "prompt": "Anything else about how you work?", "answer": "I mentor two junior developers every week."},
]


def profile() -> Dict[str, Any]:
    return {"profile": {"id": USER_ID, "full_name": "Jo Doe", "headline": "Backend engineer"},
            "experiences": EXPERIENCES, "projects": PROJECTS, "achievements": [], "education": [],
            "skills": [{"id": "s1", "name": n, "level": None, "years": None} for n in
                       ["Python", "Django", "Java", "Go", "TypeScript", "PostgreSQL"]],
            "profile_facts": FACTS}


E1, E2, E3 = (e["id"] for e in EXPERIENCES)
P1, P2 = (p["id"] for p in PROJECTS)
F1 = FACTS[0]["id"]


@dataclass
class Case:
    question: str
    relevant: Set[str]
    # True when keyword retrieval is expected to struggle (different wording).
    hard: bool = True


CASES = [
    Case("Describe a time you worked across teams.", {E1}),
    Case("Tell us about stakeholder communication.", {E2}),
    Case("Describe ownership.", {E1}),
    Case("Tell us about a time you handled an incident.", {E3}),
    Case("How do you help others grow?", {F1}),
    Case("Describe your experience with Django.", {E1}, hard=False),
    Case("Tell us about an open-source project.", {P1}, hard=False),
    Case("Describe a machine learning project.", {P2}),
]


def _ids(ctx: Any) -> List[str]:
    """The selected records' ids, best-ranked first (the question's retrieval order)."""
    refs = ctx.question_refs[0] if ctx.question_refs else []
    return [ctx.sources[ref].id for ref in refs]


async def run(embedder: Optional[Any]) -> List[Dict[str, Any]]:
    from src.app.answers.semantic import SemanticRetriever, invalidate_semantic_cache
    from tests.test_evidence_and_accounting import SemanticRest

    data = profile()
    rest = SemanticRest({"profiles": [data["profile"]], "experiences": EXPERIENCES, "projects": PROJECTS,
                         "profile_facts": FACTS})
    invalidate_semantic_cache(USER_ID)
    retriever = SemanticRetriever(embedder)
    rows = []
    for case in CASES:
        analysis = classify_question(case.question)
        ctx = build_context(data, analysis)
        keyword = _ids(ctx)
        semantic: List[str] = []
        final = keyword
        ran = bool(ctx.low_confidence and analysis.category in SEMANTIC_CATEGORIES and retriever.enabled)
        if ran:
            semantic = await retriever.search(rest, USER_ID, data, case.question)
            if semantic:
                final = _ids(build_context(data, analysis, boost={i: SEMANTIC_BOOST for i in semantic}))
        k = max(1, len(final))
        hits = [i for i in final if i in case.relevant]
        rows.append({
            "question": case.question, "hard": case.hard, "category": analysis.category,
            "low_confidence": ctx.low_confidence, "semantic_ran": ran,
            "keyword_hit": bool(set(keyword) & case.relevant),
            "keyword_top1": bool(keyword) and keyword[0] in case.relevant,
            "final_top1": bool(final) and final[0] in case.relevant,
            "semantic_hit": bool(set(semantic) & case.relevant),
            "final_hit": bool(hits),
            "irrelevant": len(final) - len(hits),
            "precision_at_k": len(hits) / k,
            "recall_at_k": len(hits) / len(case.relevant),
            "k": k,
        })
    return rows


def _embedder(provider: str) -> Any:
    os.environ["EMBEDDING_PROVIDER"] = provider
    from src.app.answers.semantic import SemanticRetriever

    retriever = SemanticRetriever.from_settings()
    if not retriever.enabled:
        raise SystemExit(f"No API key for embedding provider {provider!r}")
    return retriever.embedder


def summarize(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    def mean(key: str, subset: List[Dict[str, Any]]) -> float:
        return round(sum(float(r[key]) for r in subset) / max(1, len(subset)), 3)

    hard = [r for r in rows if r["hard"]]
    return {
        "cases": len(rows), "hard_cases": len(hard),
        "keyword_hit_rate_hard": mean("keyword_hit", hard), "final_hit_rate_hard": mean("final_hit", hard),
        "keyword_top1_hard": mean("keyword_top1", hard), "final_top1_hard": mean("final_top1", hard),
        "semantic_ran": sum(r["semantic_ran"] for r in rows),
        "keyword_hit_rate": mean("keyword_hit", rows), "final_hit_rate": mean("final_hit", rows),
        "precision_at_k": mean("precision_at_k", rows), "recall_at_k": mean("recall_at_k", rows),
        "avg_irrelevant": mean("irrelevant", rows),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--provider", help="openai or gemini: run semantic fallback with real embeddings")
    args = parser.parse_args()
    from src.app.core import llm_usage

    with llm_usage.collect() as calls:
        rows = asyncio.run(run(_embedder(args.provider) if args.provider else None))
    yes = lambda v: "y" if v else "-"  # noqa: E731
    print(f"{'question':<48}{'low':>4}{'ran':>4}{'kw':>4}{'kw@1':>5}{'sem':>4}{'fin':>4}{'fin@1':>6}{'noise':>6}"
          f"{'P@k':>6}{'R@k':>6}")
    for r in rows:
        print(f"{r['question'][:47]:<48}{yes(r['low_confidence']):>4}{yes(r['semantic_ran']):>4}"
              f"{yes(r['keyword_hit']):>4}{yes(r['keyword_top1']):>5}{yes(r['semantic_hit']):>4}"
              f"{yes(r['final_hit']):>4}{yes(r['final_top1']):>6}{r['irrelevant']:>6}{r['precision_at_k']:>6.2f}"
              f"{r['recall_at_k']:>6.2f}")
    print(summarize(rows))
    for stage in ("embedding_profile", "embedding_query"):
        mine = [c for c in calls if c.stage == stage]
        print(f"{stage}: {len(mine)} requests, {sum(c.input_tokens for c in mine)} tokens")


if __name__ == "__main__":
    main()
