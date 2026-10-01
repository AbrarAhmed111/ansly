"""
Normalized Job Record.

Every source adapter produces `NormalizedJob`s; ingestion stores them in the
`jobs` table. `dedupe_key` identifies the same job across sources.
"""

import re
import unicodedata
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from src.app.answers.profile_context import canonicalize

from .extract import extract_requirements, html_to_text, salary_tuple

# Posting descriptions are stored in full up to this length.
MAX_DESCRIPTION_CHARS = 20_000

# Gender/notation suffixes that don't change the job: "(m/w/d)", "(f/m/x)", "(all genders)".
_TITLE_NOISE = re.compile(r"\((?:[mwfdx]\s*/\s*){1,3}[mwfdx]\)|\(all genders?\)|\(gn\)", re.IGNORECASE)


@dataclass
class NormalizedJob:
    external_id: str
    url: str
    title: str
    company: str
    apply_url: Optional[str] = None
    location: Optional[str] = None
    workplace: Optional[str] = None
    employment_type: Optional[str] = None
    department: Optional[str] = None
    seniority: Optional[str] = None
    description: Optional[str] = None
    skills: List[str] = field(default_factory=list)
    experience_years_min: Optional[float] = None
    salary_min: Optional[int] = None
    salary_max: Optional[int] = None
    salary_currency: Optional[str] = None
    salary_period: Optional[str] = None
    posted_at: Optional[str] = None

    @property
    def dedupe_key(self) -> str:
        return dedupe_key(self.company, self.title, self.location)

    def row(self) -> Dict[str, Any]:
        data = asdict(self)
        data["dedupe_key"] = self.dedupe_key
        return data


def _slug(value: Optional[str]) -> str:
    text = unicodedata.normalize("NFKD", value or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def clean_title(title: str) -> str:
    return re.sub(r"\s{2,}", " ", _TITLE_NOISE.sub("", title or "")).strip(" -–|")


# Words in a location string that describe the workplace, not the place.
_WORKPLACE_WORDS = re.compile(r"\b(?:remote|hybrid|on-?site|in-?office|job|anywhere|flexible)\b", re.IGNORECASE)


def location_key(location: Optional[str]) -> str:
    """First real place in a location string: "Hybrid - London, UK" -> "london"."""
    for part in re.split(r"[,;/|()]| - ", location or ""):
        place = _slug(_WORKPLACE_WORDS.sub(" ", part))
        if place:
            return place
    return ""


def dedupe_key(company: str, title: str, location: Optional[str]) -> str:
    """company|title|place, lowercased and stripped of punctuation."""
    return "|".join([_slug(company), _slug(clean_title(title)), location_key(location)])


def iso_from_millis(value: Any) -> Optional[str]:
    if not isinstance(value, (int, float)):
        return None
    return datetime.fromtimestamp(value / 1000, tz=timezone.utc).isoformat()


def iso_from_seconds(value: Any) -> Optional[str]:
    if not isinstance(value, (int, float)):
        return None
    return datetime.fromtimestamp(value, tz=timezone.utc).isoformat()


def build_job(
    *,
    external_id: str,
    url: str,
    title: str,
    company: str,
    description_html: Optional[str] = None,
    description_text: Optional[str] = None,
    location: Optional[str] = None,
    workplace_hint: Optional[str] = None,
    employment_type: Optional[str] = None,
    department: Optional[str] = None,
    apply_url: Optional[str] = None,
    posted_at: Optional[str] = None,
    salary: Optional[tuple] = None,
) -> NormalizedJob:
    """Builds a NormalizedJob, extracting requirements from the description. `salary` overrides extraction."""
    description = (description_text or html_to_text(description_html)).strip()[:MAX_DESCRIPTION_CHARS]
    title = clean_title(title)
    req = extract_requirements(title, description, location, workplace_hint)
    s_min, s_max, s_cur, s_period = salary if salary and salary[0] is not None else salary_tuple(req.salary)
    # A company's own name in its description isn't a requirement ("Vercel" at Vercel).
    own = canonicalize(company)
    skills = [s for s in req.skills if canonicalize(s) != own]
    return NormalizedJob(
        external_id=str(external_id),
        url=url,
        apply_url=apply_url,
        title=title,
        company=company.strip(),
        location=(location or "").strip() or None,
        workplace=req.workplace,
        employment_type=employment_type,
        department=department,
        seniority=req.seniority,
        description=description or None,
        skills=skills,
        experience_years_min=req.experience_years_min,
        salary_min=s_min,
        salary_max=s_max,
        salary_currency=s_cur,
        salary_period=s_period,
        posted_at=posted_at,
    )
