"""
Saved Answers Loader.

Matching compares a question with every saved answer, so the user's list is
kept briefly per user instead of being re-read for each field. The web app edits
saved answers directly in Supabase, so the cache is short; API writes drop it.
"""

from typing import Any, Dict, List

from src.app.core import metrics
from src.app.core.ttl_cache import TTLCache
from src.app.db.rest import SupabaseRest

SAVED_ANSWERS_LIMIT = 500
SAVED_CACHE_SECONDS = 30

_cache: TTLCache[List[Dict[str, Any]]] = TTLCache(SAVED_CACHE_SECONDS, max_entries=2000)


async def load_saved_answers(rest: SupabaseRest, user_id: str) -> List[Dict[str, Any]]:
    cached = _cache.get((user_id,))
    metrics.record_cache("saved_answers", hit=cached is not None)
    if cached is not None:
        return cached
    rows = await rest.select("saved_answers", {"order": "updated_at.desc", "limit": str(SAVED_ANSWERS_LIMIT)})
    _cache.set((user_id,), rows)
    return rows


def invalidate_saved_answers(user_id: str) -> None:
    _cache.invalidate_user(user_id)
