"""Reviewable, independently tracked suggestions for a tailored resume."""

from typing import Dict, List, Optional
from uuid import uuid4

from src.app.answers.profile_context import canonicalize
from src.app.resume.matching.evidence import EvidenceCorpus
from src.app.resume.tailoring.apply import ITEM_SECTIONS
from src.app.schemas.job import JobAnalysis
from src.app.schemas.matching import RequirementMatch
from src.app.schemas.resume import StructuredResume
from src.app.schemas.tailoring import (
    ReviewChangeCategory,
    ReviewEvidenceStatus,
    TailoringChange,
    TailoringPlan,
    TailoringReviewChange,
)


def atomicize(plan: TailoringPlan, source: StructuredResume) -> TailoringPlan:
    """Split multi-value operations so each review action can be accepted or reverted alone."""
    changes: List[TailoringChange] = []
    for change in plan.changes:
        if change.action == "select":
            attr = ITEM_SECTIONS.get(change.section)
            if attr:
                kept = set(change.values or [])
                for item in getattr(source, attr):
                    if item.id not in kept:
                        changes.append(change.model_copy(update={
                            "action": "reduce", "item": item.id, "values": None, "position": None,
                        }))
                continue
        if change.action in {"emphasize", "reduce"} and change.section == "skills" and change.values:
            changes.extend(change.model_copy(update={"values": [value]}) for value in change.values)
            continue
        changes.append(change)
    return TailoringPlan(changes=changes)


def _category(change: TailoringChange) -> ReviewChangeCategory:
    if change.section == "summary":
        return "summary"
    if change.section == "headline":
        return "title"
    return {
        "experience": "experience",
        "projects": "project",
        "skills": "skill",
        "education": "education",
        "achievements": "achievement",
        "certifications": "achievement",
    }[change.section]


def _description(source: StructuredResume, change: TailoringChange) -> tuple[str, Optional[str], Optional[str]]:
    section = change.section
    item = None
    if section == "summary":
        return "summary", source.summary, change.text
    if section == "headline":
        return "headline", source.contact.headline, change.text
    if section == "skills":
        values = change.values or ([change.text] if change.text else [])
        if change.action in {"add_skill", "emphasize"}:
            return "skills", None, ", ".join(values) or None
        return "skills", ", ".join(values) or None, None
    attr = ITEM_SECTIONS.get(section)
    if not attr:
        return section, None, change.text
    items = getattr(source, attr)
    item = next((candidate for candidate in items if candidate.id == change.item), None)
    if change.bullet_id and item:
        bullet = next((candidate for candidate in getattr(item, "bullets", []) if candidate.id == change.bullet_id), None)
        return f"bullet:{change.bullet_id}", bullet.text if bullet else None, change.text
    if change.action == "reorder":
        index = next((i for i, candidate in enumerate(items) if candidate.id == change.item), None)
        return f"order:{change.item}", str(index) if index is not None else None, str(change.position)
    label = (
        getattr(item, "title", None) or getattr(item, "name", None) or getattr(item, "institution", None)
        if item else None
    )
    if change.action == "add_bullet":
        return f"new_bullet:{change.item or 'unassigned'}", None, change.text
    return f"item:{change.item or 'section'}", label, change.text


def _record(source: StructuredResume, change: TailoringChange, reason: Optional[str] = None,
            category: Optional[ReviewChangeCategory] = None,
            evidence_status: ReviewEvidenceStatus = "demonstrated", confirmation_required: bool = False,
            field: Optional[str] = None, suggested_value: Optional[str] = None) -> TailoringReviewChange:
    name, original, suggested = _description(source, change)
    return TailoringReviewChange(
        id=uuid4().hex,
        section=change.section,
        field=field or name,
        item=change.item,
        original_value=original,
        suggested_value=suggested_value if suggested_value is not None else suggested,
        reason=reason if reason is not None else change.reason,
        category=category or _category(change),
        evidence_status=evidence_status,
        confirmation_required=confirmation_required,
        status="pending",
        change=change,
    )


def build_review_changes(
    source: StructuredResume,
    plan: TailoringPlan,
    analysis: JobAnalysis,
    matches: List[RequirementMatch],
    corpus: EvidenceCorpus,
) -> List[TailoringReviewChange]:
    """Create review records from the validated plan plus explicit questions for missing evidence."""
    records = [_record(source, change) for change in atomicize(plan, source).changes]
    resume_skills = {canonicalize(skill) for group in source.skills for skill in group.items}
    matches_by_id: Dict[str, RequirementMatch] = {match.requirement_id: match for match in matches}
    for requirement in analysis.requirements:
        if requirement.type != "skill" or canonicalize(requirement.requirement) in resume_skills:
            continue
        match = matches_by_id.get(requirement.id)
        if not match or match.support == "none":
            if not match or canonicalize(requirement.requirement) in corpus.declined:
                continue
        group = source.skills[0] if source.skills else None
        if group is None:
            continue
        confirmed = bool(match and match.support != "none")
        change = TailoringChange(
            section="skills",
            item=group.id,
            action="add_skill",
            text=requirement.requirement,
            reason="This job mentions the skill, and it is not listed in your resume.",
            user_confirmed=False,
        )
        records.append(_record(
            source, change, reason=change.reason, category="skill",
            evidence_status="demonstrated" if confirmed else "unconfirmed",
            confirmation_required=not confirmed, field=f"skill:{canonicalize(requirement.requirement)}",
        ))

    candidates: List[tuple[str, str, str]] = []
    for match in matches:
        if (match.support == "none" and match.priority == "must_have"
                and match.requirement_id in matches_by_id
                and match.requirement.lower() not in {
                    r.requirement.lower() for r in analysis.requirements if r.type == "skill"
                }):
            candidates.append(("responsibility", match.requirement, match.requirement))
    for responsibility in analysis.responsibilities:
        candidates.append(("responsibility", responsibility, responsibility))
    for outcome in analysis.desired_outcomes:
        candidates.append(("outcome", outcome, outcome))

    seen = set()
    for category, prompt, source_text in candidates:
        key = canonicalize(source_text)
        if not key or key in seen:
            continue
        seen.add(key)
        if "year" in key and any(word.isdigit() for word in key.split()):
            continue
        suggestion = f"Describe your actual experience with: {prompt}"
        change = TailoringChange(
            section="experience",
            action="add_bullet",
            reason="The job values this, but your resume does not explicitly show it. Add only details that are true.",
        )
        records.append(_record(
            source,
            change,
            reason=change.reason,
            category=category,
            evidence_status="potential",
            confirmation_required=True,
            field=f"potential:{uuid4().hex}",
            suggested_value=suggestion,
        ))
        if len(seen) >= 6:
            break
    return records
