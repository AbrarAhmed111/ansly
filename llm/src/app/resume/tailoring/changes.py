"""
Human-Readable Changes and Diffs, from the validated result.

Counts come from comparing the master with the final resume (what the tailored
document actually says), so a change the validator reverted, or one the Word
document couldn't take safely, never shows up as made.
"""

from typing import Dict, List

from src.app.resume.matching.evidence import EvidenceCorpus
from src.app.schemas.resume import StructuredResume
from src.app.schemas.tailoring import ChangeSummary, TextDiff

from .apply import ITEM_SECTIONS, AppliedChange

SECTION_NAMES = {"experience": "experience", "projects": "project", "education": "education"}


def _label(item) -> str:
    return getattr(item, "name", None) or getattr(item, "title", None) or item.id


def _plural(n: int, word: str) -> str:
    return f"{n} {word}{'' if n == 1 else 's'}"


def summarize_changes(source: StructuredResume, final: StructuredResume, applied: List[AppliedChange]) -> List[ChangeSummary]:
    out: List[ChangeSummary] = []
    for section in ("experience", "projects"):
        before = {b.id: b.text for i in getattr(source, section) for b in i.bullets}
        after = {b.id: b.text for i in getattr(final, section) for b in i.bullets}
        rewritten = sum(1 for k, v in after.items() if k in before and before[k] != v)
        removed = sum(1 for k in before if k not in after)
        added = sum(1 for k in after if k not in before)
        if added:
            out.append(ChangeSummary(section=section, action="add_bullet",
                                     label=f"{_plural(added, SECTION_NAMES[section] + ' bullet')} added"))
        if rewritten:
            out.append(ChangeSummary(section=section, action="rewrite_bullet",
                                     label=f"{_plural(rewritten, SECTION_NAMES[section] + ' bullet')} rewritten"))
        if removed:
            out.append(ChangeSummary(section=section, action="reduce",
                                     label=f"{_plural(removed, SECTION_NAMES[section] + ' bullet')} removed"))

    skills_changed = [(g.id, g.items) for g in source.skills] != [(g.id, g.items) for g in final.skills]
    left_out_done = set()
    for a in applied:
        c = a.change
        if c.action == "reorder" and a.moved and a.moved[0] != a.moved[1]:
            attr = ITEM_SECTIONS[c.section]
            final_ids = [i.id for i in getattr(final, attr)]
            source_ids = [i.id for i in getattr(source, attr)]
            if c.item in final_ids and c.item in source_ids and final_ids.index(c.item) != source_ids.index(c.item):
                higher = final_ids.index(c.item) < source_ids.index(c.item)
                out.append(ChangeSummary(section=c.section, action="reorder",
                                         label=f"{a.label} moved {'higher' if higher else 'lower'}"))
        elif c.action == "emphasize" and a.label and skills_changed:
            out.append(ChangeSummary(section="skills", action="emphasize", label=f"{a.label} emphasized"))
        elif c.action in ("select", "reduce") and c.section in ("projects", "achievements", "certifications") \
                and not c.bullet_id and c.section not in left_out_done:
            attr = ITEM_SECTIONS[c.section]
            kept = {i.id for i in getattr(final, attr)}
            gone = [_label(i) for i in getattr(source, attr) if i.id not in kept]
            left_out_done.add(c.section)
            if gone:
                out.append(ChangeSummary(section=c.section, action=c.action, label=f"Left out: {', '.join(gone)}"))
        elif c.action == "reduce" and c.section == "skills" and a.label and skills_changed:
            out.append(ChangeSummary(section="skills", action="reduce", label=f"Left out skills: {a.label}"))

    if (final.summary or "") != (source.summary or ""):
        out.append(ChangeSummary(section="summary", action="update_summary", label="Summary updated"))
    return out


def text_diffs(source: StructuredResume, final: StructuredResume, applied: List[AppliedChange],
               corpus: EvidenceCorpus) -> List[TextDiff]:
    evidence: Dict[str, List[str]] = {}
    for a in applied:
        key = "summary" if a.change.section == "summary" else a.change.bullet_id
        if key:
            evidence[key] = corpus.labels(a.change.evidence_ids)
    out: List[TextDiff] = []
    if (final.summary or "") != (source.summary or ""):
        out.append(TextDiff(section="summary", item=None, item_label="Summary", before=source.summary or "",
                            after=final.summary or "", evidence_labels=evidence.get("summary", [])))
    for section in ("experience", "projects"):
        originals = {b.id: b.text for i in getattr(source, section) for b in i.bullets}
        for item in getattr(final, section):
            label = f"{item.title} at {item.company}" if section == "experience" else item.name
            for b in item.bullets:
                if b.id not in originals or originals[b.id] != b.text:
                    out.append(TextDiff(section=section, item=item.id, item_label=label, before=originals.get(b.id, ""),
                                        after=b.text, evidence_labels=evidence.get(b.id, [])))
    return out
