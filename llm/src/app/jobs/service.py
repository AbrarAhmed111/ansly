"""
Match and Alert Refresh.

Scores recent jobs against a user's profile into `job_matches`, then turns
new jobs that pass a saved search into `job_alerts`. Every query filters by
user_id explicitly, so the same code runs as the user (API, under RLS) and as
the service role for all users (ingestion worker).
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from src.app.core.config import Settings
from src.app.db.rest import SupabaseRest

from .matching import TIER_ORDER, build_candidate, compute_match
from .searches import job_matches_filters

logger = logging.getLogger("JobMatching")

SECTIONS = ["experiences", "projects", "skills", "education", "achievements"]
JOB_COLUMNS = ("id,title,company,location,workplace,employment_type,seniority,skills,experience_years_min,"
               "salary_min,salary_max,salary_currency,salary_period,first_seen_at")
UPSERT_BATCH = 500
# A new saved search gets alerts for jobs seen this recently.
NEW_SEARCH_LOOKBACK_DAYS = 7


async def load_profile_data(rest: SupabaseRest, user_id: str) -> Dict[str, Any]:
    profiles = await rest.select("profiles", {"id": f"eq.{user_id}", "limit": "1"})
    data: Dict[str, Any] = {"profile": profiles[0] if profiles else None}
    for section in SECTIONS:
        data[section] = await rest.select(section, {"user_id": f"eq.{user_id}", "order": "sort_order.asc"})
    return data


async def recent_jobs(rest: SupabaseRest, settings: Settings, now: datetime) -> List[Dict[str, Any]]:
    since = (now - timedelta(days=settings.MATCH_WINDOW_DAYS)).isoformat()
    return await rest.select_all("jobs", {
        "select": JOB_COLUMNS,
        "is_active": "is.true",
        "first_seen_at": f"gte.{since}",
        "order": "first_seen_at.desc,id",
    })


def _ts(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


async def refresh_user(rest: SupabaseRest, user_id: str, jobs: List[Dict[str, Any]],
                       now: Optional[datetime] = None) -> Dict[str, Any]:
    """Recomputes one user's matches over `jobs` and adds alerts for their saved searches."""
    now = now or datetime.now(timezone.utc)
    data = await load_profile_data(rest, user_id)
    candidate = build_candidate(data, now.date())

    matches = [{**compute_match(job, candidate), "user_id": user_id, "computed_at": now.isoformat()} for job in jobs]
    for i in range(0, len(matches), UPSERT_BATCH):
        # saved/dismissed aren't in the payload, so the user's choices survive a refresh.
        await rest.upsert("job_matches", matches[i:i + UPSERT_BATCH], on_conflict="user_id,job_id")

    tiers = {m["job_id"]: m["tier"] for m in matches}
    by_tier = {t: sum(1 for m in matches if m["tier"] == t) for t in TIER_ORDER}

    new_alerts = 0
    searches = await rest.select("saved_searches", {"user_id": f"eq.{user_id}", "alerts_enabled": "is.true"})
    for search in searches:
        cutoff = _ts(search.get("last_checked_at")) or (_ts(search.get("created_at")) or now) - timedelta(days=NEW_SEARCH_LOOKBACK_DAYS)
        alerts = [
            {"user_id": user_id, "saved_search_id": search["id"], "job_id": job["id"], "tier": tiers[job["id"]]}
            for job in jobs
            if (_ts(job.get("first_seen_at")) or now) > cutoff
            and tiers.get(job["id"]) != "low"
            and job_matches_filters(job, search.get("filters") or {}, tiers.get(job["id"]))
        ]
        if alerts:
            await rest.upsert("job_alerts", alerts, on_conflict="saved_search_id,job_id", ignore_duplicates=True)
            new_alerts += len(alerts)
        await rest.update("saved_searches", {"id": f"eq.{search['id']}"}, {"last_checked_at": now.isoformat()})

    return {"matched": len(matches), "by_tier": by_tier, "new_alerts": new_alerts, "computed_at": now.isoformat()}


async def refresh_for_user(rest: SupabaseRest, settings: Settings, user_id: str) -> Dict[str, Any]:
    now = datetime.now(timezone.utc)
    return await refresh_user(rest, user_id, await recent_jobs(rest, settings, now), now)


async def refresh_all_users(rest: SupabaseRest, settings: Settings) -> Dict[str, int]:
    """Worker only (service role): refreshes every user with a profile."""
    now = datetime.now(timezone.utc)
    jobs = await recent_jobs(rest, settings, now)
    users = await rest.select_all("profiles", {"select": "id", "order": "id"})
    alerts = 0
    for user in users:
        try:
            alerts += (await refresh_user(rest, user["id"], jobs, now))["new_alerts"]
        except Exception as e:  # noqa: BLE001 - one user's failure must not stop the others
            logger.warning(f"Match refresh failed for user {user['id']}: {e}")
    return {"users": len(users), "alerts": alerts}
