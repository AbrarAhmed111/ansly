"""
Evidence Selection for Prompts.

The evidence corpus holds every profile row and every resume line (often the
same facts twice: profiles are usually imported from the resume). Matching and
planning used to send the first 150 items to the model on every run. This
picks what a prompt needs, with no model:

1. Duplicates go: an item whose text is already contained in an earlier item.
2. Items named in `must` (e.g. evidence a match cited) come first.
3. For each query (a requirement), the items sharing the most terms with it.
4. Then work evidence (experience, projects, achievements, facts, profile) in
   corpus order, as general background, while the budget lasts.

Selection only narrows what the model reads. Validation still checks every
citation against the whole corpus.
"""

import re
from typing import Dict, Iterable, List, Optional, Set

from src.app.answers.profile_context import relevance_terms
from src.app.schemas.matching import Evidence

from .evidence import EvidenceCorpus

# A profile row up to this long is shown whole, so the resume lines it repeats can be left out.
EVIDENCE_TEXT_CHARS = 500
BACKGROUND_SOURCES = {"profile", "experience", "project", "achievement", "fact", "education"}


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def distinct(items: Iterable[Evidence]) -> List[Evidence]:
    """Items whose text isn't already shown by an earlier item (resume lines repeat profile rows). Only the part of
    an item a prompt shows counts, so a highlight cut off a long profile row keeps its own resume line."""
    kept: List[Evidence] = []
    seen: List[str] = []
    for e in items:
        text = _norm(e.text)
        if len(text) >= 20 and any(text in s for s in seen):
            continue
        kept.append(e)
        seen.append(_norm(f"{e.label} {e.text[:EVIDENCE_TEXT_CHARS]}"))
    return kept


def line(e: Evidence) -> str:
    skills = f" (technologies: {', '.join(e.skills)})" if e.skills else ""
    return f"[{e.id}] {e.label}: {e.text[:EVIDENCE_TEXT_CHARS]}{skills}"


def select_evidence(
    corpus: EvidenceCorpus,
    queries: List[str],
    budget_chars: int,
    must: Iterable[str] = (),
    exclude: Optional[Set[str]] = None,
    per_query: int = 3,
    background: bool = True,
) -> List[Evidence]:
    """Evidence for a prompt, in corpus order, within `budget_chars` of rendered lines (see module docstring).
    `exclude` drops sources ("resume" when the prompt shows the resume itself)."""
    pool = [e for e in distinct(corpus.items) if e.source not in (exclude or set())]
    by_id: Dict[str, Evidence] = {e.id: e for e in pool}
    terms = {e.id: relevance_terms(f"{e.label} {e.text} {' '.join(e.skills)}") for e in pool}

    ranked: List[str] = [i for i in must if i in by_id]
    for query in queries:
        wanted = relevance_terms(query)
        scores = sorted((-len(terms[e.id] & wanted), n) for n, e in enumerate(pool))
        ranked += [pool[n].id for score, n in scores[:per_query] if score < 0]
    if background:
        ranked += [e.id for e in pool if e.source in BACKGROUND_SOURCES]

    chosen: Set[str] = set()
    used = 0
    for evidence_id in dict.fromkeys(ranked):
        cost = len(line(by_id[evidence_id])) + 1
        if used + cost > budget_chars:
            continue
        chosen.add(evidence_id)
        used += cost
    return [e for e in pool if e.id in chosen]
