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
from typing import Any, Dict, List, Optional

from pydantic import ValidationError

from src.app.gateway import LLMGateway
from src.app.resume.llm import Usage, call_json
from src.app.resume.matching.evidence import EvidenceCorpus
from src.app.schemas.job import JobAnalysis
from src.app.schemas.matching import RequirementMatch
from src.app.schemas.resume import StructuredResume
from src.app.schemas.tailoring import TailoringChange, TailoringPlan

MAX_CHANGES = 40

SYSTEM_PROMPT = """You tailor a candidate's resume to a job by proposing a small set of controlled edits. The resume must stay 100% truthful: the candidate will send it to a real employer.

You may ONLY use these operations:
- reorder: move an item (experience, projects, skills group, education, achievements, certifications) to "position" (0 = top).
- emphasize: section "skills"; "values" = existing skills to move to the front (only skills in the resume or EVIDENCE).
- rewrite_bullet: reword one existing bullet ("item" + "bulletId") to foreground a capability the EVIDENCE supports. "text" is the new bullet.
- align_terms: like rewrite_bullet, but only swaps in the job's wording for the same thing the bullet already says.
- add_bullet: add one new bullet to an existing experience or project ("item"; optional "position" among its bullets) when EVIDENCE about that same job or project shows something relevant that no bullet covers. "text" is the bullet; cite only evidence about that job or project.
- select: section "projects", "achievements" or "certifications"; "values" = item ids to keep (drop the rest).
- reduce: remove a less relevant bullet ("item" + "bulletId"), project/achievement/certification ("item"), or skills ("values").
- update_summary: section "summary"; "text" = a new 2–4 sentence summary written only from EVIDENCE.
- update_headline: section "headline"; "text" = the candidate's title line (under their name) changed to the job's role, e.g. "Full Stack AI Engineer" -> "Full Stack Engineer" for a Full Stack Engineer job, or "Frontend Developer" for a Frontend Developer job. Use the role's plain name: no company, team, location, level code or "(Remote)"; keep a seniority word (Senior, Lead, Staff, Principal) only if the candidate's own job titles have it. Only when the resume has a HEADLINE and it differs from the role.

Hard rules:
- Every rewrite_bullet, align_terms and update_summary cites "evidenceIds" from the EVIDENCE list that support every claim in "text".
- Never add a technology, tool, employer, project, title, certification, responsibility or achievement that isn't in EVIDENCE.
- Never add or change a number, percentage, team size, money amount or duration. Keep existing metrics exactly; never invent one.
- Never change job titles at employers, company names, dates, URLs or contact details (the HEADLINE is not a job title: update_headline may change it).
- Requirements marked NONE are not supported: never claim or imply them.
- A rewrite keeps the bullet's meaning and length roughly the same; don't stuff keywords.
- Prefer few, high-value edits: at most 3 rewrites per job, at most 1 new bullet per job or project and 2 overall, at most 15 changes overall.
- Keep the resume's length: the candidate's own document layout is kept, so a much longer bullet can push content onto another page.

Return only a JSON object:
{"changes": [{"section": str, "item": str|null, "action": str, "evidenceIds": [str], "reason": str,
              "position": int|null, "bulletId": str|null, "text": str|null, "values": [str]|null}]}"""


def _resume_prompt(resume: StructuredResume) -> str:
    lines = []
    if resume.contact.headline:
        lines.append(f"HEADLINE: {resume.contact.headline}")
    if resume.summary:
        lines.append(f"SUMMARY: {resume.summary}")
    for exp in resume.experience:
        lines.append(f"EXPERIENCE [{exp.id}] {exp.title} at {exp.company} ({exp.start_date or '?'} – {exp.end_date or '?'})")
        lines += [f"  - [{b.id}] {b.text}" for b in exp.bullets]
    for proj in resume.projects:
        tech = f" (technologies: {', '.join(proj.technologies)})" if proj.technologies else ""
        lines.append(f"PROJECT [{proj.id}] {proj.name}{tech}")
        lines += [f"  - [{b.id}] {b.text}" for b in proj.bullets]
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
        cite = f" evidence: {', '.join(m.evidence_ids)}" if m.evidence_ids else ""
        lines.append(f"- {m.support.upper()} ({m.priority}) {m.requirement}{cite}")
    if analysis.responsibilities:
        lines.append("RESPONSIBILITIES: " + "; ".join(analysis.responsibilities))
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
    evidence = "\n".join(f"[{e.id}] {e.label}: {e.text[:280]}" for e in corpus.items[:150])
    message = "\n\n".join([
        "JOB REQUIREMENTS (support from the candidate's evidence):\n" + _matches_prompt(analysis, matches),
        "RESUME (ids in brackets):\n" + _resume_prompt(resume),
        "EVIDENCE:\n" + evidence,
        "Return the JSON plan now.",
    ])
    return await call_json(gateway, SYSTEM_PROMPT, message, parse_plan, usage=usage, max_tokens=4000, temperature=0.3)


def plan_json(plan: TailoringPlan) -> str:
    return json.dumps(plan.model_dump(mode="json", by_alias=True))
