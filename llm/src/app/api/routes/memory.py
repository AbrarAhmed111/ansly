"""
Application Memory Endpoints.

Everything Ansly learned outside the structured resume sections, with where it
came from, how long it applies and whether it is still current. The user can
edit, rescope, confirm, mark outdated or delete any of it; nothing is kept that
they can't control. Reads and writes go through Supabase with the user's own
JWT (row-level security), and through memory/service.py for every rule.
"""

import logging
import re
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Response, status

from src.app.answers.profile_context import invalidate_profile_cache
from src.app.api.deps import get_rest
from src.app.core.auth import AuthUser, get_current_user
from src.app.core.concurrency import gather_all
from src.app.db.rest import SupabaseError, SupabaseRest
from src.app.memory import service as memory
from src.app.memory.keys import FACT_KEYS, GROUPS, PROFILE_FIELD_KEYS, display, group_for, label_for, to_profile
from src.app.schemas.memory import (
    MemoryConflict,
    MemoryItem,
    MemoryResponse,
    ResolveConflictRequest,
    UpdateMemoryRequest,
)

logger = logging.getLogger("MemoryAPI")

router = APIRouter(prefix="/memory", tags=["Application Memory"])

NOT_FOUND = "That memory no longer exists."


def _fact_item(row: Dict[str, Any]) -> MemoryItem:
    key = row.get("key")
    spec = FACT_KEYS.get(key or "")
    return MemoryItem(
        id=str(row["id"]), key=key, label=label_for(key, row.get("prompt")) or "Fact",
        group=group_for(key, row.get("category")), value=str(row.get("answer") or ""),
        value_type=row.get("value_type") or (spec.input if spec else "text"),
        options=list(spec.options) if spec and spec.options else (["Yes", "No"] if spec and spec.input == "boolean" else None),
        scope=row.get("scope") or "global", company=row.get("company"),
        source_type=row.get("source_type") or ("ask_and_learn" if row.get("source") == "extension" else "web"),
        source_label=row.get("source_label"), created_at=row.get("created_at"), updated_at=row.get("updated_at"),
        last_confirmed_at=row.get("last_confirmed_at") or row.get("updated_at"),
        status=row.get("status") or "active", stale=memory.is_stale(row), answers_directly=spec is not None,
    )


def _profile_items(profile: Optional[Dict[str, Any]]) -> List[MemoryItem]:
    """Profile preferences, shown alongside memory: they answer the same questions and win over it."""
    items = []
    for field, key in PROFILE_FIELD_KEYS.items():
        value = (profile or {}).get(field)
        if value in (None, ""):
            continue
        spec = FACT_KEYS[key]
        items.append(MemoryItem(
            id=f"profile:{field}", key=key, label=spec.label, group=spec.group, value=display(key, value),
            value_type=spec.input, options=list(spec.options) or (["Yes", "No"] if spec.input == "boolean" else None),
            scope="global", source_type="profile", source_label="Profile → Application preferences",
            updated_at=(profile or {}).get("updated_at"), last_confirmed_at=(profile or {}).get("updated_at"),
            answers_directly=True,
        ))
    return items


def _skill_items(skills: List[Dict[str, Any]]) -> List[MemoryItem]:
    """Skills the user said they don't have: Ansly answers "No" for them instead of asking again."""
    return [MemoryItem(
        id=f"skill:{s['id']}", key=None, label=s["name"], group="Skills", value="No professional experience",
        value_type="boolean", options=None, scope="global", source_type="skills", source_label="Profile → Skills",
        created_at=s.get("created_at"), updated_at=s.get("updated_at"), answers_directly=True,
    ) for s in skills if s.get("level") == "none"]


async def _load(rest: SupabaseRest):
    profiles, facts, skills, experiences, projects = await gather_all(
        rest.select("profiles", {"limit": "1"}),
        rest.select("profile_facts", {"order": "updated_at.desc", "limit": "500"}),
        rest.select("skills", {"limit": "500"}),
        rest.select("experiences", {"limit": "200"}),
        rest.select("projects", {"limit": "200"}),
    )
    return (profiles[0] if profiles else None), facts, skills, experiences, projects


