"""Lead email draft, sending, and email-connection API schemas (keep in sync with packages/types/src/leads.ts)."""

from typing import Any, Dict, List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from src.app.schemas.outreach_history import PreviousContact

ResumeSelection = Literal["auto", "user", "none_by_user", "needs_selection"]
DeliveryStatus = Literal["draft", "sending", "sent", "failed"]
Confidence = Literal["high", "medium", "low", "none"]
MAX_GENERATE_CHUNK = 10
MAX_SEND_CHUNK = 10


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class DraftResume(BaseModel):
    id: UUID
    label: Optional[str] = None
    name: str
    file_name: Optional[str] = None
    file_type: str
    file_size: Optional[int] = None


class EmailDraftRecord(BaseModel):
    id: UUID
    lead_id: UUID
    recipient_email: Optional[str] = None
    recipient_source: Literal["post", "user"] = "post"
    post_email: Optional[str] = None
    subject: str
    body: str
    resume: Optional[DraftResume] = None
    resume_selection: ResumeSelection
    match_confidence: Optional[Confidence] = None
    match_reason: Optional[str] = None
    detected_role: Optional[Dict[str, Any]] = None
    is_user_edited: bool = False
    approved: bool = False
    approved_at: Optional[str] = None
    delivery_status: DeliveryStatus
    sent_at: Optional[str] = None
    last_error_code: Optional[str] = None
    version: int
    updated_at: Optional[str] = None
    # What blocks sending this draft right now (not counting the Gmail connection).
    issues: List[str] = Field(default_factory=list)
    previous_contacts: List[PreviousContact] = Field(default_factory=list)


class EmailDraftListResponse(BaseModel):
    drafts: List[EmailDraftRecord] = Field(default_factory=list)


class GeneratePreviewRequest(Strict):
    lead_ids: List[UUID] = Field(default_factory=list, max_length=1000)
    all_eligible: bool = False


class GeneratePreviewResponse(BaseModel):
    eligible: int
    no_email: int
    existing_drafts: int
    eligible_lead_ids: List[UUID]
    preview_token: Optional[str] = None


class GenerateRequest(Strict):
    preview_token: str = Field(min_length=10, max_length=100_000)
    lead_ids: List[UUID] = Field(min_length=1, max_length=MAX_GENERATE_CHUNK)


class GenerateResult(BaseModel):
    lead_id: UUID
    outcome: Literal["created", "existing", "insufficient_evidence", "failed"]
    message: Optional[str] = None
    draft: Optional[EmailDraftRecord] = None


class GenerateResponse(BaseModel):
    results: List[GenerateResult]


class UpdateDraftRequest(Strict):
    expected_version: int = Field(ge=1)
    recipient_email: Optional[str] = Field(default=None, max_length=320)
    subject: Optional[str] = Field(default=None, max_length=200)
    body: Optional[str] = Field(default=None, max_length=10_000)
    # Attach this resume, or choose "send without a resume" explicitly.
    resume_id: Optional[UUID] = None
    send_without_resume: bool = False


class VersionRequest(Strict):
    expected_version: int = Field(ge=1)


class RegenerateRequest(Strict):
    expected_version: int = Field(ge=1)
    confirm_replace: bool = False
    confirm_discard_edits: bool = False
    rematch_resume: bool = False


class SendPreviewRequest(Strict):
    draft_ids: List[UUID] = Field(default_factory=list, max_length=1000)
    all_ready: bool = False
    # Include failed drafts (a retry). Drafts whose outcome is unknown need confirm_may_duplicate on send.
    retry: bool = False


class SendPreviewItem(BaseModel):
    draft_id: UUID
    lead_id: UUID
    recipient_email: str
    subject: str
    attachment_name: Optional[str] = None
    may_duplicate: bool = False
    previous_contacts: List[PreviousContact] = Field(default_factory=list)


class SendExcluded(BaseModel):
    draft_id: UUID
    lead_id: UUID
    issues: List[str]


class SendPreviewResponse(BaseModel):
    ready: List[SendPreviewItem]
    excluded: List[SendExcluded]
    connection_email: Optional[str] = None
    connection_issue: Optional[str] = None
    confirm_token: Optional[str] = None


class SendRequest(Strict):
    confirm_token: str = Field(min_length=10, max_length=200_000)
    draft_ids: List[UUID] = Field(min_length=1, max_length=MAX_SEND_CHUNK)
    confirm_may_duplicate: bool = False
    confirm_duplicate_draft_ids: List[UUID] = Field(default_factory=list, max_length=MAX_SEND_CHUNK)


class SendResult(BaseModel):
    draft_id: UUID
    lead_id: Optional[UUID] = None
    outcome: Literal["sent", "failed", "needs_review", "skipped", "not_attempted"]
    code: Optional[str] = None
    message: Optional[str] = None
    previous_contacts: List[PreviousContact] = Field(default_factory=list)


class SendResponse(BaseModel):
    results: List[SendResult]
    stopped: Optional[str] = None


class EmailConnectionResponse(BaseModel):
    configured: bool
    connected: bool
    provider: Optional[str] = None
    email_address: Optional[str] = None
    status: Optional[Literal["connected", "needs_reauth"]] = None
    granted_scopes: List[str] = Field(default_factory=list)


class ConnectRequest(Strict):
    login_hint: Optional[str] = Field(default=None, max_length=320)


class ConnectResponse(BaseModel):
    authorization_url: str


class CallbackRequest(Strict):
    code: str = Field(min_length=1, max_length=4096)
    state: str = Field(min_length=10, max_length=512)


class WriteAndSendRequest(Strict):
    preview_token: str = Field(min_length=10, max_length=100_000)
    lead_ids: List[UUID] = Field(min_length=1, max_length=MAX_GENERATE_CHUNK)
    # The user's explicit confirmation that confidently matched emails are sent without a separate review.
    confirm_send: bool = False


class WriteAndSendResult(BaseModel):
    lead_id: UUID
    outcome: Literal["sent", "needs_review", "failed", "skipped", "insufficient_evidence"]
    code: Optional[str] = None
    message: Optional[str] = None
    draft: Optional[EmailDraftRecord] = None
    previous_contacts: List[PreviousContact] = Field(default_factory=list)


class WriteAndSendResponse(BaseModel):
    results: List[WriteAndSendResult]
    stopped: Optional[str] = None


class RematchRequest(Strict):
    draft_ids: List[UUID] = Field(default_factory=list, max_length=25)


class RematchResponse(BaseModel):
    checked: int
    matched: int
    drafts: List[EmailDraftRecord] = Field(default_factory=list)
    # More waiting drafts remain beyond this batch (call again).
    more: bool = False


class ApproveReadyRequest(Strict):
    draft_ids: List[UUID] = Field(default_factory=list, max_length=1000)


class ApproveReadyResponse(BaseModel):
    approved: int
    drafts: List[EmailDraftRecord] = Field(default_factory=list)
