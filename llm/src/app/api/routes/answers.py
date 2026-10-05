"""
Answer Generation Endpoints.

Everything an answer needs before the model (burst limit, today's usage, the
profile, saved answers) is read concurrently, so the user waits for one round
trip to Supabase instead of several in a row. Analytics (usage events and the
per-call llm_calls rows) are written after the response where the host allows
it (core/llm_usage.defer), so the user never waits for them.
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status

from src.app.answers.adapt import adapt_saved_answer, adaptation_reason
from src.app.answers.engine import AnswerEngine
from src.app.answers.profile_context import fetch_profile_data
from src.app.answers.rewrite import rewrite_answer
from src.app.answers.saved import load_saved_answers
from src.app.answers.similarity import best_match
from src.app.api.deps import get_answer_engine, get_rest
from src.app.core import llm_usage
from src.app.core.auth import AuthUser, get_current_user
from src.app.core.concurrency import capture, gather_all
from src.app.core.config import get_settings
from src.app.core.rate_limit import check_rate_limit, enforce_daily_limit, generations_today
from src.app.core.token_budget import job_key
from src.app.db.rest import SupabaseError, SupabaseRest
from src.app.gateway import GatewayUnavailableError
from src.app.memory.service import mark_used
from src.app.schemas.answers import (
    AnswerResponse,
    GenerateAnswerRequest,
    GenerateBatchRequest,
    GenerateBatchResponse,
    JobContext,
    RegenerateAnswerRequest,
    ResolveAnswerResponse,
    RewriteRequest,
    RewriteResponse,
)

logger = logging.getLogger("AnswersAPI")

router = APIRouter(prefix="/answers", tags=["Answers"])

PROFILE_UNAVAILABLE = "Could not load your profile. Please try again."
PROVIDERS_BUSY = "All AI providers are busy right now. Please try again in a minute."


async def _insert_events(rest: SupabaseRest, events: List[Dict[str, Any]]) -> None:
    try:
        await rest.insert_many("usage_events", events)
    except SupabaseError as e:
        logger.warning(f"Could not record usage event: {e}")


def _memory_ids(answers: List[Any]) -> List[str]:
    """The Application Memory facts these answers came from."""
    return [s.id for a in answers if a.origin == "memory" for s in a.used_sources if s.type == "fact"]


async def _record_usage(rest: SupabaseRest, events: List[Dict[str, Any]], job: Optional[JobContext] = None,
                        background: Optional[BackgroundTasks] = None, used_facts: Optional[List[str]] = None) -> None:
    """The request's usage events (one bulk insert) and its LLM calls (another), after the response when
    possible. Analytics must never cost the user their answer."""
    fields = _job_fields(job)
    calls = llm_usage.drain()

    async def write() -> None:
        if events:
            await _insert_events(rest, events)
        if used_facts:
            try:
                await mark_used(rest, used_facts)
            except SupabaseError as e:
                logger.warning(f"Could not stamp memory use: {e}")
        await llm_usage.write_calls(rest, calls, fields.get("job_key"), fields.get("job_context_id"))

    await llm_usage.defer(background, write)


def _job_fields(job: Optional[JobContext]) -> Dict[str, Any]:
    """Which job a usage event belongs to, for tokens per application (no job text is stored)."""
    if job is None:
        return {}
    return {"job_key": job_key(job.url, job.company, job.role), "job_context_id": str(job.id) if job.id else None}


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
    background: Optional[BackgroundTasks] = None,
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
                    reason = adaptation_reason(match, request)
                    adapted = await _adapt(rest, engine, match, request, analysis, reason, rate_limited, used_today,
                                           background) if reason else None
                    if adapted is None:
                        return ResolveAnswerResponse(saved_match=match, score=score)
                    return ResolveAnswerResponse(answer=adapted, score=score, adapted_from=str(match.get("id")))

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
        {"kind": kind, "category": response.category, "provider": response.provider, "tokens": response.tokens,
         "llm_calls": 1 if response.provider else 0, **_job_fields(request.job_context)},
        # Learned facts reused: the measure of Application Memory paying off.
        *([{"kind": "memory_used", "category": response.category}] if response.origin == "memory" else []),
    ], request.job_context, background, used_facts=_memory_ids([response]))
    return ResolveAnswerResponse(score=score, answer=response)


async def _adapt(rest: SupabaseRest, engine: AnswerEngine, saved: Dict[str, Any], request: GenerateAnswerRequest,
                 analysis: Any, reason: str, rate_limited: Any, used_today: int,
                 background: Optional[BackgroundTasks] = None) -> Optional[AnswerResponse]:
    """The saved answer adapted to this job, or None to return it unchanged (limits reached or no valid rewrite)."""
    settings = get_settings()
    try:
        _raise_if_error(rate_limited)
        enforce_daily_limit(used_today, settings.DAILY_GENERATION_LIMIT)
        adapted = await adapt_saved_answer(engine.gateway, saved, request, reason, analysis.category, analysis.intent)
    except (HTTPException, GatewayUnavailableError, ValueError) as e:
        logger.info(f"Saved answer returned unchanged ({reason}): {getattr(e, 'detail', e)}")
        await _record_usage(rest, [], request.job_context, background)  # a rejected rewrite was still billed
        return None
    await _record_usage(rest, [
        {"kind": "adapt_saved_answer", "category": adapted.category, "provider": adapted.provider,
         "tokens": adapted.tokens, "llm_calls": 1, **_job_fields(request.job_context)},
    ], request.job_context, background)
    return adapted


@router.post(
    "/resolve",
    response_model=ResolveAnswerResponse,
    response_model_by_alias=True,
    summary="Return a similar saved answer, or generate one: one request per field",
)
async def resolve_answer(
    request: GenerateAnswerRequest,
    background: BackgroundTasks,
    user: AuthUser = Depends(get_current_user),
    rest: SupabaseRest = Depends(get_rest),
    engine: AnswerEngine = Depends(get_answer_engine),
) -> ResolveAnswerResponse:
    return await _run("generate", request, user, rest, engine, check_saved=True, background=background)


@router.post(
    "/generate",
    response_model=AnswerResponse,
    response_model_by_alias=True,
    summary="Generate a grounded answer to an application question",
)
async def generate_answer(
    request: GenerateAnswerRequest,
    background: BackgroundTasks,
    user: AuthUser = Depends(get_current_user),
    rest: SupabaseRest = Depends(get_rest),
    engine: AnswerEngine = Depends(get_answer_engine),
) -> AnswerResponse:
    return (await _run("generate", request, user, rest, engine, background=background)).answer


@router.post(
    "/regenerate",
    response_model=AnswerResponse,
    response_model_by_alias=True,
    summary="Generate a different version of a previous answer",
)
async def regenerate_answer(
    request: RegenerateAnswerRequest,
    background: BackgroundTasks,
    user: AuthUser = Depends(get_current_user),
    rest: SupabaseRest = Depends(get_rest),
    engine: AnswerEngine = Depends(get_answer_engine),
) -> AnswerResponse:
    result = await _run(
        "regenerate", request, user, rest, engine,
        previous_answer=request.previous_answer, instruction=request.instruction, background=background,
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
    background: BackgroundTasks,
    user: AuthUser = Depends(get_current_user),
    rest: SupabaseRest = Depends(get_rest),
    engine: AnswerEngine = Depends(get_answer_engine),
) -> GenerateBatchResponse:
    """Every question of one form in as few model calls as possible: deterministic answers, saved answers
    (`check_saved`), the answer cache, then one generation call per up to BATCH_GROUP_SIZE questions."""
    settings = get_settings()
    try:
        # One burst-limit hit for the whole batch; the daily limit counts every generated answer. Saved answers
        # load alongside the profile: the plan needs both.
        saved = capture(load_saved_answers(rest, user.id)) if request.check_saved else None
        _, used_today, plan = await gather_all(
            check_rate_limit(rest, settings.RATE_LIMIT_PER_MINUTE),
            generations_today(rest),
            engine.plan_batch(rest, request, user.id, saved=saved),
        )
        enforce_daily_limit(used_today, settings.DAILY_GENERATION_LIMIT, needed=len(plan.pending) + len(plan.adapt))
        results = await engine.complete_batch(rest, plan)
    except SupabaseError as e:
        logger.error(f"Supabase error for user {user.id}: {e}")
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, PROFILE_UNAVAILABLE) from e

    # Answers given without the model don't count toward the daily limit, so they aren't recorded. The batch's
    # model calls are counted once, on its first event.
    generated = [r for r in results if r.provider is not None]
    await _record_usage(rest, [
        {"kind": "adapt_saved_answer" if r.adapted_from else "generate", "category": r.category,
         "provider": r.provider, "tokens": r.tokens, "llm_calls": plan.calls if i == 0 else 0,
         **_job_fields(request.job_context)}
        for i, r in enumerate(generated)
    ] + [{"kind": "memory_used", "category": r.category} for r in results if r.origin == "memory"],
        request.job_context, background, used_facts=_memory_ids(results))
    counts = {source: list(plan.sources.values()).count(source) for source in set(plan.sources.values())}
    logger.info("batch " + " ".join(f"{k}={v}" for k, v in sorted(counts.items())) + f" llm_calls={plan.calls}")
    return GenerateBatchResponse(results=results)


@router.post(
    "/rewrite",
    response_model=RewriteResponse,
    response_model_by_alias=True,
    summary="Shorter, more natural, fit to limit...: transform an answer without regenerating it",
)
async def rewrite(
    request: RewriteRequest,
    background: BackgroundTasks,
    user: AuthUser = Depends(get_current_user),
    rest: SupabaseRest = Depends(get_rest),
    engine: AnswerEngine = Depends(get_answer_engine),
) -> RewriteResponse:
    """One small call on the user's current text (their latest edit): no profile, no retrieval. A rewrite that
    would add facts is rejected and the text comes back unchanged (`changed: false`)."""
    if request.action == "custom" and not (request.instruction or "").strip():
        raise HTTPException(422, "Say how to rewrite it, e.g. \"more direct\".")
    settings = get_settings()
    try:
        _, used_today = await gather_all(
            check_rate_limit(rest, settings.RATE_LIMIT_PER_MINUTE), generations_today(rest))
        enforce_daily_limit(used_today, settings.DAILY_GENERATION_LIMIT)
        result = await rewrite_answer(engine.gateway, request)
    except SupabaseError as e:
        logger.error(f"Supabase error for user {user.id}: {e}")
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, PROFILE_UNAVAILABLE) from e
    except GatewayUnavailableError as e:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, PROVIDERS_BUSY) from e
    kind = "fit_to_limit" if request.action == "fit" else "rewrite"
    await _record_usage(rest, [
        {"kind": kind, "category": request.action, "provider": result.provider, "tokens": result.tokens or None,
         "llm_calls": 1, **_job_fields(request.job_context)},
    ], request.job_context, background)
    return RewriteResponse(answer=result.answer, changed=result.changed, reason=result.reason)
