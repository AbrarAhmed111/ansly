"""
Answer API Schemas.
Keep in sync with packages/types/src/api.ts.
"""

from typing import List, Literal, Optional, Union

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
    # The element type (popover) or the detected field kind (fill all).
    kind: Optional[Literal[
        "textarea", "input", "contenteditable", "open_text", "short_text", "choice_single", "choice_multi", "number",
    ]] = None
    # For choice fields: the answer must be one of these.
    options: Optional[List[str]] = Field(default=None, max_length=200)

    @property
    def is_choice(self) -> bool:
        return self.kind in ("choice_single", "choice_multi") and bool(self.options)

    @property
    def single_line(self) -> bool:
        return self.kind in ("input", "short_text", "number")


AnswerLength = Literal["auto", "concise", "standard", "detailed"]
AnswerTone = Literal["professional", "friendly", "enthusiastic", "confident", "formal", "technical"]


class AnswerStyle(BaseModel):
    """Length and tone; "auto" length means the question category's default."""

    length: AnswerLength = "auto"
    tone: AnswerTone = "professional"
    instruction: Optional[str] = Field(default=None, max_length=500)


class GenerateAnswerRequest(BaseModel):
    question: str = Field(min_length=2, max_length=2000)
    job_context: Optional[JobContext] = None
    field: Optional[FieldContext] = None
    style: Optional[AnswerStyle] = None
    # Facts the candidate just gave without saving them to their profile.
    additional_facts: Optional[List[str]] = Field(default=None, max_length=10)


class RegenerateAnswerRequest(GenerateAnswerRequest):
    previous_answer: str = Field(min_length=1, max_length=20_000)
    instruction: Optional[str] = Field(default=None, max_length=500)


class UsedSource(BaseModel):
    type: Literal["profile", "experience", "project", "skill", "education", "achievement", "fact"]
    id: str
    label: str


ProfileField = Literal[
    "work_authorization", "requires_sponsorship", "notice_period", "salary_expectation", "willing_to_relocate",
    "preferred_work_mode",
]


class ProfileFieldTarget(BaseModel):
    type: Literal["profile_field"] = "profile_field"
    field: ProfileField


class SkillTarget(BaseModel):
    type: Literal["skill"] = "skill"
    name: str = Field(min_length=1, max_length=100)


class FactTarget(BaseModel):
    type: Literal["fact"] = "fact"
    category: str = Field(min_length=1, max_length=50)


MissingTarget = Union[ProfileFieldTarget, SkillTarget, FactTarget]


class MissingInfo(BaseModel):
    """A gap the extension can ask about inline, and where the answer is saved."""

    key: str
    prompt: str
    input: Literal["text", "textarea", "select", "boolean", "number", "skill"]
    options: Optional[List[str]] = None
    target: MissingTarget = Field(discriminator="type")


class AnswerResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    status: Literal["answered", "insufficient_information"]
    answer: str
    confidence: Literal["high", "medium", "low"]
    used_sources: List[UsedSource] = Field(serialization_alias="usedSources")
    missing_information: Optional[str] = Field(serialization_alias="missingInformation")
    missing: List[MissingInfo] = Field(default_factory=list)
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
    kind: Literal["fill", "use_saved_answer", "fill_all", "job_detected", "resume_previewed"]
    category: Optional[str] = Field(default=None, max_length=50)


class BatchItem(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    question: str = Field(min_length=2, max_length=2000)
    field: Optional[FieldContext] = None
    additional_facts: Optional[List[str]] = Field(default=None, max_length=10)


class GenerateBatchRequest(BaseModel):
    job_context: Optional[JobContext] = None
    style: Optional[AnswerStyle] = None
    items: List[BatchItem] = Field(min_length=1, max_length=50)


class BatchAnswer(AnswerResponse):
    id: str
    # Set when this question couldn't be generated at all (the others still are).
    error: Optional[str] = None


class GenerateBatchResponse(BaseModel):
    results: List[BatchAnswer]


class MatchBatchItem(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    question: str = Field(min_length=2, max_length=2000)


class MatchSavedBatchRequest(BaseModel):
    items: List[MatchBatchItem] = Field(min_length=1, max_length=50)


class SkillAnswer(BaseModel):
    have: bool
    years: Optional[float] = Field(default=None, ge=0, le=60)
    level: Optional[Literal["beginner", "intermediate", "advanced", "expert"]] = None


class MissingValue(BaseModel):
    key: str = Field(max_length=200)
    target: MissingTarget = Field(discriminator="type")
    value: Union[bool, SkillAnswer, str]
    # The question that was asked; stored with facts so they read well on /profile/additional.
    prompt: Optional[str] = Field(default=None, max_length=1000)


class SaveMissingRequest(BaseModel):
    items: List[MissingValue] = Field(min_length=1, max_length=20)
