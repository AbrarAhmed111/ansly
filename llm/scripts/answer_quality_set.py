"""
Answer quality regression set: representative application questions for the
fictional candidate in scripts/benchmark_data.py, each with the factual
constraints a correct answer must meet. scripts/eval_answers.py runs them
through the real engine and checks every constraint automatically; run it
before and after any model-routing or prompt change.

Every answer is also checked for grounding: each number and each name
(capitalized word mid-sentence) must appear in the profile, the job or the
question.
"""

from dataclasses import dataclass, field
from typing import List, Optional

ANSWERED, INSUFFICIENT, EITHER = "answered", "insufficient_information", "either"


@dataclass
class QualityCase:
    id: str
    kind: str
    question: str
    field_kind: str = "textarea"
    max_length: Optional[int] = None
    options: Optional[List[str]] = None
    status: str = ANSWERED
    # At least one of these must appear (case-insensitive), when the answer is answered.
    must_include: List[str] = field(default_factory=list)
    # None of these may appear.
    must_not_include: List[str] = field(default_factory=list)
    min_words: int = 0


CASES = [
    QualityCase("factual-title", "factual", "What is your current job title?", "input",
                must_include=["Senior Software Engineer"]),
    QualityCase("skill-yes", "skills", "Do you have experience with Terraform?", "choice_single",
                options=["Yes", "No"], must_include=["Yes"]),
    QualityCase("skill-declined", "skills", "Describe your experience with Kubernetes.",
                status=EITHER, must_not_include=["years of Kubernetes", "deployed Kubernetes", "managed Kubernetes"]),
    QualityCase("tech-fastapi", "technical experience", "What experience do you have with FastAPI?",
                must_include=["Harborline", "DocQuery", "ingestion"]),
    QualityCase("tech-postgres-limited", "character-limited", "Describe your experience with PostgreSQL.",
                max_length=300, must_include=["PostgreSQL", "Postgres"]),
    QualityCase("behavioral-conflict", "behavioral", "Describe a time you disagreed with a teammate.",
                must_include=["Copperleaf", "spike", "Go"]),
    QualityCase("behavioral-failure", "behavioral", "Tell us about a time you failed and what you learned.",
                must_include=["migration", "post-mortem", "postmortem"]),
    QualityCase("leadership", "leadership", "Give an example of a time you led a team or project.",
                must_include=["reporting", "three engineers", "mentor"]),
    QualityCase("project", "project", "Describe a project you're proud of.",
                must_include=["DocQuery", "ShiftSwap", "infra-starter", "booking", "reporting"]),
    QualityCase("motivation", "motivation", "Why do you want to work at Lumenfield?",
                must_include=["Lumenfield"]),
    QualityCase("company-specific", "company-specific", "What do you know about our product?",
                status=EITHER, must_not_include=["founded in", "Series"]),
    QualityCase("long-form", "long-form", "Cover letter", min_words=150, must_include=["Lumenfield"]),
    QualityCase("char-limited-why", "character-limited", "Why are you a good fit for this role?", max_length=250),
    QualityCase("no-evidence", "behavioral", "Tell us about a time you managed a budget of over $1M.",
                status=EITHER, must_not_include=["$1M budget I managed", "managed a $"]),
]
