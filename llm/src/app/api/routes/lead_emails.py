"""
Lead email drafts and sending.

Flow: preview → generate (one draft per lead: role, resume match, email) → review/edit/approve → send preview
(confirm token bound to the exact drafts and versions) → send in chunks. Nothing is sent without that token, a
draft is claimed with a conditional update before it is sent (no duplicates from double clicks or retries), and
only a successful send marks the lead Contacted.
"""

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, AsyncIterator, Dict, List, Optional, Set
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from src.app.api.deps import get_gateway, get_rest, get_storage
from src.app.api.routes.email_connection import access_for_sending, get_connection
from src.app.core import llm_usage
from src.app.core.auth import AuthUser, get_current_user
from src.app.core.config import get_settings
from src.app.core.rate_limit import check_rate_limit
from src.app.db.rest import SupabaseError, SupabaseRest
from src.app.db.storage import SupabaseStorage
from src.app.email import crypto, gmail
from src.app.email.mime import valid_email
from src.app.email.outreach_history import (
    OutreachCandidate,
    find_previous_contacts,
    normalize_email,
)
from src.app.email.sending import send_gmail_email
from src.app.gateway import GatewayUnavailableError, LLMGateway
from src.app.leads.emails import (
    GENERATION_VERSION,
    InsufficientEvidenceError,
    candidate_facts,
    profile_evidence,
    write_email,
)
from src.app.leads.posts import _terms
from src.app.leads.roles import MatchResult, detect_role, match_resume, resume_summary
from src.app.resume.pipeline import fetch_profile_rows
from src.app.schemas.lead_emails import (
    ApproveReadyRequest,
    ApproveReadyResponse,
    DraftResume,
    EmailDraftListResponse,
    EmailDraftRecord,
    GeneratePreviewRequest,
    GeneratePreviewResponse,
    GenerateRequest,
    GenerateResponse,
    GenerateResult,
    RegenerateRequest,
    RematchRequest,
    RematchResponse,
    SendExcluded,
    SendPreviewItem,
    SendPreviewRequest,
    SendPreviewResponse,
    SendRequest,
    SendResponse,
    SendResult,
    UpdateDraftRequest,
    VersionRequest,
    WriteAndSendRequest,
    WriteAndSendResponse,
    WriteAndSendResult,
)
from src.app.schemas.resume import resume_file_name

logger = logging.getLogger("LeadEmailsAPI")


async def record_lead_usage(rest: SupabaseRest = Depends(get_rest)) -> AsyncIterator[None]:
    """After a Leads request that called the AI: its calls go to llm_calls, and one usage event carries their tokens
    so the dashboard's AI usage includes Leads. Accounting never fails the request."""
    try:
        yield
    finally:
        calls = llm_usage.drain()
        if calls:
            await llm_usage.write_calls(rest, calls)
            providers = sorted({c.provider for c in calls if c.provider})
            try:
                await rest.insert("usage_events", {
                    "kind": "lead_email", "tokens": sum(c.total_tokens for c in calls), "llm_calls": len(calls),
                    "provider": ",".join(providers)[:100] or None,
                })
            except SupabaseError as e:
                logger.warning(f"Could not record Leads usage: {e}")
router = APIRouter(prefix="/leads", tags=["Lead emails"])

TOKEN_TTL_SECONDS = 15 * 60
# A generate preview only authorizes writing (and, with confirm_send, sending) for leads the user already chose; a
# large Write & send run takes far longer than 15 minutes, so it stays valid for 12 hours.
GENERATE_TOKEN_TTL_SECONDS = 12 * 60 * 60
STALE_SENDING = timedelta(minutes=5)
GENERATE_CONCURRENCY = 3
MAX_REMATCH = 25


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso() -> str:
    return _now().isoformat()


def _upstream(message: str):
    return HTTPException(status.HTTP_502_BAD_GATEWAY, message)


def _require_crypto() -> None:
    if not crypto.is_configured():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "Email drafts need EMAIL_TOKEN_ENCRYPTION_KEY to be set on the Ansly API.")


# --------------------------------------------------------------------------- reading


def _post_email(lead: Optional[Dict[str, Any]]) -> Optional[str]:
    email = ((lead or {}).get("contact_info") or {}).get("email")
    return email if valid_email(email) else None


def _approved(draft: Dict[str, Any]) -> bool:
    return bool(draft.get("approved_at")) and draft.get("approved_version") == draft.get("version")


def send_issues(draft: Dict[str, Any]) -> List[str]:
    """What stops this draft from being sent (the Gmail connection is checked separately)."""
    if draft["delivery_status"] == "sent":
        return ["already_sent"]
    if draft["delivery_status"] == "sending":
        return ["sending"]
    issues = []
    recipient = draft.get("recipient_email")
    if not recipient:
        issues.append("missing_recipient")
    elif not valid_email(recipient):
        issues.append("invalid_recipient")
    if not (draft.get("subject") or "").strip():
        issues.append("missing_subject")
    if not (draft.get("body") or "").strip():
        issues.append("missing_body")
    if draft.get("resume_selection") == "needs_selection":
        issues.append("resume_not_chosen")
    if not _approved(draft):
        issues.append("not_approved")
    return issues


