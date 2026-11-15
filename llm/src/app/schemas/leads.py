"""Lead API schemas."""

from datetime import datetime
from typing import List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

LeadStatus = Literal["new", "contacted"]
Contactability = Literal[
    "email_available",
    "application_link_available",
    "dm_only",
    "contact_form_available",
    "no_contact_information_found",
    "unknown",
]
OpportunityType = Literal["job", "contract", "freelance", "consulting", "startup", "part_time"]
SourcePlatform = Literal["linkedin", "twitter", "reddit", "other"]


class LeadContactInfo(BaseModel):
    email: Optional[str] = None
    profile_url: Optional[str] = None
    company_url: Optional[str] = None
    application_url: Optional[str] = None
    contact_form_url: Optional[str] = None


class LeadProfileSnapshot(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    target_roles: List[str] = Field(default_factory=list)
    keywords: List[str] = Field(default_factory=list)


class LeadRecord(BaseModel):
    id: UUID
    user_id: UUID
    source_post_id: Optional[str] = None
    targeting_profile_id: Optional[UUID] = None
    collection_session_id: Optional[UUID] = None
    source_platform: SourcePlatform
    source_name: str
    author_name: str
    author_profile_url: Optional[str] = None
    company_name: str
    title: str
    opportunity_type: OpportunityType
    status: LeadStatus = "new"
    contactability: Contactability = "unknown"
    description: str
    publication_date: Optional[str] = None
    collected_at: Optional[str] = None
    original_post_url: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    profile_snapshot: Optional[LeadProfileSnapshot] = None
    contact_info: Optional[LeadContactInfo] = None
    confidence: Optional[float] = None
    qualification_reason: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class LeadListResponse(BaseModel):
    leads: List[LeadRecord] = Field(default_factory=list)


class CreateLeadRequest(BaseModel):
    source_platform: SourcePlatform
    source_name: str = Field(min_length=1, max_length=200)
    author_name: str = Field(min_length=1, max_length=200)
    author_profile_url: Optional[str] = Field(default=None, max_length=2000)
    company_name: str = Field(min_length=1, max_length=200)
    title: str = Field(min_length=1, max_length=300)
    opportunity_type: OpportunityType
    status: LeadStatus = "new"
    contactability: Contactability = "unknown"
    description: str = Field(min_length=1, max_length=10_000)
    publication_date: Optional[str] = None
    collected_at: Optional[str] = None
    original_post_url: Optional[str] = Field(default=None, max_length=2000)
    tags: List[str] = Field(default_factory=list)
    profile_snapshot: Optional[LeadProfileSnapshot] = None
    contact_info: Optional[LeadContactInfo] = None
    confidence: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    qualification_reason: Optional[str] = Field(default=None, max_length=5000)


MAX_POST_CANDIDATES = 100


class LinkedInPostCandidate(BaseModel):
    """One post the extension read from a LinkedIn search page the user loaded."""

    model_config = ConfigDict(extra="forbid")

    source_post_id: Optional[str] = Field(default=None, max_length=64)
    original_post_url: Optional[str] = Field(default=None, max_length=2000)
    author_name: Optional[str] = Field(default=None, max_length=200)
    author_profile_url: Optional[str] = Field(default=None, max_length=2000)
    post_text: str = Field(min_length=1, max_length=5000)
    published_at: Optional[datetime] = None


class CollectLinkedInPostsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    targeting_profile_id: Optional[UUID] = None
    loaded_count: int = Field(ge=0, le=MAX_POST_CANDIDATES)
    candidates: List[LinkedInPostCandidate] = Field(max_length=MAX_POST_CANDIDATES)


class CollectLinkedInPostsResponse(BaseModel):
    session_id: UUID
    status: Literal["completed", "partially_completed"]
    loaded_count: int
    extracted_count: int
    unidentified_count: int
    relevant_count: int
    filtered_count: int
    duplicate_count: int
    saved_count: int
    leads: List[LeadRecord] = Field(default_factory=list)


MAX_CLEANUP_LEADS = 50


class CleanupRequest(BaseModel):
    """One chunk of the user's leads for Ansly Cleanup (the dashboard sends all of them, chunk by chunk)."""

    model_config = ConfigDict(extra="forbid")

    lead_ids: List[UUID] = Field(min_length=1, max_length=MAX_CLEANUP_LEADS)


class CleanupResult(BaseModel):
    lead_id: UUID
    # removed: deleted now (a confident non-match). review: Ansly would remove it but the user decides. kept.
    outcome: Literal["removed", "review", "kept"]
    category: Literal["job_seeker", "stack_mismatch", "not_hiring", "match", "unclear"]
    reason: str
    included_keywords: List[str] = Field(default_factory=list)
    excluded_keywords: List[str] = Field(default_factory=list)
    # Title and post text, for removed and review leads only (kept ones are already on the page).
    title: Optional[str] = None
    description: Optional[str] = None
    contacted: bool = False
    # False when the AI couldn't check this lead (it is kept).
    checked: bool = True


class CleanupResponse(BaseModel):
    results: List[CleanupResult]
    removed: int
    review: int
    kept: int
    unchecked: int
