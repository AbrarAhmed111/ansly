"""Shared Gmail message preparation, resume attachment handling, and send-attempt auditing."""

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, Optional, Union

from src.app.db.rest import SupabaseError, SupabaseRest
from src.app.db.storage import SupabaseStorage
from src.app.email import gmail
from src.app.email.crypto import sha256_hex
from src.app.email.mime import Attachment, InvalidMessageError, build_message
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
) -> SendOutcome:
    """Send one message through the connected Gmail account and record the attempt."""
    attempt: Optional[Dict[str, Any]] = None
    try:
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
            "subject": subject,
            "body": body,
            "attachment_name": attachment.filename if attachment else None,
            "attachment_size": len(attachment.content) if attachment else None,
            "attachment_sha256": sha256_hex(attachment.content) if attachment else None,
            "status": "sending",
        })
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
