"""
Answer API Schemas.
Keep in sync with packages/types/src/api.ts.
"""

from typing import Any, Dict, List, Literal, Optional, Union
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class JobContext(BaseModel):
    # The stored job (POST /jobs/analyze's jobContextId), when the client has one: links answer usage to it.
    id: Optional[UUID] = None
    company: Optional[str] = Field(default=None, max_length=200)
    role: Optional[str] = Field(default=None, max_length=200)
    description: Optional[str] = Field(default=None, max_length=50_000)
    url: Optional[str] = Field(default=None, max_length=2000)


class FieldContext(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    label: Optional[str] = Field(default=None, max_length=1000)
    max_length: Optional[int] = Field(default=None, alias="maxLength", ge=1)
    # Limits stated in the field's helper text ("Max 250 words", "Minimum 100 characters").
    max_words: Optional[int] = Field(default=None, alias="maxWords", ge=1, le=5000)
    min_length: Optional[int] = Field(default=None, alias="minLength", ge=1)
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
    # A normalized Application Memory key (memory.keys.FACT_KEYS) for facts Ansly answers directly; None for free
    # text written for an open question.
    key: Optional[str] = Field(default=None, max_length=120)


MissingTarget = Union[ProfileFieldTarget, SkillTarget, FactTarget]

MemoryScope = Literal["global", "category", "company", "job"]


class MissingInfo(BaseModel):
    """A gap the extension can ask about inline, and where the answer is saved."""

    key: str
    prompt: str
    input: Literal["text", "textarea", "select", "choice", "boolean", "number", "skill"]
    options: Optional[List[str]] = None
    target: MissingTarget = Field(discriminator="type")
    # Ask-and-Learn groups questions (Work authorization, Relocation, Skills...) and suggests how long the answer
    # is remembered: "job" for answers about one employer, "category" for preferences that may vary.
    group: str = "Other"
    scope: MemoryScope = "global"
    # Short name for the fact ("Relocation"), for "Saved to your Application Memory".
    label: Optional[str] = None


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
    # Where the answer came from, for the UI's plain-language source: the structured profile or Application Memory
    # (no model), a saved answer (as is, or adapted to this job), or the model.
    origin: Optional[Literal["profile", "memory", "saved", "adapted", "generated"]] = None
    # Tokens the model used for this answer: recorded with the usage event, never sent to clients.
    tokens: Optional[int] = Field(default=None, exclude=True)


class ResolveAnswerResponse(BaseModel):
    """`POST /answers/resolve`: a similar saved answer if there is one, otherwise a generated answer."""

    model_config = ConfigDict(populate_by_name=True)

    saved_match: Optional[Dict[str, Any]] = Field(default=None, serialization_alias="savedMatch")
    score: float = 0.0
    answer: Optional[AnswerResponse] = None
    # Set when `answer` is a saved answer adapted to this job (its id), instead of a newly generated one.
    adapted_from: Optional[str] = Field(default=None, serialization_alias="adaptedFrom")


class MatchSavedAnswerRequest(BaseModel):
    question: str = Field(min_length=2, max_length=2000)


class CreateSavedAnswerRequest(BaseModel):
    question: str = Field(min_length=2, max_length=2000)
    answer: str = Field(min_length=1, max_length=20_000)
    category: Optional[str] = Field(default=None, max_length=50)
    company: Optional[str] = Field(default=None, max_length=200)
    role: Optional[str] = Field(default=None, max_length=200)


TrackKind = Literal[
    "fill", "use_saved_answer", "fill_all", "job_detected", "resume_previewed",
    "ask_and_learn_shown", "ask_and_learn_skipped", "fill_all_completed", "undo", "onboarding_step",
    "extension_connected", "first_answer",
]


class TrackEventRequest(BaseModel):
    kind: TrackKind
    category: Optional[str] = Field(default=None, max_length=50)
    # "fill": how long the user waited (field opened to answer shown), and whether they edited the answer first.
    duration_ms: Optional[int] = Field(default=None, ge=0, le=3_600_000)
    edited: Optional[bool] = None


class BatchItem(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    question: str = Field(min_length=2, max_length=2000)
    field: Optional[FieldContext] = None
    additional_facts: Optional[List[str]] = Field(default=None, max_length=10)


class GenerateBatchRequest(BaseModel):
    job_context: Optional[JobContext] = None
    style: Optional[AnswerStyle] = None
    items: List[BatchItem] = Field(min_length=1, max_length=50)
    # Answer free-text questions from the user's saved answers first (adapted to this job when they were written
    # for another one), so the client needn't match them separately.
    check_saved: bool = False


class BatchAnswer(AnswerResponse):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    # Set when this question couldn't be generated at all (the others still are).
    error: Optional[str] = None
    # The saved answer this result came from: used as is, or adapted to this job (then adapted_from is set too).
    saved_answer_id: Optional[str] = Field(default=None, serialization_alias="savedAnswerId")
    adapted_from: Optional[str] = Field(default=None, serialization_alias="adaptedFrom")


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
    # The question that was asked; stored with free-text facts so they read well in Application Memory.
    prompt: Optional[str] = Field(default=None, max_length=1000)
    # How long it's remembered. None: the profile for profile fields, everything else globally (older clients).
    scope: Optional[MemoryScope] = None


class SaveMissingRequest(BaseModel):
    items: List[MissingValue] = Field(min_length=1, max_length=20)
    # The application the facts were given for: company and job scopes, and provenance ("Asked during an
    # application to Acme"). Only the company, role and URL are used; no description is stored.
    job_context: Optional[JobContext] = None
    # Where the answers were given: inline while applying, or in the web app's setup.
    source: Literal["ask_and_learn", "onboarding"] = "ask_and_learn"


RewriteAction = Literal[
    "shorter", "longer", "natural", "professional", "concise", "technical", "confident", "simpler", "fit", "custom",
]


class RewriteRequest(BaseModel):
    """`POST /answers/rewrite`: transforms an existing answer (the user's latest edit) without rebuilding it."""

    text: str = Field(min_length=1, max_length=20_000)
    action: RewriteAction
    # Required for "custom": e.g. "make this more direct and emphasize backend experience".
    instruction: Optional[str] = Field(default=None, max_length=500)
    question: Optional[str] = Field(default=None, max_length=2000)
    field: Optional[FieldContext] = None
    # Only the company and role are used (a rewrite never needs the description).
    job_context: Optional[JobContext] = None


class RewriteResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    answer: str
    # False when the rewrite was rejected (it added facts, or no provider produced a valid one): `answer` is then
    # the original text, unchanged.
    changed: bool
    reason: Optional[str] = None
    tokens: Optional[int] = Field(default=None, exclude=True)
    provider: Optional[str] = Field(default=None, exclude=True)
