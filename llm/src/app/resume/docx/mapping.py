"""
Resume <-> Document Map.

Links each part of the Structured Resume (summary, bullets, skill groups, the
first line of every job/project/...) to the paragraphs of the user's Word
document, by text. Parsing copies text verbatim, so most parts match exactly.
Anything that can't be matched with confidence stays unmapped, and changes to
it are left out of the document rather than guessed at.
"""

import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set, Tuple

from lxml import etree

from src.app.resume.parsing.sections import heading_kind
from src.app.schemas.resume import StructuredResume

from .text import locate, norm, paragraphs, visible_text

# Resume section -> the heading kind that starts it in the document.
SECTION_KINDS = {"summary": "summary", "experience": "experience", "projects": "projects", "skills": "skills",
                 "education": "education", "achievements": "achievements", "certifications": "certifications"}
# Text that must be long enough to trust a "paragraph contains it" match.
MIN_PARTIAL = 12


@dataclass
class Para:
    element: etree._Element
    text: str
    key: str


@dataclass
class SkillRef:
    mode: str              # "inline": one paragraph lists the group; "lines": one paragraph per skill
    paras: List[int]


@dataclass
class ResumeMap:
    paras: List[Para]
    headings: List[int] = field(default_factory=list)
    summary: List[int] = field(default_factory=list)
    bullets: Dict[str, int] = field(default_factory=dict)
    # Bullets whose paragraph holds nothing else (safe to remove or copy).
    whole: Set[str] = field(default_factory=set)
    skills: Dict[str, SkillRef] = field(default_factory=dict)
    anchors: Dict[str, int] = field(default_factory=dict)
    # paragraph index -> resume section it belongs to (for section boundaries).
    owner: Dict[int, str] = field(default_factory=dict)

    def element(self, index: int) -> etree._Element:
        return self.paras[index].element


def word_spans(text: str, items: List[str]) -> Optional[List[Tuple[int, int]]]:
    """Each item located in order as a whole word ("Go" doesn't match inside "Google")."""
    spans: List[Tuple[int, int]] = []
    at = 0
    for item in items:
        found = None
        start = at
        while True:
            hit = locate(text, item, start)
            if hit is None:
                break
            before = text[hit[0] - 1] if hit[0] > 0 else " "
            after = text[hit[1]] if hit[1] < len(text) else " "
            if not (before.isalnum() or after.isalnum()):
                found = hit
                break
            start = hit[0] + 1
        if found is None:
            return None
        spans.append(found)
        at = found[1]
    return spans


