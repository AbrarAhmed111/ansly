"""
Job ingestion worker. Fetches every enabled job source into Supabase, then
refreshes job matches and saved-search alerts for every user.

Needs SUPABASE_SECRET_KEY (the API server does not). Usage:

    uv run python -m scripts.ingest_jobs                 # once
    uv run python -m scripts.ingest_jobs --loop          # every INGEST_INTERVAL_MINUTES
    uv run python -m scripts.ingest_jobs --only greenhouse --no-match
"""

import argparse
import asyncio
import logging
import sys

from src.app.core.config import get_settings
from src.app.core.logging import setup_logging
from src.app.db.rest import SupabaseRest
from src.app.jobs.ingest import run_ingestion
from src.app.jobs.service import refresh_all_users

logger = logging.getLogger("IngestWorker")


async def run_once(only, match: bool) -> bool:
    settings = get_settings()
    rest = SupabaseRest.service(settings)
    report = await run_ingestion(rest, settings, only=only)
    print(report.summary())
    if match:
        summary = await refresh_all_users(rest, settings)
        print(f"Matches refreshed for {summary['users']} users, {summary['alerts']} new alerts")
    return report.ok


async def main() -> int:
    parser = argparse.ArgumentParser(description="Ansly job ingestion worker")
    parser.add_argument("--loop", action="store_true", help="keep running every INGEST_INTERVAL_MINUTES")
    parser.add_argument("--only", nargs="*", help="source kinds or identifiers to ingest")
    parser.add_argument("--no-match", action="store_true", help="skip refreshing matches and alerts")
    args = parser.parse_args()

    settings = get_settings()
    setup_logging(settings.LOG_LEVEL)
    while True:
        ok = await run_once(args.only, match=not args.no_match)
        if not args.loop:
            return 0 if ok else 1
        await asyncio.sleep(settings.INGEST_INTERVAL_MINUTES * 60)


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
