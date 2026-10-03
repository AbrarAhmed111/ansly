"""
Answer Generation Endpoints.
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status

from src.app.answers.engine import AnswerEngine
from src.app.api.deps import get_answer_engine, get_rest
from src.app.core.auth import AuthUser, get_current_user
from src.app.core.config import get_settings
from src.app.core.rate_limit import check_daily_limit, check_rate_limit
from src.app.db.rest import SupabaseError, SupabaseRest
from src.app.gateway import GatewayUnavailableError
from src.app.schemas.answers import (
    AnswerResponse,
    GenerateAnswerRequest,
    GenerateBatchRequest,
    GenerateBatchResponse,
    RegenerateAnswerRequest,
)

logger = logging.getLogger("AnswersAPI")

router = APIRouter(prefix="/answers", tags=["Answers"])


async def _run(
    kind: str,
    request: GenerateAnswerRequest,
    user: AuthUser,
    rest: SupabaseRest,
    engine: AnswerEngine,
    previous_answer: Optional[str] = None,
    instruction: Optional[str] = None,
) -> AnswerResponse:
    settings = get_settings()
    try:
        await check_rate_limit(rest, settings.RATE_LIMIT_PER_MINUTE)
        await check_daily_limit(rest, settings.DAILY_GENERATION_LIMIT)
        response = await engine.answer(rest, request, previous_answer=previous_answer, instruction=instruction)
    except SupabaseError as e:
        logger.error(f"Supabase error for user {user.id}: {e}")
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Could not load your profile. Please try again.") from e
    except GatewayUnavailableError as e:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "All AI providers are busy right now. Please try again in a minute.",
        ) from e

    try:
        await rest.insert(
            "usage_events",
            {"kind": kind, "category": response.category, "provider": response.provider, "tokens": response.tokens},
        )
    except SupabaseError as e:
        # Analytics must never cost the user their answer.
        logger.warning(f"Could not record usage event: {e}")
    return response


@router.post(
    "/generate",
    response_model=AnswerResponse,
    response_model_by_alias=True,
    summary="Generate a grounded answer to an application question",
)
async def generate_answer(
    request: GenerateAnswerRequest,
    user: AuthUser = Depends(get_current_user),
    rest: SupabaseRest = Depends(get_rest),
    engine: AnswerEngine = Depends(get_answer_engine),
) -> AnswerResponse:
    return await _run("generate", request, user, rest, engine)


@router.post(
    "/regenerate",
    response_model=AnswerResponse,
    response_model_by_alias=True,
    summary="Generate a different version of a previous answer",
)
async def regenerate_answer(
    request: RegenerateAnswerRequest,
    user: AuthUser = Depends(get_current_user),
    rest: SupabaseRest = Depends(get_rest),
    engine: AnswerEngine = Depends(get_answer_engine),
) -> AnswerResponse:
    return await _run(
        "regenerate", request, user, rest, engine,
        previous_answer=request.previous_answer, instruction=request.instruction,
    )


@router.post(
    "/generate-batch",
    response_model=GenerateBatchResponse,
    response_model_by_alias=True,
    summary="Answer several questions from one form (fill all)",
)
async def generate_batch(
    request: GenerateBatchRequest,
    user: AuthUser = Depends(get_current_user),
    rest: SupabaseRest = Depends(get_rest),
    engine: AnswerEngine = Depends(get_answer_engine),
) -> GenerateBatchResponse:
    settings = get_settings()
    try:
        # One burst-limit hit for the whole batch; the daily limit counts every generated answer.
        await check_rate_limit(rest, settings.RATE_LIMIT_PER_MINUTE)
        plan = await engine.plan_batch(rest, request)
        await check_daily_limit(rest, settings.DAILY_GENERATION_LIMIT, needed=len(plan.pending))
        results = await engine.complete_batch(rest, plan)
    except SupabaseError as e:
        logger.error(f"Supabase error for user {user.id}: {e}")
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Could not load your profile. Please try again.") from e

    for result in results:
        if result.provider is None:
            continue  # Answered without the model: doesn't count toward the daily limit.
        try:
            await rest.insert("usage_events", {"kind": "generate", "category": result.category, "provider": result.provider,
                                               "tokens": result.tokens})
        except SupabaseError as e:
            logger.warning(f"Could not record usage event: {e}")
    return GenerateBatchResponse(results=results)
