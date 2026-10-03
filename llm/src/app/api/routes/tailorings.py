"""
Resume Tailoring Endpoints (v1.2).

A tailoring runs several LLM calls, so POST starts it and clients poll
GET /tailorings/{id}. Where the host lets background work run, POST runs it in
the background; a poll that finds the current step idle (no background worker,
or one the host froze) runs the next steps itself, for up to POLL_WORK_SECONDS.

The result is a tailored copy of the user's own Word document. GET .../files
gives the preview both documents (original and tailored) to render in the
browser; GET .../download gives the tailored .docx as an attachment.
"""

import asyncio
import logging
import re
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response, status

from src.app.api.deps import get_pipeline, get_rest, get_storage
from src.app.core.auth import AuthUser, get_current_user
from src.app.core.config import get_settings
from src.app.core.rate_limit import check_daily_tailoring_limit, check_rate_limit
from src.app.db.rest import SupabaseError, SupabaseRest
from src.app.db.storage import SupabaseStorage
from src.app.resume.matching.match import summarize
from src.app.resume.pipeline import (
    NEEDS_DOCX,
    PIPELINE_VERSION,
    TERMINAL,
    StepContext,
    TailoringPipeline,
    age_seconds,
    needs_worker,
)
from src.app.resume.validation.validate import user_warnings
from src.app.schemas.matching import MatchAnalysis
from src.app.schemas.tailoring import (
    StartTailoringRequest,
    StartTailoringResponse,
    TailoringDetail,
    TailoringDownloadResponse,
    TailoringFile,
    TailoringFilesResponse,
    TailoringListItem,
    TailoringListResponse,
    TailoringResponse,
    ValidationReport,
)

logger = logging.getLogger("TailoringsAPI")

router = APIRouter(prefix="/tailorings", tags=["Tailorings"])

SIGNED_URL_SECONDS = 300
TABLE = "resume_tailorings"
# A poll starts new steps for this long, so status updates keep arriving while it runs.
POLL_WORK_SECONDS = 8.0
# When the next poll will itself run a step, ask for it almost at once instead of idling between steps.
POLL_AGAIN_MS = 250


def retry_after_ms(row: Dict[str, Any]) -> Optional[int]:
    """When the client should poll next: soon if its poll runs the next step, slower the longer a worker runs."""
    if row["status"] in TERMINAL:
        return None
    if needs_worker(row):
        return POLL_AGAIN_MS
    age = age_seconds(row.get("created_at"))
    return 1000 if age < 10 else 2000 if age < 60 else 4000


async def _event(rest: SupabaseRest, kind: str) -> None:
    try:
        await rest.insert("usage_events", {"kind": kind})
    except SupabaseError as e:
        logger.warning(f"Could not record usage event {kind}: {e}")


async def _get(rest: SupabaseRest, tailoring_id: str) -> Dict[str, Any]:
    rows = await rest.select(TABLE, {"id": f"eq.{tailoring_id}", "limit": "1"})
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tailoring not found.")
    return rows[0]


async def _jobs(rest: SupabaseRest, ids: List[str]) -> Dict[str, Dict[str, Any]]:
    if not ids:
        return {}
    rows = await rest.select("job_contexts", {"id": f"in.({','.join(sorted(set(ids)))})", "select": "id,title,company"})
    return {r["id"]: r for r in rows}


def build_response(row: Dict[str, Any], job: Optional[Dict[str, Any]], detail: bool = False) -> TailoringResponse:
    ready = row["status"] == "ready"
    matches = MatchAnalysis.model_validate(row["match_analysis"]).matches if row.get("match_analysis") else []
    report = ValidationReport.model_validate(row.get("validation_report") or {})
    unsupported = [m.requirement for m in sorted(matches, key=lambda m: m.priority != "must_have") if m.support == "none"]
    response = TailoringResponse(
        id=row["id"],
        status=row["status"],
        job_context_id=row["job_context_id"],
        job_title=(job or {}).get("title") or "Job",
        company=(job or {}).get("company"),
        summary=summarize(matches) if ready and matches else None,
        changes=report.changes if ready else [],
        unsupported_requirements=unsupported if ready else [],
        warnings=user_warnings(report.issues) if ready else [],
        pipeline_version=row.get("pipeline_version") or PIPELINE_VERSION,
        error=row.get("error"),
        created_at=str(row.get("created_at", "")),
    )
    if detail and ready:
        response.detail = TailoringDetail(requirements=matches, diffs=report.diffs, issues=report.issues,
                                          page_count=report.page_count)
    return response


