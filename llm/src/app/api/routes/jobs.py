"""
Job Analysis Endpoint (v1.2).

Stores the job the user is viewing (description text only, never page HTML)
and extracts its requirements.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, status

from src.app.api.deps import get_gateway, get_rest
from src.app.core.auth import AuthUser, get_current_user
from src.app.core.config import get_settings
from src.app.core.rate_limit import check_rate_limit
from src.app.db.rest import SupabaseError, SupabaseRest
from src.app.gateway import GatewayUnavailableError, LLMGateway
from src.app.resume.analysis.analyze import analyze_job, description_too_short
from src.app.schemas.job import AnalyzeJobRequest, AnalyzeJobResponse

logger = logging.getLogger("JobsAPI")

router = APIRouter(prefix="/jobs", tags=["Jobs"])

TOO_SHORT = "There's not enough job information to tailor your resume."


@router.post("/analyze", response_model=AnalyzeJobResponse, response_model_by_alias=True,
             summary="Store a job posting and extract its requirements")
async def analyze(
    request: AnalyzeJobRequest,
    user: AuthUser = Depends(get_current_user),
    rest: SupabaseRest = Depends(get_rest),
    gateway: LLMGateway = Depends(get_gateway),
) -> AnalyzeJobResponse:
    job = request.job
    if description_too_short(job.description):
        raise HTTPException(422, TOO_SHORT)
    try:
        await check_rate_limit(rest, get_settings().RATE_LIMIT_PER_MINUTE)
        row = await rest.insert("job_contexts", {
            "title": job.title, "company": job.company or None, "location": job.location,
            "employment_type": job.employment_type, "url": job.url or None,
            "description": job.description.strip(), "source": job.source,
        })
        analysis = await analyze_job(gateway, job)
        await rest.update("job_contexts", {"id": f"eq.{row['id']}"}, {"analysis": analysis.model_dump(mode="json", by_alias=True)})
    except GatewayUnavailableError as e:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "All AI providers are busy right now. Please try again in a minute.") from e
    except SupabaseError as e:
        logger.error(f"Supabase error for user {user.id}: {e}")
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Could not save the job. Please try again.") from e
    return AnalyzeJobResponse(job_context_id=row["id"], analysis=analysis)