async def _event(rest: SupabaseRest, kind: str, group: Optional[str]) -> None:
    try:
        await rest.insert("usage_events", {"kind": kind, "category": (group or "")[:50] or None})
    except SupabaseError as e:
        logger.warning(f"Could not record usage event: {e}")


_SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def _id(value: str) -> str:
    """A row id safe to put in a filter (ids are uuids; anything else can't exist)."""
    if not _SAFE_ID.match(value):
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
    return value


async def _fact(rest: SupabaseRest, fact_id: str) -> Dict[str, Any]:
    rows = await rest.select("profile_facts", {"id": f"eq.{_id(fact_id)}", "limit": "1"})
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
    return rows[0]


def _supabase(e: SupabaseError) -> HTTPException:
    if e.status_code == 409:
        return HTTPException(status.HTTP_409_CONFLICT, "You already have an answer for this with that scope.")
    return HTTPException(status.HTTP_502_BAD_GATEWAY, "Could not update your Application Memory. Please try again.")


@router.get("", response_model=MemoryResponse, response_model_by_alias=True, summary="Everything Ansly has learned")
async def list_memory(user: AuthUser = Depends(get_current_user),
                      rest: SupabaseRest = Depends(get_rest)) -> MemoryResponse:
    try:
        profile, facts, skills, experiences, projects = await _load(rest)
    except SupabaseError as e:
        raise _supabase(e) from e
    items = _profile_items(profile) + [_fact_item(f) for f in facts] + _skill_items(skills)
    conflicts = [MemoryConflict(**vars(c)) for c in memory.find_conflicts(profile, facts, skills, experiences, projects)]
    active = [i for i in items if i.status == "active"]
    learned = [i for i in active if i.source_type not in ("profile", "skills")]
    return MemoryResponse(
        items=items, conflicts=conflicts, groups=list(GROUPS),
        counts={
            "learned": len(learned),
            "preferences": sum(1 for i in learned if i.scope in ("category", "company", "job")),
            "profile": len(active) - len(learned),
            "stale": sum(1 for i in active if i.stale),
            "conflicts": len(conflicts),
        },
    )


async def _update_profile_field(rest: SupabaseRest, user: AuthUser, field: str, value: str) -> MemoryItem:
    """A profile preference edited from the memory page or a popover. A value the column can't hold ("Depends on
    the role") moves the fact into global memory and clears the column: the user's newest explicit answer wins."""
    key = PROFILE_FIELD_KEYS[field]
    fits, column = to_profile(key, value)
    if fits:
        rows = await rest.update("profiles", {"id": f"eq.{user.id}"}, {field: column})
        return next(i for i in _profile_items(rows[0] if rows else {field: column}) if i.id == f"profile:{field}")
    spec = FACT_KEYS[key]
    if spec.input != "choice" or value not in spec.options:
        raise HTTPException(422, f"Choose one of: {', '.join(spec.options or ('Yes', 'No'))}")
    await rest.update("profiles", {"id": f"eq.{user.id}"}, {field: None})
    row = await memory.save_fact(rest, value=value, key=key, scope="global", source_type="memory_edit")
    return _fact_item(row)


@router.patch("/{item_id}", response_model=MemoryItem, response_model_by_alias=True,
              summary="Edit a fact: its value, scope or status")
