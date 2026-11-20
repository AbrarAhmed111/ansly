"""
Master Resume Endpoints (v1.2).

The web app uploads the file to the private `resumes` bucket, then registers it
here; we extract the text, structure it, and keep every version. The master is
never modified by tailoring.

Only Word (.docx) masters are accepted: tailoring edits a copy of the user's own
document so its design is kept, which needs the document's structure. The type
is checked on the request, the path, and the file's contents.

Role resumes (the Leads resume library) carry a role label, live under
{user}/library/, may be PDF or Word, are attached to emails exactly as uploaded,
and never become the master.
"""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Response, status

from src.app.api.deps import get_gateway, get_rest, get_storage
from src.app.core.auth import AuthUser, get_current_user
from src.app.core.config import get_settings
from src.app.core.rate_limit import check_rate_limit
from src.app.db.rest import SupabaseError, SupabaseRest
from src.app.db.storage import SupabaseStorage
from src.app.gateway import GatewayUnavailableError, LLMGateway
from src.app.leads.roles import match_resume
from src.app.resume.parsing.discrepancies import find_discrepancies
from src.app.resume.parsing.extract import NOT_WORD, ResumeReadError, resume_text
from src.app.resume.parsing.structure import parse_resume
from src.app.resume.pipeline import fetch_profile_rows
from src.app.schemas.resume import (
    CreateResumeRequest,
    MasterResumeResponse,
    MatchRoleResumeRequest,
    MatchRoleResumeResponse,
    ReplaceResumeRequest,
    ReplaceResumeResponse,
    ResumeDownloadResponse,
    ResumeListResponse,
    ResumeRecord,
    StructuredResume,
    UpdateResumeRequest,
    resume_file_name,
)

logger = logging.getLogger("ResumesAPI")

router = APIRouter(prefix="/resumes", tags=["Resumes"])

READ_FAILED = "We couldn't read this resume. Please upload it again as a Word (.docx) file."
NOT_LIBRARY_TYPE = "Upload the role resume as a PDF or Word (.docx) file."
DOWNLOAD_TTL_SECONDS = 300


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


def _check_upload(user: AuthUser, file_path: str, file_type: str, library: bool) -> None:
    folder = "library" if library else "masters"
    if not file_path.startswith(f"{user.id}/{folder}/") or ".." in file_path:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Upload the resume to your own {folder} folder.")
    extension = file_path.lower().rsplit(".", 1)[-1]
    if library:
        if file_type not in ("pdf", "docx") or extension != file_type:
            raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, NOT_LIBRARY_TYPE)
    elif file_type != "docx" or extension != "docx":
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, NOT_WORD)


async def _register(
    user: AuthUser,
    rest: SupabaseRest,
    storage: SupabaseStorage,
    gateway: LLMGateway,
    *,
    name: str,
    file_path: str,
    file_type: str,
    role_label: Optional[str] = None,
    role_note: Optional[str] = None,
    file_size: Optional[int] = None,
    replaces: Optional[str] = None,
) -> Dict[str, Any]:
    """Stores the uploaded file's row, parses it, and (masters only) makes it the master."""
    library = role_label is not None
    latest = await rest.select("resumes", {"order": "version.desc", "limit": "1"})
    row = await rest.insert("resumes", {
        "name": name, "file_path": file_path, "file_type": file_type,
        "version": (latest[0]["version"] + 1) if latest else 1, "parse_status": "pending",
        **({"role_label": role_label, "role_note": role_note, "file_size": file_size,
            "replaces_resume_id": replaces} if library else {}),
    })
    await _event(rest, "resume_uploaded")

    values: Dict[str, Any]
    try:
        content = await storage.download(file_path)
        if library and file_size is None:
            values = {"file_size": len(content)}
        else:
            values = {}
        text = resume_text(content, file_type)
        parsed = await parse_resume(gateway, text)
        values.update(parsed_content=parsed.resume.to_json(), parse_status=parsed.status,
                      parse_error=" ".join(parsed.notes) or None)
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
    elif not library:
        row = await _promote(rest, row)
    return row


@router.post("", response_model=ResumeRecord, response_model_by_alias=True,
             summary="Register and parse an uploaded master or role resume")
async def create_resume(
    request: CreateResumeRequest,
    user: AuthUser = Depends(get_current_user),
    rest: SupabaseRest = Depends(get_rest),
    storage: SupabaseStorage = Depends(get_storage),
    gateway: LLMGateway = Depends(get_gateway),
) -> ResumeRecord:
    _check_upload(user, request.file_path, request.file_type, request.role_label is not None)
    try:
        await check_rate_limit(rest, get_settings().RATE_LIMIT_PER_MINUTE)
        row = await _register(user, rest, storage, gateway, name=request.name, file_path=request.file_path,
                              file_type=request.file_type, role_label=request.role_label,
                              role_note=request.role_note, file_size=request.file_size)
    except SupabaseError as e:
        logger.error(f"Supabase error for user {user.id}: {e}")
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Could not save your resume. Please try again.") from e
    return ResumeRecord.from_row(row)


