"""
Master Resume Endpoints (v1.2).

The web app uploads the file to the private `resumes` bucket, then registers it
here; we extract the text, structure it, and keep every version. The master is
never modified by tailoring.

Only Word (.docx) resumes are accepted: tailoring edits a copy of the user's own
document so its design is kept, which needs the document's structure. The type
is checked on the request, the path, and the file's contents.
"""

import logging
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException, Response, status

from src.app.api.deps import get_gateway, get_rest, get_storage
from src.app.core.auth import AuthUser, get_current_user
from src.app.core.config import get_settings
from src.app.core.rate_limit import check_rate_limit
from src.app.db.rest import SupabaseError, SupabaseRest
from src.app.db.storage import SupabaseStorage
from src.app.gateway import GatewayUnavailableError, LLMGateway
from src.app.resume.parsing.discrepancies import find_discrepancies
from src.app.resume.parsing.extract import NOT_WORD, ResumeReadError, extract_text
from src.app.resume.parsing.structure import parse_resume
from src.app.resume.pipeline import fetch_profile_rows
from src.app.schemas.resume import (
    CreateResumeRequest,
    MasterResumeResponse,
    ResumeListResponse,
    ResumeRecord,
    StructuredResume,
    UpdateResumeRequest,
)

logger = logging.getLogger("ResumesAPI")

router = APIRouter(prefix="/resumes", tags=["Resumes"])

READ_FAILED = "We couldn't read this resume. Please upload it again as a Word (.docx) file."


async def _event(rest: SupabaseRest, kind: str) -> None:
    try:
        await rest.insert("usage_events", {"kind": kind})
    except SupabaseError as e:
        logger.warning(f"Could not record usage event {kind}: {e}")


async def _get(rest: SupabaseRest, resume_id: str) -> Dict[str, Any]:
    rows = await rest.select("resumes", {"id": f"eq.{resume_id}", "limit": "1"})
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Resume not found.")
    return rows[0]


async def _promote(rest: SupabaseRest, row: Dict[str, Any]) -> Dict[str, Any]:
    """Makes `row` the master. Old versions stay (tailorings keep pointing at theirs)."""
    await rest.update("resumes", {"is_master": "eq.true", "id": f"neq.{row['id']}"}, {"is_master": False})
    updated = await rest.update("resumes", {"id": f"eq.{row['id']}"}, {"is_master": True})
    return updated[0] if updated else {**row, "is_master": True}


@router.post("", response_model=ResumeRecord, response_model_by_alias=True, summary="Register and parse an uploaded master resume")
async def create_resume(
    request: CreateResumeRequest,
    user: AuthUser = Depends(get_current_user),
    rest: SupabaseRest = Depends(get_rest),
    storage: SupabaseStorage = Depends(get_storage),
    gateway: LLMGateway = Depends(get_gateway),
) -> ResumeRecord:
    if not request.file_path.startswith(f"{user.id}/masters/") or ".." in request.file_path:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Upload the resume to your own masters folder.")
    if request.file_type != "docx" or not request.file_path.lower().endswith(".docx"):
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, NOT_WORD)
    try:
        await check_rate_limit(rest, get_settings().RATE_LIMIT_PER_MINUTE)
        latest = await rest.select("resumes", {"order": "version.desc", "limit": "1"})
        row = await rest.insert("resumes", {
            "name": request.name, "file_path": request.file_path, "file_type": request.file_type,
            "version": (latest[0]["version"] + 1) if latest else 1, "parse_status": "pending",
        })
        await _event(rest, "resume_uploaded")

        values: Dict[str, Any]
        try:
            content = await storage.download(request.file_path)
            text = extract_text(content)
            parsed = await parse_resume(gateway, text)
            values = {
                "parsed_content": parsed.resume.to_json(), "parse_status": parsed.status,
                "parse_error": " ".join(parsed.notes) or None,
            }
        except ResumeReadError as e:
            values = {"parse_status": "failed", "parse_error": str(e)}
        except GatewayUnavailableError:
            values = {"parse_status": "failed",
                      "parse_error": "We couldn't read this resume right now. Please try again in a minute."}
        except SupabaseError as e:
            logger.error(f"Could not download resume for user {user.id}: {e}")
            values = {"parse_status": "failed", "parse_error": READ_FAILED}

        updated = await rest.update("resumes", {"id": f"eq.{row['id']}"}, values)
        row = updated[0] if updated else {**row, **values}
        if row["parse_status"] == "failed":
            await _event(rest, "resume_parse_failed")
        else:
            row = await _promote(rest, row)
    except SupabaseError as e:
        logger.error(f"Supabase error for user {user.id}: {e}")
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Could not save your resume. Please try again.") from e
    return ResumeRecord.from_row(row)


