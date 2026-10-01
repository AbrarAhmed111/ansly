"""
Answer API Schemas.
Keep in sync with packages/types/src/api.ts.
"""

from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class JobContext(BaseModel):
    company: Optional[str] = Field(default=None, max_length=200)
    role: Optional[str] = Field(default=None, max_length=200)
    description: Optional[str] = Field(default=None, max_length=50_000)
    url: Optional[str] = Field(default=None, max_length=2000)


class FieldContext(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    label: Optional[str] = Field(default=None, max_length=1000)
    max_length: Optional[int] = Field(default=None, alias="maxLength", ge=1)
    kind: Optional[Literal["textarea", "input", "contenteditable"]] = None


class GenerateAnswerRequest(BaseModel):
    question: str = Field(min_length=2, max_length=2000)
    job_context: Optional[JobContext] = None
    field: Optional[FieldContext] = None
    # A tracked application: its job, requirements and earlier answers shape the answer.
    application_id: Optional[str] = Field(default=None, max_length=64)


class RegenerateAnswerRequest(GenerateAnswerRequest):
    previous_answer: str = Field(min_length=1, max_length=20_000)
    instruction: Optional[str] = Field(default=None, max_length=500)


class UsedSource(BaseModel):
    type: Literal["profile", "experience", "project", "skill", "education", "achievement"]
    id: str
    label: str


class AnswerResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    status: Literal["answered", "insufficient_information"]
    answer: str
    confidence: Literal["high", "medium", "low"]
    used_sources: List[UsedSource] = Field(serialization_alias="usedSources")
    missing_information: Optional[str] = Field(serialization_alias="missingInformation")
    category: str
    intent: str
    provider: Optional[str] = None
    model: Optional[str] = None


class MatchSavedAnswerRequest(BaseModel):
    question: str = Field(min_length=2, max_length=2000)


class CreateSavedAnswerRequest(BaseModel):
    question: str = Field(min_length=2, max_length=2000)
    answer: str = Field(min_length=1, max_length=20_000)
    category: Optional[str] = Field(default=None, max_length=50)
    company: Optional[str] = Field(default=None, max_length=200)
    role: Optional[str] = Field(default=None, max_length=200)


class TrackEventRequest(BaseModel):
    kind: Literal["fill", "use_saved_answer"]
    category: Optional[str] = Field(default=None, max_length=50)
