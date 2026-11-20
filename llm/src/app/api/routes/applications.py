from datetime import datetime, timezone
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from src.app.api.deps import get_rest
from src.app.core.auth import AuthUser, get_current_user
from src.app.db.rest import SupabaseError, SupabaseRest
from src.app.schemas.application import (
    ApplicationCheckpointRequest,
    ApplicationCheckpointResponse,
    ApplicationEventRequest,
    ApplicationEventResponse,
    ApplicationOutcomeRequest,
    ApplicationRunResponse,
    ApplicationStatusRequest,
    AuthorizeApplicationRequest,
    StartApplicationRequest,
)

router = APIRouter(prefix="/applications", tags=["Applications"])


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _get_run(rest: SupabaseRest, run_id: UUID) -> dict:
    try:
        rows = await rest.select("application_runs", {"id": f"eq.{run_id}", "limit": "1"})
    except SupabaseError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY,
                            "Could not load the application run. Apply Agent data may not be migrated.") from exc
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Application run not found.")
    return rows[0]


@router.post("/start", response_model=ApplicationRunResponse, response_model_by_alias=True)
async def start_application(
    request: StartApplicationRequest,
    user: AuthUser = Depends(get_current_user),
    rest: SupabaseRest = Depends(get_rest),
) -> ApplicationRunResponse:
    try:
        existing = await rest.select("application_runs", {
            "id": f"eq.{request.id}",
            "limit": "1",
        })
    except SupabaseError as exc:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "Could not start the application run. The Apply Agent migration may not be applied.",
        ) from exc
    if existing:
        return ApplicationRunResponse.model_validate(existing[0])
    try:
        row = await rest.insert("application_runs", {
            "id": str(request.id),
            "job_key": request.job_key,
            "job_context_id": str(request.job_context_id) if request.job_context_id else None,
            "title": request.title,
            "company": request.company,
            "job_url": request.job_url,
            "platform": request.platform,
            "route": request.route,
            "behavior_mode": request.behavior_mode,
            "status": "awaiting_authorization",
            "authorization_data": {},
        })
    except SupabaseError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Could not start the application run.") from exc
    return ApplicationRunResponse.model_validate(row)


@router.post("/{run_id}/authorize", response_model=ApplicationRunResponse, response_model_by_alias=True)
async def authorize_application(
    run_id: UUID,
    request: AuthorizeApplicationRequest,
    rest: SupabaseRest = Depends(get_rest),
) -> ApplicationRunResponse:
    row = await _get_run(rest, run_id)
    if row["status"] in ("email_sent", "submitted", "failed", "cancelled"):
        raise HTTPException(status.HTTP_409_CONFLICT, "This application run is already terminal.")
    authorization = {
        "grantedAt": _now(),
        "route": request.route,
        "websiteSubmissionAllowed": request.website_submission_allowed,
        "behaviorMode": row["behavior_mode"],
        "jobUrl": row.get("job_url"),
        "platform": row["platform"],
    }
    try:
        updated = await rest.update("application_runs", {"id": f"eq.{run_id}"}, {
            "status": "authorized",
            "authorization_data": authorization,
        })
    except SupabaseError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY,
                            "Could not save application authorization.") from exc
    if not updated:
        raise HTTPException(status.HTTP_409_CONFLICT, "This application run could not be authorized.")
    return ApplicationRunResponse.model_validate(updated[0])


@router.post("/{run_id}/status", response_model=ApplicationRunResponse, response_model_by_alias=True)
async def set_application_status(
    run_id: UUID,
    request: ApplicationStatusRequest,
    rest: SupabaseRest = Depends(get_rest),
) -> ApplicationRunResponse:
    row = await _get_run(rest, run_id)
    terminal = {"email_sent", "submitted", "failed", "cancelled"}
    if row["status"] in terminal and request.status not in terminal:
        raise HTTPException(status.HTTP_409_CONFLICT, "A terminal application run cannot be reopened.")
    values = {"status": request.status}
    if request.status in terminal:
        values["completed_at"] = _now()
    try:
        try:
            updated = await rest.update("application_runs", {"id": f"eq.{run_id}"}, values)
        except SupabaseError as exc:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY,
                                "Could not record application outcome.") from exc
    except SupabaseError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY,
                            "Could not update the application run.") from exc
    return ApplicationRunResponse.model_validate(updated[0] if updated else row)


