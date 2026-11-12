"""Leads endpoints."""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException, status

from src.app.api.deps import get_rest
from src.app.core.auth import AuthUser, get_current_user
from src.app.core.config import get_settings
from src.app.core.rate_limit import check_rate_limit
from src.app.db.rest import SupabaseError, SupabaseRest
from src.app.leads.search import PublicSearchError, build_queries, qualify_result, search_public_web, unique_results
from src.app.schemas.leads import (
    CollectLeadsRequest,
    CollectLeadsResponse,
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


@router.post("/collect", response_model=CollectLeadsResponse, summary="Search public web results for matching leads")
async def collect_leads(
    request: CollectLeadsRequest,
    user: AuthUser = Depends(get_current_user),
    rest: SupabaseRest = Depends(get_rest),
) -> CollectLeadsResponse:
    settings = get_settings()
    search_key = settings.lookup("BRAVE_SEARCH_API_KEY")
    if not search_key:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Public lead search is not configured. Set BRAVE_SEARCH_API_KEY on the Ansly API service.",
        )

    try:
        profile_rows = await rest.select(
            "targeting_profiles",
            {"id": f"eq.{request.targeting_profile_id}", "limit": "1"},
        )
    except SupabaseError as exc:
        raise _upstream(exc) from exc
    if not profile_rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Targeting profile not found.")
    profile = profile_rows[0]
    try:
        queries = build_queries(profile)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    try:
        await check_rate_limit(rest, settings.RATE_LIMIT_PER_MINUTE)
    except SupabaseError as exc:
        raise _upstream(exc) from exc

    try:
        session = await rest.insert("lead_collection_sessions", {
            "targeting_profile_id": str(request.targeting_profile_id),
            "source_platform": "other",
            "status": "processing",
            "summary_json": {"provider": "brave_search", "queries": queries},
        })
    except SupabaseError as exc:
        raise _upstream(exc) from exc

    try:
        provider_results = []
        errors = 0
        query_errors = []
        for query in queries:
            try:
                provider_results.extend(await search_public_web(query, search_key))
            except PublicSearchError as exc:
                errors += 1
                query_errors.append(str(exc))
        if errors == len(queries):
            raise PublicSearchError("The public search provider failed for every query.")
        candidates = unique_results(provider_results)
        qualified = [candidate for result in candidates if (candidate := qualify_result(result, profile))]
        saved_leads: List[Dict[str, Any]] = []
        duplicates = len(provider_results) - len(candidates)
        for candidate in qualified:
            candidate["targeting_profile_id"] = str(request.targeting_profile_id)
            candidate["collection_session_id"] = session["id"]
            try:
                saved_leads.append(await rest.insert("leads", candidate))
            except SupabaseError as exc:
                if exc.status_code == status.HTTP_409_CONFLICT:
                    duplicates += 1
                    continue
                raise

        session_status = "partially_completed" if errors else "completed"
        summary = {
            "provider": "brave_search",
            "queries_run": len(queries),
            "query_errors": query_errors,
            "total_candidates_reviewed": len(provider_results),
            "relevant_candidates": len(qualified),
            "duplicates_skipped": duplicates,
            "new_leads_saved": len(saved_leads),
        }
        await rest.update(
            "lead_collection_sessions",
            {"id": f"eq.{session['id']}"},
            {
                "status": session_status,
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "total_candidates_reviewed": len(provider_results),
                "relevant_candidates": len(qualified),
                "irrelevant_candidates": len(candidates) - len(qualified),
                "duplicates_skipped": duplicates,
                "new_leads_saved": len(saved_leads),
                "error_count": errors,
                "summary_json": summary,
            },
        )
    except PublicSearchError as exc:
        await rest.update(
            "lead_collection_sessions",
            {"id": f"eq.{session['id']}"},
            {
                "status": "failed",
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "error_count": 1,
                "summary_json": {"provider": "brave_search", "error": str(exc)},
            },
        )
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
    except SupabaseError as exc:
        logger.error("Could not save lead collection session for user %s: %s", user.id, exc)
        await rest.update(
            "lead_collection_sessions",
            {"id": f"eq.{session['id']}"},
            {
                "status": "failed",
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "error_count": 1,
                "summary_json": {"provider": "brave_search", "error": "Could not persist collection results."},
            },
        )
        raise _upstream(exc) from exc

    return CollectLeadsResponse(
        session_id=session["id"],
        status=session_status,
        queries_run=len(queries),
        total_candidates_reviewed=len(provider_results),
        relevant_candidates=len(qualified),
        duplicates_skipped=duplicates,
        new_leads_saved=len(saved_leads),
        leads=[LeadRecord.model_validate(lead) for lead in saved_leads],
    )
