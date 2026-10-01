"""
Job Matching.

Structured, explainable profile-to-job alignment. No embeddings and no
model: every part of a match (skills, experience, role, workplace, location)
is a fact the user can check, and the tier follows from those facts.
"""

import re
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Dict, List, Optional, Set, Tuple

from src.app.answers.profile_context import profile_terms, term_in_corpus

from .extract import SENIORITY_YEARS
from .normalize import location_key

# --- Roles -------------------------------------------------------------------

_PHRASES = [
    (r"full[\s-]*stack", "fullstack"), (r"front[\s-]*end", "frontend"), (r"back[\s-]*end", "backend"),
    (r"machine learning", "ml"), (r"site reliability", "sre"), (r"dev[\s-]*ops", "devops"),
    (r"developer relations|dev\s*rel", "devrel"), (r"quality assurance", "qa"),
]
_SYNONYMS = {
    "developer": "engineer", "dev": "engineer", "engineering": "engineer", "programmer": "engineer",
    "swe": "engineer", "sde": "engineer", "designers": "designer", "engineers": "engineer",
    "scientists": "scientist", "analytics": "analyst", "web": "frontend",
}
# Checked in order: "Engineering Manager" is a manager, not an engineer.
_FAMILIES = [
    ("manager", {"manager", "director", "head", "vp"}),
    ("engineer", {"engineer", "architect", "sre", "devops"}),
    ("designer", {"designer"}),
    ("data", {"scientist", "analyst"}),
    ("sales", {"sales", "account", "bdr", "sdr"}),
    ("marketing", {"marketing", "growth", "content"}),
    ("support", {"support", "success"}),
    ("recruiting", {"recruiter", "recruiting", "talent"}),
    ("operations", {"administrative", "assistant", "operations", "coordinator", "partner"}),
]
_SPECIALIZATIONS = {
    "frontend", "backend", "fullstack", "mobile", "ios", "android", "data", "ml", "ai", "platform",
    "infrastructure", "security", "cloud", "devops", "product", "design", "embedded", "game", "qa", "test",
    "sre", "solutions", "devrel", "research", "software", "systems", "applied", "growth", "sales", "presales",
    "support", "network", "hardware", "firmware", "test", "automation", "analytics",
}
# Specializations that don't narrow a role ("Software Engineer" is any engineer).
_GENERIC = {"software", "systems", "applied"}


def title_tokens(title: str) -> Set[str]:
    text = (title or "").lower()
    for pattern, replacement in _PHRASES:
        text = re.sub(pattern, f" {replacement} ", text)
    return {_SYNONYMS.get(t, t) for t in re.findall(r"[a-z0-9+#]+", text)}


def classify_role(title: str) -> Tuple[Optional[str], Set[str]]:
    """(family, specializations), e.g. "Senior Full-Stack Developer" -> ("engineer", {"fullstack"})."""
    tokens = title_tokens(title)
    family = next((name for name, words in _FAMILIES if tokens & words), None)
    return family, tokens & _SPECIALIZATIONS


def role_fit(job_title: str, roles: List[Tuple[Optional[str], Set[str]]]) -> str:
    """match | related | unrelated, comparing the job title to the user's own titles."""
    family, specs = classify_role(job_title)
    specs = specs - _GENERIC
    best = "unrelated"
    for user_family, user_specs in roles:
        if family is None or user_family != family:
            continue
        # A generic job title fits anyone in the family; a specialized one needs the same specialization.
        if not specs or specs & user_specs:
            return "match"
        best = "related"
    return best


# --- Candidate ---------------------------------------------------------------

def _parse_date(value: Optional[str]) -> Optional[date]:
    try:
        return date.fromisoformat(value[:10]) if value else None
    except ValueError:
        return None


def years_of_experience(experiences: List[Dict[str, Any]], today: Optional[date] = None) -> Optional[float]:
    """Total years across dated roles, counting overlapping roles once."""
    today = today or date.today()
    spans = []
    for e in experiences:
        start = _parse_date(e.get("start_date"))
        end = today if e.get("is_current") else _parse_date(e.get("end_date"))
        if start and end and end >= start:
            spans.append((start, min(end, today)))
    if not spans:
        return None
    spans.sort()
    total, (cur_start, cur_end) = 0, spans[0]
    for start, end in spans[1:]:
        if start <= cur_end:
            cur_end = max(cur_end, end)
        else:
            total += (cur_end - cur_start).days
            cur_start, cur_end = start, end
    total += (cur_end - cur_start).days
    return round(total / 365.25, 1)


@dataclass
class Candidate:
    terms: Set[str]
    years: Optional[float]
    roles: List[Tuple[Optional[str], Set[str]]]
    titles: List[str]
    location: str = ""
    work_mode: Optional[str] = None
    willing_to_relocate: Optional[bool] = None
    skill_names: List[str] = field(default_factory=list)

    def has_skill(self, skill: str) -> bool:
        return term_in_corpus(skill, self.terms)


def build_candidate(data: Dict[str, Any], today: Optional[date] = None) -> Candidate:
    """`data` holds "profile" (a row) and the section lists, as loaded from Supabase."""
    profile = data.get("profile") or {}
    experiences = data.get("experiences") or []
    titles = [e.get("title") or "" for e in experiences if e.get("title")]
    if profile.get("headline"):
        titles.append(profile["headline"])
    return Candidate(
        terms=profile_terms(data),
        years=years_of_experience(experiences, today),
        roles=[classify_role(t) for t in titles],
        titles=titles,
        location=profile.get("location") or "",
        work_mode=profile.get("preferred_work_mode"),
        willing_to_relocate=profile.get("willing_to_relocate"),
        skill_names=[s["name"] for s in data.get("skills") or [] if s.get("name")],
    )


