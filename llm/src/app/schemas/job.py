"""
Job Posting and Analysis Schemas (v1.2 resume tailoring).
Keep in sync with packages/types/src/job.ts.
"""

from typing import List, Literal, Optional

from pydantic import Field

from src.app.schemas.resume import CamelModel

JobSource = Literal["json-ld", "linkedin", "indeed", "generic", "manual"]
JobRequirementType = Literal["skill", "experience", "education", "certification", "domain", "soft_skill", "other"]


class JobPosting(CamelModel):
    """Only these fields are ever sent; never page HTML."""

    title: str = Field(min_length=1, max_length=300)
    company: str = Field(default="", max_length=300)
    location: Optional[str] = Field(default=None, max_length=300)
    employment_type: Optional[str] = Field(default=None, max_length=100)
    description: str = Field(max_length=50_000)
    url: str = Field(default="", max_length=2000)
    source: JobSource


class JobRequirement(CamelModel):
    id: str = Field(max_length=20)
    requirement: str = Field(min_length=1, max_length=300)
    type: JobRequirementType


class JobAnalysis(CamelModel):
    role: str = Field(max_length=300)
    company: str = Field(default="", max_length=300)
    must_have: List[JobRequirement] = Field(default_factory=list)
    nice_to_have: List[JobRequirement] = Field(default_factory=list)
    responsibilities: List[str] = Field(default_factory=list)
    min_years_experience: Optional[float] = None

    @property
    def requirements(self) -> List[JobRequirement]:
        return [*self.must_have, *self.nice_to_have]


class AnalyzeJobRequest(CamelModel):
    job: JobPosting


class AnalyzeJobResponse(CamelModel):
    job_context_id: str
    analysis: JobAnalysis
