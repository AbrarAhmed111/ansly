"""
Structured Profile Lookups.

Zero-token answers for factual questions the stored profile settles on its
own: work authorization for a named country, "do you have experience with X"
when X is in the profile, years with one skill, and the highest degree. Each
returns None when the data doesn't settle the question unambiguously, and the
question goes to the model as before. None of them ever answers "no" from
missing data: a gap is never treated as a negative.
"""

import re
from typing import Any, Dict, List, Optional, Tuple

from .profile_context import canonicalize

# Country -> patterns that name it. US is matched case-sensitively as "US" so the pronoun "us" never counts.
COUNTRIES: Dict[str, str] = {
    "us": r"\bunited states\b|\bu\.s\.a?\.?(?=\W|$)|\busa\b|\bamerica(?:n)?\b",
    "uk": r"\bunited kingdom\b|\bu\.?k\.?\b|\bbritain\b|\bbritish\b|\bengland\b",
    "canada": r"\bcanad(?:a|ian)\b",
    "australia": r"\baustralia(?:n)?\b",
    "eu": r"\beuropean union\b|\bthe eu\b|\beu (?:citizen|national|work)",
    "india": r"\bindia(?:n)?\b",
    "germany": r"\bgerman(?:y)?\b",
    "ireland": r"\bireland\b|\birish\b",
    "new zealand": r"\bnew zealand\b",
    "singapore": r"\bsingapore(?:an)?\b",
}
AUTHORIZED = re.compile(
    r"\b(?:citizen|citizenship|national|permanent resident|green card|authori[sz]ed to work|right to work|"
    r"settled status|indefinite leave)\b", re.IGNORECASE)
NOT_AUTHORIZED = re.compile(r"\b(?:not|no|without|need|needs|require|requires|pending|applying)\b", re.IGNORECASE)


def countries(text: str) -> set:
    found = {name for name, pattern in COUNTRIES.items() if re.search(pattern, text, re.IGNORECASE)}
    if re.search(r"\bUS\b", text):
        found.add("us")
    return found


def authorized_in_asked_country(question: str, value: Any) -> bool:
    """True only when the stored status is a clear, unconditional authorization for the one country asked about."""
    if not isinstance(value, str) or not AUTHORIZED.search(value) or NOT_AUTHORIZED.search(value):
        return False
    asked, held = countries(question), countries(value)
    return len(asked) == 1 and asked == held


def skill_years(rows: List[Dict[str, Any]], skill: str) -> Optional[str]:
    """Years the user gave for this exact skill, formatted as a number."""
    wanted = canonicalize(skill)
    hits = [r for r in rows if canonicalize(r.get("name") or "") == wanted and r.get("level") != "none"]
    if len(hits) != 1 or not isinstance(hits[0].get("years"), (int, float)) or hits[0]["years"] <= 0:
        return None
    return f"{hits[0]['years']:g}"


# Degree level, highest first: (rank, pattern over a degree name or an option). Lookarounds instead of word boundaries so
# abbreviations ending in a dot ("B.S.") match.
DEGREE_LEVELS = [(rank, re.compile(rf"(?<!\w)(?:{pattern})(?!\w)", re.IGNORECASE)) for rank, pattern in [
    (5, r"ph\.?\s?d\.?|doctor(?:ate|al)?|d\.?phil\.?|ed\.?d\.?"),
    (4, r"master'?s?|m\.?sc?\.?|m\.a\.|ma|mba|m\.?eng\.?|m\.?tech\.?|mphil"),
    (3, r"bachelor'?s?|b\.?sc?\.?|b\.a\.|ba|b\.?eng\.?|b\.?tech\.?|undergraduate degree"),
    (2, r"associate'?s?(?: degree)?|a\.a\.s?\.?|foundation degree"),
    (1, r"high school|secondary school|ged|a-levels?"),
]]


def degree_level(text: str) -> Optional[int]:
    for rank, pattern in DEGREE_LEVELS:
        if pattern.search(text or ""):
            return rank
    return None


HIGHEST_DEGREE_QUESTION = re.compile(r"\b(?:highest|level of education|education level|degree)\b", re.IGNORECASE)


def highest_degree_option(rows: List[Dict[str, Any]], options: List[str]) -> Optional[Tuple[str, Dict[str, Any]]]:
    """The option naming the user's highest completed degree (and that education row), when exactly one does."""
    ranked = [(degree_level(r.get("degree") or ""), r) for r in rows]
    ranked = [(level, r) for level, r in ranked if level is not None]
    if not ranked:
        return None
    highest, row = max(ranked, key=lambda pair: pair[0])
    hits = [o for o in options if degree_level(o) == highest]
    return (hits[0], row) if len(hits) == 1 else None
