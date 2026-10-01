"""
Per-User Rate Limiting and Usage Limits.

- Burst limit: an in-memory sliding window per user (RATE_LIMIT_PER_MINUTE).
  Per-process; good enough for a single API instance.
- Daily limit: counts the user's generate/regenerate/prepare events in Supabase
  (DAILY_GENERATION_LIMIT), so it holds across restarts and instances.
"""

import time
from collections import defaultdict, deque
from datetime import datetime, timezone
from typing import Deque, Dict

from fastapi import HTTPException, status

from src.app.db.rest import SupabaseRest

WINDOW_SECONDS = 60


class RateLimiter:
    def __init__(self) -> None:
        self._hits: Dict[str, Deque[float]] = defaultdict(deque)

    def check(self, user_id: str, per_minute: int) -> None:
        now = time.monotonic()
        hits = self._hits[user_id]
        while hits and now - hits[0] > WINDOW_SECONDS:
            hits.popleft()
        if len(hits) >= per_minute:
            retry_after = int(WINDOW_SECONDS - (now - hits[0])) + 1
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                f"Too many requests. Try again in {retry_after} seconds.",
                {"Retry-After": str(retry_after)},
            )
        hits.append(now)

    def reset(self) -> None:
        self._hits.clear()


async def check_daily_limit(rest: SupabaseRest, limit: int) -> None:
    start_of_day = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    used = await rest.count(
        "usage_events",
        {"kind": "in.(generate,regenerate,prepare)", "created_at": f"gte.{start_of_day.isoformat()}"},
    )
    if used >= limit:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"Daily limit of {limit} generated answers reached. It resets at midnight UTC.",
        )


rate_limiter = RateLimiter()