@router.get("", response_model=ResumeListResponse, response_model_by_alias=True,
            summary="Master resume versions, or the role resume library with ?library=true")
async def list_resumes(library: bool = False, rest: SupabaseRest = Depends(get_rest)) -> ResumeListResponse:
    params = ({"role_label": "not.is.null", "archived_at": "is.null", "order": "updated_at.desc", "limit": "100"}
              if library else {"role_label": "is.null", "order": "version.desc", "limit": "50"})
    rows = await rest.select("resumes", params)
    return ResumeListResponse(items=[ResumeRecord.from_row(r) for r in rows])


@router.post("/match", response_model=MatchRoleResumeResponse, response_model_by_alias=True,
             summary="Match a job role to the user's existing Roles Resume Library")
async def match_role_resume(
    request: MatchRoleResumeRequest,
    rest: SupabaseRest = Depends(get_rest),
    gateway: LLMGateway = Depends(get_gateway),
) -> MatchRoleResumeResponse:
    try:
        library = await rest.select("resumes", {
            "role_label": "not.is.null",
            "archived_at": "is.null",
            "order": "updated_at.desc",
            "limit": "100",
        })
    except SupabaseError as exc:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "Could not load your Roles Resume Library.",
        ) from exc
    role = {
        "title": request.title,
        "company": request.company,
        "role_family": request.role_family,
        "seniority": request.seniority,
        "technologies": request.technologies,
        "responsibilities": request.responsibilities,
    }
    try:
        match = await match_resume(gateway, role, request.requirements, library)
    except GatewayUnavailableError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "Resume matching is unavailable right now. Please try again.") from exc
    return MatchRoleResumeResponse(
        resume_id=match.resume_id,
        confidence=match.confidence,
        reason=match.reason,
        gaps=match.gaps,
    )


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
    if row.get("role_label") is not None:
        if request.role_label is not None:
            values["role_label"] = request.role_label.strip()
        if request.role_note is not None:
            values["role_note"] = request.role_note.strip() or None
    elif request.role_label is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Master resume versions can't be turned into role resumes.")
    if not values:
        return ResumeRecord.from_row(row)
    try:
        updated = await rest.update("resumes", {"id": f"eq.{resume_id}"}, values)
        row = updated[0] if updated else {**row, **values}
        # A corrected upload that couldn't be read automatically becomes usable.
        if request.parsed_content is not None and not row.get("is_master") and row.get("role_label") is None:
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


@router.post("/{resume_id}/replace", response_model=ReplaceResumeResponse, response_model_by_alias=True,
             summary="Replace a role resume's file; unsent email drafts switch to the new file")
async def replace_resume(
    resume_id: str,
    request: ReplaceResumeRequest,
    user: AuthUser = Depends(get_current_user),
    rest: SupabaseRest = Depends(get_rest),
    storage: SupabaseStorage = Depends(get_storage),
    gateway: LLMGateway = Depends(get_gateway),
) -> ReplaceResumeResponse:
    old = await _get(rest, resume_id)
    if old.get("role_label") is None or old.get("archived_at"):
        raise HTTPException(status.HTTP_409_CONFLICT, "Only current role resumes can be replaced.")
    _check_upload(user, request.file_path, request.file_type, library=True)
    try:
        await check_rate_limit(rest, get_settings().RATE_LIMIT_PER_MINUTE)
        new = await _register(user, rest, storage, gateway, name=request.name, file_path=request.file_path,
                              file_type=request.file_type, role_label=old["role_label"],
                              role_note=old.get("role_note"), file_size=request.file_size, replaces=old["id"])
        await rest.update("resumes", {"id": f"eq.{old['id']}"}, {"archived_at": _now()})
        moved = await rest.update(
            "lead_drafts",
            {"resume_id": f"eq.{old['id']}", "delivery_status": "in.(draft,failed)"},
            {"resume_id": new["id"]},
        )
    except SupabaseError as e:
        logger.error(f"Could not replace resume for user {user.id}: {e}")
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Could not replace the resume. Please try again.") from e
    return ReplaceResumeResponse(resume=ResumeRecord.from_row(new), replaced_id=old["id"], drafts_updated=len(moved))


@router.get("/{resume_id}/download", response_model=ResumeDownloadResponse, response_model_by_alias=True,
            summary="A short-lived link to open or download the original file")
async def download_resume(
    resume_id: str,
    inline: bool = False,
    rest: SupabaseRest = Depends(get_rest),
    storage: SupabaseStorage = Depends(get_storage),
) -> ResumeDownloadResponse:
    row = await _get(rest, resume_id)
    file_name = resume_file_name(row) or "resume"
    try:
        url = await storage.signed_url(row["file_path"], DOWNLOAD_TTL_SECONDS, download=None if inline else file_name)
    except SupabaseError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Could not open the resume. Please try again.") from e
    return ResumeDownloadResponse(url=url)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