@router.get("", response_model=ResumeListResponse, response_model_by_alias=True, summary="Every resume version")
async def list_resumes(rest: SupabaseRest = Depends(get_rest)) -> ResumeListResponse:
    rows = await rest.select("resumes", {"order": "version.desc", "limit": "50"})
    return ResumeListResponse(items=[ResumeRecord.from_row(r) for r in rows])


@router.get("/master", response_model=MasterResumeResponse, response_model_by_alias=True,
            summary="Current master, parse status, and profile discrepancies")
async def get_master(rest: SupabaseRest = Depends(get_rest)) -> MasterResumeResponse:
    try:
        rows = await rest.select("resumes", {"is_master": "eq.true", "limit": "1"})
        if not rows:
            return MasterResumeResponse(resume=None, discrepancies=[])
        row = rows[0]
        discrepancies: List = []
        if row.get("parsed_content"):
            resume = StructuredResume.model_validate(row["parsed_content"])
            discrepancies = find_discrepancies(resume, await fetch_profile_rows(rest),
                                               set(row.get("dismissed_discrepancies") or []))
    except SupabaseError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Could not load your resume. Please try again.") from e
    return MasterResumeResponse(resume=ResumeRecord.from_row(row), discrepancies=discrepancies)


@router.patch("/{resume_id}", response_model=ResumeRecord, response_model_by_alias=True,
              summary="Save corrections to the parsed resume (also confirms it)")
async def update_resume(resume_id: str, request: UpdateResumeRequest, rest: SupabaseRest = Depends(get_rest)) -> ResumeRecord:
    row = await _get(rest, resume_id)
    values: Dict[str, Any] = {}
    if request.name is not None:
        values["name"] = request.name
    if request.parsed_content is not None:
        values.update(parsed_content=request.parsed_content.to_json(), parse_status="parsed", parse_error=None)
    if request.dismissed_discrepancies is not None:
        values["dismissed_discrepancies"] = sorted(set(request.dismissed_discrepancies))
    if not values:
        return ResumeRecord.from_row(row)
    try:
        updated = await rest.update("resumes", {"id": f"eq.{resume_id}"}, values)
        row = updated[0] if updated else {**row, **values}
        # A corrected upload that couldn't be read automatically becomes usable.
        if request.parsed_content is not None and not row.get("is_master"):
            masters = await rest.select("resumes", {"is_master": "eq.true", "limit": "1"})
            if not masters or masters[0]["version"] < row["version"]:
                row = await _promote(rest, row)
    except SupabaseError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Could not save your changes. Please try again.") from e
    return ResumeRecord.from_row(row)


@router.post("/{resume_id}/master", response_model=ResumeRecord, response_model_by_alias=True,
             summary="Make an older version the master again")
async def make_master(resume_id: str, rest: SupabaseRest = Depends(get_rest)) -> ResumeRecord:
    row = await _get(rest, resume_id)
    if not row.get("parsed_content"):
        raise HTTPException(status.HTTP_409_CONFLICT, "This version couldn't be read, so it can't be the master.")
    return ResumeRecord.from_row(await _promote(rest, row))


@router.delete("/{resume_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a resume version and its file")
async def delete_resume(
    resume_id: str,
    rest: SupabaseRest = Depends(get_rest),
    storage: SupabaseStorage = Depends(get_storage),
) -> Response:
    row = await _get(rest, resume_id)
    try:
        await storage.remove([row["file_path"]])
        await rest.delete("resumes", {"id": f"eq.{resume_id}"})
    except SupabaseError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Could not delete the resume. Please try again.") from e
    return Response(status_code=status.HTTP_204_NO_CONTENT)
