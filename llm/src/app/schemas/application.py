from typing import Any, Dict, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")


ApplicationMode = Literal["normal", "aggressive"]
ApplicationRoute = Literal["email", "website"]
ApplicationPlatform = Literal[
    "indeed", "linkedin", "greenhouse", "lever", "workday", "ashby",
    "smartrecruiters", "workable", "bamboohr", "company", "unknown",
]
ApplicationStatus = Literal[
    "detected", "awaiting_authorization", "authorized", "analyzing_job",
    "email_route_check", "email_drafting", "email_sending", "email_sent",
    "matching_resume", "inspecting_application", "filling_application",
    "uploading_resume", "generating_cover_letter", "answering_questions",
    "navigating_steps", "human_intervention", "captcha_paused",
    "ready_to_submit", "submitting", "verifying_submission",
    "submitted", "failed", "cancelled",
]


class ApplicationAuthorization(CamelModel):
    granted_at: str
    route: Literal["email", "website", "email_then_website"]
    website_submission_allowed: bool
    behavior_mode: ApplicationMode
    job_url: str
    platform: ApplicationPlatform


class StartApplicationRequest(CamelModel):
    id: UUID
    job_key: str = Field(min_length=1, max_length=128)
    job_context_id: Optional[UUID] = None
    title: str = Field(min_length=1, max_length=300)
    company: Optional[str] = Field(default=None, max_length=300)
    job_url: Optional[str] = Field(default=None, max_length=2000)
    platform: ApplicationPlatform = "unknown"
    route: ApplicationRoute = "website"
    behavior_mode: ApplicationMode = "normal"


class AuthorizeApplicationRequest(CamelModel):
    route: Literal["email", "website", "email_then_website"]
    website_submission_allowed: bool = False


class ApplicationEventRequest(CamelModel):
    type: Literal["activity", "checkpoint", "intervention", "error"] = "activity"
    activity: str = Field(min_length=1, max_length=500)
    status: Literal["pending", "running", "completed", "needs_attention", "paused", "failed", "cancelled"]
    detail: Optional[str] = Field(default=None, max_length=2000)
    checkpoint_id: Optional[UUID] = None


class ApplicationCheckpointRequest(CamelModel):
    name: str = Field(min_length=1, max_length=100)
    status: Literal["pending", "completed", "failed"]
    page_fingerprint: Optional[str] = Field(default=None, max_length=128)
    page_url: Optional[str] = Field(default=None, max_length=2000)
    action_id: Optional[UUID] = None
    action_kind: Optional[str] = Field(default=None, max_length=100)
    before_fingerprint: Optional[str] = Field(default=None, max_length=128)
    after_fingerprint: Optional[str] = Field(default=None, max_length=128)
    detail: Dict[str, Any] = Field(default_factory=dict)


class ApplicationStatusRequest(CamelModel):
    status: ApplicationStatus


class ApplicationOutcomeRequest(CamelModel):
    status: Literal["email_sent", "submitted", "failed", "cancelled"]
    job_outreach_id: Optional[UUID] = None
    resume_id: Optional[UUID] = None
    selected_resume_name: Optional[str] = Field(default=None, max_length=300)
    recipient_email: Optional[str] = Field(default=None, max_length=1000)
    email_subject: Optional[str] = Field(default=None, max_length=200)
    provider_message_id: Optional[str] = Field(default=None, max_length=300)
    submission_evidence: Dict[str, Any] = Field(default_factory=dict)


class ApplicationRunResponse(CamelModel):
    id: UUID
    job_key: str
    job_context_id: Optional[UUID] = None
    job_outreach_id: Optional[UUID] = None
    title: str
    company: Optional[str] = None
    job_url: Optional[str] = None
    platform: ApplicationPlatform
    route: ApplicationRoute
    behavior_mode: ApplicationMode
    resume_id: Optional[UUID] = None
    status: ApplicationStatus
    authorization_data: Dict[str, Any] = Field(default_factory=dict)
    submission_evidence: Optional[Dict[str, Any]] = None
    selected_resume_name: Optional[str] = None
    recipient_email: Optional[str] = None
    email_subject: Optional[str] = None
    provider_message_id: Optional[str] = None
    started_at: str
    completed_at: Optional[str] = None
    created_at: str
    updated_at: str


class ApplicationEventResponse(CamelModel):
    id: UUID
    run_id: UUID
    type: str
    activity: str
    status: str
    detail: Optional[str] = None
    checkpoint_id: Optional[UUID] = None
    occurred_at: str


class ApplicationCheckpointResponse(CamelModel):
    id: UUID
    run_id: UUID
    name: str
    status: Literal["pending", "completed", "failed"]
    page_fingerprint: Optional[str] = None
    page_url: Optional[str] = None
    action_id: Optional[UUID] = None
    action_kind: Optional[str] = None
    before_fingerprint: Optional[str] = None
    after_fingerprint: Optional[str] = None
    detail: Dict[str, Any] = Field(default_factory=dict)
    created_at: str
    updated_at: str
