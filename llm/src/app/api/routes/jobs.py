"""
Job Matching and Saved Search Endpoints.
Jobs, matches and alerts are read by the web app directly through Supabase;
these endpoints run the parts that need the matching engine.
"""

from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, status

from src.app.api.deps import get_rest
from src.app.core.auth import AuthUser, get_current_user
from src.app.core.config import get_settings
from src.app.core.rate_limit import rate_limiter
from src.app.db.rest import SupabaseError, SupabaseRest
from src.app.jobs.searches import parse_search_query, search_name
from src.app.jobs.service import refresh_for_user
from src.app.schemas.jobs import (
    CreateSavedSearchRequest,
    ParseSearchRequest,
    ParseSearchResponse,
    RefreshMatchesResponse,
    SearchFilters,
)

router = APIRouter(tags=["Jobs"])

# Match refreshes score every recent job; a few per minute is plenty.
REFRESH_PER_MINUTE = 4


def _upstream(e: SupabaseError) -> HTTPException:
    return HTTPException(status.HTTP_502_BAD_GATEWAY, f"Could not reach your data: {e}")


@router.post("/jobs/refresh-matches", response_model=RefreshMatchesResponse, summary="Score recent jobs against your profile")
async def refresh_matches(user: AuthUser = Depends(get_current_user), rest: SupabaseRest = Depends(get_rest)):
    rate_limiter.check(f"{user.id}:refresh", REFRESH_PER_MINUTE)
    try:
        return await refresh_for_user(rest, get_settings(), user.id)
    except SupabaseError as e:
        raise _upstream(e) from e


@router.post("/saved-searches/parse", response_model=ParseSearchResponse, summary="Preview the filters for a search")
async def parse_search(request: ParseSearchRequest, user: AuthUser = Depends(get_current_user)):
    filters = parse_search_query(request.query)
    return ParseSearchResponse(name=search_name(request.query, filters), filters=SearchFilters(**filters))


@router.post("/saved-searches", status_code=status.HTTP_201_CREATED, summary="Save a natural-language search")
async def create_saved_search(request: CreateSavedSearchRequest, rest: SupabaseRest = Depends(get_rest)) -> Dict[str, Any]:
    filters = request.filters.model_dump() if request.filters else parse_search_query(request.query)
    row = {
        "name": (request.name or "").strip() or search_name(request.query, filters),
        "query": request.query.strip(),
        "filters": filters,
        "alerts_enabled": request.alerts_enabled,
    }
    try:
        return await rest.insert("saved_searches", row)
    except SupabaseError as e:
        raise _upstream(e) from e
