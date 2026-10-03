"""
Answer Generation Endpoints.

Everything an answer needs before the model (burst limit, today's usage, the
profile, saved answers) is read concurrently, so the user waits for one round
trip to Supabase instead of several in a row.
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status

from src.app.answers.engine import AnswerEngine
from src.app.answers.profile_context import fetch_profile_data
from src.app.answers.saved import load_saved_answers
from src.app.answers.similarity import best_match
from src.app.api.deps import get_answer_engine, get_rest
from src.app.core.auth import AuthUser, get_current_user
from src.app.core.concurrency import capture, gather_all
from src.app.core.config import get_settings
from src.app.core.rate_limit import check_rate_limit, enforce_daily_limit, generations_today
from src.app.db.rest import SupabaseError, SupabaseRest
from src.app.gateway import GatewayUnavailableError
from src.app.schemas.answers import (
    AnswerResponse,
    GenerateAnswerRequest,
    GenerateBatchRequest,
    GenerateBatchResponse,
    RegenerateAnswerRequest,
    ResolveAnswerResponse,
)

logger = logging.getLogger("AnswersAPI")

router = APIRouter(prefix="/answers", tags=["Answers"])

PROFILE_UNAVAILABLE = "Could not load your profile. Please try again."
PROVIDERS_BUSY = "All AI providers are busy right now. Please try again in a minute."


async def _record_usage(rest: SupabaseRest, events: List[Dict[str, Any]]) -> None:
    """One bulk insert. Analytics must never cost the user their answer."""
    try:
        await rest.insert_many("usage_events", events)
    except SupabaseError as e:
        logger.warning(f"Could not record usage event: {e}")


def _raise_if_error(result: Any) -> Any:
    if isinstance(result, BaseException):
        raise result
    return result


async def _run(
    kind: str,
    request: GenerateAnswerRequest,
    user: AuthUser,
    rest: SupabaseRest,
    engine: AnswerEngine,
    previous_answer: Optional[str] = None,
    instruction: Optional[str] = None,
    check_saved: bool = False,
) -> ResolveAnswerResponse:
    settings = get_settings()
    analysis = engine.analyze(request)
    try:
        # The burst limit is enforced only if we go on to answer: a saved answer is returned even when it trips.
        reads = [
            capture(check_rate_limit(rest, settings.RATE_LIMIT_PER_MINUTE)),
            generations_today(rest),
            fetch_profile_data(rest, analysis, user.id),
        ]
        if check_saved:
            reads.append(capture(load_saved_answers(rest, user.id)))
        rate_limited, used_today, data, *saved = await gather_all(*reads)

        score = 0.0
        if saved:
            if isinstance(saved[0], SupabaseError):
                # A broken saved-answer lookup shouldn't block generating.
                logger.warning(f"Could not load saved answers: {saved[0]}")
            else:
                match, score = best_match(request.question, _raise_if_error(saved[0]))
                if match is not None:
                    return ResolveAnswerResponse(saved_match=match, score=score)

        _raise_if_error(rate_limited)
        response = await engine.answer(
            rest, request, previous_answer=previous_answer, instruction=instruction, user_id=user.id, data=data,
            before_model=lambda: enforce_daily_limit(used_today, settings.DAILY_GENERATION_LIMIT),
        )
    except SupabaseError as e:
        logger.error(f"Supabase error for user {user.id}: {e}")
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, PROFILE_UNAVAILABLE) from e
    except GatewayUnavailableError as e:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, PROVIDERS_BUSY) from e

    await _record_usage(rest, [
        {"kind": kind, "category": response.category, "provider": response.provider, "tokens": response.tokens},
    ])
    return ResolveAnswerResponse(score=score, answer=response)


@router.post(
    "/resolve",
    response_model=ResolveAnswerResponse,
    response_model_by_alias=True,
    summary="Return a similar saved answer, or generate one: one request per field",
)
async def resolve_answer(
    request: GenerateAnswerRequest,
    user: AuthUser = Depends(get_current_user),
    rest: SupabaseRest = Depends(get_rest),
    engine: AnswerEngine = Depends(get_answer_engine),
) -> ResolveAnswerResponse:
    return await _run("generate", request, user, rest, engine, check_saved=True)


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
    return (await _run("generate", request, user, rest, engine)).answer


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
    result = await _run(
        "regenerate", request, user, rest, engine,
        previous_answer=request.previous_answer, instruction=request.instruction,
    )
    return result.answer


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
        _, used_today, plan = await gather_all(
            check_rate_limit(rest, settings.RATE_LIMIT_PER_MINUTE),
            generations_today(rest),
            engine.plan_batch(rest, request, user.id),
        )
        enforce_daily_limit(used_today, settings.DAILY_GENERATION_LIMIT, needed=len(plan.pending))
        results = await engine.complete_batch(rest, plan)
    except SupabaseError as e:
        logger.error(f"Supabase error for user {user.id}: {e}")
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, PROFILE_UNAVAILABLE) from e

    # Answers given without the model don't count toward the daily limit, so they aren't recorded.
    await _record_usage(rest, [
        {"kind": "generate", "category": r.category, "provider": r.provider, "tokens": r.tokens}
        for r in results if r.provider is not None
    ])
    return GenerateBatchResponse(results=results)
