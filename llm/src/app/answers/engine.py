"""
Answer Engine.

question -> classify -> retrieve relevant profile sections -> deterministic
grounding checks -> LLM (via the gateway, with fallback) -> validated answer.

Batches (fill all) fetch the profile once, run the deterministic checks per
question, and send the rest to the model in one call.
"""

import logging
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from src.app.core.config import get_settings
from src.app.db.rest import SupabaseRest
from src.app.gateway import GatewayUnavailableError, LLMGateway
from src.app.schemas.answers import (
    AnswerResponse,
    BatchAnswer,
    BatchItem,
    FactTarget,
    FieldContext,
    GenerateAnswerRequest,
    GenerateBatchRequest,
    JobContext,
    MissingInfo,
    ProfileFieldTarget,
    SkillTarget,
    UsedSource,
)

from .classifier import CATEGORY_SECTIONS, QuestionAnalysis, apply_field_signals, classify_question
from .parser import ParsedAnswer, match_option, parse_answer, parse_batch
from .profile_context import (
    ProfileContext,
    build_context,
    canonicalize,
    fetch_profile_data,
    logistics_value,
    missing_skills,
)
from .prompt import BATCH_SYSTEM_PROMPT, SYSTEM_PROMPT, build_batch_message, build_user_message

logger = logging.getLogger("AnswerEngine")

# Most questions one model call answers in a batch; larger batches are split.
BATCH_CHUNK = 10

LOGISTICS_LABELS = {
    "salary": "your salary expectation",
    "sponsorship": "whether you need visa sponsorship",
    "work_authorization": "your work authorization",
    "notice_period": "your notice period or availability",
    "relocation": "whether you're willing to relocate",
    "work_mode": "your preferred work mode (remote, hybrid, on-site)",
}

WORK_MODES = ["remote", "hybrid", "onsite", "flexible"]

# intent -> (profile column, input type, question to ask)
LOGISTICS_ASK = {
    "salary": ("salary_expectation", "text", "What is your salary expectation?"),
    "sponsorship": ("requires_sponsorship", "boolean", "Will you need visa sponsorship to work?"),
    "work_authorization": ("work_authorization", "text", "What is your work authorization (e.g. citizen, permanent resident, visa type)?"),
    "notice_period": ("notice_period", "text", "What is your notice period, or when can you start?"),
    "relocation": ("willing_to_relocate", "boolean", "Are you willing to relocate?"),
    "work_mode": ("preferred_work_mode", "select", "Which work mode do you prefer?"),
}


def job_text(job: Optional[JobContext]) -> Optional[str]:
    """What the job is about, for ranking the profile: its role and description."""
    if job is None:
        return None
    return "\n".join(x for x in [job.role, job.description] if x) or None


def _join(items: List[str]) -> str:
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " or " + items[-1]


def _as_written(question: str, skill: str) -> str:
    """The skill as the question spelled it ("Kubernetes", not "kubernetes")."""
    match = re.search(re.escape(skill).replace(r"\-", "[-/]"), question, re.IGNORECASE)
    return match.group(0) if match else skill


def logistics_missing(intent: str) -> Optional[MissingInfo]:
    if intent not in LOGISTICS_ASK:
        return None
    column, input_type, prompt = LOGISTICS_ASK[intent]
    return MissingInfo(
        key=column,
        prompt=prompt,
        input=input_type,
        options=WORK_MODES if input_type == "select" else None,
        target=ProfileFieldTarget(field=column),
    )


def skill_missing(name: str) -> MissingInfo:
    return MissingInfo(
        key=f"skill:{canonicalize(name)}", prompt=f"Have you used {name}?", input="skill", target=SkillTarget(name=name)
    )


def fact_missing(analysis: QuestionAnalysis, prompt: Optional[str]) -> MissingInfo:
    category = analysis.intent if analysis.intent != "general" else analysis.category
    return MissingInfo(
        key=f"fact:{category}",
        prompt=(prompt or analysis.question).strip(),
        input="textarea",
        target=FactTarget(category=category),
    )


def insufficient(analysis: QuestionAnalysis, missing: str, items: Optional[List[MissingInfo]] = None) -> AnswerResponse:
    return AnswerResponse(
        status="insufficient_information",
        answer="",
        confidence="high",
        used_sources=[],
        missing_information=missing,
        missing=items or [],
        category=analysis.category,
        intent=analysis.intent,
    )


def deterministic(analysis: QuestionAnalysis, answer: str, ctx: ProfileContext, source: str = "PR") -> AnswerResponse:
    """An answer that needed no model."""
    src = ctx.sources.get(source)
    return AnswerResponse(
        status="answered",
        answer=answer,
        confidence="high",
        used_sources=[UsedSource(type=src.type, id=src.id, label=src.label)] if src else [],
        missing_information=None,
        category=analysis.category,
        intent=analysis.intent,
    )


