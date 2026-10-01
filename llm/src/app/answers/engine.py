"""
Answer Engine.

question -> classify -> retrieve relevant profile sections -> deterministic
grounding checks -> LLM (via the gateway, with fallback) -> validated answer.
"""

import logging
import re
from typing import List, Optional

from src.app.applications.context import load_application_context
from src.app.core.config import get_settings
from src.app.db.rest import SupabaseRest
from src.app.gateway import LLMGateway
from src.app.schemas.answers import AnswerResponse, GenerateAnswerRequest, UsedSource

from .classifier import QuestionAnalysis, classify_question
from .parser import ParsedAnswer, parse_answer
from .profile_context import ProfileContext, build_context, fetch_profile_data, logistics_value, missing_skills
from .prompt import SYSTEM_PROMPT, build_user_message

logger = logging.getLogger("AnswerEngine")

LOGISTICS_LABELS = {
    "salary": "your salary expectation",
    "sponsorship": "whether you need visa sponsorship",
    "work_authorization": "your work authorization",
    "notice_period": "your notice period or availability",
    "relocation": "whether you're willing to relocate",
    "work_mode": "your preferred work mode (remote, hybrid, on-site)",
}


def _join(items: List[str]) -> str:
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " or " + items[-1]


def _as_written(question: str, skill: str) -> str:
    """The skill as the question spelled it ("Kubernetes", not "kubernetes")."""
    match = re.search(re.escape(skill).replace(r"\-", "[-/]"), question, re.IGNORECASE)
    return match.group(0) if match else skill


def insufficient(analysis: QuestionAnalysis, missing: str) -> AnswerResponse:
    return AnswerResponse(
        status="insufficient_information",
        answer="",
        confidence="high",
        used_sources=[],
        missing_information=missing,
        category=analysis.category,
        intent=analysis.intent,
    )


def precheck(analysis: QuestionAnalysis, ctx: ProfileContext) -> Optional[AnswerResponse]:
    """Answers that need no model: questions the profile clearly cannot support."""
    if analysis.category == "logistics":
        if logistics_value(ctx.profile, analysis.intent) is None:
            label = LOGISTICS_LABELS.get(analysis.intent, "this preference")
            return insufficient(analysis, f"Add {label} under Personal → Application preferences in your profile.")
        return None

    if ctx.is_empty:
        return insufficient(analysis, "Your profile is empty. Add your experience, projects and skills first.")

    if analysis.category == "skill_check" and analysis.target_skills:
        missing = missing_skills(ctx, analysis.target_skills)
        if len(missing) == len(analysis.target_skills):
            return insufficient(
                analysis,
                f"Your profile doesn't mention {_join([_as_written(analysis.question, s) for s in missing])}. If you've used it, add it to your skills "
                "and to the experience or project where you used it.",
            )
    return None


class AnswerEngine:
    def __init__(self, gateway: LLMGateway):
        self.gateway = gateway

    async def answer(
        self,
        rest: SupabaseRest,
        request: GenerateAnswerRequest,
        previous_answer: Optional[str] = None,
        instruction: Optional[str] = None,
    ) -> AnswerResponse:
        settings = get_settings()
        analysis = classify_question(request.question)
        data = await fetch_profile_data(rest, analysis)
        ctx = build_context(data, analysis)

        early = precheck(analysis, ctx)
        if early is not None:
            logger.info(f"Answered without LLM: {analysis.category}/{analysis.intent} -> {early.status}")
            return early

        # A tracked application supplies the job details, requirements and earlier answers.
        job_context, requirements, earlier = request.job_context, [], []
        if request.application_id:
            app_ctx = await load_application_context(rest, request.application_id, request.question)
            if app_ctx:
                job_context = app_ctx.job_context(request.job_context)
                requirements, earlier = app_ctx.requirements, app_ctx.earlier_answers

        user_message = build_user_message(
            analysis,
            ctx,
            job_context,
            request.field,
            previous_answer=previous_answer,
            instruction=instruction,
            job_description_max_chars=settings.JOB_DESCRIPTION_MAX_CHARS,
            requirements=requirements,
            earlier_answers=earlier,
        )
        if analysis.target_skills:
            missing = missing_skills(ctx, analysis.target_skills)
            if missing:
                user_message += (
                    "\n\nNOT IN THE PROFILE: " + ", ".join(missing)
                    + ". Say plainly that the candidate hasn't listed these; don't claim experience with them."
                )

        max_length = request.field.max_length if request.field else None
        temperature = settings.LLM_TEMPERATURE + (0.3 if previous_answer else 0.0)
        result = await self.gateway.generate(
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_message}],
            temperature=min(temperature, 1.0),
            max_tokens=settings.LLM_MAX_TOKENS,
            validate=lambda text: parse_answer(text, ctx.sources, max_length),
        )
        parsed: ParsedAnswer = result.value

        return AnswerResponse(
            status=parsed.status,
            answer=parsed.answer,
            confidence=parsed.confidence,
            used_sources=[
                UsedSource(type=ctx.sources[ref].type, id=ctx.sources[ref].id, label=ctx.sources[ref].label)
                for ref in parsed.used_refs
            ],
            missing_information=parsed.missing_information,
            category=analysis.category,
            intent=analysis.intent,
            provider=result.provider,
            model=result.model,
        )
