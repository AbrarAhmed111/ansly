"""
Rewrite Controls.

Shorter, More natural, More professional, Fit to limit, a custom steer...:
one small model call that transforms the answer the user has now (their latest
edit, not the first generation). The call carries that text, the instruction,
the field's limit and, at most, the company and role; never the profile, so it
costs a few hundred tokens instead of a full regeneration.

A rewrite may change wording, order and length. It may not change facts: a
rewrite that adds a number, a name, a technology, a degree, a work-authorization
or salary claim, or a seniority the original doesn't have is rejected, and the
original is kept.
"""

import re
from dataclasses import dataclass
from typing import List, Optional

from src.app.core.config import get_settings
from src.app.core.token_budget import REWRITE
from src.app.gateway import GatewayUnavailableError, LLMGateway
from src.app.resume.text import number_set
from src.app.schemas.answers import FieldContext, RewriteRequest

from .adapt import _names
from .parser import _extract_json, strip_dashes

SYSTEM_PROMPT = """You edit a job-application answer the candidate already wrote or approved. Change only wording, order, emphasis and length as asked. Keep every fact exactly as stated; add none: no new employers, projects, technologies, numbers, dates, degrees, titles, metrics, salary, visa or work-authorization claims. When shortening, drop the least important points; never invent detail to lengthen, if there's nothing more to say keep it about the same length. Write in first person like a person, not an AI: plain prose, paragraphs split by a blank line, no markdown, no em or en dashes, no clichés. A character or word limit is hard.

Return only a JSON object: {"answer": string}"""

ACTIONS = {
    "shorter": "Make it noticeably shorter, about two thirds of its length, keeping the strongest points.",
    "longer": "Make it somewhat longer by developing what it already says. Add no new facts.",
    "natural": "Make it sound more natural and human: plainer words, varied sentences, contractions.",
    "professional": "Make it more professional: clear, measured and polished.",
    "concise": "Make it more concise: cut filler and repetition, keep every point.",
    "technical": "Make it more technical: precise about the technologies and systems it already names.",
    "confident": "Make it more confident: state what was done plainly, without hedging or overstating.",
    "simpler": "Make it simpler: short sentences and everyday words.",
    "fit": "Shorten it to fit the limit, keeping the most important evidence and meaning.",
}

# Claims a rewrite must not introduce: each pattern found in the rewrite must also be in the original.
_SENSITIVE = [
    re.compile(p, re.IGNORECASE) for p in [
        r"\b(?:bachelor'?s?|master'?s?|ph\.?d|doctorate|mba|bsc|msc|b\.?s\.?|m\.?s\.?|degree|diploma)\b",
        r"\b(?:citizen(?:ship)?|green card|permanent resident|visa|sponsor(?:ship)?|work permit|authori[sz]ed)\b",
        r"[$€£¥₹]|\b(?:salary|usd|eur|gbp|per (?:year|annum|hour)|k/year)\b",
        r"\b(?:senior|staff|principal|lead|manager|director|head of|vp|chief|founder|co-founder)\b",
        r"\b(?:certified|certification|award(?:ed)?|patent(?:ed)?|published)\b",
    ]
]
# Lower-case technology spellings the capitalized-name check misses: "node.js", "c++", "c#", "k8s".
_TECH = re.compile(r"\b[a-z][a-z0-9]*(?:[.+#][a-z0-9+#]*)+|\b[a-z]+\d+[a-z0-9]*\b", re.IGNORECASE)


@dataclass
class RewriteResult:
    answer: str
    changed: bool
    reason: Optional[str] = None
    tokens: int = 0
    provider: Optional[str] = None


def count_words(text: str) -> int:
    return len(re.findall(r"\S+", text))


def over_limit(text: str, field: Optional[FieldContext]) -> Optional[str]:
    """Why the text breaks the field's hard limits, or None."""
    if not field:
        return None
    if field.max_length and len(text) > field.max_length:
        return f"{len(text) - field.max_length} characters over the limit"
    if field.max_words and count_words(text) > field.max_words:
        return f"{count_words(text) - field.max_words} words over the limit"
    return None


