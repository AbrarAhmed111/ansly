"""
Ask-and-Learn: saves information the user gave when Ansly asked for it.

Where each answer goes depends on what it is and how long the user wants it
remembered (see memory/service.py for the precedence rules):

- a profile preference the user wants remembered goes to the structured profile
  (the source of truth), and older memory for it is retired;
- a skill goes to the skills table ("I don't have this" is level 'none');
- anything for one job or company, a preference the profile column can't hold
  ("Depends on the role"), or a free-text fact goes to Application Memory with
  its scope and provenance.

Writes go through Supabase with the user's own JWT, so row-level security
applies exactly as it does for the web app.
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status

from src.app.answers.profile_context import invalidate_profile_cache
from src.app.api.deps import get_rest
from src.app.core.auth import AuthUser, get_current_user
from src.app.core.token_budget import job_key
from src.app.db.rest import SupabaseError, SupabaseRest
from src.app.memory import service as memory
from src.app.memory.keys import FACT_KEYS, PROFILE_FIELD_KEYS, as_bool, group_for, normalize_value, to_profile
from src.app.schemas.answers import (
    FactTarget,
    JobContext,
    MissingValue,
    ProfileFieldTarget,
    SaveMissingRequest,
    SkillAnswer,
    SkillTarget,
)

logger = logging.getLogger("ProfileAPI")

router = APIRouter(prefix="/profile", tags=["Profile"])


def _bad(message: str) -> HTTPException:
    return HTTPException(422, message)


def _as_text(value: Any, max_length: int = 500) -> str:
    if not isinstance(value, str) or not value.strip():
        raise _bad("Expected a non-empty answer")
    return value.strip()[:max_length]


def checked_value(key: Optional[str], value: Any) -> str:
    """The value as memory stores it, or 422 when it isn't a valid answer for the fact (a yes/no fact needs yes or
    no; a choice one of its options)."""
    spec = FACT_KEYS.get(key or "")
    if isinstance(value, SkillAnswer):
        raise _bad("Expected an answer, not a skill")
    if spec is not None and spec.input == "boolean" and as_bool(value) is None:
        raise _bad(f"Expected yes or no, got {value!r}")
    text = normalize_value(key, value) if not isinstance(value, str) or value.strip() else ""
    if not text:
        raise _bad("Expected a non-empty answer")
    if spec is not None and spec.input == "choice" and text not in spec.options and as_bool(text) is None:
        raise _bad(f"Choose one of: {', '.join(spec.options)}")
    return text


def profile_values(item: MissingValue) -> Dict[str, Any]:
    """The profile column update for a profile-field answer, or 422 when the value doesn't fit the column."""
    target = item.target
    assert isinstance(target, ProfileFieldTarget)
    key = PROFILE_FIELD_KEYS[target.field]
    ok, value = to_profile(key, checked_value(key, item.value))
    if not ok:
        if target.field == "preferred_work_mode":
            raise _bad("Work mode must be remote, hybrid, onsite or flexible")
        raise _bad(f"Expected yes or no, got {item.value!r}")
    return {target.field: value}


def skill_answer(value: Any) -> SkillAnswer:
    if isinstance(value, SkillAnswer):
        return value
    text = str(value).strip().lower()
    if text in ("some exposure", "some", "a little", "beginner"):
        return SkillAnswer(have=True, level="beginner")
    have = as_bool(value)
    if have is None:
        raise _bad(f"Expected yes or no, got {value!r}")
    return SkillAnswer(have=have)


def provenance(job: Optional[JobContext]) -> Dict[str, Optional[str]]:
    """The application a fact was given for: its company (company scope), job key (job scope) and a label for
    "Asked during an application to Acme · Software Engineer". No description is kept."""
    if job is None:
        return {"company": None, "job_key": None, "source_label": None}
    label = " · ".join(x.strip() for x in [job.company or "", job.role or ""] if x and x.strip())
    return {"company": (job.company or "").strip() or None, "job_key": job_key(job.url, job.company, job.role),
            "source_label": label or None}