def _record(draft: Dict[str, Any], lead: Optional[Dict[str, Any]],
            resume: Optional[Dict[str, Any]], previous_contacts=None) -> EmailDraftRecord:
    return EmailDraftRecord(
        id=draft["id"], lead_id=draft["lead_id"], recipient_email=draft.get("recipient_email"),
        recipient_source=draft.get("recipient_source") or "post", post_email=_post_email(lead),
        subject=draft.get("subject") or "", body=draft.get("body") or "",
        resume=DraftResume(
            id=resume["id"], label=resume.get("role_label"), name=resume["name"],
            file_name=resume_file_name(resume),
            file_type=resume["file_type"], file_size=resume.get("file_size"),
        ) if resume else None,
        resume_selection=draft["resume_selection"], match_confidence=draft.get("match_confidence"),
        match_reason=draft.get("match_reason"), detected_role=draft.get("detected_role"),
        is_user_edited=bool(draft.get("is_user_edited")), approved=_approved(draft),
        approved_at=str(draft["approved_at"]) if draft.get("approved_at") else None,
        delivery_status=draft["delivery_status"], sent_at=str(draft["sent_at"]) if draft.get("sent_at") else None,
        last_error_code=draft.get("last_error_code"), version=draft["version"],
        updated_at=str(draft.get("updated_at") or "") or None, issues=send_issues(draft),
        previous_contacts=previous_contacts or [],
    )


async def _by_ids(rest: SupabaseRest, table: str, ids: Set[str]) -> Dict[str, Dict[str, Any]]:
    if not ids:
        return {}
    rows = await rest.select(table, {"id": f"in.({','.join(sorted(ids))})", "limit": str(len(ids))})
    return {str(r["id"]): r for r in rows}


async def _records(rest: SupabaseRest, drafts: List[Dict[str, Any]]) -> List[EmailDraftRecord]:
    leads = await _by_ids(rest, "leads", {str(d["lead_id"]) for d in drafts})
    resumes = await _by_ids(rest, "resumes", {str(d["resume_id"]) for d in drafts if d.get("resume_id")})
    candidates = []
    for draft in drafts:
        lead = leads.get(str(draft["lead_id"])) or {}
        role = draft.get("detected_role") or lead.get("detected_role") or {}
        candidates.append(OutreachCandidate(
            email=str(draft.get("recipient_email") or ""),
            role_title=str(role.get("title") or lead.get("title") or ""),
            company_name=role.get("company") or lead.get("company_name"),
        ))
    previous_by_email = await find_previous_contacts(rest, candidates)
    return [
        _record(
            draft,
            leads.get(str(draft["lead_id"])),
            resumes.get(str(draft.get("resume_id"))),
            previous_by_email.get(normalize_email(str(draft.get("recipient_email") or "")), []),
        )
        for draft in drafts
    ]


async def _expire_stale(rest: SupabaseRest, drafts: List[Dict[str, Any]]) -> None:
    """A draft stuck in `sending` (crash or timeout) may or may not have gone out: mark it, never retry it."""
    for draft in drafts:
        started = draft.get("sending_started_at")
        if draft["delivery_status"] != "sending" or not started:
            continue
        if datetime.fromisoformat(str(started).replace("Z", "+00:00")) > _now() - STALE_SENDING:
            continue
        values = {"delivery_status": "failed", "last_error_code": "outcome_unknown", "version": draft["version"] + 1}
        updated = await rest.update("lead_drafts", {"id": f"eq.{draft['id']}", "version": f"eq.{draft['version']}"},
                                    values)
        if updated:
            draft.update(updated[0])


async def _draft_for_lead(rest: SupabaseRest, lead_id: UUID) -> Dict[str, Any]:
    rows = await rest.select("lead_drafts", {"lead_id": f"eq.{lead_id}", "limit": "1"})
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No email draft for this lead yet.")
    return rows[0]


@router.get("/email-drafts", response_model=EmailDraftListResponse, summary="Email drafts (all, or for some leads)")
async def list_drafts(lead_ids: Optional[str] = None, rest: SupabaseRest = Depends(get_rest)) -> EmailDraftListResponse:
    params = {"order": "updated_at.desc", "limit": "500"}
    if lead_ids:
        ids = [i for i in lead_ids.split(",") if i][:500]
        try:
            ids = [str(UUID(i)) for i in ids]
        except ValueError as e:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid lead id.") from e
        params["lead_id"] = f"in.({','.join(ids)})"
    try:
        drafts = await rest.select("lead_drafts", params)
        await _expire_stale(rest, drafts)
        return EmailDraftListResponse(drafts=await _records(rest, drafts))
    except SupabaseError as e:
        raise _upstream("Could not load email drafts.") from e


# --------------------------------------------------------------------------- generating


@router.post("/email-drafts/preview", response_model=GeneratePreviewResponse,
             summary="Which leads can get an email draft")
async def preview_generation(request: GeneratePreviewRequest, rest: SupabaseRest = Depends(get_rest)
                             ) -> GeneratePreviewResponse:
    _require_crypto()
    if not request.all_eligible and not request.lead_ids:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose leads or all eligible leads.")
    try:
        if request.all_eligible:
            leads = await rest.select("leads", {"order": "collected_at.desc", "removed_at": "is.null", "limit": "1000"})
        else:
            leads = list((await _by_ids(rest, "leads", {str(i) for i in request.lead_ids})).values())
        drafted = {str(d["lead_id"]) for d in await rest.select("lead_drafts", {"select": "lead_id", "limit": "5000"})}
    except SupabaseError as e:
        raise _upstream("Could not check your leads.") from e
    with_email = [lead for lead in leads if _post_email(lead)]
    eligible = [str(lead["id"]) for lead in with_email if str(lead["id"]) not in drafted]
    return GeneratePreviewResponse(
        eligible=len(eligible), no_email=len(leads) - len(with_email),
        existing_drafts=len(with_email) - len(eligible), eligible_lead_ids=eligible,
        preview_token=crypto.sign({"kind": "generate", "leads": eligible}, GENERATE_TOKEN_TTL_SECONDS) if eligible else None,
    )


