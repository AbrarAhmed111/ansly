"""Builds the RFC 5322 message for one email, plain text, optional CC, and optional attachment."""

import re
from dataclasses import dataclass
from email.message import EmailMessage
from email.policy import SMTP
from email.utils import formataddr
from typing import Iterable, Optional, Union

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


def normalize_addresses(addresses: Union[str, Iterable[str], None]) -> list[str]:
    """Parse a single address or an address list and remove duplicates while preserving order."""
    if addresses is None:
        return []
    if isinstance(addresses, str):
        values = re.split(r"[,;\s]+", addresses)
    else:
        values = []
        for value in addresses:
            values.extend(re.split(r"[,;\s]+", str(value)))
    result = []
    seen = set()
    for value in values:
        address = value.strip()
        if address and valid_email(address) and address.casefold() not in seen:
            seen.add(address.casefold())
            result.append(address)
    return result


def build_message(sender: str, recipient: Union[str, Iterable[str]], subject: str, body: str,
                  attachment: Optional[Attachment] = None, cc: Optional[Union[str, Iterable[str]]] = None) -> bytes:
    recipients = normalize_addresses(recipient)
    cc_recipients = normalize_addresses(cc)
    if not recipients:
        raise InvalidMessageError("At least one valid recipient is required.")
    if isinstance(recipient, str):
        raw_recipient_values = re.split(r"[,;\s]+", recipient)
    else:
        raw_recipient_values = []
        for value in recipient:
            raw_recipient_values.extend(re.split(r"[,;\s]+", str(value)))
    if any(not valid_email(value.strip()) for value in raw_recipient_values if value.strip()):
        raise InvalidMessageError("One of the recipient addresses is invalid.")
    if isinstance(cc, str):
        raw_cc_values = re.split(r"[,;\s]+", cc)
    elif cc is not None:
        raw_cc_values = []
        for value in cc:
            raw_cc_values.extend(re.split(r"[,;\s]+", str(value)))
    else:
        raw_cc_values = []
    if any(not valid_email(value.strip()) for value in raw_cc_values if value.strip()):
        raise InvalidMessageError("One of the CC addresses is invalid.")
    if any(address.casefold() in {item.casefold() for item in cc_recipients} for address in recipients):
        raise InvalidMessageError("An address cannot be both a To and CC recipient.")
    if not valid_email(sender):
        raise InvalidMessageError("The connected sending address isn't valid.")
    if not subject.strip() or CONTROL_RE.search(subject):
        raise InvalidMessageError("The subject is empty or contains line breaks.")
    if not body.strip():
        raise InvalidMessageError("The email body is empty.")

    msg = EmailMessage(policy=SMTP)
    msg["From"] = formataddr(("", sender))
    msg["To"] = ", ".join(recipients)
    if cc_recipients:
        msg["Cc"] = ", ".join(cc_recipients)
    msg["Subject"] = subject.strip()
    msg.set_content(body, subtype="plain", charset="utf-8")
    if attachment is not None:
        if attachment.file_type not in MIME_TYPES:
            raise InvalidMessageError("Only PDF and Word resumes can be attached.")
        name = CONTROL_RE.sub("", attachment.filename).strip() or f"resume.{attachment.file_type}"
        maintype, subtype = MIME_TYPES[attachment.file_type]
        msg.add_attachment(attachment.content, maintype=maintype, subtype=subtype, filename=name)
    return msg.as_bytes()


def build_message_legacy(sender: str, recipient: str, subject: str, body: str,
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
