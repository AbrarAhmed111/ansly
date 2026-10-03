"""
Step 2: Profile + Master Resume -> Evidence Corpus.

Every fact the tailored resume may draw on, with a stable id. A claim in the
tailored resume must trace back to at least one of these. Skills the user said
they don't have (skills.level = 'none') never count as evidence.

Ids: profile rows are short refs (E1, P2, S3...); resume items are "R:" + the
resume's own id (R:exp_1_b2), so plans and validation can point at both.
"""

from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional, Set

from src.app.answers.profile_context import canonicalize
from src.app.resume.text import has_term, number_set, terms
from src.app.schemas.matching import Evidence
from src.app.schemas.resume import StructuredResume

# Evidence that shows a skill being used (vs. only listed).
WORK_SOURCES = {"experience", "project", "achievement", "fact"}


def _join(*parts: Any) -> str:
    out = []
    for part in parts:
        if isinstance(part, list):
            part = "; ".join(str(p) for p in part if p)
        if part:
            out.append(str(part).strip())
    return ". ".join(out)


def _dates(row: Dict[str, Any]) -> str:
    start = (row.get("start_date") or "")[:7]
    end = "present" if row.get("is_current") else (row.get("end_date") or "")[:7]
    return f"{start or '?'} – {end or '?'}" if start or end else ""


@dataclass
class EvidenceCorpus:
    items: List[Evidence]
    declined: Set[str] = field(default_factory=set)
    by_id: Dict[str, Evidence] = field(default_factory=dict)
    item_terms: Dict[str, Set[str]] = field(default_factory=dict)
    terms: Set[str] = field(default_factory=set)
    numbers: Set[str] = field(default_factory=set)

    def __post_init__(self) -> None:
        self.by_id = {e.id: e for e in self.items}
        for e in self.items:
            t = terms(_join(e.label, e.text, e.skills)) - self.declined
            self.item_terms[e.id] = t
            self.terms |= t
        self.numbers = number_set(_join(e.label, e.text) for e in self.items)

    def has(self, evidence_id: str) -> bool:
        return evidence_id in self.by_id

    def has_term(self, term: str) -> bool:
        return canonicalize(term) not in self.declined and has_term(self.terms, term)

    def ids_with_term(self, term: str) -> List[str]:
        if canonicalize(term) in self.declined:
            return []
        hits = [eid for eid, t in self.item_terms.items() if has_term(t, term)]
        if hits or len(term.split()) <= 3:
            return hits
        # Long names ("AWS Certified Solutions Architect"): every significant word in one evidence item.
        words = [canonicalize(w) for w in term.split() if len(w) > 2]
        return [eid for eid, t in self.item_terms.items() if words and all(w in t for w in words)]

    def labels(self, ids: Iterable[str]) -> List[str]:
        out: List[str] = []
        for eid in ids:
            e = self.by_id.get(eid)
            if e and e.label not in out:
                out.append(e.label)
        return out

    def text(self, ids: Iterable[str]) -> str:
        return "\n".join(f"[{eid}] {self.by_id[eid].label}: {self.by_id[eid].text}" for eid in ids if eid in self.by_id)


