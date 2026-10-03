"""
Structured Resume JSON (v1.2 resume tailoring).
Keep in sync with packages/types/src/resume.ts; sample fixtures live in
packages/types/fixtures/structured-resume/.

Every resume is parsed into this and tailored as this; the tailored result is
then applied to a copy of the user's own Word document.
Dates stay as written on the resume so protected fields can be compared exactly.
"""

from typing import Iterator, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel

STRUCTURED_RESUME_SCHEMA_VERSION = 1


class CamelModel(BaseModel):
    """camelCase on the wire (matching the TS types), snake_case in Python."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")


class ResumeLink(CamelModel):
    label: str = Field(max_length=100)
    url: str = Field(max_length=2000)


class ResumeContact(CamelModel):
    name: str = Field(max_length=200)
    headline: Optional[str] = Field(default=None, max_length=300)
    email: Optional[str] = Field(default=None, max_length=320)
    phone: Optional[str] = Field(default=None, max_length=50)
    location: Optional[str] = Field(default=None, max_length=200)
    links: List[ResumeLink] = Field(default_factory=list, max_length=20)


class ResumeBullet(CamelModel):
    id: str = Field(min_length=1, max_length=100)
    text: str = Field(min_length=1, max_length=2000)


class ResumeExperience(CamelModel):
    id: str = Field(min_length=1, max_length=100)
    company: str = Field(min_length=1, max_length=300)
    title: str = Field(min_length=1, max_length=300)
    location: Optional[str] = Field(default=None, max_length=200)
    start_date: Optional[str] = Field(default=None, max_length=50)
    end_date: Optional[str] = Field(default=None, max_length=50)
    is_current: bool = False
    bullets: List[ResumeBullet] = Field(default_factory=list, max_length=50)
    technologies: List[str] = Field(default_factory=list, max_length=100)


class ResumeProject(CamelModel):
    id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=300)
    role: Optional[str] = Field(default=None, max_length=300)
    url: Optional[str] = Field(default=None, max_length=2000)
    start_date: Optional[str] = Field(default=None, max_length=50)
    end_date: Optional[str] = Field(default=None, max_length=50)
    bullets: List[ResumeBullet] = Field(default_factory=list, max_length=50)
    technologies: List[str] = Field(default_factory=list, max_length=100)


class ResumeSkillGroup(CamelModel):
    id: str = Field(min_length=1, max_length=100)
    label: Optional[str] = Field(default=None, max_length=100)
    items: List[str] = Field(default_factory=list, max_length=200)


class ResumeEducation(CamelModel):
    id: str = Field(min_length=1, max_length=100)
    institution: str = Field(min_length=1, max_length=300)
    degree: Optional[str] = Field(default=None, max_length=300)
    field_of_study: Optional[str] = Field(default=None, max_length=300)
    start_date: Optional[str] = Field(default=None, max_length=50)
    end_date: Optional[str] = Field(default=None, max_length=50)
    grade: Optional[str] = Field(default=None, max_length=100)
    bullets: List[ResumeBullet] = Field(default_factory=list, max_length=30)


class ResumeAchievement(CamelModel):
    id: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=1, max_length=300)
    description: Optional[str] = Field(default=None, max_length=2000)
    date: Optional[str] = Field(default=None, max_length=50)
    url: Optional[str] = Field(default=None, max_length=2000)


class ResumeCertification(CamelModel):
    id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=300)
    issuer: Optional[str] = Field(default=None, max_length=300)
    date: Optional[str] = Field(default=None, max_length=50)
    url: Optional[str] = Field(default=None, max_length=2000)


class ResumeCustomSection(CamelModel):
    id: str = Field(min_length=1, max_length=100)
    heading: str = Field(min_length=1, max_length=100)
    bullets: List[ResumeBullet] = Field(default_factory=list, max_length=50)


class StructuredResume(CamelModel):
    schema_version: Literal[1] = STRUCTURED_RESUME_SCHEMA_VERSION
    contact: ResumeContact
    summary: Optional[str] = Field(default=None, max_length=3000)
    experience: List[ResumeExperience] = Field(default_factory=list, max_length=50)
    projects: List[ResumeProject] = Field(default_factory=list, max_length=50)
    skills: List[ResumeSkillGroup] = Field(default_factory=list, max_length=30)
    education: List[ResumeEducation] = Field(default_factory=list, max_length=20)
    achievements: List[ResumeAchievement] = Field(default_factory=list, max_length=50)
    certifications: List[ResumeCertification] = Field(default_factory=list, max_length=50)
    custom_sections: List[ResumeCustomSection] = Field(default_factory=list, max_length=20)

    def iter_ids(self) -> Iterator[str]:
        """Every item and bullet id; tailoring plans and validation point at these."""
        for section in (self.experience, self.projects, self.education, self.custom_sections):
            for item in section:
                yield item.id
                yield from (bullet.id for bullet in item.bullets)
        for section in (self.skills, self.achievements, self.certifications):
            yield from (item.id for item in section)

    @model_validator(mode="after")
    def _ids_are_unique(self) -> "StructuredResume":
        seen = set()
        for item_id in self.iter_ids():
            if item_id in seen:
                raise ValueError(f"duplicate id in structured resume: {item_id}")
            seen.add(item_id)
        return self

    def to_json(self) -> dict:
        """The camelCase JSON stored in Supabase and sent to clients."""
        return self.model_dump(mode="json", by_alias=True)


# ---------------------------------------------------------------------------
# Resume API (keep in sync with packages/types/src/resume.ts)
# ---------------------------------------------------------------------------

# "pdf" only for versions uploaded before tailoring became DOCX-only; new uploads must be "docx".
ResumeFileType = Literal["pdf", "docx"]
ResumeParseStatus = Literal["pending", "parsed", "needs_review", "failed"]


class ResumeRecord(CamelModel):
    id: str
    name: str
    file_type: ResumeFileType
    parse_status: ResumeParseStatus
    parse_error: Optional[str] = None
    parsed_content: Optional[StructuredResume] = None
    version: int
    is_master: bool
    dismissed_discrepancies: List[str] = Field(default_factory=list)
    created_at: str
    updated_at: str

    @classmethod
    def from_row(cls, row: dict) -> "ResumeRecord":
        return cls(
            id=row["id"], name=row["name"], file_type=row["file_type"], parse_status=row["parse_status"],
            parse_error=row.get("parse_error"), parsed_content=row.get("parsed_content"), version=row["version"],
            is_master=row["is_master"], dismissed_discrepancies=list(row.get("dismissed_discrepancies") or []),
            created_at=str(row.get("created_at", "")),
            updated_at=str(row.get("updated_at", "")),
        )


class ResumeDiscrepancy(CamelModel):
    key: str
    field: Literal["title", "company", "dates", "skill", "education", "contact"]
    resume_value: Optional[str] = None
    profile_value: Optional[str] = None
    label: str


class CreateResumeRequest(CamelModel):
    name: str = Field(min_length=1, max_length=200)
    file_path: str = Field(min_length=1, max_length=1000)
    # Checked in the endpoint, so a PDF gets a clear message instead of a schema error.
    file_type: str = Field(min_length=1, max_length=20)


class MasterResumeResponse(CamelModel):
    resume: Optional[ResumeRecord] = None
    discrepancies: List[ResumeDiscrepancy] = Field(default_factory=list)


class UpdateResumeRequest(CamelModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    parsed_content: Optional[StructuredResume] = None
    dismissed_discrepancies: Optional[List[str]] = Field(default=None, max_length=500)


class ResumeListResponse(CamelModel):
    items: List[ResumeRecord]
