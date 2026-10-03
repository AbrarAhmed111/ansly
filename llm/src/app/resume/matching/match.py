"""
Step 3: JobAnalysis + Evidence -> RequirementMatch[].

Deterministic first: skill and certification requirements are looked up in the
evidence corpus (V1's skill precheck), and the model never decides them, so a
Kubernetes the candidate never used is always "none". The model only judges
semantic requirements ("built SaaS platforms", "led small teams"), and must
cite evidence ids that exist; an uncited claim is rejected.
"""

from typing import Any, Dict, List, Optional

from src.app.answers.profile_context import canonicalize
from src.app.gateway import LLMGateway
from src.app.resume.llm import Usage, call_json
from src.app.schemas.job import JobAnalysis, JobRequirement
from src.app.schemas.matching import MatchSummary, RequirementMatch

from .evidence import EvidenceCorpus, is_work_evidence

DETERMINISTIC_TYPES = {"skill", "certification"}
EVIDENCE_TEXT_CHARS = 280
MAX_EVIDENCE_IN_PROMPT = 150

SYSTEM_PROMPT = """You check a candidate's evidence against job requirements for a resume-tailoring tool. Be strict: a requirement is only supported by evidence that actually shows it.

For each requirement return:
- support: "strong" (evidence clearly shows it), "partial" (related or weaker evidence), or "none".
- evidenceIds: the ids of the evidence items that show it. Required for strong and partial. Use only ids from the EVIDENCE list.
- note: one short sentence on why (optional).

Never count the job posting itself as evidence. Years of experience are only supported if the evidence dates add up.

Return only a JSON object: {"matches": [{"requirementId": str, "support": str, "evidenceIds": [str], "note": str|null}]}"""


def _deterministic(req: JobRequirement, priority: str, corpus: EvidenceCorpus) -> RequirementMatch:
    ids = corpus.ids_with_term(req.requirement)
    if not ids:
        declined = canonicalize(req.requirement) in corpus.declined
        note = "You said you don't have this skill." if declined else "Not found in your profile or resume."
        return RequirementMatch(requirement_id=req.id, requirement=req.requirement, priority=priority, support="none",
                                evidence_ids=[], method="deterministic", note=note)
    work = [i for i in ids if is_work_evidence(corpus.by_id[i])]
    support = "strong" if work else "partial"
    note = None if work else "Listed as a skill, but not shown in your experience or projects."
    return RequirementMatch(requirement_id=req.id, requirement=req.requirement, priority=priority, support=support,
                            evidence_ids=(work or ids)[:6], method="deterministic", note=note)


def _evidence_prompt(corpus: EvidenceCorpus) -> str:
    lines = []
    for e in corpus.items[:MAX_EVIDENCE_IN_PROMPT]:
        text = e.text[:EVIDENCE_TEXT_CHARS]
        skills = f" (technologies: {', '.join(e.skills)})" if e.skills else ""
        lines.append(f"[{e.id}] {e.label}: {text}{skills}")
    return "\n".join(lines)


def parse_semantic(data: Dict[str, Any], pending: List[tuple], corpus: EvidenceCorpus) -> List[RequirementMatch]:
    by_id = {str(m.get("requirementId")): m for m in data.get("matches") or [] if isinstance(m, dict)}
    out: List[RequirementMatch] = []
    for req, priority in pending:
        raw = by_id.get(req.id) or {}
        support = raw.get("support") if raw.get("support") in ("strong", "partial", "none") else "none"
        ids = [str(i) for i in raw.get("evidenceIds") or [] if corpus.has(str(i))][:6]
        note = str(raw.get("note") or "")[:300] or None
        if support != "none" and not ids:
            support, note = "none", "No evidence was cited, so it isn't counted."
        if support == "none":
            ids = []
        out.append(RequirementMatch(requirement_id=req.id, requirement=req.requirement, priority=priority,
                                    support=support, evidence_ids=ids, method="semantic", note=note))
    return out


async def match_requirements(
    gateway: LLMGateway, analysis: JobAnalysis, corpus: EvidenceCorpus, usage: Optional[Usage] = None,
) -> List[RequirementMatch]:
    reqs = [(r, "must_have") for r in analysis.must_have] + [(r, "nice_to_have") for r in analysis.nice_to_have]
    results: Dict[str, RequirementMatch] = {}
    pending = []
    for req, priority in reqs:
        if req.type in DETERMINISTIC_TYPES:
            results[req.id] = _deterministic(req, priority, corpus)
        else:
            pending.append((req, priority))

    if pending and corpus.items:
        message = "\n".join([
            "REQUIREMENTS:",
            *[f"[{req.id}] ({req.type}, {priority}) {req.requirement}" for req, priority in pending],
            "",
            "EVIDENCE:",
            _evidence_prompt(corpus),
        ])
        for match in await call_json(gateway, SYSTEM_PROMPT, message,
                                     lambda data: parse_semantic(data, pending, corpus), usage=usage,
                                     max_tokens=3000, temperature=0.0):
            results[match.requirement_id] = match
    for req, priority in pending:
        results.setdefault(req.id, RequirementMatch(
            requirement_id=req.id, requirement=req.requirement, priority=priority, support="none",
            evidence_ids=[], method="semantic", note="Your profile is empty.",
        ))
    return [results[req.id] for req, _ in reqs]


def summarize(matches: List[RequirementMatch]) -> MatchSummary:
    return MatchSummary(
        analyzed=len(matches),
        supported=sum(m.support == "strong" for m in matches),
        partial=sum(m.support == "partial" for m in matches),
        unsupported=sum(m.support == "none" for m in matches),
    )
