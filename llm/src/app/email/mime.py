"""Builds the RFC 5322 message for one email: one recipient, plain text, optional attachment sent unchanged."""

import re
from dataclasses import dataclass
from email.message import EmailMessage
from email.policy import SMTP
from email.utils import formataddr
from typing import Optional

EMAIL_RE = re.compile(r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?"
                      r"(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$")
CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")
MIME_TYPES = {
    "pdf": ("application", "pdf"),
    "docx": ("application", "vnd.openxmlformats-officedocument.wordprocessingml.document"),
}


class InvalidMessageError(ValueError):
    """The message can't be sent as given (bad recipient, header injection, empty content)."""


def valid_email(address: Optional[str]) -> bool:
    return bool(address) and len(address) <= 320 and not CONTROL_RE.search(address) and bool(EMAIL_RE.match(address))


@dataclass
class Attachment:
    filename: str
    file_type: str
    content: bytes


def build_message(sender: str, recipient: str, subject: str, body: str,
                  attachment: Optional[Attachment] = None) -> bytes:
    if not valid_email(recipient):
        raise InvalidMessageError("The recipient isn't a single valid email address.")
    if not valid_email(sender):
        raise InvalidMessageError("The connected sending address isn't valid.")
    if not subject.strip() or CONTROL_RE.search(subject):
        raise InvalidMessageError("The subject is empty or contains line breaks.")
    if not body.strip():
        raise InvalidMessageError("The email body is empty.")

    msg = EmailMessage(policy=SMTP)
    msg["From"] = formataddr(("", sender))
    msg["To"] = recipient
    msg["Subject"] = subject.strip()
    msg.set_content(body, subtype="plain", charset="utf-8")
    if attachment is not None:
        if attachment.file_type not in MIME_TYPES:
            raise InvalidMessageError("Only PDF and Word resumes can be attached.")
        name = CONTROL_RE.sub("", attachment.filename).strip() or f"resume.{attachment.file_type}"
        maintype, subtype = MIME_TYPES[attachment.file_type]
        msg.add_attachment(attachment.content, maintype=maintype, subtype=subtype, filename=name)
    return msg.as_bytes()
