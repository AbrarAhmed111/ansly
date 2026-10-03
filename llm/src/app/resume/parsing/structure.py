"""
LLM-Assisted Structuring: resume text -> Structured Resume JSON.

Rules identify the sections and contact details; the model only sorts the text
into fields, copying it verbatim. Ids are assigned in code. A confidence check
compares the output with the source text: if words went missing or appeared
from nowhere, or a detected section came back empty, the parse is marked
`needs_review` and the user confirms it before first use.
"""

import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set

from pydantic import ValidationError

from src.app.gateway import LLMGateway
from src.app.resume.llm import Usage, call_json
from src.app.schemas.resume import StructuredResume

from .sections import ContactHints, contact_hints, detected_kinds, split_sections

# Share of the source's words that must reappear in the structured output.
MIN_COVERAGE = 0.85
# Share of the output's words allowed to be absent from the source (formatting, normalized dates).
MAX_INVENTED = 0.04

SYSTEM_PROMPT = """You convert the text of a resume into JSON. Copy wording exactly as written: never rewrite, summarize, correct, translate, infer or add anything. If something is not in the text, use null or an empty list.

Return only a JSON object with this shape:
{
  "contact": {"name": str, "headline": str|null, "email": str|null, "phone": str|null, "location": str|null,
              "links": [{"label": str, "url": str}]},
  "summary": str|null,
  "experience": [{"company": str, "title": str, "location": str|null, "startDate": str|null, "endDate": str|null,
                  "isCurrent": bool, "bullets": [str], "technologies": [str]}],
  "projects": [{"name": str, "role": str|null, "url": str|null, "startDate": str|null, "endDate": str|null,
                "bullets": [str], "technologies": [str]}],
  "skills": [{"label": str|null, "items": [str]}],
  "education": [{"institution": str, "degree": str|null, "fieldOfStudy": str|null, "startDate": str|null,
                 "endDate": str|null, "grade": str|null, "bullets": [str]}],
  "achievements": [{"title": str, "description": str|null, "date": str|null, "url": str|null}],
  "certifications": [{"name": str, "issuer": str|null, "date": str|null, "url": str|null}],
  "customSections": [{"heading": str, "bullets": [str]}]
}

Rules:
- Dates exactly as written ("Mar 2022", "2021", "Present"). isCurrent is true only when the end date says Present/Current/Now.
- One bullet per bullet point or line of description, without the bullet character.
- technologies: only technologies the text explicitly lists for that job or project (e.g. a "Tech:" line); otherwise [].
- skills: keep the resume's own groups and labels; split comma-separated lists into items.
- Sections the schema doesn't cover (Languages, Volunteering, Publications...) go in customSections with their heading.
- Never drop content: every line of the resume belongs somewhere."""


@dataclass
class ParseResult:
    resume: StructuredResume
    status: str                      # parsed | needs_review
    notes: List[str] = field(default_factory=list)
    coverage: float = 1.0


def _words(text: str) -> Set[str]:
    return {w for w in re.findall(r"[a-z0-9][a-z0-9+#]*", text.lower()) if len(w) > 1}


def _output_text(resume: StructuredResume) -> str:
    return " ".join(str(v) for v in _walk(resume.to_json()))


def _walk(value: Any):
    if isinstance(value, dict):
        for key, v in value.items():
            if key not in ("id", "schemaVersion", "isCurrent"):
                yield from _walk(v)
    elif isinstance(value, list):
        for v in value:
            yield from _walk(v)
    elif isinstance(value, str):
        yield value


def _str(value: Any, limit: int = 300) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text[:limit] or None


def _bullets(prefix: str, items: Any) -> List[Dict[str, str]]:
    out = []
    for i, text in enumerate([b for b in (items or []) if isinstance(b, str) and b.strip()], start=1):
        out.append({"id": f"{prefix}_b{i}", "text": re.sub(r"^[•\-*–]\s*", "", text.strip())[:2000]})
    return out


def _list(items: Any) -> List[Any]:
    return [x for x in items if isinstance(x, dict)] if isinstance(items, list) else []


def _strings(items: Any) -> List[str]:
    return [str(x).strip()[:100] for x in items if str(x).strip()] if isinstance(items, list) else []