async def _target_roles(rest: SupabaseRest) -> List[str]:
    rows = await rest.select("targeting_profiles", {"is_active": "eq.true", "limit": "1"})
    return _terms(rows[0].get("target_roles"), 15) if rows else []


async def _library(rest: SupabaseRest) -> List[Dict[str, Any]]:
    return await rest.select("resumes", {"role_label": "not.is.null", "archived_at": "is.null",
                                         "order": "updated_at.desc", "limit": "50"})


async def _role_for(rest: SupabaseRest, gateway: LLMGateway, lead: Dict[str, Any],
                    target_roles: List[str]) -> Dict[str, Any]:
    # Roles cached before company detection existed are detected again once.
    if lead.get("detected_role") and "company" in lead["detected_role"]:
        return lead["detected_role"]
    role = await detect_role(gateway, lead.get("description") or "", target_roles)
    await rest.update("leads", {"id": f"eq.{lead['id']}"}, {"detected_role": role})
    return role


def _selection(match: MatchResult) -> Dict[str, Any]:
    return {
        "resume_id": match.resume_id if match.auto_attach else None,
        "resume_selection": "auto" if match.auto_attach else "needs_selection",
        "match_confidence": match.confidence,
        "match_reason": (match.reason + (f" Missing: {'; '.join(match.gaps)}." if match.gaps else ""))[:500],
    }


async def _compose(gateway: LLMGateway, lead: Dict[str, Any], role: Dict[str, Any], profile_data: Dict[str, Any],
                   resume_row: Optional[Dict[str, Any]], post_char_limit: int = 4000):
    role_text = " ".join([role.get("title", ""), *role.get("technologies", []), lead.get("description") or ""])
    return await write_email(
        gateway, post_text=lead.get("description") or "", role=role, author_name=lead.get("author_name"),
        profile_text=profile_evidence(profile_data, role_text),
        candidate=candidate_facts(profile_data),
        resume=resume_summary(resume_row) if resume_row else None,
        post_char_limit=post_char_limit,
    )


@dataclass
class _Generation:
    """Everything one generate (or write-and-send) request needs, loaded once."""

    rest: SupabaseRest
    gateway: LLMGateway
    user: AuthUser
    leads: Dict[str, Dict[str, Any]]
    existing: Dict[str, Dict[str, Any]]
    library: List[Dict[str, Any]]
    profile_data: Dict[str, Any]
    target_roles: List[str]
    semaphore: asyncio.Semaphore

    @property
    def library_by_id(self) -> Dict[str, Dict[str, Any]]:
        return {str(r["id"]): r for r in self.library}


def _verify_generate_token(preview_token: str, lead_ids: List[str]) -> None:
    try:
        token = crypto.verify(preview_token)
    except ValueError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, "This preview expired. Preview the leads again.") from e
    allowed = set(token.get("leads") or []) if token.get("kind") == "generate" else set()
    if not set(lead_ids) <= allowed:
        raise HTTPException(status.HTTP_409_CONFLICT, "These leads weren't in the confirmed preview.")


async def _load_generation(rest: SupabaseRest, gateway: LLMGateway, user: AuthUser, lead_ids: List[str]) -> _Generation:
    try:
        await check_rate_limit(rest, get_settings().RATE_LIMIT_PER_MINUTE)
        leads = await _by_ids(rest, "leads", set(lead_ids))
        existing = {str(d["lead_id"]): d for d in await rest.select(
            "lead_drafts", {"lead_id": f"in.({','.join(lead_ids)})", "limit": "50"})}
        library, profile_data, target_roles = await asyncio.gather(_library(rest), fetch_profile_rows(rest),
                                                                   _target_roles(rest))
    except SupabaseError as e:
        raise _upstream("Could not prepare the drafts.") from e
    return _Generation(rest, gateway, user, leads, existing, library, profile_data, target_roles,
                       asyncio.Semaphore(GENERATE_CONCURRENCY))


