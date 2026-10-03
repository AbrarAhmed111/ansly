"""
Hallucination Review: the last validation pass, run by the model.

Asks whether any rewritten sentence claims something its evidence doesn't
support. It only flags (the user decides); deterministic checks already
removed what can be proven wrong. If no provider is available the review is
skipped with a warning rather than failing the tailoring.
"""

import logging
from typing import Any, Dict, List, Optional

from src.app.core.token_budget import VALIDATION
from src.app.gateway import GatewayUnavailableError, LLMGateway
from src.app.resume.llm import Usage, call_json
from src.app.resume.matching.evidence import EvidenceCorpus
from src.app.schemas.tailoring import ValidationIssue

from .validate import TextChange

logger = logging.getLogger("ResumeReview")

SYSTEM_PROMPT = """You audit a tailored resume for truthfulness. For each rewritten text you get the ORIGINAL, the REWRITE and the EVIDENCE it cites.

Flag a rewrite only if it claims something that neither the original nor the evidence states: a responsibility, scope, seniority, outcome, technology, team size or achievement. Rewording, reordering and emphasis are fine.

Return only a JSON object: {"flags": [{"id": str, "claim": str}]} — "claim" quotes the unsupported part. Return {"flags": []} when everything is supported."""


def _parse(data: Dict[str, Any], ids: List[str]) -> List[Dict[str, str]]:
    flags = data.get("flags")
    if not isinstance(flags, list):
        raise ValueError("Model output has no flags list")
    return [{"id": str(f["id"]), "claim": str(f.get("claim") or "")[:300]}
            for f in flags if isinstance(f, dict) and str(f.get("id")) in ids]


async def review_changes(gateway: LLMGateway, changes: List[TextChange], corpus: EvidenceCorpus,
                         usage: Optional[Usage] = None) -> List[ValidationIssue]:
    changes = [c for c in changes if c.after != c.before]
    if not changes:
        return []
    blocks = []
    for c in changes:
        cited = [i for i in (c.change.evidence_ids if c.change else []) if corpus.has(i)]
        blocks.append(f"ID: {c.key}\nORIGINAL: {c.before or '(none)'}\nREWRITE: {c.after}\nEVIDENCE:\n{corpus.text(cited)}")
    ids = [c.key for c in changes]
    try:
        flags = await call_json(gateway, SYSTEM_PROMPT, "\n\n---\n\n".join(blocks), lambda d: _parse(d, ids),
                                VALIDATION, usage=usage, max_tokens=1500, temperature=0.0)
    except GatewayUnavailableError as e:
        logger.warning(f"Hallucination review skipped: {e}")
        return [ValidationIssue(check="hallucination_review", outcome="warning",
                                message="The final truthfulness review couldn't run. Read the changes carefully before downloading.")]
    by_key = {c.key: c for c in changes}
    return [
        ValidationIssue(check="hallucination_review", outcome="flagged", section=by_key[f["id"]].section,
                        item=by_key[f["id"]].item, message=f"Check this claim: \"{f['claim']}\"",
                        original=by_key[f["id"]].before, attempted=by_key[f["id"]].after)
        for f in flags
    ]
