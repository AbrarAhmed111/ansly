"""
Step 6: Tailored Resume -> Validation Report.

Runs after every tailoring, before anything is shown. Deterministic checks
first, each fixing what it finds:

- protected fields  titles, companies, dates, URLs, contact details, names equal the master exactly -> revert
- headline          the title line is the job's role, cleaned (job_fit.py) -> replaced
- traceability      every rewritten text cites evidence ids that exist -> revert; a new bullet
                    cites evidence about that same job or project -> left out
- metrics           every number in a rewritten text is in its cited evidence or the original -> remove the claim
- technology        every technology in a rewritten text is in its cited evidence or the original -> remove the claim
- skills            every skill on the tailored resume is in the evidence corpus -> remove
- keyword integrity no master skill disappears without a `reduce` reason -> restore

The LLM hallucination review (review.py) runs last and only flags.
"""

import re
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional, Set, Tuple

from src.app.answers.profile_context import canonicalize
from src.app.resume.matching.evidence import EvidenceCorpus
from src.app.resume.parsing.discrepancies import _company_key, _key
from src.app.resume.tailoring.apply import ITEM_SECTIONS, AppliedChange
from src.app.resume.tailoring.job_fit import fit_headline
from src.app.resume.text import number_set, numbers, tech_terms, terms
from src.app.schemas.job import JobAnalysis
from src.app.schemas.resume import ResumeSkillGroup, StructuredResume
from src.app.schemas.tailoring import TailoringChange, ValidationIssue

PROTECTED: Dict[str, Tuple[str, ...]] = {
    "experience": ("company", "title", "location", "start_date", "end_date", "is_current", "technologies"),
    "projects": ("name", "role", "url", "start_date", "end_date", "technologies"),
    "education": ("institution", "degree", "field_of_study", "start_date", "end_date", "grade", "bullets"),
    "achievements": ("title", "description", "date", "url"),
    "certifications": ("name", "issuer", "date", "url"),
}

SKIPPED_PREFIX = "Skipped a suggested change"
CREDENTIAL = re.compile(r"\b(?:certified|certification|certificate|licensed|license)\b", re.IGNORECASE)


@dataclass
class ValidationResult:
    resume: StructuredResume
    issues: List[ValidationIssue] = field(default_factory=list)
    applied: List[AppliedChange] = field(default_factory=list)


@dataclass
class TextChange:
    """A rewritten bullet or summary that survived so far."""

    key: str                    # bullet id, or "summary"
    section: str
    item: Optional[str]
    before: str
    after: str
    change: Optional[TailoringChange]

    @property
    def added(self) -> bool:
        """A new bullet (nothing to fall back to: reverting it leaves it out)."""
        return self.key != "summary" and not self.before


def _sentences(text: str) -> List[str]:
    return [s for s in re.split(r"(?<=[.!?])\s+", text.strip()) if s]


def _short(text: str, limit: int = 120) -> str:
    return text if len(text) <= limit else text[: limit - 1] + "…"


