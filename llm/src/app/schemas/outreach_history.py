"""Shared API representation of a previous successful outreach contact."""

from typing import Optional

from pydantic import BaseModel


class PreviousContact(BaseModel):
    history_id: Optional[str] = None
    recipient_email: str
    role_title: str
    company_name: Optional[str] = None
    source: str
    sent_at: Optional[str] = None
