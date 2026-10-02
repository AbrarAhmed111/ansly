"""
Ask-and-Learn: saves information the user gave when Ansly asked for it.

Writes go through Supabase with the user's own JWT, so row-level security
applies exactly as it does for the web app.
"""

import re
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException, status

from src.app.api.deps import get_rest
from src.app.core.auth import AuthUser, get_current_user
from src.app.db.rest import SupabaseError, SupabaseRest
from src.app.schemas.answers import (
    FactTarget,
    MissingValue,
    ProfileFieldTarget,
    SaveMissingRequest,
    SkillAnswer,
    SkillTarget,
)

router = APIRouter(prefix="/profile", tags=["Profile"])

BOOLEAN_FIELDS = {"requires_sponsorship", "willing_to_relocate"}
WORK_MODES = {"remote": "remote", "hybrid": "hybrid", "onsite": "onsite", "on-site": "onsite", "on site": "onsite",
              "in office": "onsite", "in-office": "onsite", "office": "onsite", "flexible": "flexible"}


def _bad(message: str) -> HTTPException:
    return HTTPException(422, message)


def _as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    text = str(value).strip().lower()
    if text in ("yes", "y", "true", "1"):
        return True
    if text in ("no", "n", "false", "0"):
        return False
    raise _bad(f"Expected yes or no, got {value!r}")


def _as_text(value: Any, max_length: int = 500) -> str:
    if not isinstance(value, str) or not value.strip():
        raise _bad("Expected a non-empty answer")
    return value.strip()[:max_length]


def profile_values(item: MissingValue) -> Dict[str, Any]:
    target = item.target
    assert isinstance(target, ProfileFieldTarget)
    if target.field in BOOLEAN_FIELDS:
        return {target.field: _as_bool(item.value)}
    if target.field == "preferred_work_mode":
        mode = WORK_MODES.get(re.sub(r"\s+", " ", str(item.value).strip().lower()))
        if not mode:
            raise _bad("Work mode must be remote, hybrid, onsite or flexible")
        return {target.field: mode}
    return {target.field: _as_text(item.value)}


def skill_answer(value: Any) -> SkillAnswer:
    if isinstance(value, SkillAnswer):
        return value
    return SkillAnswer(have=_as_bool(value))


@router.post("/missing", summary="Save information Ansly asked for (profile field, skill or fact)")
async def save_missing(
    request: SaveMissingRequest,
    user: AuthUser = Depends(get_current_user),
    rest: SupabaseRest = Depends(get_rest),
) -> Dict[str, List[Dict[str, Any]]]:
    saved: List[Dict[str, Any]] = []
    try:
        skills = None
        for item in request.items:
            target = item.target
            if isinstance(target, ProfileFieldTarget):
                values = profile_values(item)
                rows = await rest.update("profiles", {"id": f"eq.{user.id}"}, values)
                row = rows[0] if rows else values
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
            else:
                assert isinstance(target, FactTarget)
                row = await rest.insert("profile_facts", {
                    "category": target.category,
                    "prompt": _as_text(item.prompt or item.key.split(":", 1)[-1].replace("_", " "), 1000),
                    "answer": _as_text(item.value, 5000),
                    "source": "extension",
                })
            saved.append({"key": item.key, "target": target.model_dump(), "row": row})
    except SupabaseError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Could not save to your profile: {e}") from e
    return {"saved": saved}
