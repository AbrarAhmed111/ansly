"""
Evidence and Requirement Matching Schemas (v1.2 resume tailoring).
Keep in sync with packages/types/src/matching.ts.
"""

from typing import List, Literal, Optional

from pydantic import Field

from src.app.schemas.resume import CamelModel

EvidenceSource = Literal["profile", "experience", "project", "skill", "education", "achievement", "fact", "resume"]
SupportLevel = Literal["strong", "partial", "none"]
RequirementPriority = Literal["must_have", "nice_to_have"]


class Evidence(CamelModel):
    id: str
    source: EvidenceSource
    source_id: str
    label: str
    text: str
    skills: List[str] = Field(default_factory=list)


class RequirementMatch(CamelModel):
    requirement_id: str
    requirement: str
    priority: RequirementPriority
    support: SupportLevel
    evidence_ids: List[str] = Field(default_factory=list)
    method: Literal["deterministic", "semantic"]
    note: Optional[str] = None


class MatchSummary(CamelModel):
    analyzed: int
    supported: int
    partial: int
    unsupported: int


class MatchAnalysis(CamelModel):
    matches: List[RequirementMatch]
    evidence: List[Evidence]
    # Canonical names of skills the user said they don't have; never evidence.
    declined_skills: List[str] = Field(default_factory=list)