async def _generate_one(g: _Generation, lead_id: str) -> tuple[GenerateResult, Optional[Dict[str, Any]]]:
    """Writes one lead's draft. Returns the result and, when a draft was created now, its row."""
    rest = g.rest
    lead = g.leads.get(lead_id)
    if lead is None:
        return GenerateResult(lead_id=lead_id, outcome="failed", message="Lead not found."), None
    if lead_id in g.existing:
        (record,) = await _records(rest, [g.existing[lead_id]])
        return GenerateResult(lead_id=lead_id, outcome="existing", draft=record), None
    recipient = _post_email(lead)
    if not recipient:
        return GenerateResult(lead_id=lead_id, outcome="failed", message="This post has no email address."), None
    async with g.semaphore:
        try:
            role = await _role_for(rest, g.gateway, lead, g.target_roles)
            match = await match_resume(g.gateway, role, lead.get("description") or "", g.library)
            selection = _selection(match)
            resume_row = g.library_by_id.get(str(selection["resume_id"])) if selection["resume_id"] else None
            email = await _compose(g.gateway, lead, role, g.profile_data, resume_row)
            draft = await rest.insert("lead_drafts", {
                "lead_id": lead_id, "recipient_email": recipient, "recipient_source": "post",
                "subject": email.subject, "body": email.body, "detected_role": role,
                "generation_version": GENERATION_VERSION, "delivery_status": "draft", "version": 1,
                **selection,
            })
        except InsufficientEvidenceError as e:
            return GenerateResult(lead_id=lead_id, outcome="insufficient_evidence", message=str(e)), None
        except GatewayUnavailableError:
            return GenerateResult(lead_id=lead_id, outcome="failed",
                                  message="The AI providers are busy. Try this lead again in a minute."), None
        except SupabaseError as e:
            if e.status_code == status.HTTP_409_CONFLICT:
                rows = await rest.select("lead_drafts", {"lead_id": f"eq.{lead_id}", "limit": "1"})
                if rows:
                    (record,) = await _records(rest, rows)
                    return GenerateResult(lead_id=lead_id, outcome="existing", draft=record), None
            logger.error(f"Could not save a draft for user {g.user.id}: {e}")
            return GenerateResult(lead_id=lead_id, outcome="failed", message="Could not save this draft."), None
    (record,) = await _records(rest, [draft])
    return GenerateResult(lead_id=lead_id, outcome="created", draft=record), draft


@router.post("/email-drafts/generate", dependencies=[Depends(record_lead_usage)], response_model=GenerateResponse,
             summary="Write one personalized draft per lead (up to 10 per request)")
async def generate_drafts(
    request: GenerateRequest,
    user: AuthUser = Depends(get_current_user),
    rest: SupabaseRest = Depends(get_rest),
    gateway: LLMGateway = Depends(get_gateway),
) -> GenerateResponse:
    _require_crypto()
    lead_ids = [str(i) for i in request.lead_ids]
    _verify_generate_token(request.preview_token, lead_ids)
    g = await _load_generation(rest, gateway, user, lead_ids)
    outcomes = await asyncio.gather(*(_generate_one(g, i) for i in lead_ids))
    return GenerateResponse(results=[result for result, _ in outcomes])


@router.post("/email-drafts/write-and-send", dependencies=[Depends(record_lead_usage)], response_model=WriteAndSendResponse,
             summary="Write each email and send it at once when its resume match is confident (up to 10 per request)")
async def write_and_send(
    request: WriteAndSendRequest,
    user: AuthUser = Depends(get_current_user),
    rest: SupabaseRest = Depends(get_rest),
    storage: SupabaseStorage = Depends(get_storage),
    gateway: LLMGateway = Depends(get_gateway),
) -> WriteAndSendResponse:
    """The fast path. The user confirmed sending for these leads in one step, so a new draft whose resume Ansly
    matched with high confidence is approved and sent right away. A draft without a confident match is never
    sent: it waits in Review. Leads already contacted, or that already have a draft, are left alone."""
    _require_crypto()
    if not request.confirm_send:
        raise HTTPException(status.HTTP_409_CONFLICT, "Confirm that emails will be sent.")
    lead_ids = [str(i) for i in request.lead_ids]
    _verify_generate_token(request.preview_token, lead_ids)

    # Gmail first: if it can't send, nothing is written either.
    try:
        connection, access = await access_for_sending(rest)
    except gmail.GmailError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e

    g = await _load_generation(rest, gateway, user, lead_ids)
    results: List[WriteAndSendResult] = []
    to_write: List[str] = []
    for lead_id in lead_ids:
        lead = g.leads.get(lead_id)
        if lead is not None and lead.get("status") == "contacted":
            results.append(WriteAndSendResult(lead_id=lead_id, outcome="skipped", code="already_contacted",
                                              message="Already contacted."))
        else:
            to_write.append(lead_id)

    outcomes = await asyncio.gather(*(_generate_one(g, i) for i in to_write))
    stopped: Optional[str] = None
    for result, row in outcomes:
        if row is None:
            outcome = {"existing": "skipped", "insufficient_evidence": "insufficient_evidence"}.get(result.outcome,
                                                                                                   "failed")
            results.append(WriteAndSendResult(lead_id=result.lead_id, outcome=outcome,
                                              code="has_draft" if result.outcome == "existing" else None,
                                              message=result.message, draft=result.draft))
            continue
        if row["resume_selection"] != "auto":
            results.append(WriteAndSendResult(lead_id=result.lead_id, outcome="needs_review", code="resume_not_chosen",
                                              message="No resume fit confidently. Choose one in Review.",
                                              draft=result.draft))
            continue
        if stopped:
            results.append(WriteAndSendResult(lead_id=result.lead_id, outcome="needs_review", code=stopped,
                                              message="Written but not sent.", draft=result.draft))
            continue
        # Approved by the user's write-and-send confirmation for exactly this version.
        approved = await rest.update(
            "lead_drafts", {"id": f"eq.{row['id']}", "version": f"eq.{row['version']}"},
            {"approved_at": _iso(), "approved_version": row["version"] + 1, "version": row["version"] + 1},
        )
        if not approved:
            results.append(WriteAndSendResult(lead_id=result.lead_id, outcome="needs_review", code="changed",
                                              draft=result.draft))
            continue
        sent = await _send_one(rest, storage, connection, access, approved[0])
        if sent.code in ("rate_limited", "reauth_required"):
            stopped = sent.code
        (record,) = await _records(rest, await rest.select("lead_drafts", {"id": f"eq.{row['id']}", "limit": "1"}))
        results.append(WriteAndSendResult(
            lead_id=result.lead_id,
            outcome="sent" if sent.outcome == "sent" else (
                "needs_review" if sent.outcome == "needs_review" else "failed"
            ),
            code=sent.code,
            message=sent.message,
            draft=record,
            previous_contacts=sent.previous_contacts,
        ))
        await asyncio.sleep(0.3)
    order = {lead_id: i for i, lead_id in enumerate(lead_ids)}
    results.sort(key=lambda r: order.get(str(r.lead_id), 0))
    return WriteAndSendResponse(results=results, stopped=stopped)


