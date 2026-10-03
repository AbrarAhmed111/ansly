"""
Step 5: Plan -> Tailored Structured Resume.

Applies the plan's operations to a copy of the master in code. The master is
never modified. An added bullet gets the id "{item}_added", so validation can
tell it apart from the master's own bullets. A change that doesn't fit (unknown item, wrong section,
removing a job) is rejected and reported, never guessed at.
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from src.app.answers.profile_context import canonicalize
from src.app.resume.matching.evidence import EvidenceCorpus
from src.app.schemas.resume import ResumeBullet, ResumeSkillGroup, StructuredResume
from src.app.schemas.tailoring import TailoringChange, TailoringPlan

ITEM_SECTIONS = {
    "experience": "experience", "projects": "projects", "skills": "skills", "education": "education",
    "achievements": "achievements", "certifications": "certifications",
}
BULLET_SECTIONS = {"experience", "projects", "education"}
# New bullets: only under a job or project, one each, a few in total.
ADD_SECTIONS = {"experience", "projects"}
MAX_ADDED = 2
REMOVABLE_ITEM_SECTIONS = {"projects", "achievements", "certifications"}
TEXT_ACTIONS = {"rewrite_bullet", "add_bullet", "align_terms", "update_summary"}


@dataclass
class AppliedChange:
    change: TailoringChange
    before: Optional[str] = None
    after: Optional[str] = None
    # reorder: index before and after.
    moved: Optional[Tuple[int, int]] = None
    label: str = ""


@dataclass
class ApplyResult:
    resume: StructuredResume
    applied: List[AppliedChange] = field(default_factory=list)
    rejected: List[Tuple[TailoringChange, str]] = field(default_factory=list)


def _item_label(section: str, item) -> str:
    if section == "experience":
        return f"{item.title} at {item.company}"
    if section == "education":
        return item.institution
    if section == "skills":
        return item.label or "Skills"
    return getattr(item, "name", None) or getattr(item, "title", None) or item.id


def _find(items: list, item_id: Optional[str]):
    for index, item in enumerate(items):
        if item.id == item_id:
            return index, item
    return -1, None


def apply_plan(source: StructuredResume, plan: TailoringPlan, corpus: EvidenceCorpus) -> ApplyResult:
    resume = source.model_copy(deep=True)
    result = ApplyResult(resume=resume)
    touched_text: set = set()

    def reject(change: TailoringChange, reason: str) -> None:
        result.rejected.append((change, reason))

    for change in plan.changes:
        action, section = change.action, change.section

        if action == "update_summary" or (action == "align_terms" and section == "summary"):
            text = (change.text or "").strip()
            if section != "summary" or not text or "summary" in touched_text:
                reject(change, "Summary change was empty or repeated.")
                continue
            touched_text.add("summary")
            result.applied.append(AppliedChange(change, before=resume.summary or "", after=text, label="Summary"))
            resume.summary = text
            continue

        attr = ITEM_SECTIONS.get(section)
        if attr is None:
            reject(change, f"Unknown section {section}.")
            continue
        items = getattr(resume, attr)

        if action == "reorder":
            index, item = _find(items, change.item)
            if item is None or change.position is None:
                reject(change, "Reorder points at an item that doesn't exist.")
                continue
            position = min(change.position, len(items) - 1)
            items.insert(position, items.pop(index))
            result.applied.append(AppliedChange(change, moved=(index, position), label=_item_label(section, item)))

        elif action in ("rewrite_bullet", "align_terms"):
            index, item = _find(items, change.item)
            text = (change.text or "").strip()
            if section not in BULLET_SECTIONS or item is None or not text:
                reject(change, "Rewrite points at a bullet that doesn't exist.")
                continue
            bullet = next((b for b in item.bullets if b.id == change.bullet_id), None)
            if bullet is None or bullet.id in touched_text:
                reject(change, "Rewrite points at a bullet that doesn't exist or was already rewritten.")
                continue
            touched_text.add(bullet.id)
            result.applied.append(AppliedChange(change, before=bullet.text, after=text, label=_item_label(section, item)))
            bullet.text = text

        elif action == "add_bullet":
            index, item = _find(items, change.item)
            text = (change.text or "").strip()
            if section not in ADD_SECTIONS or item is None or not text:
                reject(change, "A new bullet must go under an existing job or project.")
                continue
            added = sum(1 for a in result.applied if a.change.action == "add_bullet")
            if added >= MAX_ADDED or any(a.change.item == item.id and a.change.action == "add_bullet" for a in result.applied):
                reject(change, "Only one new bullet per job or project, and a few overall.")
                continue
            if any(canonicalize(b.text) == canonicalize(text) for b in item.bullets):
                reject(change, "That bullet is already on the resume.")
                continue
            bullet_id = f"{item.id}_added"
            position = min(change.position if change.position is not None else len(item.bullets), len(item.bullets))
            item.bullets.insert(position, ResumeBullet(id=bullet_id, text=text))
            touched_text.add(bullet_id)
            change = change.model_copy(update={"bullet_id": bullet_id})
            result.applied.append(AppliedChange(change, before="", after=text, label=_item_label(section, item)))

        elif action == "emphasize":
            if section != "skills" or not change.values:
                reject(change, "Emphasize needs skills to move forward.")
                continue
            moved: List[str] = []
            for value in reversed(change.values):
                key = canonicalize(value)
                group = next((g for g in resume.skills if any(canonicalize(s) == key for s in g.items)), None)
                if group is not None:
                    existing = next(s for s in group.items if canonicalize(s) == key)
                    group.items.remove(existing)
                    group.items.insert(0, existing)
                    moved.insert(0, existing)
                elif corpus.has_term(value):
                    if not resume.skills:
                        resume.skills.append(ResumeSkillGroup(id="skills_tailored", label=None, items=[]))
                    _, target = _find(resume.skills, change.item)
                    (target or resume.skills[0]).items.insert(0, value.strip()[:100])
                    moved.insert(0, value.strip())
            if moved:
                result.applied.append(AppliedChange(change, label=", ".join(moved)))
            else:
                reject(change, "None of the skills to emphasize are in your evidence.")

        elif action == "select":
            if section not in REMOVABLE_ITEM_SECTIONS or not change.values:
                reject(change, "Select works on projects, achievements or certifications.")
                continue
            keep = [i for i in items if i.id in set(change.values)]
            if not keep:
                reject(change, "Select would remove every item.")
                continue
            dropped = [i for i in items if i not in keep]
            items[:] = keep
            result.applied.append(AppliedChange(change, label=", ".join(_item_label(section, i) for i in dropped)))

        elif action == "reduce":
            if section == "skills" and change.values:
                removed = []
                drop = {canonicalize(v) for v in change.values}
                for group in resume.skills:
                    kept = [s for s in group.items if canonicalize(s) not in drop]
                    removed += [s for s in group.items if canonicalize(s) in drop]
                    group.items[:] = kept
                resume.skills[:] = [g for g in resume.skills if g.items]
                if removed:
                    result.applied.append(AppliedChange(change, label=", ".join(removed)))
                else:
                    reject(change, "Those skills aren't on the resume.")
                continue
            index, item = _find(items, change.item)
            if item is None:
                reject(change, "Reduce points at an item that doesn't exist.")
                continue
            if change.bullet_id:
                bullet = next((b for b in getattr(item, "bullets", []) if b.id == change.bullet_id), None)
                if bullet is None or len(item.bullets) <= 1:
                    reject(change, "Can't remove that bullet.")
                    continue
                item.bullets.remove(bullet)
                touched_text.add(bullet.id)
                result.applied.append(AppliedChange(change, before=bullet.text, label=_item_label(section, item)))
            elif section in REMOVABLE_ITEM_SECTIONS and len(items) > 1:
                items.pop(index)
                result.applied.append(AppliedChange(change, label=_item_label(section, item)))
            else:
                reject(change, "Jobs, education and the last item of a section are never removed.")

        else:
            reject(change, f"Unknown action {action}.")
    return result


def bullet_index(resume: StructuredResume) -> Dict[str, Tuple[str, str, str]]:
    """bullet id -> (section, item id, text)."""
    out: Dict[str, Tuple[str, str, str]] = {}
    for section in BULLET_SECTIONS:
        for item in getattr(resume, ITEM_SECTIONS[section]):
            for b in item.bullets:
                out[b.id] = (section, item.id, b.text)
    return out