async def update_memory(item_id: str, request: UpdateMemoryRequest, user: AuthUser = Depends(get_current_user),
                        rest: SupabaseRest = Depends(get_rest)) -> MemoryItem:
    try:
        if item_id.startswith("profile:"):
            field = item_id.split(":", 1)[1]
            if field not in PROFILE_FIELD_KEYS or not (request.value or "").strip():
                raise HTTPException(422, "Give the new value for this preference.")
            item = await _update_profile_field(rest, user, field, request.value.strip())
        elif item_id.startswith("skill:"):
            raise HTTPException(422, "Edit skills on your profile, or delete this to be asked again.")
        else:
            fact = await _fact(rest, item_id)
            item = _fact_item(await memory.update_fact(rest, fact, request.model_dump(exclude_none=True)))
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    except SupabaseError as e:
        raise _supabase(e) from e
    finally:
        invalidate_profile_cache(user.id)
    await _event(rest, "memory_fact_edited", item.group)
    return item


@router.post("/{item_id}/confirm", response_model=MemoryItem, response_model_by_alias=True,
             summary="Still accurate: re-confirm a fact")
async def confirm_memory(item_id: str, user: AuthUser = Depends(get_current_user),
                         rest: SupabaseRest = Depends(get_rest)) -> MemoryItem:
    try:
        fact = await _fact(rest, item_id)
        item = _fact_item(await memory.update_fact(rest, fact, {"status": "active"}))
    except SupabaseError as e:
        raise _supabase(e) from e
    finally:
        invalidate_profile_cache(user.id)
    await _event(rest, "memory_fact_confirmed", item.group)
    return item


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Forget a fact")
async def delete_memory(item_id: str, user: AuthUser = Depends(get_current_user),
                        rest: SupabaseRest = Depends(get_rest)) -> Response:
    group = None
    try:
        if item_id.startswith("profile:"):
            field = item_id.split(":", 1)[1]
            if field not in PROFILE_FIELD_KEYS:
                raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
            await rest.update("profiles", {"id": f"eq.{user.id}"}, {field: None})
            group = FACT_KEYS[PROFILE_FIELD_KEYS[field]].group
        elif item_id.startswith("skill:"):
            # Only an "I don't have this" skill is memory; real skills are deleted on the profile.
            skill_id = _id(item_id.split(":", 1)[1])
            removed = await rest.delete("skills", {"id": f"eq.{skill_id}", "level": "eq.none"})
            if not removed:
                raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
            group = "Skills"
        else:
            fact = await _fact(rest, item_id)
            await memory.delete_fact(rest, str(fact["id"]))
            group = group_for(fact.get("key"), fact.get("category"))
    except SupabaseError as e:
        raise _supabase(e) from e
    finally:
        invalidate_profile_cache(user.id)
    await _event(rest, "memory_fact_deleted", group)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/conflicts/resolve", response_model=MemoryResponse, response_model_by_alias=True,
             summary="Settle a disagreement between the profile and Application Memory")
async def resolve_conflict(request: ResolveConflictRequest, user: AuthUser = Depends(get_current_user),
                           rest: SupabaseRest = Depends(get_rest)) -> MemoryResponse:
    if request.id.startswith("skill:"):
        # A declined skill the profile's own work lists: keeping the profile drops the "I don't have this".
        if request.use == "memory":
            raise HTTPException(422, "Remove the skill from that experience or project on your profile instead.")
        await delete_memory(request.id, user, rest)
        return await list_memory(user, rest)
    try:
        fact = await _fact(rest, request.id)
        key = fact.get("key")
        spec = FACT_KEYS.get(key or "")
        if request.use == "memory" and spec and spec.profile_field:
            await _update_profile_field(rest, user, spec.profile_field, str(fact.get("answer") or ""))
            fits, _ = to_profile(key, fact.get("answer"))
            if fits:
                await rest.update("profile_facts", {"id": f"eq.{fact['id']}"}, {"status": "superseded"})
        else:
            # Keep the profile (or the newer memory): this one stops answering, but stays visible as history.
            await rest.update("profile_facts", {"id": f"eq.{fact['id']}"}, {"status": "superseded"})
    except SupabaseError as e:
        raise _supabase(e) from e
    finally:
        invalidate_profile_cache(user.id)
    await _event(rest, "memory_fact_edited", group_for(key, fact.get("category")))
    return await list_memory(user, rest)