@router.post("/missing", summary="Save information Ansly asked for (profile field, skill or Application Memory)")
async def save_missing(
    request: SaveMissingRequest,
    user: AuthUser = Depends(get_current_user),
    rest: SupabaseRest = Depends(get_rest),
) -> Dict[str, List[Dict[str, Any]]]:
    saved: List[Dict[str, Any]] = []
    origin = provenance(request.job_context)
    events: List[Dict[str, Any]] = []
    try:
        skills = None
        facts: Optional[List[Dict[str, Any]]] = None

        async def load_facts() -> List[Dict[str, Any]]:
            nonlocal facts
            if facts is None:
                facts = await rest.select("profile_facts", {"limit": "500"})
            return facts

        async def remember(key: Optional[str], value: str, scope: str, category: str,
                           prompt: Optional[str]) -> Dict[str, Any]:
            return await memory.save_fact(
                rest, value=value, key=key, prompt=prompt, category=category, scope=scope,
                company=origin["company"], job_key=origin["job_key"], source_type=request.source,
                source_label=origin["source_label"], existing=await load_facts(),
            )

        for item in request.items:
            target = item.target
            destination = "memory"
            if isinstance(target, ProfileFieldTarget):
                key = PROFILE_FIELD_KEYS[target.field]
                value = checked_value(key, item.value)
                fits, column = to_profile(key, value)
                if item.scope in (None, "global", "category") and fits:
                    # The profile is the source of truth for this fact: write it there, retire older memory.
                    rows = await rest.update("profiles", {"id": f"eq.{user.id}"}, {target.field: column})
                    row = rows[0] if rows else {target.field: column}
                    await memory.supersede(rest, key, await load_facts())
                    destination = "profile"
                else:
                    scope = item.scope or FACT_KEYS[key].default_scope
                    row = await remember(key, value, scope, FACT_KEYS[key].group, None)
                group = FACT_KEYS[key].group
            elif isinstance(target, SkillTarget):
                answer = skill_answer(item.value)
                if skills is None:
                    skills = await rest.select("skills", {"limit": "500"})
                existing = next((s for s in skills if s["name"].strip().lower() == target.name.strip().lower()), None)
                values = {
                    # "I don't have this" is stored as level 'none' so the next answer is an honest "No".
                    "level": (answer.level if answer.have else "none"),
                    "years": (answer.years if answer.have else None),
                }
                if existing:
                    rows = await rest.update("skills", {"id": f"eq.{existing['id']}"}, values)
                    row = rows[0] if rows else {**existing, **values}
                else:
                    row = await rest.insert("skills", {"name": target.name.strip(), **values})
                    skills.append(row)
                destination, group = "skills", "Skills"
            else:
                assert isinstance(target, FactTarget)
                key = target.key if target.key in FACT_KEYS else None
                value = checked_value(key, item.value) if key else _as_text(item.value, 5000)
                scope = item.scope or (FACT_KEYS[key].default_scope if key else "global")
                prompt = item.prompt or item.key.split(":", 1)[-1].replace("_", " ")
                row = await remember(key, value, scope, target.category, _as_text(prompt, 1000))
                group = group_for(key, target.category)
            saved.append({"key": item.key, "target": target.model_dump(), "row": row, "destination": destination,
                          "scope": row.get("scope") if destination == "memory" else "global", "group": group})
            events.append({"kind": "memory_fact_saved", "category": group[:50]})
    except ValueError as e:
        raise _bad(str(e)) from e
    except SupabaseError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Could not save to your profile: {e}") from e
    finally:
        # The next answer must see what was saved, even if this request failed part-way.
        invalidate_profile_cache(user.id)
    try:
        done = ({"kind": "ask_and_learn_completed", "category": None} if request.source == "ask_and_learn"
                else {"kind": "onboarding_step", "category": "preferences"})
        await rest.insert_many("usage_events", [*events, done])
    except SupabaseError as e:
        logger.warning(f"Could not record usage event: {e}")
    return {"saved": saved}