# --------------------------------------------------------------------------- editing


async def _conditional_update(rest: SupabaseRest, draft: Dict[str, Any], expected: int,
                              values: Dict[str, Any]) -> Dict[str, Any]:
    if draft["version"] != expected:
        raise HTTPException(status.HTTP_409_CONFLICT, "This draft changed in another tab. Reload it and try again.")
    updated = await rest.update("lead_drafts", {"id": f"eq.{draft['id']}", "version": f"eq.{expected}"},
                                {**values, "version": expected + 1})
    if not updated:
        raise HTTPException(status.HTTP_409_CONFLICT, "This draft changed in another tab. Reload it and try again.")
    return updated[0]


def _editable(draft: Dict[str, Any]) -> None:
    if draft["delivery_status"] in ("sent", "sending"):
        raise HTTPException(status.HTTP_409_CONFLICT, "This email was already sent (or is sending) and can't be changed.")


@router.get("/{lead_id}/email-draft", response_model=EmailDraftRecord, summary="One lead's email draft")
async def get_draft(lead_id: UUID, rest: SupabaseRest = Depends(get_rest)) -> EmailDraftRecord:
    try:
        draft = await _draft_for_lead(rest, lead_id)
        await _expire_stale(rest, [draft])
        (record,) = await _records(rest, [draft])
    except SupabaseError as e:
        raise _upstream("Could not load the draft.") from e
    return record


@router.patch("/{lead_id}/email-draft", response_model=EmailDraftRecord, summary="Edit a draft")
async def update_draft(lead_id: UUID, request: UpdateDraftRequest,
                       rest: SupabaseRest = Depends(get_rest)) -> EmailDraftRecord:
    try:
        draft = await _draft_for_lead(rest, lead_id)
        _editable(draft)
        values: Dict[str, Any] = {}
        edited = False
        if request.recipient_email is not None:
            recipient = request.recipient_email.strip()
            if not valid_email(recipient):
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Enter one valid email address.")
            if recipient != draft.get("recipient_email"):
                lead = (await _by_ids(rest, "leads", {str(lead_id)})).get(str(lead_id))
                values.update(recipient_email=recipient,
                              recipient_source="post" if recipient == _post_email(lead) else "user")
                edited = True
        if request.subject is not None and request.subject.strip() != draft.get("subject"):
            if not request.subject.strip() or "\n" in request.subject or "\r" in request.subject:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The subject must be one non-empty line.")
            values["subject"] = request.subject.strip()
            edited = True
        if request.body is not None and request.body != draft.get("body"):
            if not request.body.strip():
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The email body can't be empty.")
            values["body"] = request.body
            edited = True
        if request.send_without_resume:
            values.update(resume_id=None, resume_selection="none_by_user")
        elif request.resume_id is not None and str(request.resume_id) != str(draft.get("resume_id")):
            resumes = await rest.select("resumes", {"id": f"eq.{request.resume_id}", "archived_at": "is.null",
                                                    "limit": "1"})
            if not resumes:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "That resume isn't in your library.")
            values.update(resume_id=str(request.resume_id), resume_selection="user")
        if not values:
            (record,) = await _records(rest, [draft])
            return record
        if edited:
            values["is_user_edited"] = True
        # The user's own changes keep an approval current; the new version is what they approved.
        if _approved(draft):
            values["approved_version"] = draft["version"] + 1
        updated = await _conditional_update(rest, draft, request.expected_version, values)
        (record,) = await _records(rest, [updated])
    except SupabaseError as e:
        raise _upstream("Could not save the draft.") from e
    return record


@router.post("/{lead_id}/email-draft/approve", response_model=EmailDraftRecord,
             summary="Approve this exact version for sending")
async def approve_draft(lead_id: UUID, request: VersionRequest, rest: SupabaseRest = Depends(get_rest)
                        ) -> EmailDraftRecord:
    try:
        draft = await _draft_for_lead(rest, lead_id)
        _editable(draft)
        updated = await _conditional_update(rest, draft, request.expected_version,
                                            {"approved_at": _iso(), "approved_version": request.expected_version + 1})
        (record,) = await _records(rest, [updated])
    except SupabaseError as e:
        raise _upstream("Could not approve the draft.") from e
    return record


@router.post("/{lead_id}/email-draft/unapprove", response_model=EmailDraftRecord, summary="Withdraw approval")
async def unapprove_draft(lead_id: UUID, request: VersionRequest, rest: SupabaseRest = Depends(get_rest)
                          ) -> EmailDraftRecord:
    try:
        draft = await _draft_for_lead(rest, lead_id)
        _editable(draft)
        updated = await _conditional_update(rest, draft, request.expected_version,
                                            {"approved_at": None, "approved_version": None})
        (record,) = await _records(rest, [updated])
    except SupabaseError as e:
        raise _upstream("Could not update the draft.") from e
    return record