def build_corpus(data: Dict[str, Any], resume: Optional[StructuredResume]) -> EvidenceCorpus:
    """`data` holds the profile rows (profile, experiences, projects, skills, education, achievements, profile_facts)."""
    items: List[Evidence] = []
    skills = data.get("skills") or []
    declined = {canonicalize(s["name"]) for s in skills if s.get("level") == "none"}

    profile = data.get("profile") or {}
    if (profile.get("summary") or profile.get("headline") or profile.get("additional_context") or "").strip():
        items.append(Evidence(id="PR", source="profile", source_id=profile.get("id", ""), label="Profile",
                              text=_join(profile.get("headline"), profile.get("summary"),
                                         profile.get("additional_context"))))
    for i, r in enumerate(data.get("experiences") or [], start=1):
        items.append(Evidence(
            id=f"E{i}", source="experience", source_id=r.get("id", ""), label=f"{r.get('title')} at {r.get('company')}",
            text=_join(_dates(r), r.get("location"), r.get("description"), r.get("highlights")),
            skills=list(r.get("technologies") or []),
        ))
    for i, r in enumerate(data.get("projects") or [], start=1):
        items.append(Evidence(
            id=f"P{i}", source="project", source_id=r.get("id", ""), label=f"Project: {r.get('name')}",
            text=_join(r.get("role"), r.get("description"), r.get("highlights")), skills=list(r.get("technologies") or []),
        ))
    for i, r in enumerate([s for s in skills if s.get("level") != "none"], start=1):
        detail = ", ".join(x for x in [r.get("level"), f"{r['years']:g} years" if r.get("years") else None] if x)
        items.append(Evidence(id=f"S{i}", source="skill", source_id=r.get("id", ""), label=f"Skill: {r['name']}",
                              text=detail or "listed skill", skills=[r["name"]]))
    for i, r in enumerate(data.get("education") or [], start=1):
        label = ", ".join(x for x in [r.get("degree"), r.get("field_of_study")] if x) or "Education"
        items.append(Evidence(id=f"ED{i}", source="education", source_id=r.get("id", ""),
                              label=f"{label} — {r.get('institution')}",
                              text=_join(_dates(r), r.get("grade"), r.get("description"))))
    for i, r in enumerate(data.get("achievements") or [], start=1):
        items.append(Evidence(id=f"A{i}", source="achievement", source_id=r.get("id", ""), label=f"Achievement: {r.get('title')}",
                              text=_join(r.get("date"), r.get("description"))))
    for i, r in enumerate(data.get("profile_facts") or [], start=1):
        items.append(Evidence(id=f"F{i}", source="fact", source_id=r.get("id", ""), label=f"Fact: {r.get('prompt', '')[:80]}",
                              text=r.get("answer") or ""))

    if resume is not None:
        items += resume_evidence(resume)
    return EvidenceCorpus(items=items, declined=declined)


def resume_evidence(resume: StructuredResume) -> List[Evidence]:
    items: List[Evidence] = []
    if resume.summary:
        items.append(Evidence(id="R:summary", source="resume", source_id="summary", label="Resume summary", text=resume.summary))
    for exp in resume.experience:
        label = f"{exp.title} at {exp.company}"
        items.append(Evidence(id=f"R:{exp.id}", source="resume", source_id=exp.id, label=label,
                              text=_join(f"{exp.start_date or '?'} – {exp.end_date or '?'}", exp.location),
                              skills=list(exp.technologies)))
        for b in exp.bullets:
            items.append(Evidence(id=f"R:{b.id}", source="resume", source_id=b.id, label=label, text=b.text))
    for proj in resume.projects:
        label = f"Project: {proj.name}"
        items.append(Evidence(id=f"R:{proj.id}", source="resume", source_id=proj.id, label=label,
                              text=_join(proj.role, proj.url), skills=list(proj.technologies)))
        for b in proj.bullets:
            items.append(Evidence(id=f"R:{b.id}", source="resume", source_id=b.id, label=label, text=b.text))
    for group in resume.skills:
        items.append(Evidence(id=f"R:{group.id}", source="resume", source_id=group.id,
                              label=f"Resume skills{': ' + group.label if group.label else ''}",
                              text=", ".join(group.items), skills=list(group.items)))
    for edu in resume.education:
        label = ", ".join(x for x in [edu.degree, edu.field_of_study] if x) or "Education"
        items.append(Evidence(id=f"R:{edu.id}", source="resume", source_id=edu.id, label=f"{label} — {edu.institution}",
                              text=_join(edu.start_date, edu.end_date, edu.grade, [b.text for b in edu.bullets])))
    for ach in resume.achievements:
        items.append(Evidence(id=f"R:{ach.id}", source="resume", source_id=ach.id, label=f"Achievement: {ach.title}",
                              text=_join(ach.date, ach.description)))
    for cert in resume.certifications:
        items.append(Evidence(id=f"R:{cert.id}", source="resume", source_id=cert.id, label=f"Certification: {cert.name}",
                              text=_join(cert.issuer, cert.date)))
    for section in resume.custom_sections:
        for b in section.bullets:
            items.append(Evidence(id=f"R:{b.id}", source="resume", source_id=b.id, label=section.heading, text=b.text))
    return items


def is_work_evidence(e: Evidence) -> bool:
    """Shows the skill in use, not only listed (resume bullets and job/project headers count)."""
    if e.source in WORK_SOURCES:
        return True
    return e.source == "resume" and not e.source_id.startswith("skills") and e.source_id != "summary"
