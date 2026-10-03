"""
Rule-Based Section Identification and Contact Details.

Rules find the section headings and contact details (cheap, deterministic, and
checkable); the LLM only structures the content inside each section.
"""

import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional

SECTION_HEADINGS: Dict[str, List[str]] = {
    "summary": ["summary", "professional summary", "profile", "professional profile", "about", "about me",
                "objective", "career objective", "career summary", "overview"],
    "experience": ["experience", "work experience", "professional experience", "employment", "employment history",
                   "work history", "career history", "relevant experience", "experience history"],
    "projects": ["projects", "personal projects", "selected projects", "key projects", "side projects",
                 "open source", "open-source projects", "portfolio"],
    "skills": ["skills", "technical skills", "core skills", "key skills", "technologies", "tech stack",
               "core competencies", "competencies", "tools", "skills & tools", "skills and tools", "expertise"],
    "education": ["education", "academic background", "education & training", "qualifications", "academics"],
    "certifications": ["certifications", "certificates", "licenses", "licenses & certifications",
                       "licenses and certifications", "certifications & licenses"],
    "achievements": ["achievements", "awards", "honors", "honours", "awards & honors", "accomplishments",
                     "awards and achievements", "key achievements"],
    "custom": ["languages", "volunteering", "volunteer experience", "publications", "interests", "hobbies",
               "references", "leadership", "activities", "additional information", "courses", "training"],
}

_HEADING_LOOKUP = {heading: kind for kind, headings in SECTION_HEADINGS.items() for heading in headings}

EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
PHONE = re.compile(r"(?<![\w(])(?:\+?\(?\d[\d ().-]{7,}\d)(?!\w)")
URL = re.compile(r"(?:https?://)?(?:www\.)?(?:[\w-]+\.)+[a-z]{2,}(?:/[\w\-./?%&=#~+]*)?", re.IGNORECASE)


@dataclass
class Section:
    kind: str           # summary | experience | ... | custom | header
    heading: str
    lines: List[str] = field(default_factory=list)

    @property
    def text(self) -> str:
        return "\n".join(self.lines).strip()


def heading_kind(line: str) -> Optional[str]:
    """The section a heading line starts, or None if the line isn't a heading."""
    text = re.sub(r"[:|•\-–—_=*#]+$", "", line.strip()).strip()
    text = re.sub(r"^[•\-–—_=*#\d.\s]+", "", text)
    if not text or len(text) > 40 or len(text.split()) > 5:
        return None
    return _HEADING_LOOKUP.get(re.sub(r"\s+", " ", text.lower()))


def split_sections(text: str) -> List[Section]:
    """Splits resume text at known headings. Text before the first heading is the "header" (name, contact)."""
    sections = [Section("header", "")]
    for line in text.split("\n"):
        kind = heading_kind(line)
        if kind:
            sections.append(Section(kind, line.strip().rstrip(":")))
        else:
            sections[-1].lines.append(line)
    return [s for s in sections if s.text or s.kind != "header"]


@dataclass
class ContactHints:
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    links: List[str] = field(default_factory=list)


def contact_hints(text: str) -> ContactHints:
    """Deterministic contact details; these win over the model's reading."""
    header = split_sections(text)[0]
    head_text = header.text if header.kind == "header" else "\n".join(text.split("\n")[:8])
    hints = ContactHints()
    email = EMAIL.search(text)
    hints.email = email.group(0) if email else None
    phone = PHONE.search(head_text)
    if phone and sum(c.isdigit() for c in phone.group(0)) >= 8:
        hints.phone = phone.group(0).strip()
    for match in URL.finditer(head_text):
        url = match.group(0).rstrip(".,)")
        if "@" in head_text[max(0, match.start() - 1):match.start() + 1] or (hints.email and url in hints.email):
            continue
        if url not in hints.links:
            hints.links.append(url)
    for line in head_text.split("\n"):
        # "Priya Patel | Product Designer | priya@example.com": the name is the first segment.
        candidate = re.split(r"\s[|\u2022\u00b7]\s|,", line.strip())[0].strip()
        if (candidate and not EMAIL.search(candidate) and not PHONE.search(candidate)
                and not URL.fullmatch(candidate) and len(candidate.split()) <= 5 and not any(ch.isdigit() for ch in candidate)):
            hints.name = candidate
            break
    return hints


def detected_kinds(text: str) -> List[str]:
    return [s.kind for s in split_sections(text) if s.kind != "header"]
