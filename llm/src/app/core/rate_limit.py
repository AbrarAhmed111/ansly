"""
Per-User Rate Limiting and Usage Limits.

Both limits live in Supabase, so they hold across restarts and across the
many short-lived instances of a serverless deployment.

- Burst limit: public.check_rate_limit records a hit per request and refuses
  more than RATE_LIMIT_PER_MINUTE in a sliding minute.
- Daily limit: counts the user's generate/regenerate events
  (DAILY_GENERATION_LIMIT).
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


async def check_daily_limit(rest: SupabaseRest, limit: int, needed: int = 1) -> None:
    """Refuses when `needed` more generations would go over today's limit (fill all needs several)."""
    if needed <= 0:
        return
    start_of_day = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    used = await rest.count(
        "usage_events",
        {"kind": "in.(generate,regenerate)", "created_at": f"gte.{start_of_day.isoformat()}"},
    )
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