def _yes_no_option(options: List[str], yes: bool) -> Optional[str]:
    word = "yes" if yes else "no"
    hits = [o for o in options if re.match(rf"^\W*{word}\b", o.strip(), re.IGNORECASE)]
    return hits[0] if len(hits) == 1 else None


def deterministic_choice(intent: str, value: Any, options: List[str]) -> Optional[str]:
    """Picks the option a logistics preference implies, or None to let the model decide."""
    if isinstance(value, bool):
        return _yes_no_option(options, value)
    if intent == "work_mode" and isinstance(value, str):
        patterns = {"remote": r"remote", "hybrid": r"hybrid", "onsite": r"on[- ]?site|in[- ]office|office"}
        pattern = patterns.get(value)
        if pattern:
            hits = [o for o in options if re.search(pattern, o, re.IGNORECASE)]
            if len(hits) == 1:
                return hits[0]
        return None
    return match_option(str(value), options)


def precheck(analysis: QuestionAnalysis, ctx: ProfileContext, field: Optional[FieldContext] = None) -> Optional[AnswerResponse]:
    """Answers that need no model: questions the profile clearly cannot support, and choices it settles."""
    if analysis.category == "logistics":
        value = logistics_value(ctx.profile, analysis.intent)
        if value is None:
            label = LOGISTICS_LABELS.get(analysis.intent, "this preference")
            ask = logistics_missing(analysis.intent)
            return insufficient(
                analysis, f"Add {label} under Personal → Application preferences in your profile.", [ask] if ask else []
            )
        if field and field.is_choice and field.kind == "choice_single":
            option = deterministic_choice(analysis.intent, value, field.options or [])
            if option:
                return deterministic(analysis, option, ctx)
        return None

    if ctx.is_empty:
        return insufficient(analysis, "Your profile is empty. Add your experience, projects and skills first.")

    if analysis.category == "skill_check" and analysis.target_skills:
        missing = missing_skills(ctx, analysis.target_skills)
        if len(missing) == len(analysis.target_skills):
            unknown = [s for s in missing if not ctx.declined(s)]
            if not unknown:
                # The user told us they don't have it: answer honestly instead of asking again.
                names = _join([_as_written(analysis.question, s) for s in missing])
                if field and field.is_choice:
                    option = _yes_no_option(field.options or [], False)
                    if option:
                        return deterministic(analysis, option, ctx)
                if field and field.kind == "number":
                    return deterministic(analysis, "0", ctx)
                return deterministic(analysis, f"No, I haven't worked with {names}.", ctx)
            written = [_as_written(analysis.question, s) for s in unknown]
            return insufficient(
                analysis,
                f"Your profile doesn't mention {_join(written)}. If you've used it, add it to your skills "
                "and to the experience or project where you used it.",
                [skill_missing(s) for s in written],
            )
    return None


def _response(analysis: QuestionAnalysis, ctx: ProfileContext, parsed: ParsedAnswer, provider: Optional[str],
              model: Optional[str]) -> AnswerResponse:
    return AnswerResponse(
        status=parsed.status,
        answer=parsed.answer,
        confidence=parsed.confidence,
        used_sources=[
            UsedSource(type=ctx.sources[ref].type, id=ctx.sources[ref].id, label=ctx.sources[ref].label)
            for ref in parsed.used_refs
        ],
        missing_information=parsed.missing_information,
        missing=[fact_missing(analysis, parsed.missing_question)] if parsed.status == "insufficient_information" else [],
        category=analysis.category,
        intent=analysis.intent,
        provider=provider,
        model=model,
    )


def _analyze(question: str, field_ctx: Optional[FieldContext]) -> QuestionAnalysis:
    return apply_field_signals(
        classify_question(question), field_ctx.kind if field_ctx else None, field_ctx.max_length if field_ctx else None
    )


def _not_in_profile(ctx: ProfileContext, analysis: QuestionAnalysis) -> str:
    missing = missing_skills(ctx, analysis.target_skills) if analysis.target_skills else []
    if not missing:
        return ""
    return (
        "NOT IN THE PROFILE: " + ", ".join(missing)
        + ". Say plainly that the candidate hasn't listed these; don't claim experience with them."
    )