# --- Match -------------------------------------------------------------------

TIER_ORDER = {"strong": 0, "good": 1, "potential": 2, "low": 3}


def _experience_fit(job: Dict[str, Any], years: Optional[float]) -> Dict[str, Any]:
    required = job.get("experience_years_min")
    inferred = False
    if required is None and job.get("seniority") in SENIORITY_YEARS and job.get("seniority") not in ("intern", "junior"):
        required, inferred = SENIORITY_YEARS[job["seniority"]], True
    if required is None or years is None:
        fit = "unknown"
    elif years >= float(required):
        fit = "meets"
    elif years >= float(required) - 1:
        fit = "close"
    else:
        fit = "below"
    return {"required": float(required) if required is not None else None, "profile": years, "fit": fit,
            "inferred": inferred}


def _workplace_fit(job_workplace: Optional[str], preference: Optional[str]) -> str:
    if not job_workplace or not preference:
        return "unknown"
    if preference == "flexible" or job_workplace in (preference, "remote"):
        return "match"
    if preference == "onsite":
        return "match"  # hybrid also puts you in the office
    return "mismatch"  # wants remote but job is hybrid/on-site, or wants hybrid but job is on-site


def _location_fit(job: Dict[str, Any], candidate: Candidate) -> str:
    if job.get("workplace") == "remote":
        return "remote"
    job_place = location_key(job.get("location"))
    if not job_place or not candidate.location:
        return "unknown"
    user_words = set(re.findall(r"[a-z]+", candidate.location.lower())) - {"remote", "hybrid"}
    job_words = set(re.findall(r"[a-z]+", (job.get("location") or "").lower())) - {"remote", "hybrid"}
    if user_words & job_words:
        return "match"
    return "relocate" if candidate.willing_to_relocate else "mismatch"


def _list(items: List[str], limit: int = 4) -> str:
    shown = ", ".join(items[:limit])
    return f"{shown} and {len(items) - limit} more" if len(items) > limit else shown


def compute_match(job: Dict[str, Any], candidate: Candidate) -> Dict[str, Any]:
    """A `job_matches` row (without user_id) for one job."""
    skills: List[str] = job.get("skills") or []
    matched = [s for s in skills if candidate.has_skill(s)]
    missing = [s for s in skills if s not in matched]
    # Thin postings (one or two named skills) can't show a strong skill match on their own.
    coverage = len(matched) / max(len(skills), 3) if skills else None

    role = role_fit(job.get("title") or "", candidate.roles)
    experience = _experience_fit(job, candidate.years)
    workplace = _workplace_fit(job.get("workplace"), candidate.work_mode)
    location = _location_fit(job, candidate)

    score = (
        0.45 * (coverage if coverage is not None else 0.4)
        + 0.25 * {"match": 1.0, "related": 0.5, "unrelated": 0.0}[role]
        + 0.15 * {"meets": 1.0, "close": 0.6, "below": 0.15, "unknown": 0.6}[experience["fit"]]
        + 0.075 * {"match": 1.0, "unknown": 0.6, "mismatch": 0.0}[workplace]
        + 0.075 * {"match": 1.0, "remote": 1.0, "relocate": 0.7, "unknown": 0.6, "mismatch": 0.1}[location]
    )
    score = round(min(max(score, 0.0), 1.0), 3)

    blocked = role == "unrelated" or experience["fit"] == "below" or workplace == "mismatch"
    if score >= 0.75 and not blocked:
        tier = "strong"
    elif score >= 0.6 and role != "unrelated":
        tier = "good"
    elif score >= 0.45 and role != "unrelated":
        tier = "potential"
    else:
        tier = "low"

    reasons: List[str] = []
    if skills:
        reasons.append(f"Matches {len(matched)} of {len(skills)} skills in the posting"
                       + (f": {_list(matched)}" if matched else ""))
    if role == "match":
        reasons.append("Same kind of role as your experience")
    elif role == "related":
        reasons.append("Related to roles you've held")
    else:
        reasons.append("Different kind of role from your experience")
    req, have = experience["required"], experience["profile"]
    if experience["fit"] == "meets":
        reasons.append(f"Your {have:g} years meet the {req:g}+ {'usually expected' if experience['inferred'] else 'asked for'}")
    elif experience["fit"] in ("close", "below"):
        reasons.append(f"Asks for {req:g}+ years{' (typical for the level)' if experience['inferred'] else ''}; your profile shows {have:g}")
    if workplace == "match":
        reasons.append(f"{(job.get('workplace') or '').capitalize()}, which suits your preference")
    elif workplace == "mismatch":
        reasons.append(f"{(job.get('workplace') or '').capitalize()}, but you prefer {candidate.work_mode}")
    if location == "relocate":
        reasons.append(f"In {job.get('location')}; you're open to relocating")
    elif location == "mismatch":
        reasons.append(f"In {job.get('location')}, away from your location")
    if missing:
        reasons.append(f"Not in your profile: {_list(missing)}")

    return {
        "job_id": job["id"],
        "tier": tier,
        "score": score,
        "matched_skills": matched,
        "missing_skills": missing,
        "experience": experience,
        "workplace_fit": workplace,
        "location_fit": location,
        "role_fit": role,
        "reasons": reasons,
    }
