"""
Tailoring Plan, Validation and API Schemas (v1.2 resume tailoring).
Keep in sync with packages/types/src/tailoring.ts.
"""

from typing import List, Literal, Optional

from pydantic import Field

from src.app.schemas.matching import MatchSummary, RequirementMatch
from src.app.schemas.resume import CamelModel

TailoringStatus = Literal["queued", "analyzing", "matching", "tailoring", "validating", "rendering", "ready", "failed"]
TailoringAction = Literal[
    "reorder", "emphasize", "rewrite_bullet", "add_bullet", "select", "reduce", "align_terms", "update_summary",
    "update_headline",
]
ResumeSection = Literal["headline", "summary", "experience", "projects", "skills", "education", "achievements", "certifications"]
ValidationCheck = Literal[
    "protected_fields", "metrics", "unsupported_technology", "traceability", "keyword_integrity",
    "hallucination_review", "formatting", "document", "unverified_skill",
]
ValidationOutcome = Literal["reverted", "removed", "restored", "flagged", "warning"]


class TailoringChange(CamelModel):
    section: ResumeSection
    item: Optional[str] = Field(default=None, max_length=100)
    action: TailoringAction
    evidence_ids: List[str] = Field(default_factory=list, max_length=20)
    reason: str = Field(default="", max_length=500)
    position: Optional[int] = Field(default=None, ge=0)
    bullet_id: Optional[str] = Field(default=None, max_length=100)
    text: Optional[str] = Field(default=None, max_length=3000)
    values: Optional[List[str]] = Field(default=None, max_length=100)


class TailoringPlan(CamelModel):
    changes: List[TailoringChange] = Field(default_factory=list, max_length=60)


class ValidationIssue(CamelModel):
    check: ValidationCheck
    outcome: ValidationOutcome
    section: Optional[ResumeSection] = None
    item: Optional[str] = None
    message: str
    original: Optional[str] = None
    attempted: Optional[str] = None


class ChangeSummary(CamelModel):
    section: ResumeSection
    action: TailoringAction
    label: str


class TextDiff(CamelModel):
    """One rewritten bullet or summary, for the review screen's diff view."""

    section: ResumeSection
    item: Optional[str] = None
    item_label: str
    before: str
    after: str
    evidence_labels: List[str] = Field(default_factory=list)


class ValidationReport(CamelModel):
    issues: List[ValidationIssue] = Field(default_factory=list)
    page_count: Optional[int] = None
    # What survived validation, for the result card and the review screen's diff view.
    changes: List[ChangeSummary] = Field(default_factory=list)
    diffs: List[TextDiff] = Field(default_factory=list)


class StartTailoringRequest(CamelModel):
    job_context_id: str
    resume_id: Optional[str] = None


class StartTailoringResponse(CamelModel):
    id: str
    status: TailoringStatus


class TailoringDetail(CamelModel):
    requirements: List[RequirementMatch]
    diffs: List[TextDiff]
    issues: List[ValidationIssue]
    page_count: Optional[int] = None


class TailoringResponse(CamelModel):
    id: str
    status: TailoringStatus
    job_context_id: str
    job_title: str
    company: Optional[str] = None
    summary: Optional[MatchSummary] = None
    changes: List[ChangeSummary] = Field(default_factory=list)
    unsupported_requirements: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
    pipeline_version: str
    error: Optional[str] = None
    created_at: str
    detail: Optional[TailoringDetail] = None
    # Set while it runs (GET /tailorings/{id}): when to poll next.
    retry_after_ms: Optional[int] = None


class TailoringListItem(CamelModel):
    id: str
    status: TailoringStatus
    job_title: str
    company: Optional[str] = None
    has_file: bool
    created_at: str


class TailoringListResponse(CamelModel):
    items: List[TailoringListItem]


class TailoringDownloadResponse(CamelModel):
    url: str
    expires_in: int
    file_name: str


class TailoringFile(CamelModel):
    url: str
    file_name: str


class TailoringFilesResponse(CamelModel):
    """Short-lived URLs to render the preview from: the tailored file and the original it was made from."""

    format: Literal["docx", "pdf"]
    tailored: TailoringFile
    # None when that resume version was deleted.
    original: Optional[TailoringFile] = None
    expires_in: int
