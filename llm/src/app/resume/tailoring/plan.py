"""
Step 4: Matches + Master -> TailoringPlan.

The model proposes controlled operations only (reorder, emphasize,
rewrite_bullet, add_bullet, select, reduce, align_terms, update_summary,
update_headline). It
never writes the resume or the document: the plan executor applies the
operations in code, the validator checks every one, and only then are they
applied to a copy of the user's own Word file.
"""

import json
import re
from typing import Any, Dict, List, Optional, Set

from pydantic import ValidationError

from src.app.answers.profile_context import relevance_terms
from src.app.core.token_budget import TAILORING
from src.app.gateway import LLMGateway
from src.app.resume.llm import Usage, call_json
from src.app.resume.matching.evidence import EvidenceCorpus
from src.app.resume.matching.select import EVIDENCE_TEXT_CHARS, select_evidence
from src.app.schemas.job import JobAnalysis
from src.app.schemas.matching import RequirementMatch
from src.app.schemas.resume import StructuredResume
from src.app.schemas.tailoring import TailoringChange, TailoringPlan

MAX_CHANGES = 40
MAX_RESPONSIBILITIES = 5
TEXT_ACTIONS = {"rewrite_bullet", "align_terms", "add_bullet"}

SYSTEM_PROMPT = """You tailor a candidate's resume to a job with a few controlled edits. It must stay 100% truthful: it goes to a real employer.

Operations (no others):
- reorder: move an item (experience, project, skills group, education, achievement, certification) to "position" (0 = top).
- emphasize: section "skills"; "values" = existing skills to move first (only skills in the resume or EVIDENCE).
- rewrite_bullet: reword one bullet ("item" + "bulletId") to foreground a capability the evidence supports; "text" = new bullet.
- align_terms: as rewrite_bullet, but only swaps in the job's wording for what the bullet already says.
- add_bullet: one new bullet on an existing experience or project ("item"; optional "position") when evidence about that same job or project shows something relevant no bullet covers; cite only that item's evidence.
- select: section "projects", "achievements" or "certifications"; "values" = item ids to keep.
- reduce: remove a less relevant bullet ("item" + "bulletId"), item ("item"), or skills ("values").
- update_summary: "text" = a new 2–4 sentence summary written only from evidence.
- update_headline: "text" = the title line under the name changed to the job's role, plain name only (no company, team, location, level code or "(Remote)"; keep Senior/Lead/Staff/Principal only if the candidate's own titles have it). Only when there is a HEADLINE and it differs from the role.

Hard rules:
- rewrite_bullet, align_terms and update_summary cite "evidenceIds" (EVIDENCE ids or resume lines as "R:<id>") supporting every claim in "text".
- Never add a technology, tool, employer, project, title, certification, responsibility or achievement the evidence lacks. Never claim or imply anything under NOT SUPPORTED.
- Never add or change a number, percentage, team size, money amount or duration; keep existing metrics exactly.
- Never change job titles at employers, company names, dates, URLs or contact details (the HEADLINE may change).
- A rewrite keeps the bullet's meaning and roughly its length; no keyword stuffing. Keep the resume's length.
- Few, high-value edits: at most 3 rewrites per job, 1 new bullet per job or project and 2 overall, 15 changes overall.

Return only a JSON object:
{"changes": [{"section": str, "item": str|null, "action": str, "evidenceIds": [str], "reason": str,
              "position": int|null, "bulletId": str|null, "text": str|null, "values": [str]|null}]}"""


# The most recent roles are always shown in full; older roles and projects only when they share this many terms
# with the job. The rest show their bullet ids only: they can be reordered, reduced or selected, not rewritten.
RECENT_ROLES = 3
RELEVANT_TERMS = 2


def editable_items(resume: StructuredResume, analysis: JobAnalysis) -> Set[str]:
    """Ids of the experience and project items whose bullets the plan sees (and may rewrite or add to)."""
    job = relevance_terms(" ".join([analysis.role, *(r.requirement for r in analysis.must_have + analysis.nice_to_have),
                                    *analysis.responsibilities]))
    out = {exp.id for exp in resume.experience[:RECENT_ROLES]}
    for item in resume.experience[RECENT_ROLES:] + resume.projects:
        text = " ".join([getattr(item, "title", "") or getattr(item, "name", ""), " ".join(item.technologies),
                         *(b.text for b in item.bullets)])
        if len(relevance_terms(text) & job) >= RELEVANT_TERMS:
            out.add(item.id)
    return out


def _bullets(item, editable: Set[str]) -> List[str]:
    if item.id in editable:
        return [f"  - [{b.id}] {b.text}" for b in item.bullets]
    return [f"  (bullets not shown, reorder/reduce only: {', '.join(b.id for b in item.bullets)})"] if item.bullets else []


