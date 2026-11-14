"""Leads endpoints."""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from src.app.api.deps import get_rest
from src.app.core.auth import AuthUser, get_current_user
from src.app.core.config import get_settings
from src.app.core.rate_limit import check_rate_limit
from src.app.db.rest import SupabaseError, SupabaseRest
from src.app.leads.posts import _terms, canonical_post_url, post_identity, qualify_post
from src.app.schemas.leads import (
    CollectLinkedInPostsRequest,
    CollectLinkedInPostsResponse,
    CreateLeadRequest,
    LeadListResponse,
    LeadRecord,
)

router = APIRouter(prefix="/leads", tags=["Leads"])
logger = logging.getLogger("LeadsAPI")


def _upstream(error: SupabaseError) -> HTTPException:
    return HTTPException(status.HTTP_502_BAD_GATEWAY, f"Could not complete the lead request: {error}")


@router.get("", response_model=LeadListResponse, summary="List leads for the current user")
async def list_leads(
    user: AuthUser = Depends(get_current_user),
    rest: SupabaseRest = Depends(get_rest),
) -> LeadListResponse:
    try:
        rows = await rest.select("leads", {"order": "collected_at.desc"})
    except SupabaseError as exc:
        raise _upstream(exc) from exc
    return {"leads": rows}


@router.post("", status_code=status.HTTP_201_CREATED, summary="Create a lead for the current user")
async def create_lead(
    request: CreateLeadRequest,
    user: AuthUser = Depends(get_current_user),
    rest: SupabaseRest = Depends(get_rest),
) -> Dict[str, Any]:
    payload = request.model_dump(exclude_none=True)
    payload["user_id"] = user.id
    try:
        row = await rest.insert("leads", payload)
    except SupabaseError as exc:
        raise _upstream(exc) from exc
    return row


async def _targeting_profile(rest: SupabaseRest, profile_id: Optional[UUID]) -> Dict[str, Any]:
    """The requested profile, else the active one, else the most recently updated one."""
    if profile_id:
        rows = await rest.select("targeting_profiles", {"id": f"eq.{profile_id}", "limit": "1"})
        if not rows:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Targeting profile not found.")
        return rows[0]
    rows = await rest.select("targeting_profiles", {"is_active": "eq.true", "limit": "1"})
    if not rows:
        rows = await rest.select("targeting_profiles", {"order": "updated_at.desc", "limit": "1"})
    if not rows:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Create a targeting profile in Ansly Leads before collecting posts.",
        )
    return rows[0]


@router.post(
    "/collect",
    response_model=CollectLinkedInPostsResponse,
    summary="Qualify and save LinkedIn posts the user loaded and sent from the extension",
)
async def collect_linkedin_leads(
    request: CollectLinkedInPostsRequest,
    user: AuthUser = Depends(get_current_user),
    rest: SupabaseRest = Depends(get_rest),
) -> CollectLinkedInPostsResponse:
    settings = get_settings()
    try:
        profile = await _targeting_profile(rest, request.targeting_profile_id)
        if not _terms(profile.get("target_roles")) and not _terms(profile.get("keywords")):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "Add target roles or keywords to your targeting profile before collecting posts.",
            )
        await check_rate_limit(rest, settings.RATE_LIMIT_PER_MINUTE)
        session = await rest.insert("lead_collection_sessions", {
            "targeting_profile_id": str(profile["id"]),
            "source_platform": "linkedin",
            "status": "processing",
            "summary_json": {"provider": "extension_linkedin_posts", "loaded_count": request.loaded_count},
        })
    except SupabaseError as exc:
        raise _upstream(exc) from exc

    seen: set[str] = set()
    saved_leads: List[Dict[str, Any]] = []
    unidentified = filtered = duplicates = relevant = persistence_errors = 0
    for candidate in request.candidates:
        url = canonical_post_url(candidate.source_post_id, candidate.original_post_url)
        data = candidate.model_dump()
        identity = post_identity(data)
        if not identity and not url:
            unidentified += 1
            continue
        key = url or identity
        if key in seen:
            duplicates += 1
            continue
        seen.add(key)
        data["canonical_url"] = url
        data["published_at"] = candidate.published_at.isoformat() if candidate.published_at else None
        lead = qualify_post(data, profile)
        if lead is None:
            filtered += 1
            continue
        relevant += 1
        lead["source_post_id"] = identity
        lead["targeting_profile_id"] = str(profile["id"])
        lead["collection_session_id"] = session["id"]
        try:
            saved_leads.append(await rest.insert("leads", lead))
        except SupabaseError as exc:
            if exc.status_code == status.HTTP_409_CONFLICT:
                duplicates += 1
                continue
            persistence_errors += 1
            logger.error("Could not save a LinkedIn lead for user %s: %s", user.id, exc)

    session_status = "partially_completed" if persistence_errors else "completed"
    counts = {
        "loaded_count": request.loaded_count,
        "extracted_count": len(request.candidates),
        "unidentified_count": unidentified,
        "relevant_count": relevant,
        "filtered_count": filtered,
        "duplicate_count": duplicates,
        "saved_count": len(saved_leads),
    }
    try:
        await rest.update(
            "lead_collection_sessions",
            {"id": f"eq.{session['id']}"},
            {
                "status": session_status,
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "total_candidates_reviewed": len(request.candidates),
                "relevant_candidates": relevant,
                "irrelevant_candidates": filtered,
                "duplicates_skipped": duplicates,
                "new_leads_saved": len(saved_leads),
                "error_count": persistence_errors,
                "summary_json": {"provider": "extension_linkedin_posts", **counts},
            },
        )
    except SupabaseError as exc:
        logger.error("Could not finalize LinkedIn collection session for user %s: %s", user.id, exc)

    return CollectLinkedInPostsResponse(
        session_id=session["id"],
        status=session_status,
        **counts,
        leads=[LeadRecord.model_validate(lead) for lead in saved_leads],
    )
