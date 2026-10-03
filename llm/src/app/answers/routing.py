"""
Answer Complexity Routing.

Which stage (and so which model tier, see core/token_budget.STAGE_TIER) a single
generated answer runs on. Conservative: an answer is SIMPLE only when the
question asks about one concrete thing the evidence directly settles and the
answer is short:

  SIMPLE   "What experience do you have with FastAPI?" (one technology, found in
           the profile), "Tell us about your degree."
  COMPLEX  everything else: behavioral and motivation questions, several
           technologies, a technology the profile doesn't show, cover letters
           and "about me", long or detailed answers, custom instructions.

Simple answers run on the fast model only when FAST_MODEL_SIMPLE_ANSWERS is on;
otherwise they stay on the main model and only their token budget differs.
"""

from typing import Optional

from src.app.core.token_budget import ANSWER, ANSWER_COMPLEX, ANSWER_SIMPLE, REGENERATION
from src.app.schemas.answers import AnswerStyle, FieldContext

from .classifier import QuestionAnalysis
from .profile_context import ProfileContext

COMPLEX_CATEGORIES = {"cover_letter", "about_me"}
SIMPLE_INTENTS = {"skill_check", "skill_experience", "skill_years"}
# Above this many characters a field invites a long answer, which is not simple.
SIMPLE_MAX_CHARS = 1200


def is_simple(analysis: QuestionAnalysis, ctx: ProfileContext, field: Optional[FieldContext],
              style: Optional[AnswerStyle]) -> bool:
    if style and (style.length == "detailed" or (style.instruction or "").strip()):
        return False
    if field and field.max_length and field.max_length > SIMPLE_MAX_CHARS:
        return False
    if analysis.category == "skill_check":
        # One record naming the technology settles it, even if retrieval wanted two ("low confidence").
        return analysis.intent in SIMPLE_INTENTS and len(analysis.target_skills) == 1 \
            and not ctx.declined(analysis.target_skills[0]) and ctx.has_skill(analysis.target_skills[0])
    # Education: the degree rows are the whole answer (one degree reads as "low confidence" to retrieval, which
    # looks for two supporting records).
    return analysis.category == "education" and bool(ctx.rows.get("education"))


def answer_stage(analysis: QuestionAnalysis, ctx: ProfileContext, field: Optional[FieldContext],
                 style: Optional[AnswerStyle], regenerating: bool = False) -> str:
    if regenerating:
        return REGENERATION
    if analysis.category in COMPLEX_CATEGORIES:
        return ANSWER_COMPLEX
    return ANSWER_SIMPLE if is_simple(analysis, ctx, field, style) else ANSWER