def to_structured(data: Dict[str, Any], hints: ContactHints) -> StructuredResume:
    """Model output -> validated StructuredResume, with ids assigned in code and contact details from the rules."""
    contact = data.get("contact") if isinstance(data.get("contact"), dict) else {}
    links = [
        {"label": (_str(link.get("label"), 100) or "Link"), "url": _str(link.get("url"), 2000)}
        for link in _list(contact.get("links")) if _str(link.get("url"), 2000)
    ]
    known = {link["url"].lower().removeprefix("https://").removeprefix("http://").removeprefix("www.") for link in links}
    for url in hints.links:
        bare = url.lower().removeprefix("https://").removeprefix("http://").removeprefix("www.")
        if bare not in known:
            label = "LinkedIn" if "linkedin" in bare else "GitHub" if "github" in bare else "Website"
            links.append({"label": label, "url": url})
    resume = {
        "schemaVersion": 1,
        "contact": {
            "name": _str(contact.get("name"), 200) or hints.name or "",
            "headline": _str(contact.get("headline")),
            "email": hints.email or _str(contact.get("email"), 320),
            "phone": hints.phone or _str(contact.get("phone"), 50),
            "location": _str(contact.get("location"), 200),
            "links": links[:20],
        },
        "summary": _str(data.get("summary"), 3000),
        "experience": [],
        "projects": [],
        "skills": [],
        "education": [],
        "achievements": [],
        "certifications": [],
        "customSections": [],
    }
    for i, row in enumerate(_list(data.get("experience")), start=1):
        if not (_str(row.get("company")) or _str(row.get("title"))):
            continue
        end = _str(row.get("endDate"), 50)
        resume["experience"].append({
            "id": f"exp_{i}", "company": _str(row.get("company")) or "—", "title": _str(row.get("title")) or "—",
            "location": _str(row.get("location"), 200), "startDate": _str(row.get("startDate"), 50), "endDate": end,
            "isCurrent": bool(row.get("isCurrent")) or bool(end and re.match(r"(?i)present|current|now", end)),
            "bullets": _bullets(f"exp_{i}", row.get("bullets")), "technologies": _strings(row.get("technologies")),
        })
    for i, row in enumerate(_list(data.get("projects")), start=1):
        if not _str(row.get("name")):
            continue
        resume["projects"].append({
            "id": f"proj_{i}", "name": _str(row.get("name")), "role": _str(row.get("role")),
            "url": _str(row.get("url"), 2000), "startDate": _str(row.get("startDate"), 50),
            "endDate": _str(row.get("endDate"), 50), "bullets": _bullets(f"proj_{i}", row.get("bullets")),
            "technologies": _strings(row.get("technologies")),
        })
    for i, row in enumerate(_list(data.get("skills")), start=1):
        items = _strings(row.get("items"))
        if items:
            resume["skills"].append({"id": f"skills_{i}", "label": _str(row.get("label"), 100), "items": items})
    for i, row in enumerate(_list(data.get("education")), start=1):
        if not _str(row.get("institution")):
            continue
        resume["education"].append({
            "id": f"edu_{i}", "institution": _str(row.get("institution")), "degree": _str(row.get("degree")),
            "fieldOfStudy": _str(row.get("fieldOfStudy")), "startDate": _str(row.get("startDate"), 50),
            "endDate": _str(row.get("endDate"), 50), "grade": _str(row.get("grade"), 100),
            "bullets": _bullets(f"edu_{i}", row.get("bullets")),
        })
    for i, row in enumerate(_list(data.get("achievements")), start=1):
        if _str(row.get("title")):
            resume["achievements"].append({
                "id": f"ach_{i}", "title": _str(row.get("title")), "description": _str(row.get("description"), 2000),
                "date": _str(row.get("date"), 50), "url": _str(row.get("url"), 2000),
            })
    for i, row in enumerate(_list(data.get("certifications")), start=1):
        if _str(row.get("name")):
            resume["certifications"].append({
                "id": f"cert_{i}", "name": _str(row.get("name")), "issuer": _str(row.get("issuer")),
                "date": _str(row.get("date"), 50), "url": _str(row.get("url"), 2000),
            })
    for i, row in enumerate(_list(data.get("customSections")), start=1):
        if _str(row.get("heading"), 100):
            resume["customSections"].append({
                "id": f"custom_{i}", "heading": _str(row.get("heading"), 100),
                "bullets": _bullets(f"custom_{i}", row.get("bullets")),
            })
    if not resume["contact"]["name"]:
        raise ValueError("Model output has no candidate name")
    try:
        return StructuredResume.model_validate(resume)
    except ValidationError as e:
        raise ValueError(f"Model output didn't fit the resume schema: {e.error_count()} errors") from e


SECTION_FIELDS = {"experience": "experience", "projects": "projects", "skills": "skills", "education": "education",
                  "certifications": "certifications", "achievements": "achievements", "summary": "summary"}


def assess(text: str, resume: StructuredResume) -> ParseResult:
    """Compares the structured output with the source text."""
    notes: List[str] = []
    headings = {s.heading.lower() for s in split_sections(text)}
    source = {w for w in _words(text) if w not in _words(" ".join(headings))}
    output = _words(_output_text(resume))
    coverage = len(source & output) / len(source) if source else 1.0
    invented = len(output - _words(text)) / len(output) if output else 0.0
    if coverage < MIN_COVERAGE:
        notes.append(f"Some text from your resume may be missing ({round(coverage * 100)}% was captured).")
    if invented > MAX_INVENTED:
        notes.append("Some parsed text doesn't appear word-for-word in your resume.")
    data = resume.to_json()
    for kind in set(detected_kinds(text)):
        field_name = SECTION_FIELDS.get(kind)
        if field_name and not data.get(field_name):
            notes.append(f"Your resume has a {kind} section, but nothing was read from it.")
    if not resume.experience and not resume.projects:
        notes.append("No experience or projects were found.")
    return ParseResult(resume=resume, status="needs_review" if notes else "parsed", notes=notes, coverage=coverage)


async def parse_resume(gateway: LLMGateway, text: str, usage: Optional[Usage] = None) -> ParseResult:
    hints = contact_hints(text)
    sections = split_sections(text)
    marked = "\n\n".join(
        (f"=== {s.kind.upper()}: {s.heading} ===\n" if s.kind != "header" else "=== HEADER ===\n") + s.text
        for s in sections
    )
    resume = await call_json(
        gateway, SYSTEM_PROMPT, f"RESUME TEXT (section markers added by a parser):\n\n{marked}",
        lambda data: to_structured(data, hints), usage=usage, max_tokens=8000, temperature=0.0,
    )
    return assess(text, resume)