@router.post("/{run_id}/events", response_model=ApplicationEventResponse, response_model_by_alias=True)
async def record_application_event(
    run_id: UUID,
    request: ApplicationEventRequest,
    rest: SupabaseRest = Depends(get_rest),
) -> ApplicationEventResponse:
    await _get_run(rest, run_id)
    try:
        row = await rest.insert("application_run_events", {
            "run_id": str(run_id),
            "type": request.type,
            "activity": request.activity,
            "status": request.status,
            "detail": request.detail,
            "checkpoint_id": str(request.checkpoint_id) if request.checkpoint_id else None,
        })
    except SupabaseError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY,
                            "Could not record application activity.") from exc
    return ApplicationEventResponse.model_validate(row)


@router.post("/{run_id}/checkpoints", response_model=ApplicationCheckpointResponse, response_model_by_alias=True)
async def record_application_checkpoint(
    run_id: UUID,
    request: ApplicationCheckpointRequest,
    rest: SupabaseRest = Depends(get_rest),
) -> ApplicationCheckpointResponse:
    await _get_run(rest, run_id)
    try:
        existing = await rest.select("application_run_checkpoints", {
            "run_id": f"eq.{run_id}",
            "name": f"eq.{request.name}",
            "limit": "1",
        })
    except SupabaseError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY,
                            "Could not load application checkpoints.") from exc
    values = {
        "run_id": str(run_id),
        "name": request.name,
        "status": request.status,
        "page_fingerprint": request.page_fingerprint,
        "page_url": request.page_url,
        "action_id": str(request.action_id) if request.action_id else None,
        "action_kind": request.action_kind,
        "before_fingerprint": request.before_fingerprint,
        "after_fingerprint": request.after_fingerprint,
        "detail": request.detail,
    }
    if existing:
        try:
            rows = await rest.update("application_run_checkpoints", {
                "id": f"eq.{existing[0]['id']}",
            }, values)
        except SupabaseError as exc:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY,
                                "Could not update application checkpoint.") from exc
        row = rows[0] if rows else existing[0]
    else:
        try:
            row = await rest.insert("application_run_checkpoints", values)
        except SupabaseError as exc:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY,
                                "Could not save application checkpoint.") from exc
    return ApplicationCheckpointResponse.model_validate(row)


@router.post("/{run_id}/outcome", response_model=ApplicationRunResponse, response_model_by_alias=True)
async def complete_application(
    run_id: UUID,
    request: ApplicationOutcomeRequest,
    rest: SupabaseRest = Depends(get_rest),
) -> ApplicationRunResponse:
    row = await _get_run(rest, run_id)
    if row["status"] in ("email_sent", "submitted", "failed", "cancelled"):
        raise HTTPException(status.HTTP_409_CONFLICT, "This application run is already terminal.")
    values = {
        "status": request.status,
        "completed_at": _now(),
        "job_outreach_id": str(request.job_outreach_id) if request.job_outreach_id else None,
        "resume_id": str(request.resume_id) if request.resume_id else None,
        "selected_resume_name": request.selected_resume_name,
        "recipient_email": request.recipient_email,
        "email_subject": request.email_subject,
        "provider_message_id": request.provider_message_id,
        "submission_evidence": request.submission_evidence,
    }
    updated = await rest.update("application_runs", {"id": f"eq.{run_id}"}, values)
    return ApplicationRunResponse.model_validate(updated[0] if updated else row)


@router.get("/{run_id}", response_model=ApplicationRunResponse, response_model_by_alias=True)
async def get_application(run_id: UUID, rest: SupabaseRest = Depends(get_rest)) -> ApplicationRunResponse:
    return ApplicationRunResponse.model_validate(await _get_run(rest, run_id))


@router.get("", response_model=List[ApplicationRunResponse], response_model_by_alias=True)
async def list_applications(rest: SupabaseRest = Depends(get_rest)) -> List[ApplicationRunResponse]:
    try:
        rows = await rest.select("application_runs", {"order": "started_at.desc", "limit": "100"})
    except SupabaseError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY,
                            "Could not load application runs.") from exc
    return [ApplicationRunResponse.model_validate(row) for row in rows]
