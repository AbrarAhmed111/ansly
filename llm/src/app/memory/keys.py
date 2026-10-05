"""
Application Memory: the facts Ansly knows how to ask for and answer directly.

Each key names one fact about the candidate (normalized, never the question's
wording), how it is entered, which group it belongs to, the scope it is saved
with by default, and the structured profile column that holds the same fact,
if any. Free-text facts the user wrote for an open question have no key: they
are evidence for the model, not something answered directly.
"""

from dataclasses import dataclass
from typing import Any, Dict, Optional, Tuple

# Groups, in the order the memory page and Ask-and-Learn show them.
GROUPS = (
    "Personal", "Work authorization", "Availability", "Relocation", "Compensation", "Skills", "Experience",
    "Education", "Preferences", "Other",
)

# Question category / intent -> group, for free-text facts and skills.
CATEGORY_GROUPS: Dict[str, str] = {
    "skill_check": "Skills", "skill_experience": "Skills", "skill_years": "Skills",
    "experience": "Experience", "project": "Experience", "behavioral": "Experience", "achievement": "Experience",
    "leadership": "Experience", "challenge": "Experience", "technical_challenge": "Experience",
    "conflict": "Experience", "failure": "Experience", "strengths": "Experience",
    "education": "Education",
    "about_me": "Personal",
    "motivation": "Preferences", "motivation_role": "Preferences", "motivation_company": "Preferences",
}

# Scopes from widest to narrowest. "category" is a preference that may vary between applications.
SCOPES = ("global", "category", "company", "job")


@dataclass(frozen=True)
class FactKey:
    key: str
    label: str
    group: str
    # How the value is entered: "boolean" (Yes/No), "choice" (one of options), "text", "number".
    input: str
    options: Tuple[str, ...] = ()
    # The scope a remembered answer gets unless the user picks another.
    default_scope: str = "global"
    # The profiles column holding the same fact: the structured profile wins over memory for it.
    profile_field: Optional[str] = None
    # Facts that drift (preferences, availability): after this many days unconfirmed, the memory page asks
    # "Still accurate?". None: stable facts are never nagged about.
    stale_days: Optional[int] = None
    # The classifier intent this fact answers.
    intent: Optional[str] = None
    # The question Ask-and-Learn shows.
    ask: str = ""


FACT_KEYS: Dict[str, FactKey] = {k.key: k for k in [
    FactKey("work_authorization", "Work authorization", "Work authorization", "text",
            profile_field="work_authorization", intent="work_authorization",
            ask="What is your work authorization (e.g. citizen, permanent resident, visa type)?"),
    FactKey("requires_sponsorship", "Visa sponsorship", "Work authorization", "boolean",
            profile_field="requires_sponsorship", intent="sponsorship",
            ask="Will you need visa sponsorship to work?"),
    FactKey("notice_period", "Notice period", "Availability", "text",
            profile_field="notice_period", stale_days=120, intent="notice_period",
            ask="What is your notice period, or when can you start?"),
    FactKey("salary_expectation", "Salary expectation", "Compensation", "text", default_scope="category",
            profile_field="salary_expectation", stale_days=180, intent="salary",
            ask="What is your salary expectation?"),
    FactKey("relocation_preference", "Relocation", "Relocation", "choice", ("Yes", "No", "Depends on the role"),
            default_scope="category", profile_field="willing_to_relocate", stale_days=240, intent="relocation",
            ask="Are you willing to relocate?"),
    FactKey("work_mode", "Preferred work arrangement", "Preferences", "choice",
            ("Remote", "Hybrid", "On-site", "Flexible"), default_scope="category",
            profile_field="preferred_work_mode", stale_days=240, intent="work_mode",
            ask="Which work arrangement do you prefer?"),
    FactKey("travel_willingness", "Willingness to travel", "Preferences", "choice",
            ("Yes", "No", "Occasionally"), default_scope="category", stale_days=240, intent="travel",
            ask="Are you willing to travel for work?"),
]}

INTENT_KEYS: Dict[str, str] = {k.intent: k.key for k in FACT_KEYS.values() if k.intent}
PROFILE_FIELD_KEYS: Dict[str, str] = {k.profile_field: k.key for k in FACT_KEYS.values() if k.profile_field}

_WORK_MODES = {"remote": "Remote", "hybrid": "Hybrid", "onsite": "On-site", "flexible": "Flexible"}
_WORK_MODE_INPUT = {"remote": "remote", "hybrid": "hybrid", "onsite": "onsite", "on-site": "onsite",
                    "on site": "onsite", "in office": "onsite", "in-office": "onsite", "office": "onsite",
                    "flexible": "flexible"}
_YES = {"yes", "y", "true", "1"}
_NO = {"no", "n", "false", "0"}


def as_bool(value: Any) -> Optional[bool]:
    if isinstance(value, bool):
        return value
    text = str(value).strip().lower()
    return True if text in _YES else False if text in _NO else None


def display(key: str, value: Any) -> str:
    """A stored value (profile column or memory text) as the user reads it: "Yes", "On-site", "2 weeks"."""
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if key == "work_mode" and isinstance(value, str):
        return _WORK_MODES.get(value, value)
    return str(value).strip()


def to_profile(key: str, value: Any) -> Tuple[bool, Any]:
    """(True, column value) when the value fits the profile column for `key`; (False, None) when it doesn't
    (a relocation of "Depends on the role" has no place in a yes/no column, so it lives in memory)."""
    spec = FACT_KEYS.get(key)
    if spec is None or spec.profile_field is None:
        return False, None
    if spec.profile_field in ("requires_sponsorship", "willing_to_relocate"):
        b = as_bool(value)
        return (b is not None), b
    if spec.profile_field == "preferred_work_mode":
        mode = _WORK_MODE_INPUT.get(" ".join(str(value).strip().lower().split()))
        return (mode is not None), mode
    text = str(value).strip()
    return bool(text), text[:500]


def normalize_value(key: Optional[str], value: Any) -> str:
    """The text stored in memory for a value: a choice is stored as its option ("Depends on the role")."""
    spec = FACT_KEYS.get(key or "")
    if isinstance(value, bool):
        return "Yes" if value else "No"
    text = " ".join(str(value).split())
    if spec and spec.input == "choice":
        low = text.lower()
        for option in spec.options:
            if option.lower() == low:
                return option
        if spec.key == "work_mode" and low in _WORK_MODE_INPUT:
            return _WORK_MODES[_WORK_MODE_INPUT[low]]
    if spec and spec.input == "boolean":
        b = as_bool(text)
        if b is not None:
            return "Yes" if b else "No"
    return text


def answer_value(key: str, text: str) -> Any:
    """Memory text in the form the answer engine compares profile values in: a bool for Yes/No, a work-mode code,
    otherwise the text ("Depends on the role" stays text: no yes/no answer follows from it)."""
    if key in ("requires_sponsorship", "relocation_preference", "travel_willingness"):
        b = as_bool(text)
        if b is not None:
            return b
    if key == "work_mode":
        return _WORK_MODE_INPUT.get(text.strip().lower(), text)
    return text


def group_for(key: Optional[str], category: Optional[str]) -> str:
    if key and key in FACT_KEYS:
        return FACT_KEYS[key].group
    if key and key.startswith("skill:"):
        return "Skills"
    return CATEGORY_GROUPS.get(category or "", "Other")


def label_for(key: Optional[str], prompt: Optional[str]) -> str:
    if key and key in FACT_KEYS:
        return FACT_KEYS[key].label
    return (prompt or "").strip()