class Validator:
    def __init__(self, source: StructuredResume, tailored: StructuredResume, applied: List[AppliedChange],
                 corpus: EvidenceCorpus, analysis: Optional[JobAnalysis] = None):
        self.source = source
        self.resume = tailored.model_copy(deep=True)
        self.applied = list(applied)
        self.corpus = corpus
        self.issues: List[ValidationIssue] = []
        self.analysis = analysis
        skill_reqs = [r.requirement for r in (analysis.requirements if analysis else []) if r.type == "skill"]
        self.vocabulary: List[str] = skill_reqs + [s for e in corpus.items for s in e.skills]

    def issue(self, check: str, outcome: str, message: str, section: Optional[str] = None, item: Optional[str] = None,
              original: Optional[str] = None, attempted: Optional[str] = None) -> None:
        self.issues.append(ValidationIssue(check=check, outcome=outcome, section=section, item=item, message=message,
                                           original=original, attempted=attempted))

    # -- protected fields -----------------------------------------------------

    def protected_fields(self) -> None:
        # The headline is checked on its own (headline()); everything else in the contact block is protected.
        headline = self.resume.contact.headline
        if self.resume.contact.model_copy(update={"headline": self.source.contact.headline}) != self.source.contact:
            self.resume.contact = self.source.contact.model_copy(deep=True, update={"headline": headline})
            self.issue("protected_fields", "reverted", "Contact details were restored to your master resume.")
        if self.resume.custom_sections != self.source.custom_sections:
            self.resume.custom_sections = [s.model_copy(deep=True) for s in self.source.custom_sections]
            self.issue("protected_fields", "reverted", "Additional sections were restored to your master resume.")
        for section, fields in PROTECTED.items():
            attr = ITEM_SECTIONS[section]
            originals = {i.id: i for i in getattr(self.source, attr)}
            kept = []
            for item in getattr(self.resume, attr):
                original = originals.get(item.id)
                if original is None:
                    self.issue("protected_fields", "removed", f"An item that isn't on your master resume was removed ({section}).",
                               section=section, item=item.id)
                    continue
                for name in fields:
                    if getattr(item, name) != getattr(original, name):
                        setattr(item, name, getattr(original, name))
                        self.issue("protected_fields", "reverted",
                                   f"{name.replace('_', ' ').capitalize()} restored for {getattr(original, 'title', None) or getattr(original, 'name', None) or getattr(original, 'institution', item.id)}.",
                                   section=section, item=item.id)
                kept.append(item)
            setattr(self.resume, attr, kept)
        # Bullets come from the master (rewritten in place), or from an add_bullet change checked below.
        added = {a.change.bullet_id for a in self.applied if a.change.action == "add_bullet"}
        for section in ("experience", "projects"):
            originals = {i.id: {b.id for b in i.bullets} for i in getattr(self.source, section)}
            for item in getattr(self.resume, section):
                extra = [b for b in item.bullets if b.id not in originals.get(item.id, set()) and b.id not in added]
                for b in extra:
                    item.bullets.remove(b)
                    self.issue("protected_fields", "removed", "A bullet that isn't on your master resume was removed.",
                               section=section, item=item.id, attempted=b.text)

    def headline(self) -> None:
        self.resume.contact.headline = fit_headline(
            self.source.contact.headline, self.resume.contact.headline,
            self.analysis.role if self.analysis else None, [e.title for e in self.source.experience],
        )

    # -- rewritten text -------------------------------------------------------

    def text_changes(self) -> List[TextChange]:
        by_bullet = {a.change.bullet_id: a.change for a in self.applied
                     if a.change.action in ("rewrite_bullet", "align_terms", "add_bullet") and a.change.bullet_id}
        summary_change = next((a.change for a in self.applied if a.change.section == "summary"), None)
        out: List[TextChange] = []
        if (self.resume.summary or "") != (self.source.summary or ""):
            out.append(TextChange("summary", "summary", None, self.source.summary or "", self.resume.summary or "", summary_change))
        for section in ("experience", "projects"):
            originals = {b.id: b.text for i in getattr(self.source, section) for b in i.bullets}
            for item in getattr(self.resume, section):
                for b in item.bullets:
                    if b.id in originals and b.text != originals[b.id]:
                        out.append(TextChange(b.id, section, item.id, originals[b.id], b.text, by_bullet.get(b.id)))
                    elif b.id not in originals and b.id in by_bullet:
                        out.append(TextChange(b.id, section, item.id, "", b.text, by_bullet[b.id]))
        return out

    def _set_text(self, tc: TextChange, text: str) -> None:
        tc.after = text
        if tc.key == "summary":
            self.resume.summary = text or None
            return
        for item in getattr(self.resume, tc.section):
            for b in item.bullets:
                if b.id == tc.key:
                    b.text = text

    def _revert(self, tc: TextChange) -> None:
        if tc.added:
            for item in getattr(self.resume, tc.section):
                item.bullets = [b for b in item.bullets if b.id != tc.key]
            tc.after = ""
            self.applied = [a for a in self.applied if a.change is not tc.change]
            return
        self._set_text(tc, tc.before)
        tc.after = tc.before
        self.applied = [a for a in self.applied if a.change is not tc.change]

    def _allowed_text(self, tc: TextChange) -> str:
        ids = [i for i in (tc.change.evidence_ids if tc.change else []) if self.corpus.has(i)]
        own = ""
        if tc.item:
            item = next((i for i in getattr(self.source, tc.section) if i.id == tc.item), None)
            if item is not None:
                own = " ".join([getattr(item, "title", "") or getattr(item, "name", ""), " ".join(item.technologies)])
        return "\n".join([tc.before, own, *(f"{self.corpus.by_id[i].label}. {self.corpus.by_id[i].text}. "
                                            f"{', '.join(self.corpus.by_id[i].skills)}" for i in ids)])

    def _strip_claims(self, tc: TextChange, bad: Iterable[str], check: str, describe: str) -> None:
        """Bullets go back to the original; a summary loses only the offending sentences."""
        bad = list(bad)
        sentence_check, check = check, ("traceability" if check == "credential" else check)
        if tc.key != "summary":
            attempted = tc.after
            self._revert(tc)
            kept = "The new bullet was left out." if tc.added else "The original bullet was kept."
            self.issue(check, "reverted", f"{describe}: {', '.join(bad)}. {kept}",
                       section=tc.section, item=tc.item, original=tc.before, attempted=attempted)
            return
        kept = [s for s in _sentences(tc.after) if not self._sentence_has(s, bad, sentence_check)]
        attempted = tc.after
        if not kept:
            self._revert(tc)
            self.issue(check, "reverted", f"{describe}: {', '.join(bad)}. Your original summary was kept.",
                       section="summary", original=tc.before, attempted=attempted)
        else:
            self._set_text(tc, " ".join(kept))
            self.issue(check, "removed", f"{describe}: {', '.join(bad)}. That sentence was removed from the summary.",
                       section="summary", original=tc.before, attempted=attempted)

    def _sentence_has(self, sentence: str, bad: List[str], check: str) -> bool:
        if check == "metrics":
            return bool(set(numbers(sentence)) & set(bad))
        if check == "credential":
            return bool(CREDENTIAL.search(sentence))
        return bool(terms(sentence) & {canonicalize(b) for b in bad})

    def _about_item(self, evidence_id: str, tc: TextChange) -> bool:
        """Evidence about the job or project a new bullet goes under (never another job's achievements)."""
        if evidence_id == f"R:{tc.item}" or evidence_id.startswith(f"R:{tc.item}_b"):
            return True
        item = next((i for i in getattr(self.source, tc.section) if i.id == tc.item), None)
        e = self.corpus.by_id.get(evidence_id)
        if item is None or e is None:
            return False
        if tc.section == "experience" and e.source == "experience":
            return _company_key(e.label.rsplit(" at ", 1)[-1]) == _company_key(item.company)
        if tc.section == "projects" and e.source == "project":
            return _key(e.label.removeprefix("Project: ")) == _key(item.name)
        return False

    def rewritten_text(self) -> None:
        for tc in self.text_changes():
            # Traceability: a rewrite rests on evidence that exists; a new bullet on evidence about its own item.
            cited = [i for i in (tc.change.evidence_ids if tc.change else []) if self.corpus.has(i)]
            if tc.added and tc.change:
                tc.change.evidence_ids = [i for i in cited if self._about_item(i, tc)]
                cited = tc.change.evidence_ids
            if not cited and tc.added:
                attempted = tc.after
                self._revert(tc)
                self.issue("traceability", "removed",
                           "A new bullet didn't cite evidence from that same job or project, so it was left out.",
                           section=tc.section, item=tc.item, attempted=attempted)
                continue
            if not cited:
                attempted = tc.after
                self._revert(tc)
                self.issue("traceability", "reverted",
                           "A rewrite didn't cite real evidence, so the original was kept." if tc.key != "summary"
                           else "The new summary didn't cite real evidence, so your original summary was kept.",
                           section=tc.section, item=tc.item, original=tc.before, attempted=attempted)
                continue
            allowed = self._allowed_text(tc)
            # Metrics: no number the evidence doesn't have.
            bad_numbers = sorted(set(numbers(tc.after)) - number_set([allowed]))
            if bad_numbers:
                self._strip_claims(tc, bad_numbers, "metrics", "Metric not found in your profile")
                if tc.after == tc.before:
                    continue
            # Technologies: none the evidence doesn't have.
            allowed_terms = terms(allowed)
            bad_tech = sorted(t for t in tech_terms(tc.after, self.vocabulary)
                              if t not in allowed_terms or t in self.corpus.declined)
            if bad_tech:
                self._strip_claims(tc, bad_tech, "unsupported_technology", "Technology not supported by your evidence")
                if tc.after == tc.before:
                    continue
            # Credentials: a certification or license is only claimed when the evidence has one.
            if CREDENTIAL.search(tc.after) and not CREDENTIAL.search(allowed):
                self._strip_claims(tc, [CREDENTIAL.search(tc.after).group(0)], "credential",
                                   "Certification not found in your profile")

    # -- skills -----------------------------------------------------------------

    def skills(self) -> None:
        source_skills = {canonicalize(s): (g.id, s) for g in self.source.skills for s in g.items}
        for group in self.resume.skills:
            for skill in list(group.items):
                c = canonicalize(skill)
                if c in source_skills and c not in self.corpus.declined:
                    continue
                if c not in source_skills and self.corpus.has_term(skill):
                    continue
                group.items.remove(skill)
                self.issue("unsupported_technology", "removed", f"{skill} was removed: it isn't in your profile or resume.",
                           section="skills", item=group.id, attempted=skill)
        self.resume.skills = [g for g in self.resume.skills if g.items]

        reduced = {canonicalize(v) for a in self.applied
                   if a.change.action == "reduce" and a.change.section == "skills" and a.change.reason.strip()
                   for v in a.change.values or []}
        present = {canonicalize(s) for g in self.resume.skills for s in g.items}
        for c, (group_id, name) in source_skills.items():
            if c in present or c in reduced or c in self.corpus.declined:
                continue
            group = next((g for g in self.resume.skills if g.id == group_id), None)
            if group is None:
                original = next(g for g in self.source.skills if g.id == group_id)
                group = ResumeSkillGroup(id=original.id, label=original.label, items=[])
                self.resume.skills.append(group)
            group.items.append(name)
            present.add(c)
            self.issue("keyword_integrity", "restored", f"{name} was restored to your skills.", section="skills",
                       item=group_id)

    def run(self) -> ValidationResult:
        self.protected_fields()
        self.headline()
        self.rewritten_text()
        self.skills()
        return ValidationResult(resume=self.resume, issues=self.issues, applied=self.applied)


