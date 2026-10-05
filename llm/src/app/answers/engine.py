"""
Answer Engine.

question -> classify -> retrieve relevant profile sections -> deterministic
grounding checks -> LLM (via the gateway, with fallback) -> validated answer.

Batches (fill all) fetch the profile once, run the deterministic checks per
question, and send the rest to the model in one call.
"""

import asyncio
import hashlib
import inspect
import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple

from src.app.core import metrics
from src.app.core.config import get_settings
from src.app.core.token_budget import ANSWER_BATCH, job_key
from src.app.core.ttl_cache import TTLCache
from src.app.db.rest import SupabaseRest
from src.app.gateway import GatewayUnavailableError, LLMGateway
from src.app.memory.keys import CATEGORY_GROUPS, FACT_KEYS, INTENT_KEYS
from src.app.memory.service import Resolved, scope_facts
from src.app.schemas.answers import (
    AnswerResponse,
    AnswerStyle,
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

from .adapt import adapt_saved_answer, adaptation_reason
from .classifier import CATEGORY_SECTIONS, QuestionAnalysis, apply_field_signals, classify_question
from .lookup import HIGHEST_DEGREE_QUESTION, authorized_in_asked_country, highest_degree_option, skill_years
from .parser import ParsedAnswer, match_option, parse_answer, parse_batch
from .profile_context import (
    ProfileContext,
    build_context,
    canonicalize,
    fetch_profile_data,
    missing_skills,
)
from .prompt import BATCH_SYSTEM_PROMPT, SYSTEM_PROMPT, build_batch_message, build_user_message
from .routing import answer_stage
from .semantic import SEMANTIC_BOOST, SEMANTIC_CATEGORIES, SemanticRetriever
from .similarity import best_match

logger = logging.getLogger("AnswerEngine")

# Most questions one model call answers in a batch; larger batches are split into chunks run side by side.
BATCH_CHUNK = 10
CHUNK_CONCURRENCY = 3

# Questions per model call in a batch (see group_questions). Measured on the benchmark's Fill all (6 open-ended
# questions): one call 3,776 tokens, one call per question family (2 calls) 5,545; every extra call repeats the
# system prompt and job context, which costs more than narrower evidence saves. So calls are as few as possible
# (BATCH_BY_FAMILY off), with related questions kept together when a batch has to be split.
# Batch size, measured live (Gemini flash-lite, 10 long questions, scripts/benchmark_live.py): one call of 9
# took 4.4-4.6s for 4.2k tokens; two parallel calls of 5 + 4 took 2.9-3.9s for 5.1-5.3k. Six keeps a typical form
# in one call and splits bigger ones into parallel calls the user waits less for.
BATCH_GROUP_SIZE = 6
BATCH_BY_FAMILY = False

# Generated answers, reused when the same question is asked again with the same inputs (reopening a field's
# popover, or opening one Fill all already answered). The key covers what the prompt is built from, the exact
# profile rows the answer was built from and the prompt version, so a changed profile, job or style always
# generates afresh. Regenerations never use it.
#
# Variations that can't change the prompt don't split the key: case, spacing and trailing punctuation of the
# question; the job's id and URL (the prompt uses its company, role and description); the label repeated from
# the question; the field kinds the prompt treats alike (a popover's "textarea" and Fill all's "open_text");
# no style and the default style. Differently worded questions ("Why do you want to work here?" / "Why are you
# interested in this company?") stay distinct: their answers may differ, and saved answers cover reuse across
# wordings. Answers are never shared across jobs: every answer prompt carries the job's context.
ANSWER_CACHE_SECONDS = 600
_answer_cache: TTLCache[AnswerResponse] = TTLCache(ANSWER_CACHE_SECONDS, max_entries=1000)
_PROMPT_VERSION = hashlib.sha256((SYSTEM_PROMPT + BATCH_SYSTEM_PROMPT).encode()).hexdigest()[:12]
_KIND_CLASS = {"textarea": "long", "contenteditable": "long", "open_text": "long", "input": "line",
               "short_text": "line"}


def _norm_text(text: Optional[str]) -> str:
    return " ".join((text or "").split()).rstrip("?.!:* ").lower()


def cache_request(request: GenerateAnswerRequest) -> Dict[str, Any]:
    """The parts of a request that decide its prompt, normalized (see ANSWER_CACHE_SECONDS)."""
    data = request.model_dump(mode="json")
    data["question"] = _norm_text(request.question)
    job = data.get("job_context")
    if job:
        job.pop("id", None)
        job.pop("url", None)
    field_ = data.get("field")
    if field_:
        if field_.get("label") and _norm_text(field_["label"]) == data["question"]:
            field_["label"] = None
        kind = field_.get("kind")
        field_["kind"] = _KIND_CLASS.get(kind, kind) if kind else "long"
    if data.get("style") is None:
        data["style"] = AnswerStyle().model_dump(mode="json")
    data["additional_facts"] = data.get("additional_facts") or None
    return data


def _key_rows(data: Dict[str, Any], analysis: QuestionAnalysis) -> Dict[str, Any]:
    """The fetched rows this question's answer depends on: what fetch_profile_data reads for it alone. A batch
    fetches the union of its questions' sections; keying on all of it would make the same question miss when
    asked on its own, or in a batch with other questions."""
    keys = {"profile", "profile_facts", *analysis.sections}
    if analysis.target_skills:
        keys |= {"skills", "experiences", "projects", "achievements"}
    return {k: v for k, v in data.items() if k in keys}


def _answer_key(user_id: str, request: GenerateAnswerRequest, data: Dict[str, Any]) -> tuple:
    rows = _key_rows(data, _analyze(request.question, request.field))
    payload = json.dumps(
        {"prompt": _PROMPT_VERSION, "request": cache_request(request), "data": rows},
        sort_keys=True, default=str,
    )
    return (user_id, hashlib.sha256(payload.encode()).hexdigest())


def _cached_answer(key: tuple) -> Optional[AnswerResponse]:
    cached, outcome = _answer_cache.lookup(key)
    metrics.record_cache("answer", hit=cached is not None, outcome=outcome)
    return cached

LOGISTICS_LABELS = {
    "salary": "your salary expectation",
    "sponsorship": "whether you need visa sponsorship",
    "work_authorization": "your work authorization",
    "notice_period": "your notice period or availability",
    "relocation": "whether you're willing to relocate",
    "work_mode": "your preferred work mode (remote, hybrid, on-site)",
    "travel": "whether you're willing to travel",
}

WORK_MODES = ["remote", "hybrid", "onsite", "flexible"]
# Ask-and-Learn input per fact type (see memory.keys).
# A choice is sent as "select" (with its options): extension builds from before Application Memory render that
# as a dropdown, newer ones as buttons.
_INPUTS = {"boolean": "boolean", "choice": "select", "text": "text", "number": "number"}


def scoped_data(data: Dict[str, Any], job: Optional[JobContext]) -> Dict[str, Any]:
    """The profile with only the Application Memory that applies to this application: facts saved for another
    job or company never reach its answers."""
    facts = data.get("profile_facts")
    if not facts:
        return data
    key = job_key(job.url, job.company, job.role) if job else None
    return {**data, "profile_facts": scope_facts(facts, job.company if job else None, key)}


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
    key = INTENT_KEYS.get(intent)
    spec = FACT_KEYS.get(key or "")
    if spec is None:
        return None
    target = ProfileFieldTarget(field=spec.profile_field) if spec.profile_field \
        else FactTarget(category=spec.group, key=spec.key)
    return MissingInfo(
        key=spec.profile_field or spec.key,
        prompt=spec.ask,
        input=_INPUTS[spec.input],
        options=list(spec.options) or None,
        target=target,
        group=spec.group,
        scope=spec.default_scope,
        label=spec.label,
    )


def skill_missing(name: str) -> MissingInfo:
    return MissingInfo(
        key=f"skill:{canonicalize(name)}", prompt=f"Have you used {name}?", input="skill", target=SkillTarget(name=name),
        group="Skills", scope="global", label=name,
    )


# Questions whose answer is about one employer or role: what the user writes is kept for that job only.
JOB_SPECIFIC_INTENTS = {"motivation_company", "motivation_role", "cover_letter"}


def fact_missing(analysis: QuestionAnalysis, prompt: Optional[str]) -> MissingInfo:
    category = analysis.intent if analysis.intent != "general" else analysis.category
    return MissingInfo(
        key=f"fact:{category}",
        prompt=(prompt or analysis.question).strip(),
        input="textarea",
        target=FactTarget(category=category),
        group=CATEGORY_GROUPS.get(category, CATEGORY_GROUPS.get(analysis.category, "Other")),
        scope="job" if analysis.intent in JOB_SPECIFIC_INTENTS else "global",
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


def deterministic(analysis: QuestionAnalysis, answer: str, ctx: ProfileContext, source: str = "PR",
                  used: Optional[UsedSource] = None) -> AnswerResponse:
    """An answer that needed no model. `used` names the source directly when it isn't one of ctx.sources."""
    src = ctx.sources.get(source)
    if used is None and src:
        used = UsedSource(type=src.type, id=src.id, label=src.label)
    return AnswerResponse(
        status="answered",
        answer=answer,
        confidence="high",
        used_sources=[used] if used else [],
        missing_information=None,
        category=analysis.category,
        intent=analysis.intent,
        origin="memory" if used is not None and used.type == "fact" else "profile",
    )


def memory_source(found: Resolved) -> Optional[UsedSource]:
    """The memory row an answer came from, so the popover can show it and edit it inline."""
    if not found.from_memory or not found.row:
        return None
    spec = FACT_KEYS.get(found.key)
    return UsedSource(type="fact", id=str(found.row.get("id") or ""), label=spec.label if spec else found.key)


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


YES_NO_QUESTION = re.compile(r"^\W*(?:are|do|does|will|would|can|could|have|has|is|did|may)\b", re.IGNORECASE)
WORK_MODE_LABELS = {"remote": "Remote", "hybrid": "Hybrid", "onsite": "On-site", "flexible": "Flexible"}


def logistics_text(intent: str, value: Any, question: str) -> Optional[str]:
    """A one-line field's answer straight from the profile, or None when the wording needs the model. Only for
    phrasings whose answer the stored value settles unambiguously (a "Do you have a visa?" is not "do you need
    sponsorship", so it goes to the model)."""
    yes_no = bool(YES_NO_QUESTION.match(question))
    if intent == "work_authorization" and yes_no:
        return "Yes" if authorized_in_asked_country(question, value) else None
    if intent in ("salary", "notice_period", "work_authorization"):
        return str(value).strip() if isinstance(value, str) and not yes_no else None
    if intent == "sponsorship" and isinstance(value, bool):
        asks_need = re.search(r"\b(?:require|need)\w*\b.*\bsponsor", question, re.IGNORECASE)
        return ("Yes" if value else "No") if yes_no and asks_need else None
    if intent == "relocation" and isinstance(value, bool):
        return ("Yes" if value else "No") if yes_no and re.search(r"\b(?:willing|open|able)\b", question, re.IGNORECASE) else None
    if intent == "work_mode" and isinstance(value, str):
        return WORK_MODE_LABELS.get(value) if not yes_no and re.search(r"\bprefer", question, re.IGNORECASE) else None
    if intent == "travel" and isinstance(value, bool):
        willing = re.search(r"\b(?:willing|open|able)\b", question, re.IGNORECASE)
        return ("Yes" if value else "No") if yes_no and willing else None
    return None


def precheck(analysis: QuestionAnalysis, ctx: ProfileContext, field: Optional[FieldContext] = None) -> Optional[AnswerResponse]:
    """Answers that need no model: questions the profile clearly cannot support, and choices it settles."""
    if analysis.category == "logistics":
        found = ctx.resolve(analysis.intent)
        value = found.value if found else None
        used = memory_source(found) if found else None
        if value is None:
            label = LOGISTICS_LABELS.get(analysis.intent, "this preference")
            ask = logistics_missing(analysis.intent)
            return insufficient(
                analysis, f"Add {label} under Personal → Application preferences in your profile.", [ask] if ask else []
            )
        if field and field.is_choice and field.kind == "choice_single":
            option = deterministic_choice(analysis.intent, value, field.options or [])
            if option is None and analysis.intent == "work_authorization"                     and authorized_in_asked_country(analysis.question, value):
                option = _yes_no_option(field.options or [], True)
            if option:
                return deterministic(analysis, option, ctx, used=used)
        # A one-line text box ("Notice period", "Expected salary") takes the stored value as is: no model needed.
        if field and field.kind in ("input", "short_text"):
            text = logistics_text(analysis.intent, value, analysis.question)
            if text:
                return deterministic(analysis, text, ctx, used=used)
        return None

    if ctx.is_empty:
        return insufficient(analysis, "Your profile is empty. Add your experience, projects and skills first.")

    if analysis.category == "education" and field and field.is_choice and field.kind == "choice_single"             and HIGHEST_DEGREE_QUESTION.search(analysis.question):
        found = highest_degree_option(ctx.rows.get("education") or [], field.options or [])
        if found:
            option, row = found
            label = " — ".join(x for x in [row.get("degree"), row.get("institution")] if x)
            return deterministic(analysis, option, ctx, used=UsedSource(type="education", id=row.get("id", ""), label=label))

    if analysis.category == "skill_check" and analysis.target_skills:
        missing = missing_skills(ctx, analysis.target_skills)
        if not missing and field:
            # Every skill asked about is in the profile: a yes/no choice or a years count needs no model.
            if field.is_choice and field.kind == "choice_single" and analysis.intent != "skill_years":
                option = _yes_no_option(field.options or [], True)
                if option:
                    return deterministic(analysis, option, ctx, source="S")
            if analysis.intent == "skill_years" and len(analysis.target_skills) == 1                     and field.kind in ("number", "input", "short_text"):
                years = skill_years(ctx.rows.get("skills") or [], analysis.target_skills[0])
                if years:
                    return deterministic(analysis, years, ctx, source="S")
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


def _tokens(usage: Optional[Dict[str, int]]) -> int:
    usage = usage or {}
    return int(usage.get("prompt_tokens", 0) or 0) + int(usage.get("completion_tokens", 0) or 0)


def _response(analysis: QuestionAnalysis, ctx: ProfileContext, parsed: ParsedAnswer, provider: Optional[str],
              model: Optional[str], tokens: Optional[int] = None) -> AnswerResponse:
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
        tokens=tokens,
        origin="generated" if parsed.status == "answered" else None,
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
    """A batch after the deterministic checks and the answer cache: what's answered and what needs the model."""

    request: GenerateBatchRequest
    ctx: ProfileContext
    analyses: Dict[str, QuestionAnalysis]
    user_id: Optional[str] = None
    results: Dict[str, BatchAnswer] = field(default_factory=dict)
    pending: List[BatchItem] = field(default_factory=list)
    # The fetched profile and the facts the candidate just gave: each chunk builds its own evidence from them.
    data: Dict[str, Any] = field(default_factory=dict)
    facts: List[str] = field(default_factory=list)
    cache_keys: Dict[str, tuple] = field(default_factory=dict)
    # Saved answers that match but were written for another job or are too long: (item, saved row, reason).
    adapt: List[Tuple[BatchItem, Dict[str, Any], str]] = field(default_factory=list)
    # Model calls made for the batch (chunks, adaptations and per-question fallbacks).
    calls: int = 0
    # Where each answer came from: deterministic / saved / cache / generated.
    sources: Dict[str, str] = field(default_factory=dict)


# Pending questions are grouped by what evidence they draw on. Each model call (up to BATCH_GROUP_SIZE questions)
# gets evidence retrieved for its own questions only, shared between them.
QUESTION_FAMILIES = {
    "experience": "work", "skill_check": "work", "project": "work",
    "behavioral": "behavioral", "strengths": "behavioral", "achievement": "behavioral",
    "motivation": "motivation", "cover_letter": "motivation", "about_me": "motivation",
}


def group_questions(items: List[BatchItem], analyses: Dict[str, QuestionAnalysis], size: int,
                    by_family: bool = True) -> List[List[BatchItem]]:
    """Calls of up to `size` questions: one per question family with `by_family`, otherwise as few as possible
    with each family's questions next to each other."""
    families: Dict[str, List[BatchItem]] = {}
    for item in items:
        families.setdefault(QUESTION_FAMILIES.get(analyses[item.id].category, "general"), []).append(item)
    groups = list(families.values()) if by_family else [[i for group in families.values() for i in group]]
    # As few calls as `size` allows, evenly filled (9 questions at 6: 5 + 4, not 6 + 3), so parallel calls finish
    # together.
    out: List[List[BatchItem]] = []
    for group in groups:
        calls = -(-len(group) // size)
        base, extra = divmod(len(group), calls) if calls else (0, 0)
        start = 0
        for c in range(calls):
            end = start + base + (1 if c < extra else 0)
            out.append(group[start:end])
            start = end
    return out


class AnswerEngine:
    def __init__(self, gateway: LLMGateway, semantic: Optional[SemanticRetriever] = None):
        self.gateway = gateway
        self.semantic = semantic if semantic is not None else SemanticRetriever.from_settings()

    @staticmethod
    def analyze(request: GenerateAnswerRequest) -> QuestionAnalysis:
        return _analyze(request.question, request.field)

    async def _context(self, rest: SupabaseRest, user_id: Optional[str], data: Dict[str, Any],
                       analysis: QuestionAnalysis, facts: Optional[List[str]], job: Optional[str]) -> ProfileContext:
        """Keyword + metadata evidence; semantic retrieval only when that found too little for a question whose
        wording is likely to differ from the profile's (behavioral, motivation...)."""
        ctx = build_context(data, analysis, facts, job_text=job)
        if ctx.low_confidence and user_id and analysis.category in SEMANTIC_CATEGORIES and self.semantic.enabled:
            hits = await self.semantic.search(rest, user_id, data, " ".join(x for x in [analysis.question, job] if x))
            if hits:
                ctx = build_context(data, analysis, facts, job_text=job, boost={i: SEMANTIC_BOOST for i in hits})
        return ctx

    async def answer(
        self,
        rest: SupabaseRest,
        request: GenerateAnswerRequest,
        previous_answer: Optional[str] = None,
        instruction: Optional[str] = None,
        *,
        user_id: Optional[str] = None,
        data: Optional[Dict[str, Any]] = None,
        before_model: Optional[Callable[[], None]] = None,
    ) -> AnswerResponse:
        """`data` is the profile from fetch_profile_data, when the caller already loaded it. `before_model` runs
        only when the model is actually needed (e.g. the daily limit, which no-model answers don't use)."""
        settings = get_settings()
        analysis = _analyze(request.question, request.field)
        if data is None:
            data = await fetch_profile_data(rest, analysis, user_id)
        data = scoped_data(data, request.job_context)
        ctx = build_context(data, analysis, request.additional_facts, job_text=job_text(request.job_context))

        early = precheck(analysis, ctx, request.field)
        if early is not None:
            logger.info(f"Answered without LLM: {analysis.category}/{analysis.intent} -> {early.status}")
            return early

        cache_key = _answer_key(user_id, request, data) if user_id and previous_answer is None else None
        if cache_key is not None:
            cached = _cached_answer(cache_key)
            if cached is not None:
                return cached.model_copy(update={"provider": None, "model": None, "tokens": None})
        if before_model is not None:
            before_model()
        if ctx.low_confidence:
            ctx = await self._context(rest, user_id, data, analysis, request.additional_facts,
                                      job_text(request.job_context))

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
            stage=answer_stage(analysis, ctx, request.field, request.style, regenerating=previous_answer is not None),
        )
        response = _response(analysis, ctx, result.value, result.provider, result.model, _tokens(result.usage))
        if cache_key is not None and response.status == "answered":
            _answer_cache.set(cache_key, response)
        return response

    # --- batches (fill all) -------------------------------------------------------

    async def plan_batch(self, rest: SupabaseRest, request: GenerateBatchRequest,
                         user_id: Optional[str] = None, saved: Any = None) -> BatchPlan:
        """Fetches the profile once, then answers what needs no model, in order: deterministic answers, the user's
        saved answers (`saved`: the rows, or an awaitable loading them alongside the profile; free-text questions
        only), the answer cache. A saved answer written
        for another job lands in `plan.adapt` (one small call each, run with the batch). `plan.pending` is what
        still needs generating."""
        analyses = {item.id: _analyze(item.question, item.field) for item in request.items}
        order = list(CATEGORY_SECTIONS["general"])
        sections = [s for s in order if any(s in a.sections for a in analyses.values())]
        skills = list(dict.fromkeys(s for a in analyses.values() for s in a.target_skills))
        has_logistics = any(a.category == "logistics" for a in analyses.values())
        union = QuestionAnalysis(question="", category="general", intent="general", sections=sections,
                                 target_skills=skills)
        if inspect.isawaitable(saved):
            data, saved = await asyncio.gather(fetch_profile_data(rest, union, user_id), saved)
            if isinstance(saved, BaseException):
                # A broken saved-answer lookup shouldn't block generating.
                logger.warning(f"Could not load saved answers: {saved}")
                saved = None
        else:
            data = await fetch_profile_data(rest, union, user_id)
        data = scoped_data(data, request.job_context)
        facts = [f for item in request.items for f in (item.additional_facts or [])]
        # Grounding only (no evidence text yet): the prechecks need the profile, not a prompt.
        ctx = build_context(data, union, facts, include_logistics=has_logistics, analyses=[])

        plan = BatchPlan(request=request, ctx=ctx, analyses=analyses, user_id=user_id, data=data, facts=facts)
        for item in request.items:
            analysis = analyses[item.id]
            early = precheck(analysis, ctx, item.field)
            if early is not None and early.status == "answered":
                plan.results[item.id] = BatchAnswer(id=item.id, **early.model_dump())
                plan.sources[item.id] = "deterministic"
                continue
            # A saved answer beats asking the user to add something to their profile: they already wrote one.
            if saved and _takes_saved_answer(item.field):
                match, _ = best_match(item.question, saved)
                if match is not None:
                    reason = adaptation_reason(match, _item_request(request, item))
                    if reason:
                        plan.adapt.append((item, match, reason))
                    else:
                        plan.results[item.id] = _saved_result(item, analysis, match)
                    plan.sources[item.id] = "saved"
                    continue
            if early is not None:
                plan.results[item.id] = BatchAnswer(id=item.id, **early.model_dump())
                plan.sources[item.id] = "deterministic"
                continue
            if user_id:
                key = _answer_key(user_id, _item_request(request, item), data)
                cached = _cached_answer(key)
                if cached is not None:
                    plan.results[item.id] = BatchAnswer(
                        id=item.id, **cached.model_copy(update={"provider": None, "model": None}).model_dump())
                    plan.sources[item.id] = "cache"
                    continue
                plan.cache_keys[item.id] = key
            plan.pending.append(item)
            plan.sources[item.id] = "generated"
        return plan

    async def complete_batch(self, rest: SupabaseRest, plan: BatchPlan, group_size: Optional[int] = None,
                             by_family: bool = BATCH_BY_FAMILY) -> List[BatchAnswer]:
        """Generates the pending answers, one model call per group of related questions (up to CHUNK_CONCURRENCY at
        once), falling back to one call per question."""
        limit = asyncio.Semaphore(CHUNK_CONCURRENCY)

        async def run(chunk: List[BatchItem]) -> None:
            async with limit:
                await self._complete_chunk(rest, plan, chunk)

        chunks = group_questions(plan.pending, plan.analyses, group_size or BATCH_GROUP_SIZE, by_family)
        # Adaptations are small and independent of the generation calls: they run alongside, adding no wait.
        await asyncio.gather(*(run(chunk) for chunk in chunks),
                             *(self._adapt(plan, item, saved, reason) for item, saved, reason in plan.adapt))
        return [plan.results[item.id] for item in plan.request.items]

    async def _adapt(self, plan: BatchPlan, item: BatchItem, saved: Dict[str, Any], reason: str) -> None:
        """The saved answer adapted to this job, or unchanged when no valid rewrite comes back (as /resolve)."""
        analysis = plan.analyses[item.id]
        try:
            plan.calls += 1
            adapted = await adapt_saved_answer(self.gateway, saved, _item_request(plan.request, item), reason,
                                               analysis.category, analysis.intent)
        except (GatewayUnavailableError, ValueError) as e:
            logger.info(f"Saved answer used unchanged ({reason}): {e}")
            plan.results[item.id] = _saved_result(item, analysis, saved)
            return
        values = {**adapted.model_dump(exclude={"tokens"}), "origin": "adapted"}
        plan.results[item.id] = BatchAnswer(id=item.id, **values, tokens=adapted.tokens,
                                            saved_answer_id=str(saved.get("id")), adapted_from=str(saved.get("id")))

    def _chunk_context(self, plan: BatchPlan, chunk: List[BatchItem]) -> ProfileContext:
        analyses = [plan.analyses[item.id] for item in chunk]
        union = QuestionAnalysis(question="", category="general", intent="general",
                                 sections=list(CATEGORY_SECTIONS["general"]),
                                 target_skills=list(dict.fromkeys(s for a in analyses for s in a.target_skills)))
        return build_context(plan.data, union, plan.facts, job_text=job_text(plan.request.job_context),
                             analyses=analyses)

    async def _complete_chunk(self, rest: SupabaseRest, plan: BatchPlan, chunk: List[BatchItem]) -> None:
        parsed: Dict[str, Optional[ParsedAnswer]] = {}
        provider = model = None
        tokens = 0
        ctx = self._chunk_context(plan, chunk)
        try:
            plan.calls += 1
            result = await self._generate_chunk(plan, chunk, ctx)
            parsed, provider, model = result.value, result.provider, result.model
            # One call answered the chunk: its tokens are shared by the answers it produced.
            tokens = _tokens(result.usage) // max(1, sum(1 for item in chunk if parsed.get(item.id) is not None))
        except GatewayUnavailableError as e:
            logger.warning(f"Batch generation failed, answering one by one: {e}")
        for item in chunk:
            answer = parsed.get(item.id)
            if answer is not None:
                response = _response(plan.analyses[item.id], ctx, answer, provider, model, tokens)
                plan.results[item.id] = BatchAnswer(id=item.id, **response.model_dump(), tokens=tokens)
                if item.id in plan.cache_keys and response.status == "answered":
                    _answer_cache.set(plan.cache_keys[item.id], response)
            else:
                plan.results[item.id] = await self._single(rest, plan, item)

    async def _generate_chunk(self, plan: BatchPlan, chunk: List[BatchItem], ctx: ProfileContext):
        settings = get_settings()
        request = plan.request
        message = build_batch_message(
            [(item.id, plan.analyses[item.id], item.field) for item in chunk],
            ctx,
            request.job_context,
            request.style,
            job_description_max_chars=settings.JOB_DESCRIPTION_MAX_CHARS,
        )
        notes = [n for n in (_not_in_profile(ctx, plan.analyses[i.id]) for i in chunk) if n]
        if notes:
            message += "\n\n" + "\n".join(dict.fromkeys(notes))
        fields = {item.id: item.field for item in chunk}
        return await self.gateway.generate(
            system=BATCH_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": message}],
            temperature=settings.LLM_TEMPERATURE,
            max_tokens=min(max(settings.LLM_MAX_TOKENS, 700 * len(chunk)), 16_000),
            validate=lambda text: parse_batch(text, ctx.sources, fields),
            stage=ANSWER_BATCH,
            items=len(chunk),
        )

    async def _single(self, rest: SupabaseRest, plan: BatchPlan, item: BatchItem) -> BatchAnswer:
        """Per-question fallback when the batch output was unusable for this question."""
        try:
            response = await self.answer(rest, _item_request(plan.request, item), user_id=plan.user_id)
            plan.calls += 1 if response.provider else 0
        except (GatewayUnavailableError, ValueError) as e:
            logger.warning(f"Could not answer batch item {item.id}: {e}")
            analysis = plan.analyses[item.id]
            return BatchAnswer(
                id=item.id, status="insufficient_information", answer="", confidence="low", used_sources=[],
                missing_information=None, category=analysis.category, intent=analysis.intent,
                error="Couldn't generate this answer. Try it on its own.",
            )
        return BatchAnswer(id=item.id, **response.model_dump(), tokens=response.tokens)


def _takes_saved_answer(field_: Optional[FieldContext]) -> bool:
    """Saved answers are prose: they fill text fields, never choices or numbers."""
    return not (field_ and (field_.is_choice or field_.kind in ("number", "choice_single", "choice_multi")))


def _saved_result(item: BatchItem, analysis: QuestionAnalysis, saved: Dict[str, Any]) -> BatchAnswer:
    return BatchAnswer(id=item.id, status="answered", answer=str(saved.get("answer") or ""), confidence="high",
                       used_sources=[], missing_information=None, category=analysis.category,
                       intent=analysis.intent, saved_answer_id=str(saved.get("id")), origin="saved")


def _item_request(request: GenerateBatchRequest, item: BatchItem) -> GenerateAnswerRequest:
    return GenerateAnswerRequest(question=item.question, job_context=request.job_context, field=item.field,
                                 style=request.style, additional_facts=item.additional_facts)
