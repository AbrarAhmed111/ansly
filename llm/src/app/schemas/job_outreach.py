"""Job Outreach analysis, draft, and send API schemas."""

from typing import Any, Dict, List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AnalyzeJobOutreachRequest(Strict):
    id: UUID
    job_text: str = Field(min_length=30, max_length=20000)


class ComposeJobOutreachRequest(Strict):
    mode: Literal["analyze", "analyze_and_send"]


class SendJobOutreachRequest(Strict):
    automatic: bool = False
    recipient_email: Optional[str] = Field(default=None, max_length=320)
    subject: Optional[str] = Field(default=None, max_length=200)
    body: Optional[str] = Field(default=None, max_length=10000)
    resume_id: Optional[UUID] = None


class JobOutreachResume(BaseModel):
    id: UUID
    label: Optional[str] = None
    name: str
    file_name: Optional[str] = None
    file_type: Literal["pdf", "docx"]


class JobOutreachResponse(BaseModel):
    id: UUID
    status: Literal["analyzing", "analyzed", "draft", "needs_review", "sending", "sent", "failed"]
    job_info: Dict[str, Any] = Field(default_factory=dict)
    recipient_email: Optional[str] = None
    subject: str = ""
    body: str = ""
    resume_id: Optional[UUID] = None
    resume_selection: Literal["auto", "user", "needs_selection"] = "needs_selection"
    match_confidence: Optional[Literal["high", "medium", "low", "none"]] = None
    match_reason: Optional[str] = None
    recommended_resume: Optional[JobOutreachResume] = None
    resumes: List[JobOutreachResume] = Field(default_factory=list)
    review_reasons: List[str] = Field(default_factory=list)
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    sent_at: Optional[str] = None
    can_auto_send: bool = False
    can_send: bool = False