def validate(source: StructuredResume, tailored: StructuredResume, applied: List[AppliedChange],
             corpus: EvidenceCorpus, analysis: Optional[JobAnalysis] = None,
             rejected: Optional[List[Tuple[TailoringChange, str]]] = None) -> ValidationResult:
    result = Validator(source, tailored, applied, corpus, analysis).run()
    for change, reason in rejected or []:
        result.issues.append(ValidationIssue(
            check="traceability", outcome="reverted", section=change.section, item=change.item,
            message=f"{SKIPPED_PREFIX}: {reason}", attempted=change.text,
        ))
    return result


def user_warnings(issues: List[ValidationIssue]) -> List[str]:
    """Grouped, user-facing warnings for the result card ("1 metric removed: not found in your profile")."""
    shown = [i for i in issues if not i.message.startswith(SKIPPED_PREFIX)]
    counts: Dict[str, int] = {}
    for i in shown:
        counts[i.check] = counts.get(i.check, 0) + 1
    out: List[str] = []
    phrases = {
        "metrics": ("metric removed: not found in your profile", "metrics removed: not found in your profile"),
        "unsupported_technology": ("unsupported technology removed", "unsupported technologies removed"),
        "traceability": ("rewrite reverted: no supporting evidence", "rewrites reverted: no supporting evidence"),
        "protected_fields": ("protected detail restored from your master", "protected details restored from your master"),
        "keyword_integrity": ("skill restored to your resume", "skills restored to your resume"),
        "hallucination_review": ("sentence flagged for your review", "sentences flagged for your review"),
        "document": ("change left out to protect your document's formatting",
                     "changes left out to protect your document's formatting"),
    }
    for check, count in counts.items():
        if check in phrases:
            one, many = phrases[check]
            out.append(f"{count} {one if count == 1 else many}")
    out += [i.message for i in shown if i.check == "formatting"]
    added = [i.attempted for i in shown if i.check == "unverified_skill" and i.attempted]
    if added:
        out.append(f"{len(added)} {'skill' if len(added) == 1 else 'skills'} added from the job that your profile "
                   f"doesn't show: {', '.join(added)}. Remove any you don't have before sending.")
    return out


def unique(values: Iterable[str]) -> List[str]:
    seen: Set[str] = set()
    return [v for v in values if not (v in seen or seen.add(v))]
