"""
Job Ingestion.

For each enabled `job_sources` row: fetch the source, normalize every posting,
deduplicate (within the batch, and against jobs already stored from other
sources), upsert into `jobs`, and close jobs that are no longer listed.
Runs with the service-role client (see scripts/ingest_jobs.py).
"""

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional

import httpx

from src.app.core.config import Settings
from src.app.db.rest import SupabaseError, SupabaseRest, in_list

from .normalize import NormalizedJob
from .sources import SourceAdapter, SourceError, adapters

logger = logging.getLogger("JobIngest")

UPSERT_BATCH = 200
LOOKUP_BATCH = 100


@dataclass
class SourceResult:
    source: str
    status: str  # ok | error | skipped
    fetched: int = 0
    stored: int = 0
    cross_listed: int = 0
    closed: int = 0
    error: Optional[str] = None


@dataclass
class IngestReport:
    results: List[SourceResult] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return all(r.status != "error" for r in self.results)

    def summary(self) -> str:
        lines = []
        for r in self.results:
            if r.status == "error":
                lines.append(f"FAIL {r.source}: {r.error}")
            else:
                lines.append(f"OK   {r.source}: {r.fetched} fetched, {r.stored} stored, "
                             f"{r.cross_listed} cross-listed, {r.closed} closed")
        return "\n".join(lines)


def _chunks(items: List[Any], size: int) -> Iterable[List[Any]]:
    for i in range(0, len(items), size):
        yield items[i:i + size]


def unique_by_key(jobs: List[NormalizedJob]) -> Dict[str, NormalizedJob]:
    """One job per dedupe key; the first listing wins."""
    unique: Dict[str, NormalizedJob] = {}
    for job in jobs:
        unique.setdefault(job.dedupe_key, job)
    return unique


async def _store(rest: SupabaseRest, source_id: str, jobs: Dict[str, NormalizedJob], now: str) -> SourceResult:
    result = SourceResult(source=source_id, status="ok", fetched=len(jobs))

    # This source's stored jobs, to follow a posting whose title or location changed.
    own = await rest.select_all("jobs", {"select": "id,external_id,dedupe_key", "source_id": f"eq.{source_id}", "order": "id"})
    own_by_external = {r["external_id"]: r for r in own}

    # Jobs already stored under the same keys, possibly from another source.
    stored_by_key: Dict[str, Dict[str, Any]] = {}
    for chunk in _chunks(list(jobs), LOOKUP_BATCH):
        rows = await rest.select("jobs", {"select": "id,source_id,dedupe_key,also_listed_on", "dedupe_key": in_list(chunk)})
        stored_by_key.update({r["dedupe_key"]: r for r in rows})

    upserts: List[Dict[str, Any]] = []
    for key, job in jobs.items():
        row = {**job.row(), "source_id": source_id, "last_seen_at": now, "is_active": True}
        existing = stored_by_key.get(key)
        if existing and existing["source_id"] != source_id:
            # Listed first by another source: keep that record and note this listing.
            listings = existing.get("also_listed_on") or []
            if not any(entry.get("source_id") == source_id for entry in listings):
                listings = [*listings, {"source_id": source_id, "url": job.url}]
            await rest.update("jobs", {"id": f"eq.{existing['id']}"},
                              {"also_listed_on": listings, "last_seen_at": now, "is_active": True})
            result.cross_listed += 1
            continue
        previous = own_by_external.get(job.external_id)
        if previous and previous["dedupe_key"] != key:
            if key in stored_by_key:
                continue  # its new key belongs to another of this source's postings
            await rest.update("jobs", {"id": f"eq.{previous['id']}"}, row)
            result.stored += 1
            continue
        upserts.append(row)

    for chunk in _chunks(upserts, UPSERT_BATCH):
        await rest.upsert("jobs", chunk, on_conflict="dedupe_key")
        result.stored += len(chunk)
    return result


async def _close_missing(rest: SupabaseRest, source_id: str, adapter: SourceAdapter, now: datetime,
                         stale_days: int) -> int:
    cutoff = now if adapter.complete_listing else now - timedelta(days=stale_days)
    closed = await rest.update(
        "jobs",
        {"source_id": f"eq.{source_id}", "is_active": "is.true", "last_seen_at": f"lt.{cutoff.isoformat()}"},
        {"is_active": False},
    )
    return len(closed)


async def ingest_source(rest: SupabaseRest, client: httpx.AsyncClient, source: Dict[str, Any],
                        adapter: SourceAdapter, settings: Settings, now: Optional[datetime] = None) -> SourceResult:
    now = now or datetime.now(timezone.utc)
    label = f"{source['kind']}:{source['identifier'] or source['name']}"
    try:
        jobs = unique_by_key(await adapter.fetch(client, source["identifier"], source["name"]))
        result = await _store(rest, source["id"], jobs, now.isoformat())
        result.closed = await _close_missing(rest, source["id"], adapter, now, settings.INGEST_STALE_DAYS)
        status, error = "ok", None
    except (SourceError, SupabaseError) as e:
        logger.warning(f"Ingest failed for {label}: {e}")
        result = SourceResult(source=label, status="error", error=str(e))
        status, error = "error", str(e)[:500]
    result.source = label
    await rest.update("job_sources", {"id": f"eq.{source['id']}"}, {
        "last_run_at": now.isoformat(),
        "last_status": status,
        "last_error": error,
        **({"last_job_count": result.fetched} if status == "ok" else {}),
    })
    return result


async def run_ingestion(rest: SupabaseRest, settings: Settings, only: Optional[List[str]] = None,
                        transport: Optional[httpx.AsyncBaseTransport] = None) -> IngestReport:
    """Ingests every enabled source (or only those whose kind or identifier is in `only`)."""
    report = IngestReport()
    registry = adapters(settings.INGEST_MAX_PAGES)
    sources = await rest.select("job_sources", {"enabled": "is.true", "order": "kind,identifier"})
    async with httpx.AsyncClient(timeout=30.0, transport=transport, follow_redirects=True) as client:
        for source in sources:
            if only and source["kind"] not in only and source["identifier"] not in only:
                continue
            adapter = registry.get(source["kind"])
            if adapter is None:
                report.results.append(SourceResult(source=source["kind"], status="skipped", error="no adapter"))
                continue
            report.results.append(await ingest_source(rest, client, source, adapter, settings))
    return report
