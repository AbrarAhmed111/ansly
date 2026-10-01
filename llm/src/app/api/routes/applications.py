"""
Application Workspace Endpoints.
The web app manages applications directly through Supabase; these endpoints
run preparation and serve the extension (context lookup, answer write-back,
autofill data).
"""

import logging
import re
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, Query, status

from src.app.answers.engine import AnswerEngine
from src.app.api.deps import get_answer_engine, get_rest
from src.app.applications.context import url_matches
from src.app.applications.prepare import PrepError, prepare_application
from src.app.core.auth import AuthUser, get_current_user
from src.app.core.config import get_settings
from src.app.core.rate_limit import check_daily_limit, rate_limiter
from src.app.db.rest import SupabaseError, SupabaseRest
from src.app.schemas.jobs import PrepareApplicationResponse, SaveApplicationAnswerRequest

logger = logging.getLogger("ApplicationsAPI")

router = APIRouter(tags=["Applications"])

# Statuses where the user may still be filling the application in.
OPEN_STATUSES = "in.(interested,preparing,applied,interview)"
LOOKUP_COLUMNS = "id,job_id,company,role,job_url,status,resume_id,location"


def _upstream(e: SupabaseError) -> HTTPException:
    return HTTPException(status.HTTP_502_BAD_GATEWAY, f"Could not reach your data: {e}")


@router.post("/applications/{application_id}/prepare", response_model=PrepareApplicationResponse,
             summary="Prepare resume choice, cover letter, answers and interview questions")
async def prepare(application_id: str, user: AuthUser = Depends(get_current_user),
                  rest: SupabaseRest = Depends(get_rest), engine: AnswerEngine = Depends(get_answer_engine)):
    settings = get_settings()
    rate_limiter.check(user.id, settings.RATE_LIMIT_PER_MINUTE)
    try:
        await check_daily_limit(rest, settings.DAILY_GENERATION_LIMIT)
        result = await prepare_application(
            rest, engine, engine.gateway, user.id, application_id,
            temperature=settings.LLM_TEMPERATURE, max_tokens=settings.LLM_MAX_TOKENS,
            job_description_max_chars=settings.JOB_DESCRIPTION_MAX_CHARS,
        )
    except PrepError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e)) from e
    except SupabaseError as e:
        raise _upstream(e) from e
    try:
        await rest.insert("usage_events", {"kind": "prepare", "category": None, "provider": None})
    except SupabaseError as e:
        logger.warning(f"Could not record usage event: {e}")
    return PrepareApplicationResponse(application=result.application, answers=result.answers,
                                      llm_available=result.llm_available)


@router.post("/applications/{application_id}/answers", status_code=status.HTTP_201_CREATED,
             summary="Record an answer given in an application")
async def save_answer(application_id: str, request: SaveApplicationAnswerRequest, user: AuthUser = Depends(get_current_user),
                      rest: SupabaseRest = Depends(get_rest)) -> Dict[str, Any]:
    try:
        if not await rest.select("applications", {"id": f"eq.{application_id}", "select": "id", "limit": "1"}):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Application not found")
        rows = await rest.upsert("application_answers", [{
            "user_id": user.id, "application_id": application_id, "question": request.question.strip(),
            "answer": request.answer.strip(), "category": request.category, "source": request.source,
        }], on_conflict="application_id,question_key", returning=True)
    except SupabaseError as e:
        raise _upstream(e) from e
    return rows[0] if rows else {}


@router.get("/applications/lookup", summary="Find the tracked application for a page URL")
async def lookup(url: str = Query(min_length=8, max_length=2000), rest: SupabaseRest = Depends(get_rest)) -> Dict[str, Any]:
    try:
        apps = await rest.select("applications", {"select": LOOKUP_COLUMNS, "status": OPEN_STATUSES,
                                                  "order": "updated_at.desc", "limit": "500"})
        job_ids = [a["job_id"] for a in apps if a.get("job_id")]
        jobs: Dict[str, Dict[str, Any]] = {}
        if job_ids:
            rows = await rest.select("jobs", {"select": "id,url,apply_url,skills",
                                              "id": "in.(" + ",".join(job_ids) + ")"})
            jobs = {j["id"]: j for j in rows}
    except SupabaseError as e:
        raise _upstream(e) from e
    for app in apps:
        job = jobs.get(app.get("job_id") or "", {})
        if url_matches(url, [app.get("job_url"), job.get("url"), job.get("apply_url")]):
            return {"application": {**app, "skills": job.get("skills") or []}}
    return {"application": None}


def _split_name(full_name: str) -> Dict[str, str]:
    parts = full_name.split()
    if not parts:
        return {"first_name": "", "last_name": ""}
    return {"first_name": parts[0], "last_name": " ".join(parts[1:])}


@router.get("/profile/autofill", summary="Personal details the extension may fill into standard fields")
async def autofill_profile(user: AuthUser = Depends(get_current_user), rest: SupabaseRest = Depends(get_rest)) -> Dict[str, Any]:
    try:
        rows = await rest.select("profiles", {"id": f"eq.{user.id}", "limit": "1"})
    except SupabaseError as e:
        raise _upstream(e) from e
    p = rows[0] if rows else {}
    links = p.get("links") or {}
    full_name = (p.get("full_name") or "").strip()
    location = (p.get("location") or "").strip()
    city = re.split(r",", location)[0].strip() if location else ""
    return {
        "full_name": full_name,
        **_split_name(full_name),
        "email": p.get("email") or user.email or "",
        "phone": p.get("phone") or "",
        "location": location,
        "city": city,
        "linkedin": links.get("linkedin") or "",
        "github": links.get("github") or "",
        "website": links.get("website") or links.get("portfolio") or "",
        "portfolio": links.get("portfolio") or links.get("website") or "",
        "headline": p.get("headline") or "",
    }
