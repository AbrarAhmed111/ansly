"""
Job, Search and Application API Schemas.
Keep in sync with packages/types/src/api.ts.
"""

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class RefreshMatchesResponse(BaseModel):
    matched: int
    by_tier: Dict[str, int]
    new_alerts: int
    computed_at: str


class SearchFilters(BaseModel):
    roles: List[str] = Field(default_factory=list, max_length=20)
    skills: List[str] = Field(default_factory=list, max_length=30)
    workplace: List[Literal["remote", "hybrid", "onsite"]] = Field(default_factory=list)
    locations: List[str] = Field(default_factory=list, max_length=20)
    experience_years: Optional[int] = Field(default=None, ge=0, le=50)
    min_salary: Optional[int] = Field(default=None, ge=0)
    employment_types: List[Literal["full_time", "part_time", "contract", "internship", "temporary"]] = Field(
        default_factory=list
    )


class ParseSearchRequest(BaseModel):
    query: str = Field(min_length=2, max_length=500)


class ParseSearchResponse(BaseModel):
    name: str
    filters: SearchFilters


class CreateSavedSearchRequest(BaseModel):
    query: str = Field(min_length=2, max_length=500)
    name: Optional[str] = Field(default=None, max_length=120)
    # Filters the user edited after previewing; parsed from the query when omitted.
    filters: Optional[SearchFilters] = None
    alerts_enabled: bool = True


class PrepareApplicationResponse(BaseModel):
    application: Dict[str, Any]
    answers: List[Dict[str, Any]]
    llm_available: bool


class SaveApplicationAnswerRequest(BaseModel):
    question: str = Field(min_length=2, max_length=2000)
    answer: str = Field(min_length=1, max_length=20_000)
    category: Optional[str] = Field(default=None, max_length=50)
    source: Literal["prepared", "extension", "manual"] = "extension"
