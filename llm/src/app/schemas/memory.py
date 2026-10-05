"""
Application Memory API Schemas.
Keep in sync with packages/types/src/memory.ts.
"""

from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from .answers import MemoryScope

MemorySourceType = Literal["profile", "skills", "ask_and_learn", "web", "onboarding", "memory_edit"]
MemoryStatus = Literal["active", "outdated", "superseded"]


class _Out(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class MemoryItem(_Out):
    # A profile_facts id, or "profile:<column>" for a profile preference, or "skill:<id>" for a declined skill.
    id: str
    key: Optional[str] = None
    label: str
    group: str
    value: str
    value_type: str = Field(serialization_alias="valueType")
    options: Optional[List[str]] = None
    scope: MemoryScope
    company: Optional[str] = None
    source_type: MemorySourceType = Field(serialization_alias="sourceType")
    # "Acme · Software Engineer": the application it was learned during.
    source_label: Optional[str] = Field(default=None, serialization_alias="sourceLabel")
    created_at: Optional[str] = Field(default=None, serialization_alias="createdAt")
    updated_at: Optional[str] = Field(default=None, serialization_alias="updatedAt")
    last_confirmed_at: Optional[str] = Field(default=None, serialization_alias="lastConfirmedAt")
    status: MemoryStatus = "active"
    # A drifting preference nobody confirmed for a while: the page asks "Still accurate?".
    stale: bool = False
    # Ansly answers questions about this fact directly, without the model.
    answers_directly: bool = Field(default=False, serialization_alias="answersDirectly")


class MemoryConflict(_Out):
    key: str
    label: str
    winner: str
    winner_source: str = Field(serialization_alias="winnerSource")
    other: str
    other_source: str = Field(serialization_alias="otherSource")
    other_id: Optional[str] = Field(default=None, serialization_alias="otherId")
    rule: str


class MemoryResponse(_Out):
    items: List[MemoryItem]
    conflicts: List[MemoryConflict]
    groups: List[str]
    counts: Dict[str, int]


class UpdateMemoryRequest(BaseModel):
    value: Optional[str] = Field(default=None, max_length=5000)
    scope: Optional[MemoryScope] = None
    company: Optional[str] = Field(default=None, max_length=200)
    status: Optional[Literal["active", "outdated"]] = None


class ResolveConflictRequest(BaseModel):
    # The memory row in conflict.
    id: str = Field(max_length=100)
    # "profile": keep the profile, retire the memory. "memory": the memory value replaces the profile's.
    use: Literal["profile", "memory"]
