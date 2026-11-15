"""Leads endpoints."""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from src.app.api.deps import get_gateway, get_rest
from src.app.api.routes.lead_emails import record_lead_usage
from src.app.core.auth import AuthUser, get_current_user
from src.app.core.config import get_settings
from src.app.core.rate_limit import check_rate_limit
from src.app.db.rest import SupabaseError, SupabaseRest
from src.app.gateway import LLMGateway
from src.app.leads.cleanup import Verdict, classify, profile_terms
from src.app.leads.posts import _terms, canonical_post_url, post_identity, qualify_post
from src.app.schemas.leads import (
    CleanupRequest,
    CleanupResponse,
    CleanupResult,
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


# --------------------------------------------------------------------------- Ansly Cleanup

CLEANUP_TEXT_CHARS = 1500


def _cleanup_result(verdict: Verdict, lead: Dict[str, Any], outcome: str, reason: Optional[str] = None
                    ) -> CleanupResult:
    shown = outcome != "kept"
    return CleanupResult(
        lead_id=verdict.lead_id, outcome=outcome, category=verdict.category, reason=reason or verdict.reason,
        included_keywords=verdict.included[:10], excluded_keywords=verdict.excluded[:10],
        title=(lead.get("title") or "")[:300] if shown else None,
        description=(lead.get("description") or "")[:CLEANUP_TEXT_CHARS] if shown else None,
        contacted=lead.get("status") == "contacted", checked=verdict.decided_by != "none",
    )


async def _remove(rest: SupabaseRest, ids: List[str]) -> set[str]:
    """Deletes the leads; returns the ids that were removed. One that can't go (its email is sending) stays."""
    if not ids:
        return set()
    try:
        return {str(r["id"]) for r in await rest.delete("leads", {"id": f"in.({','.join(ids)})"})}
    except SupabaseError:
        removed: set[str] = set()
        for lead_id in ids:
            try:
                removed |= {str(r["id"]) for r in await rest.delete("leads", {"id": f"eq.{lead_id}"})}
            except SupabaseError as exc:
                logger.warning("Cleanup could not remove lead %s: %s", lead_id, exc)
        return removed


@router.post(
    "/cleanup",
    response_model=CleanupResponse,
    dependencies=[Depends(record_lead_usage)],
    summary="Ansly Cleanup: remove job-seeker posts and off-stack roles from these leads (up to 50 per request)",
)
async def cleanup_leads(
    request: CleanupRequest,
    user: AuthUser = Depends(get_current_user),
    rest: SupabaseRest = Depends(get_rest),
    gateway: LLMGateway = Depends(get_gateway),
) -> CleanupResponse:
    """Classifies each lead against the active targeting profile and the user's skills. Confident non-matches are
    deleted now; leads Ansly is unsure about (and contacted leads, which keep their email history) are returned
    for review and left in place. Nothing else changes."""
    ids = sorted({str(i) for i in request.lead_ids})
    try:
        await check_rate_limit(rest, get_settings().RATE_LIMIT_PER_MINUTE)
        profile = await _targeting_profile(rest, None)
        leads = await rest.select("leads", {"id": f"in.({','.join(ids)})", "limit": str(len(ids))})
        skills = [row.get("name") for row in await rest.select(
            "skills", {"select": "name", "order": "sort_order.asc", "limit": "100"})]
    except SupabaseError as exc:
        raise _upstream(exc) from exc

    verdicts = await classify(gateway, leads, profile_terms(profile, skills))
    by_id = {str(lead["id"]): lead for lead in leads}
    to_remove = [v.lead_id for v in verdicts if v.action == "remove" and by_id[v.lead_id].get("status") != "contacted"]
    removed = await _remove(rest, to_remove)

    results: List[CleanupResult] = []
    for verdict in verdicts:
        lead = by_id[verdict.lead_id]
        if verdict.lead_id in removed:
            results.append(_cleanup_result(verdict, lead, "removed"))
        elif verdict.action == "remove" and lead.get("status") == "contacted":
            results.append(_cleanup_result(verdict, lead, "review",
                                           verdict.reason + " You already contacted this lead, so it wasn't removed."))
        elif verdict.action == "remove":
            results.append(_cleanup_result(verdict, lead, "review",
                                           verdict.reason + " It couldn't be removed right now."))
        elif verdict.action == "review":
            results.append(_cleanup_result(verdict, lead, "review"))
        else:
            results.append(_cleanup_result(verdict, lead, "kept"))
    return CleanupResponse(
        results=results,
        removed=sum(r.outcome == "removed" for r in results),
        review=sum(r.outcome == "review" for r in results),
        kept=sum(r.outcome == "kept" for r in results),
        unchecked=sum(not r.checked for r in results),
    )
