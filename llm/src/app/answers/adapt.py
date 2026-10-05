"""
Saved-Answer Adaptation.

A saved answer that matches the question is normally returned as is (no model).
It is adapted, with one small model call, only when it can't be used unchanged:

- it is longer than the field allows, or
- it names a different employer or role than the job being applied to.

The call carries the saved answer, the company and role, a few lines of the job
and a short instruction (a few hundred tokens), never the profile. The rewrite
may change names, emphasis and length; it may not add facts about the
candidate. A rewrite containing a number that is in neither the saved answer
nor the job context is rejected, and the saved answer is returned unchanged.
"""

import re
from typing import Any, Dict, Optional

from src.app.core.config import get_settings
from src.app.core.token_budget import ADAPTATION
from src.app.gateway import LLMGateway
from src.app.resume.text import number_set
from src.app.schemas.answers import AnswerResponse, GenerateAnswerRequest

from .job_digest import digest
from .parser import _extract_json, fit_to_length, strip_dashes

# Job description given to an adaptation: enough to name what the role is about.
JOB_CHARS = 500

SYSTEM_PROMPT = """You adapt a candidate's saved answer to a new job application. The candidate wrote it; keep every fact about them exactly as stated and add none (no new skills, employers, numbers, titles or claims). Change only what must change: the employer or role names, emphasis toward this job, and length to fit the limit. JOB CONTEXT is about the employer, never the candidate. Keep the saved answer's voice: first person, plain prose that sounds like a person wrote it, not an AI. Never use em dashes or en dashes; use a comma, a period or parentheses instead.

Return only a JSON object: {"answer": string}"""


def _norm(text: Optional[str]) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()


def _mentions(answer: str, name: Optional[str]) -> bool:
    name = _norm(name)
    return bool(name) and f" {name} " in f" {_norm(answer)} "


def adaptation_reason(saved: Dict[str, Any], request: GenerateAnswerRequest) -> Optional[str]:
    """Why the saved answer can't be used as is, or None when it can."""
    answer = saved.get("answer") or ""
    max_length = request.field.max_length if request.field else None
    if max_length and len(answer) > max_length:
        return "too_long"
    job = request.job_context
    if job is None:
        return None
    if job.company and saved.get("company") and _norm(saved["company"]) != _norm(job.company) \
            and _mentions(answer, saved["company"]):
        return "other_company"
    if job.role and saved.get("role") and _norm(saved["role"]) != _norm(job.role) and _mentions(answer, saved["role"]):
        return "other_role"
    return None


def _message(saved: Dict[str, Any], request: GenerateAnswerRequest, reason: str) -> str:
    job = request.job_context
    max_length = request.field.max_length if request.field else None
    written_for = " at ".join(x for x in [saved.get("role"), saved.get("company")] if x)
    parts = [f"QUESTION:\n{request.question}",
             f"SAVED ANSWER{f' (written for {written_for})' if written_for else ''}:\n{saved['answer']}"]
    if job and (job.company or job.role or job.description):
        lines = [x for x in [f"Company: {job.company}" if job.company else "", f"Role: {job.role}" if job.role else ""] if x]
        lines.append(digest(job.description, JOB_CHARS, request.question, prefer_intro=True))
        parts.append("JOB CONTEXT:\n" + "\n".join(x for x in lines if x))
    task = {"too_long": f"Shorten it to at most {max_length} characters, keeping its strongest points.",
            "other_company": "Retarget it to this company and role; drop what only fit the old employer.",
            "other_role": "Retarget it to this role; drop what only fit the old one."}[reason]
    if max_length and reason != "too_long":
        task += f" At most {max_length} characters."
    parts.append(f"TASK:\n{task}")
    return "\n\n".join(parts)


# A capitalized word that doesn't start a sentence: a name (employer, product, technology, place).
_NAME = re.compile(r"(?<![.!?]\s)(?<!^)(?<![\"'(])\b([A-Z][A-Za-z0-9+#.&-]*[A-Za-z0-9+#])")


def _names(text: str) -> set:
    return {m.group(1).lower() for m in _NAME.finditer(text or "")} - {"i", "i'm", "i've", "i'd", "i'll"}


def _validate(text: str, saved: Dict[str, Any], request: GenerateAnswerRequest, reason: str = "") -> str:
    """The rewrite, or ValueError when it adds what the saved answer and the job don't say: a number, or a name
    (employer, technology, product...); or keeps the old employer's name when retargeting away from it."""
    answer = strip_dashes(str(_extract_json(text).get("answer") or "").strip())
    if not answer:
        raise ValueError("Empty adaptation")
    job = request.job_context
    sources = [saved.get("answer") or "", request.question]
    if job:
        sources += [job.description or "", job.company or "", job.role or ""]
    invented = number_set([answer]) - number_set(sources)
    if invented:
        raise ValueError(f"Adaptation added numbers: {sorted(invented)}")
    known = " ".join(sources).lower()
    new_names = {n for n in _names(answer) if n not in known}
    if new_names:
        raise ValueError(f"Adaptation added names: {sorted(new_names)}")
    if reason == "other_company" and _mentions(answer, saved.get("company")):
        raise ValueError("Adaptation still names the old employer")
    return fit_to_length(answer, request.field.max_length if request.field else None)


async def adapt_saved_answer(gateway: LLMGateway, saved: Dict[str, Any], request: GenerateAnswerRequest,
                             reason: str, category: str, intent: str) -> AnswerResponse:
    """Raises GatewayUnavailableError when no provider produced a valid rewrite (the caller keeps the original)."""
    settings = get_settings()
    result = await gateway.generate(
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": _message(saved, request, reason)}],
        temperature=settings.LLM_TEMPERATURE,
        max_tokens=600,
        validate=lambda text: _validate(text, saved, request, reason),
        stage=ADAPTATION,
    )
    usage = result.usage or {}
    return AnswerResponse(
        status="answered", answer=result.value, confidence="high", used_sources=[], missing_information=None,
        category=category, intent=intent, provider=result.provider, model=result.model,
        tokens=int(usage.get("prompt_tokens", 0) or 0) + int(usage.get("completion_tokens", 0) or 0),
    )