@router.post("/{lead_id}/email-draft/regenerate", dependencies=[Depends(record_lead_usage)], response_model=EmailDraftRecord,
             summary="Rewrite the draft (replaces its text; clears approval)")
async def regenerate_draft(
    lead_id: UUID,
    request: RegenerateRequest,
    rest: SupabaseRest = Depends(get_rest),
    gateway: LLMGateway = Depends(get_gateway),
) -> EmailDraftRecord:
    if not request.confirm_replace:
        raise HTTPException(status.HTTP_409_CONFLICT, "Confirm that the current text will be replaced.")
    try:
        draft = await _draft_for_lead(rest, lead_id)
        _editable(draft)
        if draft.get("is_user_edited") and not request.confirm_discard_edits:
            raise HTTPException(status.HTTP_409_CONFLICT, "This draft has your edits. Confirm to discard them.")
        if draft["version"] != request.expected_version:
            raise HTTPException(status.HTTP_409_CONFLICT, "This draft changed in another tab. Reload it and try again.")
        await check_rate_limit(rest, get_settings().RATE_LIMIT_PER_MINUTE)
        lead = (await _by_ids(rest, "leads", {str(lead_id)})).get(str(lead_id))
        if lead is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Lead not found.")
        library, profile_data, target_roles = await asyncio.gather(_library(rest), fetch_profile_rows(rest),
                                                                   _target_roles(rest))
        role = await _role_for(rest, gateway, lead, target_roles)
        values: Dict[str, Any] = {}
        resume_id = draft.get("resume_id")
        if request.rematch_resume:
            values.update(_selection(await match_resume(gateway, role, lead.get("description") or "", library)))
            resume_id = values["resume_id"]
        resume_row = next((r for r in library if str(r["id"]) == str(resume_id)), None) if resume_id else None
        email = await _compose(gateway, lead, role, profile_data, resume_row)
        values.update(subject=email.subject, body=email.body, detected_role=role, is_user_edited=False,
                      approved_at=None, approved_version=None, generation_version=GENERATION_VERSION,
                      delivery_status="draft", last_error_code=None)
        updated = await _conditional_update(rest, draft, request.expected_version, values)
        (record,) = await _records(rest, [updated])
    except InsufficientEvidenceError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e)) from e
    except GatewayUnavailableError as e:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "The AI providers are busy. Try again in a minute.") from e
    except SupabaseError as e:
        raise _upstream("Could not regenerate the draft.") from e
    return record


@router.post("/email-drafts/rematch", dependencies=[Depends(record_lead_usage)], response_model=RematchResponse,
             summary="Match resumes again for drafts still waiting for one (up to 25 per request)")
async def rematch_drafts(
    request: RematchRequest,
    rest: SupabaseRest = Depends(get_rest),
    gateway: LLMGateway = Depends(get_gateway),
) -> RematchResponse:
    """Only drafts that are unsent and still `needs_selection` are touched: a resume the user chose (or "no resume")
    is never replaced. A confident match is attached; nothing is approved or sent."""
    try:
        params = {"resume_selection": "eq.needs_selection", "delivery_status": "in.(draft,failed)",
                  "order": "updated_at.asc", "limit": str(MAX_REMATCH)}
        if request.draft_ids:
            params["id"] = f"in.({','.join(str(i) for i in request.draft_ids[:MAX_REMATCH])})"
        drafts = await rest.select("lead_drafts", params)
        library = await _library(rest)
        leads = await _by_ids(rest, "leads", {str(d["lead_id"]) for d in drafts})
    except SupabaseError as e:
        raise _upstream("Could not load the drafts.") from e

    semaphore = asyncio.Semaphore(GENERATE_CONCURRENCY)

    async def one(draft: Dict[str, Any]) -> Optional[EmailDraftRecord]:
        lead = leads.get(str(draft["lead_id"])) or {}
        role = draft.get("detected_role") or lead.get("detected_role")
        if not role:
            return None
        async with semaphore:
            try:
                match = await match_resume(gateway, role, lead.get("description") or "", library)
            except GatewayUnavailableError:
                return None
        values = _selection(match)
        if values["resume_selection"] != "auto":
            values = {k: v for k, v in values.items() if k in ("match_confidence", "match_reason")}
        try:
            updated = await rest.update(
                "lead_drafts",
                {"id": f"eq.{draft['id']}", "version": f"eq.{draft['version']}",
                 "resume_selection": "eq.needs_selection"},
                {**values, "version": draft["version"] + 1},
            )
        except SupabaseError:
            return None
        if not updated or updated[0]["resume_selection"] != "auto":
            return None
        (record,) = await _records(rest, updated)
        return record

    matched = [r for r in await asyncio.gather(*(one(d) for d in drafts)) if r is not None]
    remaining = len(drafts) == MAX_REMATCH and not request.draft_ids
    return RematchResponse(checked=len(drafts), matched=len(matched), drafts=matched, more=remaining)


@router.post("/email-drafts/approve-ready", response_model=ApproveReadyResponse,
             summary="Approve every unsent draft whose only remaining step is approval")
