"""Shared Gmail message preparation, resume attachment handling, and send-attempt auditing."""

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Union

from src.app.db.rest import SupabaseError, SupabaseRest
from src.app.db.storage import SupabaseStorage
from src.app.email import gmail
from src.app.email.crypto import sha256_hex
from src.app.email.mime import Attachment, InvalidMessageError, build_message, normalize_addresses
from src.app.email.outreach_history import (
    OutreachCandidate,
    find_in_progress_contacts,
    find_previous_contacts,
    normalize_company,
    normalize_email,
    normalize_role,
)
from src.app.schemas.outreach_history import PreviousContact
from src.app.schemas.resume import resume_file_name

logger = logging.getLogger("EmailSending")

MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
PROVIDER = "gmail"


@dataclass
class SendOutcome:
    sent: bool
    code: Optional[str] = None
    message: Optional[str] = None
    message_id: Optional[str] = None
    previous_contacts: Optional[List[PreviousContact]] = None


async def send_gmail_email(
    rest: SupabaseRest,
    storage: SupabaseStorage,
    connection: Dict[str, Any],
    access: str,
    *,
    recipient: Union[str, Iterable[str]],
    subject: str,
    body: str,
    resume_id: Optional[str],
    cc: Optional[Union[str, Iterable[str]]] = None,
    draft_id: Optional[str] = None,
    lead_id: Optional[str] = None,
    job_outreach_id: Optional[str] = None,
    role_title: Optional[str] = None,
    company_name: Optional[str] = None,
    outreach_source: Optional[str] = None,
    allow_duplicate: bool = False,
) -> SendOutcome:
    """Send one message through the connected Gmail account and record the attempt."""
    attempt: Optional[Dict[str, Any]] = None
    try:
        address_map = {
            normalize_email(address): address
            for address in [*normalize_addresses(recipient), *normalize_addresses(cc)]
        }
        addresses = [address_map[key] for key in sorted(address_map)]
        candidates = [
            OutreachCandidate(email=address, role_title=role_title or "", company_name=company_name)
            for address in addresses
        ]
        previous_by_email = await find_previous_contacts(rest, candidates)
        previous_contacts = [
            contact
            for contacts in previous_by_email.values()
            for contact in contacts
        ]
        if previous_contacts and not allow_duplicate:
            return SendOutcome(
                False,
                code="duplicate_contact",
                message="A recipient was previously contacted for this role. Review and confirm before sending again.",
                previous_contacts=previous_contacts,
            )
        pending = await find_in_progress_contacts(rest, candidates)
        if pending:
            code = "outcome_unknown" if any(row.get("status") == "outcome_unknown" for row in pending) else (
                "contact_send_in_progress"
            )
            message = (
                "A previous send to this recipient may have succeeded. Check Gmail's Sent folder before retrying."
                if code == "outcome_unknown"
                else "An equivalent email to this recipient is already being sent."
            )
            return SendOutcome(False, code=code, message=message)

        attachment: Optional[Attachment] = None
        if resume_id:
            resumes = await rest.select("resumes", {"id": f"eq.{resume_id}", "limit": "1"})
            if not resumes:
                raise gmail.GmailError("The attached resume no longer exists.", "attachment_unavailable")
            resume = resumes[0]
            content = await storage.download(resume["file_path"])
            if len(content) > MAX_ATTACHMENT_BYTES:
                raise gmail.GmailError("The attached resume is larger than 10 MB.", "attachment_too_large")
            attachment = Attachment(
                filename=resume_file_name(resume) or f"resume.{resume['file_type']}",
                file_type=resume["file_type"],
                content=content,
            )
        raw = build_message(connection["email_address"], recipient, subject, body, attachment, cc=cc)
        attempt = await rest.insert("email_send_attempts", {
            "draft_id": draft_id,
            "lead_id": lead_id,
            "job_outreach_id": job_outreach_id,
            "provider": PROVIDER,
            "from_address": connection["email_address"],
            "recipient_email": recipient,
            "cc_email": ", ".join(normalize_addresses(cc)) or None,
            "subject": subject,
            "body": body,
            "attachment_name": attachment.filename if attachment else None,
            "attachment_size": len(attachment.content) if attachment else None,
            "attachment_sha256": sha256_hex(attachment.content) if attachment else None,
            "status": "sending",
        })
        source = outreach_source or ("job_outreach" if job_outreach_id else "linkedin_leads")
        contact_rows = [
            {
                "email_send_attempt_id": attempt["id"],
                "recipient_email": address,
                "normalized_email": normalize_email(address),
                "role_title": role_title or "",
                "normalized_role": normalize_role(role_title),
                "company_name": company_name,
                "normalized_company": normalize_company(company_name),
                "source": source,
                "lead_id": lead_id,
                "job_outreach_id": job_outreach_id,
                "repeat_authorized": allow_duplicate,
                "status": "sending",
            }
            for address in addresses
        ]
        if contact_rows:
            try:
                await rest.insert_many("outreach_contact_history", contact_rows)
            except SupabaseError as e:
                await _finish_attempt(rest, attempt, ok=False, code="contact_send_in_progress")
                if (
                    "outreach_contact_history_active_send" in str(e)
                    or "equivalent outreach email" in str(e).casefold()
                    or "23505" in str(e)
                ):
                    previous_by_email = await find_previous_contacts(rest, candidates)
                    previous_contacts = [
                        contact
                        for contacts in previous_by_email.values()
                        for contact in contacts
                    ]
                    if previous_contacts and not allow_duplicate:
                        return SendOutcome(
                            False,
                            code="duplicate_contact",
                            message=(
                                "A recipient was previously contacted for this role. "
                                "Review and confirm before sending again."
                            ),
                            previous_contacts=previous_contacts,
                        )
                    return SendOutcome(
                        False,
                        code="contact_send_in_progress",
                        message="An equivalent email to this recipient is already being sent.",
                    )
                raise
        message_id = await gmail.send(access, raw)
    except (gmail.GmailError, InvalidMessageError, SupabaseError) as e:
        code = e.code if isinstance(e, gmail.GmailError) else (
            "invalid_message" if isinstance(e, InvalidMessageError) else "storage_error"
        )
        message = str(e) if not isinstance(e, SupabaseError) else "Could not prepare this email."
        await _finish_attempt(rest, attempt, ok=False, code=code)
        return SendOutcome(False, code=code, message=message)

    await _finish_attempt(rest, attempt, ok=True, message_id=message_id)
    return SendOutcome(True, message_id=message_id)


async def _finish_attempt(
    rest: SupabaseRest,
    attempt: Optional[Dict[str, Any]],
    *,
    ok: bool,
    code: Optional[str] = None,
    message_id: Optional[str] = None,
) -> None:
    if attempt is None:
        return
    try:
        await rest.update("email_send_attempts", {"id": f"eq.{attempt['id']}"}, {
            "status": "sent" if ok else "failed",
            "provider_message_id": message_id,
            "error_code": code,
            "finished_at": datetime.now(timezone.utc).isoformat(),
        })
    except SupabaseError as e:
        logger.error(f"Could not record email send attempt {attempt['id']}: {e}")
    try:
        await rest.update("outreach_contact_history", {
            "email_send_attempt_id": f"eq.{attempt['id']}",
            "status": "eq.sending",
        }, {
            "status": "sent" if ok else ("outcome_unknown" if code == "outcome_unknown" else "failed"),
            "sent_at": datetime.now(timezone.utc).isoformat() if ok else None,
            "provider_message_id": message_id,
        })
    except SupabaseError as e:
        logger.error(f"Could not record outreach contact outcome for attempt {attempt['id']}: {e}")
