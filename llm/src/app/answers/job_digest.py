"""
Job Description Digest.

Answers used to carry the raw job description (up to JOB_DESCRIPTION_MAX_CHARS)
in every prompt. Most of a posting is irrelevant to any one question, and some of
it (benefits, equal-opportunity statements, interview process) is irrelevant to
all of them. This module, with no model:

- strip_boilerplate(): drops sections whose heading marks them as boilerplate.
- digest(): keeps the lines most relevant to a question within a character
  budget, in their original order and under their original headings. A posting
  that already fits the budget is passed through whole.
"""

import re
from dataclasses import dataclass
from typing import List, Optional, Set

from .profile_context import relevance_terms

# Anchored at the heading's start, so a short content line such as "Competitive salary" never reads as a
# boilerplate heading that would drop the lines after it.
BOILERPLATE_HEADING = re.compile(
    r"^(?:\W|our|the|what|your)*\s*(?:benefits?|perks|compensation|salary|pay range|equal (?:opportunity|employment)|"
    r"eeo|diversity|inclusion|accommodations?|interview(?:ing)? process|hiring process|how to apply|"
    r"application process|privacy|we offer|offer)\b",
    re.IGNORECASE,
)
BOILERPLATE_LINE = re.compile(
    r"\b(?:equal opportunity employer|regardless of (?:race|gender)|reasonable accommodations?|e-?verify)\b",
    re.IGNORECASE,
)
# Headings whose lines describe what the job needs: kept first when the budget is tight.
CORE_HEADING = re.compile(
    r"\b(?:requirements?|qualifications?|what you'?ll (?:do|bring|need)|you have|you will|responsibilit\w*|"
    r"looking for|must|nice to have|preferred|bonus|skills|the role|about the role|role|tech(?:nology)? stack)\b",
    re.IGNORECASE,
)
BULLET = re.compile(r"^\s*(?:[-*•·▪◦]|\d+[.)])\s+")


@dataclass
class _Line:
    index: int
    text: str
    heading: Optional[str]
    is_heading: bool


def _is_heading(line: str) -> bool:
    text = line.strip()
    if not text or len(text) > 70 or BULLET.match(text):
        return False
    return text.endswith(":") or not re.search(r"[.!?,;]$", text) and len(text.split()) <= 8


# Longer lines are split into sentences, so a posting scraped as one paragraph can still be trimmed.
LONG_LINE = 300


def _lines(description: str) -> List[_Line]:
    out: List[_Line] = []
    heading: Optional[str] = None
    for raw in description.splitlines():
        text = raw.rstrip()
        if not text.strip():
            continue
        if _is_heading(text):
            heading = text.strip().rstrip(":")
            out.append(_Line(len(out), text, heading, True))
            continue
        parts = re.split(r"(?<=[.!?])\s+", text.strip()) if len(text) > LONG_LINE else [text]
        for part in parts:
            out.append(_Line(len(out), part, heading, False))
    return out


def strip_boilerplate(description: str) -> str:
    """The description without benefits, compensation, EEO, interview-process and similar sections."""
    kept = [line.text for line in _lines(description or "")
            if not (line.heading and BOILERPLATE_HEADING.search(line.heading)) and not BOILERPLATE_LINE.search(line.text)]
    return "\n".join(kept)


def digest(description: Optional[str], budget_chars: int, query: str = "", prefer_intro: bool = False) -> str:
    """The parts of a job description that matter for `query`, within `budget_chars`.

    Lines score by shared terms with the query, plus a bonus under requirement / responsibility headings;
    `prefer_intro` (motivation and cover letters) also favors the company and role introduction."""
    if budget_chars <= 0 or not (description or "").strip():
        return ""
    cleaned = strip_boilerplate(description)
    if len(cleaned) <= budget_chars:
        return cleaned
    lines = _lines(cleaned)
    query_terms: Set[str] = relevance_terms(query) if query.strip() else set()
    first_heading = next((line.heading for line in lines if line.heading), None)

    def score(line: _Line) -> float:
        value = len(relevance_terms(line.text) & query_terms) * 2.0
        if line.heading and CORE_HEADING.search(line.heading):
            value += 1.5
        if prefer_intro and (line.heading is None or line.heading == first_heading
                             or re.search(r"\babout\b", line.heading, re.IGNORECASE)):
            value += 2.0
        # Earlier lines tend to say more about the role than later ones.
        return value - line.index * 0.001

    chosen: Set[int] = set()
    used = 0
    for line in sorted((line for line in lines if not line.is_heading), key=score, reverse=True):
        cost = len(line.text) + 1
        if used + cost > budget_chars:
            continue
        chosen.add(line.index)
        used += cost

    if not chosen:
        # Nothing fits whole (one unbroken block of text): keep its start.
        return cleaned[:budget_chars]
    out: List[str] = []
    last_heading: Optional[str] = None
    for line in lines:
        if line.index not in chosen:
            continue
        if line.heading and line.heading != last_heading:
            out.append(f"{line.heading}:")
            last_heading = line.heading
        out.append(line.text)
    return "\n".join(out)