@dataclass
class BatchPlan:
    """A batch after the deterministic checks: what's answered and what still needs the model."""

    request: GenerateBatchRequest
    ctx: ProfileContext
    analyses: Dict[str, QuestionAnalysis]
    results: Dict[str, BatchAnswer] = field(default_factory=dict)
    pending: List[BatchItem] = field(default_factory=list)


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
        analysis = _analyze(request.question, request.field)
        data = await fetch_profile_data(rest, analysis)
        ctx = build_context(data, analysis, request.additional_facts, job_text=job_text(request.job_context))

        early = precheck(analysis, ctx, request.field)
        if early is not None:
            logger.info(f"Answered without LLM: {analysis.category}/{analysis.intent} -> {early.status}")
            return early

        user_message = build_user_message(
            analysis,
            ctx,
            request.job_context,
            request.field,
            previous_answer=previous_answer,
            instruction=instruction,
            job_description_max_chars=settings.JOB_DESCRIPTION_MAX_CHARS,
            style=request.style,
        )
        note = _not_in_profile(ctx, analysis)
        if note:
            user_message += "\n\n" + note

        max_length = request.field.max_length if request.field else None
        temperature = settings.LLM_TEMPERATURE + (0.3 if previous_answer else 0.0)
        result = await self.gateway.generate(
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_message}],
            temperature=min(temperature, 1.0),
            max_tokens=settings.LLM_MAX_TOKENS,
            validate=lambda text: parse_answer(text, ctx.sources, max_length, request.field),
        )
        return _response(analysis, ctx, result.value, result.provider, result.model)

    # --- batches (fill all) -------------------------------------------------------

    async def plan_batch(self, rest: SupabaseRest, request: GenerateBatchRequest) -> BatchPlan:
        """Fetches the profile once and answers what needs no model. `plan.pending` is what's left."""
        analyses = {item.id: _analyze(item.question, item.field) for item in request.items}
        order = list(CATEGORY_SECTIONS["general"])
        sections = [s for s in order if any(s in a.sections for a in analyses.values())]
        skills = list(dict.fromkeys(s for a in analyses.values() for s in a.target_skills))
        has_logistics = any(a.category == "logistics" for a in analyses.values())
        union = QuestionAnalysis(question="", category="general", intent="general", sections=sections,
                                 target_skills=skills)
        data = await fetch_profile_data(rest, union)
        facts = [f for item in request.items for f in (item.additional_facts or [])]
        ctx = build_context(data, union, facts, include_logistics=has_logistics, job_text=job_text(request.job_context))

        plan = BatchPlan(request=request, ctx=ctx, analyses=analyses)
        for item in request.items:
            early = precheck(analyses[item.id], ctx, item.field)
            if early is not None:
                plan.results[item.id] = BatchAnswer(id=item.id, **early.model_dump())
            else:
                plan.pending.append(item)
        return plan

    async def complete_batch(self, rest: SupabaseRest, plan: BatchPlan) -> List[BatchAnswer]:
        """Generates the pending answers, BATCH_CHUNK per model call, falling back to one call per question."""
        for start in range(0, len(plan.pending), BATCH_CHUNK):
            chunk = plan.pending[start:start + BATCH_CHUNK]
            parsed: Dict[str, Optional[ParsedAnswer]] = {}
            provider = model = None
            try:
                result = await self._generate_chunk(plan, chunk)
                parsed, provider, model = result.value, result.provider, result.model
            except GatewayUnavailableError as e:
                logger.warning(f"Batch generation failed, answering one by one: {e}")
            for item in chunk:
                answer = parsed.get(item.id)
                if answer is not None:
                    response = _response(plan.analyses[item.id], plan.ctx, answer, provider, model)
                    plan.results[item.id] = BatchAnswer(id=item.id, **response.model_dump())
                else:
                    plan.results[item.id] = await self._single(rest, plan, item)
        return [plan.results[item.id] for item in plan.request.items]

    async def _generate_chunk(self, plan: BatchPlan, chunk: List[BatchItem]):
        settings = get_settings()
        request = plan.request
        message = build_batch_message(
            [(item.id, plan.analyses[item.id], item.field) for item in chunk],
            plan.ctx,
            request.job_context,
            request.style,
            job_description_max_chars=settings.JOB_DESCRIPTION_MAX_CHARS,
        )
        notes = [n for n in (_not_in_profile(plan.ctx, plan.analyses[i.id]) for i in chunk) if n]
        if notes:
            message += "\n\n" + "\n".join(dict.fromkeys(notes))
        fields = {item.id: item.field for item in chunk}
        return await self.gateway.generate(
            system=BATCH_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": message}],
            temperature=settings.LLM_TEMPERATURE,
            max_tokens=min(max(settings.LLM_MAX_TOKENS, 700 * len(chunk)), 16_000),
            validate=lambda text: parse_batch(text, plan.ctx.sources, fields),
        )

    async def _single(self, rest: SupabaseRest, plan: BatchPlan, item: BatchItem) -> BatchAnswer:
        """Per-question fallback when the batch output was unusable for this question."""
        request = GenerateAnswerRequest(
            question=item.question,
            job_context=plan.request.job_context,
            field=item.field,
            style=plan.request.style,
            additional_facts=item.additional_facts,
        )
        try:
            response = await self.answer(rest, request)
        except (GatewayUnavailableError, ValueError) as e:
            logger.warning(f"Could not answer batch item {item.id}: {e}")
            analysis = plan.analyses[item.id]
            return BatchAnswer(
                id=item.id, status="insufficient_information", answer="", confidence="low", used_sources=[],
                missing_information=None, category=analysis.category, intent=analysis.intent,
                error="Couldn't generate this answer. Try it on its own.",
            )
        return BatchAnswer(id=item.id, **response.model_dump())
