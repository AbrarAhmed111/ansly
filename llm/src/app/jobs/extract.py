"""
Requirement Extraction.

Deterministic, zero-token reading of a job posting: plain text from HTML,
skills, years of experience, workplace, salary, seniority and employment
type. Every value is something a user can check against the posting.
"""

import html
import re
from dataclasses import dataclass
from typing import Optional, Tuple

from .vocabulary import find_skills

# --- Text --------------------------------------------------------------------

_BLOCK_TAGS = re.compile(r"</?(?:p|div|br|li|ul|ol|h[1-6]|tr|section|article|blockquote)\b[^>]*>", re.IGNORECASE)
_TAGS = re.compile(r"<[^>]+>")


def html_to_text(value: Optional[str]) -> str:
    """Plain text from posting HTML (also handles HTML that was escaped twice, as Greenhouse sends it)."""
    if not value:
        return ""
    text = html.unescape(value)
    if "&lt;" in text or "&amp;" in text:
        text = html.unescape(text)
    text = re.sub(r"<li\b[^>]*>", "\n• ", text, flags=re.IGNORECASE)
    text = _BLOCK_TAGS.sub("\n", text)
    text = _TAGS.sub("", text)
    text = text.replace("\xa0", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\s*\n\s*", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


# --- Experience ----------------------------------------------------------------

_YEARS = re.compile(
    r"(?P<min>\d{1,2})(?:\.\d)?\s*(?:\+|plus)?\s*(?:(?:-|–|—|to)\s*(?P<max>\d{1,2})\s*)?\+?\s*"
    r"(?:years?|yrs?)(?:\s+of)?(?P<tail>[^.\n;]{0,60})",
    re.IGNORECASE,
)
_YEARS_CONTEXT = re.compile(r"experience|engineering|development|industry|professional|building|working|in a similar|in software", re.IGNORECASE)


def extract_experience_years(text: str) -> Optional[float]:
    """Minimum years of experience the posting asks for ("4+ years of experience" -> 4)."""
    for match in _YEARS.finditer(text or ""):
        years = int(match.group("min"))
        if not 1 <= years <= 20:
            continue
        # "5 years" must be about the candidate's experience, not the company's history.
        if not _YEARS_CONTEXT.search(match.group("tail") or "") and "experience" not in text[max(0, match.start() - 40):match.start()].lower():
            continue
        return float(years)
    return None


# --- Workplace ---------------------------------------------------------------

def extract_workplace(*hints: Optional[str]) -> Optional[str]:
    """remote / hybrid / onsite from location strings, ATS fields or the description (first hint wins)."""
    for hint in hints:
        if not hint:
            continue
        h = hint.lower()
        if re.search(r"\bhybrid\b", h):
            return "hybrid"
        if re.search(r"\b(?:fully remote|remote[- ]first|100% remote|work from anywhere|remote)\b", h):
            # "Remote" next to an office city with "hybrid" handled above; plain remote wins.
            return "remote"
        if re.search(r"\b(?:on[- ]?site|in[- ]office|in the office)\b", h):
            return "onsite"
    return None


# --- Salary --------------------------------------------------------------------

_CURRENCY_SYMBOLS = {"$": "USD", "€": "EUR", "£": "GBP"}
_CURRENCY_CODES = r"USD|EUR|GBP|CAD|AUD|CHF|SGD|INR"
_AMOUNT = r"(\d{1,3}(?:[,.]\d{3})+|\d+(?:\.\d+)?)\s*([kK])?"
_SALARY = re.compile(
    rf"(?P<cur>[$€£]|(?:{_CURRENCY_CODES})\s?)\s?{_AMOUNT}"
    rf"\s*(?:-|–|—|to)\s*(?P<cur2>[$€£]|(?:{_CURRENCY_CODES})\s?)?\s?{_AMOUNT}"
    rf"(?P<tail>[^.\n]{{0,30}})",
)


@dataclass
class Salary:
    min: int
    max: int
    currency: str
    period: str  # year | month | hour


def _amount(number: str, k: Optional[str]) -> float:
    if re.fullmatch(r"\d{1,3}(?:[,.]\d{3})+", number):
        value = float(re.sub(r"[,.]", "", number))
    else:
        value = float(number)
    return value * 1000 if k else value


def extract_salary(text: str) -> Optional[Salary]:
    """The first salary range in `text` ("$100k–140k", "€60,000 - €80,000 per year")."""
    for m in _SALARY.finditer(text or ""):
        groups = m.groups()
        # "$100–140k": a "k" on the upper bound applies to both.
        low = _amount(groups[1], groups[2] or (groups[5] if float(groups[1].replace(",", "")) < 1000 else None))
        high = _amount(groups[4], groups[5] or groups[2])
        if low > high:
            continue
        cur = m.group("cur").strip()
        currency = _CURRENCY_SYMBOLS.get(cur, cur.upper())
        tail = (m.group("tail") or "").lower()
        if re.search(r"\b(?:per|an|/)\s*(?:hour|hr)\b|hourly", tail) or high < 500:
            period = "hour"
        elif re.search(r"\b(?:per|a|/)\s*month\b|monthly", tail) or high < 25_000:
            period = "month"
        else:
            period = "year"
        if period == "year" and high < 10_000:
            continue
        return Salary(min=int(low), max=int(high), currency=currency, period=period)
    return None


# --- Seniority and employment type ---------------------------------------------

_SENIORITY = [
    ("intern", r"\b(?:intern(?:ship)?|working student|werkstudent|trainee)\b"),
    ("principal", r"\b(?:principal|staff|distinguished)\b"),
    ("lead", r"\b(?:lead|head of|tech lead|engineering manager)\b"),
    ("senior", r"\b(?:senior|sr\.?)\b"),
    ("junior", r"\b(?:junior|jr\.?|entry[- ]level|graduate|new grad)\b"),
]

# Years of experience a seniority usually implies, when the posting doesn't say.
SENIORITY_YEARS = {"intern": 0, "junior": 0, "mid": 2, "senior": 5, "lead": 7, "principal": 8}


def extract_seniority(title: str) -> Optional[str]:
    t = (title or "").lower()
    for level, pattern in _SENIORITY:
        if re.search(pattern, t):
            return level
    return None


def normalize_employment_type(*values: Optional[str]) -> Optional[str]:
    for value in values:
        v = re.sub(r"[\s_-]+", "", (value or "").lower())
        if not v:
            continue
        if "intern" in v or "werkstudent" in v or "student" in v:
            return "internship"
        if "parttime" in v or "teilzeit" in v:
            return "part_time"
        if "contract" in v or "freelance" in v or "contractor" in v:
            return "contract"
        if "temporary" in v or "temp" == v:
            return "temporary"
        if "fulltime" in v or "permanent" in v or "vollzeit" in v:
            return "full_time"
    return None


# --- Everything ----------------------------------------------------------------

@dataclass
class Requirements:
    skills: list
    experience_years_min: Optional[float]
    workplace: Optional[str]
    salary: Optional[Salary]
    seniority: Optional[str]


def extract_requirements(title: str, description: str, location: Optional[str] = None,
                         workplace_hint: Optional[str] = None) -> Requirements:
    text = f"{title}\n{description or ''}"
    return Requirements(
        skills=find_skills(text),
        experience_years_min=extract_experience_years(description or ""),
        workplace=extract_workplace(workplace_hint, location, _workplace_sentence(description)),
        salary=extract_salary(description or ""),
        seniority=extract_seniority(title),
    )


def _workplace_sentence(description: Optional[str]) -> Optional[str]:
    """The description's workplace statement, if it has a clear one."""
    if not description:
        return None
    m = re.search(
        r"[^.\n]*\b(?:fully remote|remote[- ]first|100% remote|work from anywhere|hybrid|on[- ]?site|in[- ]office)\b[^.\n]*",
        description,
        re.IGNORECASE,
    )
    return m.group(0) if m else None


def salary_tuple(s: Optional[Salary]) -> Tuple[Optional[int], Optional[int], Optional[str], Optional[str]]:
    return (s.min, s.max, s.currency, s.period) if s else (None, None, None, None)