@router.post("", response_model=StartTailoringResponse, response_model_by_alias=True, summary="Start tailoring the master resume for a job")
async def start_tailoring(
    request: StartTailoringRequest,
    background: BackgroundTasks,
    user: AuthUser = Depends(get_current_user),
    rest: SupabaseRest = Depends(get_rest),
    storage: SupabaseStorage = Depends(get_storage),
    pipeline: TailoringPipeline = Depends(get_pipeline),
) -> StartTailoringResponse:
    settings = get_settings()
    try:
        await check_rate_limit(rest, settings.RATE_LIMIT_PER_MINUTE)
        await check_daily_tailoring_limit(rest, settings.DAILY_TAILORING_LIMIT)
        jobs = await rest.select("job_contexts", {"id": f"eq.{request.job_context_id}", "select": "id", "limit": "1"})
        if not jobs:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Job not found. Analyze the job first.")
        params = {"id": f"eq.{request.resume_id}"} if request.resume_id else {"is_master": "eq.true"}
        resumes = await rest.select("resumes", {**params, "limit": "1"})
        if not resumes:
            raise HTTPException(status.HTTP_409_CONFLICT, "Upload your master resume first.")
        resume = resumes[0]
        if resume["parse_status"] != "parsed" or not resume.get("parsed_content"):
            raise HTTPException(status.HTTP_409_CONFLICT, "Review and confirm your parsed resume before tailoring.")
        if resume.get("file_type") != "docx":
            raise HTTPException(status.HTTP_409_CONFLICT, NEEDS_DOCX)
        row = await rest.insert(TABLE, {
            "resume_id": resume["id"], "resume_version": resume["version"], "job_context_id": request.job_context_id,
            "pipeline_version": PIPELINE_VERSION, "status": "queued",
        })
        await _event(rest, "tailoring_started")
    except SupabaseError as e:
        logger.error(f"Supabase error for user {user.id}: {e}")
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Could not start tailoring. Please try again.") from e
    if settings.TAILORING_BACKGROUND:
        background.add_task(pipeline.run, StepContext(rest=rest, storage=storage, user_id=user.id), row["id"])
    return StartTailoringResponse(id=row["id"], status=row["status"])


@router.get("", response_model=TailoringListResponse, response_model_by_alias=True, summary="Tailoring history")
async def list_tailorings(rest: SupabaseRest = Depends(get_rest)) -> TailoringListResponse:
    rows = await rest.select(TABLE, {"select": "id,status,job_context_id,output_file_path,created_at",
                                     "order": "created_at.desc", "limit": "100"})
    jobs = await _jobs(rest, [r["job_context_id"] for r in rows])
    return TailoringListResponse(items=[
        TailoringListItem(
            id=r["id"], status=r["status"], job_title=jobs.get(r["job_context_id"], {}).get("title") or "Job",
            company=jobs.get(r["job_context_id"], {}).get("company"), has_file=bool(r.get("output_file_path")),
            created_at=str(r.get("created_at", "")),
        )
        for r in rows
    ])


@router.get("/{tailoring_id}", response_model=TailoringResponse, response_model_by_alias=True, summary="Poll a tailoring")
async def get_tailoring(
    tailoring_id: str,
    detail: bool = Query(default=False),
    user: AuthUser = Depends(get_current_user),
    rest: SupabaseRest = Depends(get_rest),
    storage: SupabaseStorage = Depends(get_storage),
    pipeline: TailoringPipeline = Depends(get_pipeline),
) -> TailoringResponse:
    row = await _get(rest, tailoring_id)
    # The job's title doesn't change while steps run: read it alongside them.
    jobs_read = asyncio.ensure_future(_jobs(rest, [row["job_context_id"]]))
    try:
        if needs_worker(row):
            # Nobody is running the current step (no background worker, or the host froze it): run it here.
            try:
                row = await pipeline.drive(StepContext(rest=rest, storage=storage, user_id=user.id), row,
                                           POLL_WORK_SECONDS)
            except SupabaseError as e:
                logger.error(f"Tailoring {tailoring_id}: Supabase error while running a step, next poll retries: {e}")
        jobs = await jobs_read
    finally:
        jobs_read.cancel()
    response = build_response(row, jobs.get(row["job_context_id"]), detail)
    response.retry_after_ms = retry_after_ms(row)
    return response


