"""
Per-User Rate Limiting and Usage Limits.

Both limits live in Supabase, so they hold across restarts and across the
many short-lived instances of a serverless deployment.

- Burst limit: public.check_rate_limit records a hit per request and refuses
  more than RATE_LIMIT_PER_MINUTE in a sliding minute.
- Daily limit: counts the user's generate/regenerate events
  (DAILY_GENERATION_LIMIT).
- Daily tailoring limit: counts tailoring_started events
  (DAILY_TAILORING_LIMIT). Separate because a tailoring costs several LLM calls.
"""

from datetime import datetime, timezone

from fastapi import HTTPException, status

from src.app.db.rest import SupabaseRest

WINDOW_SECONDS = 60


async def check_rate_limit(rest: SupabaseRest, per_minute: int) -> None:
    retry_after = await rest.rpc("check_rate_limit", {"max_hits": per_minute, "window_seconds": WINDOW_SECONDS})
    if retry_after:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"Too many requests. Try again in {retry_after} seconds.",
            {"Retry-After": str(retry_after)},
        )


async def _used_today(rest: SupabaseRest, kinds: str) -> int:
    start_of_day = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    return await rest.count("usage_events", {"kind": f"in.({kinds})", "created_at": f"gte.{start_of_day.isoformat()}"})


async def generations_today(rest: SupabaseRest) -> int:
    # Rewrites are small, but they are model calls: they count, so the limit can't be sidestepped.
    return await _used_today(rest, "generate,regenerate,rewrite,fit_to_limit")


async def check_daily_limit(rest: SupabaseRest, limit: int, needed: int = 1) -> None:
    """Refuses when `needed` more generations would go over today's limit (fill all needs several)."""
    if needed <= 0:
        return
    enforce_daily_limit(await generations_today(rest), limit, needed)


def enforce_daily_limit(used: int, limit: int, needed: int = 1) -> None:
    """check_daily_limit for a count the caller already has (fetched alongside other work)."""
    if needed <= 0:
        return
    remaining = max(limit - used, 0)
    if remaining <= 0:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"Daily limit of {limit} generated answers reached. It resets at midnight UTC.",
        )
    if needed > remaining:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"These {needed} answers would go over your daily limit: {remaining} left today. "
            "Answer fewer fields at once, or try again after midnight UTC.",
        )


async def check_daily_tailoring_limit(rest: SupabaseRest, limit: int) -> None:
    """Refuses a new resume tailoring once today's tailoring limit is used up."""
    if await _used_today(rest, "tailoring_started") >= limit:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"Daily limit of {limit} tailored resumes reached. It resets at midnight UTC.",
        )
