"""Lead API schemas."""

from typing import List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field

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


class CollectLeadsRequest(BaseModel):
    targeting_profile_id: UUID


class CollectLeadsResponse(BaseModel):
    session_id: UUID
    status: Literal["completed", "partially_completed"]
    queries_run: int
    total_candidates_reviewed: int
    relevant_candidates: int
    duplicates_skipped: int
    new_leads_saved: int
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