def _resume_prompt(resume: StructuredResume, editable: Optional[Set[str]] = None) -> str:
    editable = {i.id for i in resume.experience + resume.projects} if editable is None else editable
    lines = []
    if resume.contact.headline:
        lines.append(f"HEADLINE: {resume.contact.headline}")
    if resume.summary:
        lines.append(f"SUMMARY: {resume.summary}")
    for exp in resume.experience:
        lines.append(f"EXPERIENCE [{exp.id}] {exp.title} at {exp.company} ({exp.start_date or '?'} – {exp.end_date or '?'})")
        lines += _bullets(exp, editable)
    for proj in resume.projects:
        tech = f" (technologies: {', '.join(proj.technologies)})" if proj.technologies else ""
        lines.append(f"PROJECT [{proj.id}] {proj.name}{tech}")
        lines += _bullets(proj, editable)
    for group in resume.skills:
        lines.append(f"SKILLS [{group.id}] {group.label or 'Skills'}: {', '.join(group.items)}")
    for edu in resume.education:
        lines.append(f"EDUCATION [{edu.id}] {edu.degree or ''} {edu.field_of_study or ''} — {edu.institution}")
    for ach in resume.achievements:
        lines.append(f"ACHIEVEMENT [{ach.id}] {ach.title}")
    for cert in resume.certifications:
        lines.append(f"CERTIFICATION [{cert.id}] {cert.name}")
    return "\n".join(lines)


def _matches_prompt(analysis: JobAnalysis, matches: List[RequirementMatch]) -> str:
    lines = [f"ROLE: {analysis.role} at {analysis.company or 'unknown'}"]
    for m in matches:
        if m.support != "none":
            cite = f": {', '.join(m.evidence_ids)}" if m.evidence_ids else ""
            lines.append(f"- {m.support.upper()} ({m.priority.replace('_have', '')}) {m.requirement}{cite}")
    unsupported = [m.requirement for m in matches if m.support == "none"]
    if unsupported:
        # One line: the plan only needs to know never to claim these.
        lines.append("NOT SUPPORTED (never claim or imply): " + "; ".join(unsupported))
    if analysis.responsibilities:
        lines.append("RESPONSIBILITIES: " + "; ".join(analysis.responsibilities[:MAX_RESPONSIBILITIES]))
    return "\n".join(lines)


def parse_plan(data: Dict[str, Any]) -> TailoringPlan:
    """Keeps every well-formed change; malformed ones are dropped here (the executor checks the rest)."""
    raw = data.get("changes")
    if not isinstance(raw, list):
        raise ValueError("Model output has no changes list")
    changes: List[TailoringChange] = []
    for item in raw[:MAX_CHANGES]:
        if not isinstance(item, dict):
            continue
        try:
            changes.append(TailoringChange.model_validate(item))
        except ValidationError:
            continue
    return TailoringPlan(changes=changes)


async def generate_plan(
    gateway: LLMGateway,
    analysis: JobAnalysis,
    matches: List[RequirementMatch],
    resume: StructuredResume,
    corpus: EvidenceCorpus,
    usage: Optional[Usage] = None,
) -> TailoringPlan:
    editable = editable_items(resume, analysis)
    message = "\n\n".join([
        "JOB REQUIREMENTS (support from the candidate's evidence):\n" + _matches_prompt(analysis, matches),
        'RESUME (ids in brackets; each resume line is evidence too: cite it as "R:" + its id, e.g. "R:exp_1_b2"):\n'
        + _resume_prompt(resume, editable),
        "EVIDENCE (what the profile adds to the resume):\n" + _evidence_prompt(analysis, matches, resume, corpus),
        "Return the JSON plan now.",
    ])
    plan = await call_json(gateway, SYSTEM_PROMPT, message, parse_plan, TAILORING, usage=usage, max_tokens=4000,
                           temperature=0.3)
    # Text edits to an item whose bullets the model didn't see are dropped: it can't reword what it hasn't read.
    plan.changes = [c for c in plan.changes if c.action not in TEXT_ACTIONS or c.section not in ("experience", "projects")
                    or c.item in editable]
    for change in plan.changes:
        # A resume line cited without its "R:" prefix is still that line.
        change.evidence_ids = [i if corpus.has(i) or not corpus.has(f"R:{i}") else f"R:{i}" for i in change.evidence_ids]
    return plan


# Rendered profile evidence per plan prompt (~600 tokens); the resume itself is shown in full above it.
EVIDENCE_BUDGET_CHARS = 2400
_SEGMENT = re.compile(r"(?<=[.;])\s+")


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def _evidence_prompt(analysis: JobAnalysis, matches: List[RequirementMatch], resume: StructuredResume,
                     corpus: EvidenceCorpus) -> str:
    """Profile evidence for the plan: what matches cited first, then what's relevant to the job, each showing only
    the sentences the resume doesn't already say. Rows the resume fully covers are left out."""
    resume_text = _norm(" ".join(e.text for e in corpus.items if e.source == "resume"))
    cited = [i for m in matches for i in m.evidence_ids if not i.startswith("R:")]
    queries = [m.requirement for m in matches if m.support != "none"] + analysis.responsibilities
    lines = []
    for e in select_evidence(corpus, queries, EVIDENCE_BUDGET_CHARS * 2, must=cited, exclude={"resume"}):
        # Dates alone add nothing: the resume shows each role's dates.
        novel = [s for s in _SEGMENT.split(e.text)
                 if len(_norm(s)) >= 15 and re.search(r"[a-z]{3}", _norm(s)) and _norm(s) not in resume_text]
        if novel:
            lines.append(f"[{e.id}] {e.label}: {' '.join(novel)[:EVIDENCE_TEXT_CHARS]}")
    out, used = [], 0
    for text in lines:
        if used + len(text) + 1 > EVIDENCE_BUDGET_CHARS:
            continue
        out.append(text)
        used += len(text) + 1
    return "\n".join(out) or "(nothing beyond the resume)"


def plan_json(plan: TailoringPlan) -> str:
    return json.dumps(plan.model_dump(mode="json", by_alias=True))