class _Mapper:
    def __init__(self, body: etree._Element, resume: StructuredResume):
        self.resume = resume
        self.m = ResumeMap(paras=[Para(p, t, norm(t)) for p in paragraphs(body) for t in [visible_text(p)]])
        self.used: Set[int] = set()
        customs = {norm(s.heading) for s in resume.custom_sections}
        self.kinds: Dict[int, str] = {}
        for i, para in enumerate(self.m.paras):
            kind = heading_kind(para.text) if para.key else None
            if kind or (para.key and para.key in customs):
                self.m.headings.append(i)
                self.kinds[i] = kind if kind and para.key not in customs else f"custom:{para.key}"

    # -- ranges -------------------------------------------------------------------

    def section_range(self, kind: str) -> Tuple[int, int]:
        """Paragraphs under the section's heading; the whole document if there's no such heading."""
        total = len(self.m.paras)
        for n, i in enumerate(self.m.headings):
            if self.kinds[i] == kind:
                end = next((h for h in self.m.headings[n + 1:]), total)
                return i + 1, end
        if kind == "summary" and self.m.headings:
            return 0, self.m.headings[0]
        return 0, total

    # -- matching -------------------------------------------------------------------

    def find(self, target: str, lo: int, hi: int) -> Optional[Tuple[int, bool]]:
        """(paragraph, whole) for `target`: an exact paragraph first, then a paragraph containing it."""
        key = norm(target)
        if not key:
            return None
        for i in range(lo, hi):
            if i not in self.used and self.m.paras[i].key == key:
                return i, True
        if len(key) >= MIN_PARTIAL:
            for i in range(lo, hi):
                if i not in self.used and key in self.m.paras[i].key:
                    return i, False
        return None

    def anchor(self, needles: List[Optional[str]], lo: int, hi: int) -> Optional[int]:
        keys = [k for k in (norm(n) for n in needles if n) if len(k) >= 2]
        for i in range(lo, hi):
            if i in self.used or i in self.kinds:
                continue
            if any(re.search(rf"(?<![a-z0-9]){re.escape(k)}(?![a-z0-9])", self.m.paras[i].key) for k in keys):
                return i
        return None

    def claim(self, i: int, section: str) -> None:
        self.used.add(i)
        self.m.owner[i] = section

    # -- sections -------------------------------------------------------------------

    def summary(self) -> None:
        text = self.resume.summary
        if not text:
            return
        for lo, hi in (self.section_range("summary"), (0, len(self.m.paras))):
            found = self.find(text, lo, hi)
            if found:
                self.m.summary = [found[0]]
                self.claim(found[0], "summary")
                return
        # A summary written as several paragraphs.
        key = norm(text)
        paras = self.m.paras
        for i in range(len(paras)):
            joined = ""
            for j in range(i, min(i + 8, len(paras))):
                if j in self.used or not paras[j].key:
                    break
                joined = f"{joined} {paras[j].key}".strip()
                if joined == key and j > i:
                    self.m.summary = list(range(i, j + 1))
                    for k in self.m.summary:
                        self.claim(k, "summary")
                    return
                if not key.startswith(joined):
                    break

    def items(self, section: str, items: list, needles) -> None:
        lo, hi = self.section_range(SECTION_KINDS.get(section, section))
        cursor = lo
        for item in items:
            bullets = list(getattr(item, "bullets", []))
            first_bullet = None
            for b in bullets:
                found = self.find(b.text, cursor, hi)
                if found and found[1]:
                    first_bullet = found[0]
                    break
            anchor = self.anchor(needles(item), cursor, first_bullet if first_bullet is not None else hi)
            if anchor is not None:
                self.m.anchors[item.id] = anchor
                self.claim(anchor, section)
            start = anchor + 1 if anchor is not None else cursor
            last = anchor if anchor is not None else cursor - 1
            for b in bullets:
                found = self.find(b.text, start, hi) or self.find(b.text, lo, hi)
                if not found:
                    continue
                index, whole = found
                self.m.bullets[b.id] = index
                if whole:
                    self.m.whole.add(b.id)
                self.claim(index, section)
                if index >= start:
                    start = index + 1
                    last = max(last, index)
            cursor = max(cursor, last + 1)

    def skills(self) -> None:
        lo, hi = self.section_range("skills")
        for group in self.resume.skills:
            if not group.items:
                continue
            ref = None
            for a, b in ((lo, hi), (0, len(self.m.paras))):
                for i in range(a, b):
                    if i not in self.used and word_spans(self.m.paras[i].text, group.items):
                        ref = SkillRef("inline", [i])
                        break
                if ref:
                    break
            if ref is None:
                lines = []
                for item in group.items:
                    found = self.find(item, lo, hi)
                    if not found or not found[1]:
                        lines = []
                        break
                    lines.append(found[0])
                    self.used.add(found[0])
                for i in lines:
                    self.used.discard(i)
                if lines:
                    ref = SkillRef("lines", lines)
            if ref:
                self.m.skills[group.id] = ref
                for i in ref.paras:
                    self.claim(i, "skills")
                self.m.anchors[group.id] = ref.paras[0]

    def run(self) -> ResumeMap:
        r = self.resume
        self.summary()
        self.items("experience", r.experience, lambda i: [i.title, i.company])
        self.items("projects", r.projects, lambda i: [i.name])
        self.items("education", r.education, lambda i: [i.institution, i.degree])
        self.items("achievements", r.achievements, lambda i: [i.title])
        self.items("certifications", r.certifications, lambda i: [i.name])
        for section in r.custom_sections:
            self.items(f"custom:{norm(section.heading)}", [section], lambda i: [])
        self.skills()
        return self.m


def build_map(body: etree._Element, resume: StructuredResume) -> ResumeMap:
    return _Mapper(body, resume).run()