async def approve_ready(request: ApproveReadyRequest, rest: SupabaseRest = Depends(get_rest)) -> ApproveReadyResponse:
    """Approves drafts that have a recipient, subject, body and a resume decision. Nothing is sent: sending still
    goes through the send preview and its confirmation."""
    try:
        params = {"delivery_status": "eq.draft", "approved_at": "is.null", "limit": "1000"}
        if request.draft_ids:
            params["id"] = f"in.({','.join(str(i) for i in request.draft_ids[:1000])})"
        drafts = await rest.select("lead_drafts", params)
    except SupabaseError as e:
        raise _upstream("Could not load the drafts.") from e
    approved: List[EmailDraftRecord] = []
    for draft in drafts:
        if send_issues(draft) != ["not_approved"]:
            continue
        try:
            updated = await rest.update(
                "lead_drafts", {"id": f"eq.{draft['id']}", "version": f"eq.{draft['version']}"},
                {"approved_at": _iso(), "approved_version": draft["version"] + 1, "version": draft["version"] + 1},
            )
        except SupabaseError:
            continue
        if updated:
            approved.extend(await _records(rest, updated))
    return ApproveReadyResponse(approved=len(approved), drafts=approved)


# --------------------------------------------------------------------------- sending


@router.post("/email-drafts/send-preview", response_model=SendPreviewResponse,
             summary="Exactly what would be sent, and a confirm token for it")
async def send_preview(request: SendPreviewRequest, rest: SupabaseRest = Depends(get_rest)) -> SendPreviewResponse:
    _require_crypto()
    if not request.all_ready and not request.draft_ids:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose drafts to send.")
    try:
        if request.all_ready:
            drafts = await rest.select("lead_drafts", {"delivery_status": "in.(draft,failed)", "limit": "1000"})
        else:
            drafts = list((await _by_ids(rest, "lead_drafts", {str(i) for i in request.draft_ids})).values())
        await _expire_stale(rest, drafts)
        connection = await get_connection(rest)
        resumes = await _by_ids(rest, "resumes", {str(d["resume_id"]) for d in drafts if d.get("resume_id")})
        draft_records = await _records(rest, drafts) if drafts else []
    except SupabaseError as e:
        raise _upstream("Could not check the drafts.") from e

    ready: List[SendPreviewItem] = []
    previous_by_draft = {str(record.id): record.previous_contacts for record in draft_records}
    excluded: List[SendExcluded] = []
    for draft in drafts:
        issues = send_issues(draft)
        if draft["delivery_status"] == "failed" and not request.retry:
            issues.append("failed_needs_retry")
        if issues:
            if not (request.all_ready and issues == ["already_sent"]):
                excluded.append(SendExcluded(draft_id=draft["id"], lead_id=draft["lead_id"], issues=issues))
            continue
        resume = resumes.get(str(draft.get("resume_id")))
        ready.append(SendPreviewItem(
            draft_id=draft["id"], lead_id=draft["lead_id"], recipient_email=draft["recipient_email"],
            subject=draft["subject"], attachment_name=resume_file_name(resume) if resume else None,
            may_duplicate=draft.get("last_error_code") == "outcome_unknown",
            previous_contacts=previous_by_draft.get(str(draft["id"]), []),
        ))

    connection_issue = None
    if connection is None:
        connection_issue = "not_connected"
    elif connection["status"] == "needs_reauth":
        connection_issue = "reauth_required"
    token = None
    if ready and connection_issue is None:
        token = crypto.sign({"kind": "send", "drafts": {str(i.draft_id): _version_of(drafts, i.draft_id) for i in ready}},
                            TOKEN_TTL_SECONDS)
    return SendPreviewResponse(ready=ready, excluded=excluded, connection_issue=connection_issue,
                               connection_email=connection["email_address"] if connection else None,
                               confirm_token=token)


def _version_of(drafts: List[Dict[str, Any]], draft_id: UUID) -> int:
    return next(d["version"] for d in drafts if str(d["id"]) == str(draft_id))


@router.post("/email-drafts/send", response_model=SendResponse,
             summary="Send confirmed drafts through Gmail (up to 10 per request)")
