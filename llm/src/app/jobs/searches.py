"""
Saved Searches.

Turns a natural-language request ("remote Full Stack/Product Engineering roles
with AI, Next.js and TypeScript") into structured filters the user can see
and edit, and checks jobs against them. Deterministic: the parsed filters are
shown back to the user, so nothing is hidden in a model's interpretation.
"""

import re
from typing import Any, Dict, List, Optional

from src.app.answers.profile_context import canonicalize

from .extract import extract_workplace
from .matching import title_tokens
from .vocabulary import find_skills

_ROLE_NOUNS = r"engineers?|engineering|developers?|development|designers?|scientists?|analysts?|architects?|managers?|leads?"
_ROLE = re.compile(
    rf"(?P<prefix>(?:[A-Za-z+#.]+[\s/,-]+){{0,4}}?)(?P<noun>{_ROLE_NOUNS})\b(?:\s+(?:roles?|positions?|jobs?|openings?))?",
    re.IGNORECASE,
)
# Words before a role noun that aren't part of the role.
_NOT_ROLE = {
    "remote", "hybrid", "onsite", "on-site", "find", "me", "show", "looking", "for", "a", "an", "the", "senior-level",
    "jobs", "roles", "with", "and", "or", "in", "at", "involving", "using", "of", "full-time", "part-time", "contract",
    "worldwide", "europe", "any", "all", "new", "good", "great", "i", "want", "need", "some", "fully",
}
_NOUN_FORMS = {
    "engineering": "Engineer", "engineers": "Engineer", "engineer": "Engineer", "developers": "Developer",
    "developer": "Developer", "development": "Developer", "designers": "Designer", "designer": "Designer",
    "scientists": "Scientist", "scientist": "Scientist", "analysts": "Analyst", "analyst": "Analyst",
    "architects": "Architect", "architect": "Architect", "managers": "Manager", "manager": "Manager",
    "leads": "Lead", "lead": "Lead",
}
_REGIONS = {
    "worldwide": "Worldwide", "anywhere": "Worldwide", "europe": "Europe", "emea": "EMEA", "eu": "Europe",
    "us": "United States", "usa": "United States", "united states": "United States", "uk": "United Kingdom",
    "united kingdom": "United Kingdom", "canada": "Canada", "germany": "Germany", "latam": "Latin America",
    "asia": "Asia", "apac": "APAC", "india": "India", "australia": "Australia",
}
_EMPLOYMENT = [
    ("full_time", r"full[\s-]?time"), ("part_time", r"part[\s-]?time"), ("contract", r"contract|freelance"),
    ("internship", r"intern(?:ship)?s?"),
]


def _roles(text: str) -> List[str]:
    roles: List[str] = []
    for m in _ROLE.finditer(text):
        noun = _NOUN_FORMS[m.group("noun").lower()]
        words = [w for w in re.split(r"\s+", m.group("prefix").strip()) if w]
        # Keep the words right before the noun that describe the role.
        kept: List[str] = []
        for w in reversed(words):
            # Stop at filler words and at list commas ("Python, backend engineer").
            if w.lower() in _NOT_ROLE or w.endswith(","):
                break
            kept.insert(0, w)
        phrase = " ".join(kept)
        # "Full Stack/Product" -> two roles.
        variants = [v.strip() for v in phrase.split("/")] if "/" in phrase else [phrase]
        for v in variants:
            role = f"{_title_case(v)} {noun}".strip()
            if role not in roles:
                roles.append(role)
    return roles


def _title_case(value: str) -> str:
    return " ".join(w if any(c.isupper() for c in w[1:]) else w[:1].upper() + w[1:] for w in value.split())


def parse_search_query(query: str) -> Dict[str, Any]:
    """Structured filters from a natural-language search."""
    text = query.strip()
    lower = text.lower()
    skills = find_skills(text)
    filters: Dict[str, Any] = {"roles": _roles(text), "skills": skills}

    workplace = []
    for word in ("remote", "hybrid"):
        if re.search(rf"\b{word}\b", lower):
            workplace.append(word)
    if re.search(r"\b(?:on[\s-]?site|in[\s-]office)\b", lower):
        workplace.append("onsite")
    filters["workplace"] = workplace

    locations = []
    for key, name in _REGIONS.items():
        if re.search(rf"\b{re.escape(key)}\b", lower) and name not in locations:
            locations.append(name)
    for m in re.finditer(r"\b(?:in|based in|located in|near)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)", text):
        place = m.group(1)
        if place.lower() not in _REGIONS and canonicalize(place) not in {canonicalize(s) for s in skills} and place not in locations:
            locations.append(place)
    filters["locations"] = locations

    years = re.search(r"(\d{1,2})\s*\+?\s*(?:years?|yrs?)", lower)
    filters["experience_years"] = int(years.group(1)) if years else None

    salary = re.search(r"(?:[$€£]\s?(\d{2,3})\s?k|(\d{2,3})\s?k\s?(?:\+|or more|minimum)|[$€£]\s?(\d{2,3}),000)", lower)
    filters["min_salary"] = int(next(g for g in salary.groups() if g)) * 1000 if salary else None

    filters["employment_types"] = [kind for kind, pattern in _EMPLOYMENT if re.search(rf"\b(?:{pattern})\b", lower)]
    return filters


def search_name(query: str, filters: Dict[str, Any]) -> str:
    parts = []
    if filters.get("workplace"):
        parts.append("/".join(w.capitalize() for w in filters["workplace"]))
    if filters.get("roles"):
        parts.append(", ".join(filters["roles"][:2]))
    elif filters.get("skills"):
        parts.append(", ".join(filters["skills"][:3]))
    name = " · ".join(parts) or query.strip()
    return name[:80]


def _role_matches(job_title: str, role: str) -> bool:
    wanted = title_tokens(role) - {"senior", "junior", "lead", "staff"}
    return bool(wanted) and wanted <= title_tokens(job_title)


def job_matches_filters(job: Dict[str, Any], filters: Dict[str, Any], tier: Optional[str] = None) -> bool:
    """Whether a job passes a saved search's filters. Unknown job values don't exclude it, except workplace."""
    roles = filters.get("roles") or []
    if roles and not any(_role_matches(job.get("title") or "", r) for r in roles):
        return False

    skills = filters.get("skills") or []
    if skills:
        job_skills = {canonicalize(s) for s in job.get("skills") or []}
        hits = sum(1 for s in skills if canonicalize(s) in job_skills)
        # Broad searches need one skill; specific ones (3+) need at least half.
        if hits == 0 or (len(skills) >= 3 and hits < len(skills) / 2):
            return False

    workplace = filters.get("workplace") or []
    if workplace and (job.get("workplace") or extract_workplace(job.get("location"))) not in workplace:
        return False

    locations = [loc.lower() for loc in filters.get("locations") or []]
    if locations and job.get("workplace") != "remote" and "worldwide" not in locations:
        job_location = (job.get("location") or "").lower()
        if job_location and not any(loc in job_location for loc in locations):
            return False

    years = filters.get("experience_years")
    required = job.get("experience_years_min")
    if years is not None and required is not None and float(required) > years + 1:
        return False

    min_salary = filters.get("min_salary")
    if min_salary and job.get("salary_max") and job.get("salary_period") in (None, "year") and job["salary_max"] < min_salary:
        return False

    types = filters.get("employment_types") or []
    if types and job.get("employment_type") and job["employment_type"] not in types:
        return False
    return True