def _safe_name(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r'[\\/:*?"<>|\x00-\x1f]+', " ", text)).strip()[:120]


def tailored_file_name(resume_name: Optional[str], company: Optional[str], extension: str) -> str:
    """"Sam Rivera Resume.docx" for Company X -> "Sam Rivera Resume - Tailored - Company X.docx"."""
    stem = _safe_name(re.sub(r"\.(docx|pdf)$", "", resume_name or "", flags=re.IGNORECASE)) or "Resume"
    company = _safe_name(company or "")
    return f"{stem} - Tailored{f' - {company}' if company else ''}.{extension}"


async def _ready_files(rest: SupabaseRest, tailoring_id: str):
    row = await _get(rest, tailoring_id)
    if row["status"] != "ready" or not row.get("output_file_path"):
        raise HTTPException(status.HTTP_409_CONFLICT, "This resume isn't ready yet.")
    jobs = await _jobs(rest, [row["job_context_id"]])
    source = None
    if row.get("resume_id"):
        rows = await rest.select("resumes", {"id": f"eq.{row['resume_id']}", "select": "name,file_path", "limit": "1"})
        source = rows[0] if rows else None
    extension = "pdf" if row["output_file_path"].lower().endswith(".pdf") else "docx"
    name = tailored_file_name((source or {}).get("name"), jobs.get(row["job_context_id"], {}).get("company"), extension)
    return row, source, extension, name


@router.get("/{tailoring_id}/files", response_model=TailoringFilesResponse, response_model_by_alias=True,
            summary="Short-lived URLs for the preview: the tailored document and the original")
async def tailoring_files(
    tailoring_id: str,
    rest: SupabaseRest = Depends(get_rest),
    storage: SupabaseStorage = Depends(get_storage),
) -> TailoringFilesResponse:
    row, source, extension, name = await _ready_files(rest, tailoring_id)
    try:
        tailored = TailoringFile(url=await storage.signed_url(row["output_file_path"], SIGNED_URL_SECONDS), file_name=name)
        original = None
        if source and source.get("file_path"):
            original = TailoringFile(url=await storage.signed_url(source["file_path"], SIGNED_URL_SECONDS),
                                     file_name=source.get("name") or "Original resume")
    except SupabaseError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Could not prepare the preview. Please try again.") from e
    await _event(rest, "resume_previewed")
    return TailoringFilesResponse(format=extension, tailored=tailored, original=original, expires_in=SIGNED_URL_SECONDS)


@router.get("/{tailoring_id}/download", response_model=TailoringDownloadResponse, response_model_by_alias=True,
            summary="Short-lived signed URL that downloads the tailored Word document")
async def download_tailoring(
    tailoring_id: str,
    rest: SupabaseRest = Depends(get_rest),
    storage: SupabaseStorage = Depends(get_storage),
) -> TailoringDownloadResponse:
    row, _, _, name = await _ready_files(rest, tailoring_id)
    try:
        url = await storage.signed_url(row["output_file_path"], SIGNED_URL_SECONDS, download=name)
    except SupabaseError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Could not prepare the download. Please try again.") from e
    await _event(rest, "resume_downloaded")
    return TailoringDownloadResponse(url=url, expires_in=SIGNED_URL_SECONDS, file_name=name)


@router.delete("/{tailoring_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a tailoring and its tailored document")
async def delete_tailoring(
    tailoring_id: str,
    rest: SupabaseRest = Depends(get_rest),
    storage: SupabaseStorage = Depends(get_storage),
) -> Response:
    row = await _get(rest, tailoring_id)
    try:
        if row.get("output_file_path"):
            await storage.remove([row["output_file_path"]])
        await rest.delete(TABLE, {"id": f"eq.{tailoring_id}"})
    except SupabaseError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Could not delete the tailoring. Please try again.") from e
    await _event(rest, "tailoring_deleted")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