async def send_drafts(
    request: SendRequest,
    user: AuthUser = Depends(get_current_user),
    rest: SupabaseRest = Depends(get_rest),
    storage: SupabaseStorage = Depends(get_storage),
) -> SendResponse:
    _require_crypto()
    try:
        token = crypto.verify(request.confirm_token)
    except ValueError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, "This confirmation expired. Review the emails and confirm again.") from e
    confirmed: Dict[str, int] = (token.get("drafts") or {}) if token.get("kind") == "send" else {}
    ids = [str(i) for i in request.draft_ids]
    if not set(ids) <= set(confirmed):
        raise HTTPException(status.HTTP_409_CONFLICT, "These emails weren't in what you confirmed.")
    duplicate_confirmed = {str(i) for i in request.confirm_duplicate_draft_ids}
    if not duplicate_confirmed <= set(ids) or not duplicate_confirmed <= set(confirmed):
        raise HTTPException(status.HTTP_409_CONFLICT, "Duplicate confirmation must match the drafts you reviewed.")

    try:
        drafts = await _by_ids(rest, "lead_drafts", set(ids))
    except SupabaseError as e:
        raise _upstream("Could not load the drafts.") from e
    may_duplicate = [d for d in drafts.values() if d.get("last_error_code") == "outcome_unknown"]
    if may_duplicate and not request.confirm_may_duplicate:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "Some of these may already have been sent. Check Gmail's Sent folder, then confirm.")

    # Start Gmail before claiming anything: if access lapsed, the drafts stay untouched.
    try:
        connection, access = await access_for_sending(rest)
    except gmail.GmailError as e:
        return SendResponse(stopped=e.code, results=[
            SendResult(draft_id=i, outcome="not_attempted", code=e.code, message=str(e)) for i in ids])

    results: List[SendResult] = []
    stopped: Optional[str] = None
    for draft_id in ids:
        draft = drafts.get(draft_id)
        if stopped:
            results.append(SendResult(draft_id=draft_id, outcome="not_attempted", code=stopped))
            continue
        if draft is None:
            results.append(SendResult(draft_id=draft_id, outcome="skipped", code="not_found"))
            continue
        if draft["version"] != confirmed[draft_id]:
            results.append(SendResult(draft_id=draft_id, lead_id=draft["lead_id"], outcome="skipped",
                                      code="changed_since_confirmed",
                                      message="This draft changed after you confirmed. Review and send it again."))
            continue
        issues = send_issues(draft)
        if issues:
            results.append(SendResult(draft_id=draft_id, lead_id=draft["lead_id"], outcome="skipped", code=issues[0]))
            continue
        result = await _send_one(
            rest, storage, connection, access, draft,
            allow_duplicate=draft_id in duplicate_confirmed,
        )
        results.append(result)
        if result.code in ("rate_limited", "reauth_required"):
            stopped = result.code
        await asyncio.sleep(0.3)
    return SendResponse(results=results, stopped=stopped)


async def _send_one(rest: SupabaseRest, storage: SupabaseStorage, connection: Dict[str, Any], access: str,
                    draft: Dict[str, Any], *, allow_duplicate: bool = False) -> SendResult:
    draft_id, lead_id, version = str(draft["id"]), str(draft["lead_id"]), draft["version"]
    try:
        lead = (await _by_ids(rest, "leads", {lead_id})).get(lead_id) or {}
    except SupabaseError as e:
        logger.error(f"Could not load role details before sending draft {draft_id}: {e}")
        return SendResult(
            draft_id=draft_id,
            lead_id=lead_id,
            outcome="failed",
            code="history_unavailable",
            message="Could not verify previous outreach history.",
        )

    # Claim: only one request can move this exact version to `sending`.
    claimed = await rest.update(
        "lead_drafts",
        {"id": f"eq.{draft_id}", "version": f"eq.{version}", "delivery_status": "in.(draft,failed)"},
        {"delivery_status": "sending", "sending_started_at": _iso(), "version": version + 1,
         "approved_version": version + 1, "last_error_code": None},
    )
    if not claimed:
        return SendResult(draft_id=draft_id, lead_id=lead_id, outcome="skipped", code="already_sending_or_sent")
    version += 1

    role = draft.get("detected_role") or lead.get("detected_role") or {}
    outcome = await send_gmail_email(
        rest, storage, connection, access,
        recipient=draft["recipient_email"], subject=draft["subject"], body=draft["body"],
        resume_id=str(draft["resume_id"]) if draft.get("resume_id") else None,
        draft_id=draft_id, lead_id=lead_id,
        role_title=str(role.get("title") or lead.get("title") or ""),
        company_name=role.get("company") or lead.get("company_name"),
        outreach_source="linkedin_leads",
        allow_duplicate=allow_duplicate,
    )
    if outcome.code == "duplicate_contact":
        await rest.update(
            "lead_drafts",
            {"id": f"eq.{draft_id}", "version": f"eq.{version}"},
            {"delivery_status": "draft", "sending_started_at": None, "version": version + 1,
             "approved_version": version + 1, "last_error_code": None},
        )
        return SendResult(
            draft_id=draft_id,
            lead_id=lead_id,
            outcome="needs_review",
            code=outcome.code,
            message=outcome.message,
            previous_contacts=outcome.previous_contacts or [],
        )
    await _finish(rest, draft_id, version, ok=outcome.sent, code=outcome.code, message_id=outcome.message_id)
    if not outcome.sent:
        return SendResult(draft_id=draft_id, lead_id=lead_id, outcome="failed", code=outcome.code,
                          message=outcome.message)
    try:
        # Only a successful send marks the lead Contacted (and only if it was still New).
        await rest.update("leads", {"id": f"eq.{lead_id}", "status": "eq.new"}, {"status": "contacted"})
    except SupabaseError as e:
        logger.warning(f"Email sent but the lead status update failed: {e}")
    return SendResult(draft_id=draft_id, lead_id=lead_id, outcome="sent")


async def _finish(rest: SupabaseRest, draft_id: str, version: int, *, ok: bool,
                  code: Optional[str] = None, message_id: Optional[str] = None) -> None:
    now = _iso()
    try:
        await rest.update("lead_drafts", {"id": f"eq.{draft_id}", "version": f"eq.{version}"}, {
            "delivery_status": "sent" if ok else "failed", "sent_at": now if ok else None,
            # Approval carries over: a retry sends the same content the user approved.
            "last_error_code": code, "version": version + 1, "approved_version": version + 1,
        })
    except SupabaseError as e:
        # The draft stays `sending`; after 5 minutes it's marked "may have been sent" and never retried automatically.
        logger.error(f"Could not record the send result for draft {draft_id}: {e}")