def _limits(field: Optional[FieldContext]) -> List[str]:
    parts = []
    if field and field.max_length:
        parts.append(f"at most {field.max_length} characters")
    if field and field.max_words:
        parts.append(f"at most {field.max_words} words")
    if field and field.min_length:
        parts.append(f"at least {field.min_length} characters")
    return parts


def build_message(request: RewriteRequest) -> str:
    action = ACTIONS.get(request.action) or "Follow the candidate's instruction."
    parts = []
    if request.question:
        parts.append(f"QUESTION:\n{request.question.strip()}")
    job = request.job_context
    if job and (job.company or job.role):
        parts.append("APPLYING TO: " + " · ".join(x for x in [job.role, job.company] if x))
    parts.append(f"ANSWER:\n{request.text.strip()}")
    task = action
    if request.action == "custom" or (request.instruction or "").strip():
        task += f" Candidate's instruction: {(request.instruction or '').strip()}"
    limits = _limits(request.field)
    if limits:
        task += " Limit: " + ", ".join(limits) + "."
    if request.action == "fit" and request.field and request.field.max_length:
        task += f" Aim for about {int(request.field.max_length * 0.9)} characters."
    parts.append(f"TASK:\n{task}")
    return "\n\n".join(parts)


def invented(rewrite: str, sources: List[str]) -> List[str]:
    """What the rewrite claims that none of the sources do (empty when it adds nothing)."""
    known = " ".join(sources)
    known_low = known.lower()
    found = [f"number {n}" for n in sorted(number_set([rewrite]) - number_set(sources))]
    found += [f"name {n}" for n in sorted(_names(rewrite)) if n not in known_low]
    for pattern in _SENSITIVE:
        for m in pattern.finditer(rewrite):
            if not pattern.search(known):
                found.append(f"claim '{m.group(0)}'")
                break
    # A sentence's last word ("in Next.js.") keeps its name, not the full stop.
    tech = {t.lower().rstrip(".") for t in _TECH.findall(rewrite)}
    found += [f"technology {t}" for t in sorted(tech) if t and t not in known_low]
    return found


def validate(text: str, request: RewriteRequest) -> str:
    """The rewrite, or ValueError (so the gateway tries another provider) when it is empty, breaks the limit, or
    adds a fact the original doesn't state."""
    answer = strip_dashes(str(_extract_json(text).get("answer") or "").strip())
    if not answer:
        raise ValueError("Empty rewrite")
    job = request.job_context
    sources = [request.text, request.question or "", (job.company or "") if job else "", (job.role or "") if job else ""]
    added = invented(answer, sources)
    if added:
        raise ValueError(f"Rewrite added facts: {', '.join(added[:5])}")
    over = over_limit(answer, request.field)
    if over:
        raise ValueError(f"Rewrite is {over}")
    if request.action in ("fit", "shorter", "concise") and len(answer) >= len(request.text.strip()):
        raise ValueError("Rewrite is not shorter")
    return answer


KEPT = "Ansly couldn't rewrite this without changing its facts, so your answer was kept."


async def rewrite_answer(gateway: LLMGateway, request: RewriteRequest) -> RewriteResult:
    """Raises GatewayUnavailableError only when no provider answered at all; a rewrite that kept failing validation
    returns the original unchanged, with the reason."""
    settings = get_settings()
    rejected: List[str] = []

    def check(text: str) -> str:
        try:
            return validate(text, request)
        except ValueError as e:
            rejected.append(str(e))
            raise

    try:
        result = await gateway.generate(
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": build_message(request)}],
            temperature=settings.LLM_TEMPERATURE,
            max_tokens=min(1500, max(400, len(request.text) // 2)),
            validate=check,
            stage=REWRITE,
        )
    except GatewayUnavailableError:
        if not rejected:
            raise
        # No provider produced a rewrite that keeps the facts: the user's text stays exactly as it was.
        return RewriteResult(request.text, False, KEPT)
    usage = result.usage or {}
    tokens = int(usage.get("prompt_tokens", 0) or 0) + int(usage.get("completion_tokens", 0) or 0)
    return RewriteResult(result.value, result.value.strip() != request.text.strip(), None, tokens, result.provider)
