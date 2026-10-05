"""
Model Output Parsing.
Turns the model's JSON reply into a validated answer, or raises ValueError so
the gateway can try the next provider.
"""

import json
import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from src.app.schemas.answers import FieldContext

from .profile_context import Source

STATUSES = {"answered", "insufficient_information"}
CONFIDENCES = {"high", "medium", "low"}


@dataclass
class ParsedAnswer:
    status: str
    answer: str
    confidence: str
    used_refs: List[str]
    missing_information: Optional[str]
    missing_question: Optional[str] = None


def _extract_json(text: str) -> dict:
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.IGNORECASE)
    try:
        value = json.loads(cleaned)
    except json.JSONDecodeError:
        # Some models wrap the object in prose; take the outermost braces.
        start, end = cleaned.find("{"), cleaned.rfind("}")
        if start == -1 or end <= start:
            raise ValueError("Model output contained no JSON object")
        try:
            value = json.loads(cleaned[start:end + 1])
        except json.JSONDecodeError as e:
            raise ValueError(f"Model output was not valid JSON: {e}") from e
    if not isinstance(value, dict):
        raise ValueError("Model output was not a JSON object")
    return value


def strip_dashes(text: str) -> str:
    """Replaces em and en dashes, a tell-tale of generated text: a range ("2019–2021") gets a hyphen, a dash
    before punctuation is dropped, any other dash becomes a comma."""
    text = re.sub(r"(?<=\d)\s*[–—]\s*(?=\d)", "-", text)
    text = re.sub(r"[ \t]*[–—][ \t]*(?=[.,;:!?)]|$)", "", text, flags=re.MULTILINE)
    text = re.sub(r"(?m)^[ \t]*[–—][ \t]*", "", text)
    text = re.sub(r"[ \t]*[–—]+[ \t]*", ", ", text)
    return re.sub(r",(\s*,)+", ",", text)


def fit_to_length(answer: str, max_length: Optional[int]) -> str:
    """Trims an over-long answer at the last sentence end that fits."""
    if not max_length or len(answer) <= max_length:
        return answer
    cut = answer[:max_length]
    last_stop = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "), cut.rfind(".\n"))
    if last_stop >= max_length * 0.5:
        return cut[:last_stop + 1].strip()
    return cut[: cut.rfind(" ")].rstrip(",;:- ") if " " in cut else cut


def fit_to_words(answer: str, max_words: Optional[int]) -> str:
    """Trims an answer over a word limit at the last sentence end within it (a guard: prompts target the limit)."""
    words = re.findall(r"\S+\s*", answer)
    if not max_words or len(words) <= max_words:
        return answer
    return fit_to_length(answer, len("".join(words[:max_words]).rstrip()))


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def match_option(answer: str, options: List[str]) -> Optional[str]:
    """The option the model meant: exact, then case/punctuation-insensitive, then a unique containment."""
    if answer in options:
        return answer
    target = _norm(answer)
    if not target:
        return None
    for option in options:
        if _norm(option) == target:
            return option
    contained = [o for o in options if _norm(o) and (_norm(o) in target or target in _norm(o))]
    if len(contained) == 1:
        return contained[0]
    # "Yes, I am authorized" -> "Yes"
    first = target.split()[0]
    leading = [o for o in options if _norm(o) == first]
    return leading[0] if len(leading) == 1 else None


def _coerce_to_field(answer: str, field: Optional[FieldContext]) -> str:
    """Makes a choice/number answer exactly what the field accepts, or raises ValueError."""
    if not field:
        return answer
    if field.is_choice:
        options = field.options or []
        if field.kind == "choice_multi":
            picked = [match_option(part.strip(), options) for part in re.split(r"\s*\|\s*|\n", answer) if part.strip()]
            if not picked or any(p is None for p in picked):
                raise ValueError(f"Answer {answer!r} is not a list of the given options")
            return " | ".join(dict.fromkeys(p for p in picked if p))
        option = match_option(answer, options)
        if option is None:
            raise ValueError(f"Answer {answer!r} is not one of the given options")
        return option
    if field.kind == "number":
        # "120,000" -> "120000"
        number = re.search(r"-?\d+(?:\.\d+)?", re.sub(r"(?<=\d),(?=\d{3}\b)", "", answer))
        if not number:
            raise ValueError(f"Answer {answer!r} is not a number")
        return number.group(0)
    return answer


def parse_answer(
    text: str,
    sources: Dict[str, Source],
    max_length: Optional[int] = None,
    field: Optional[FieldContext] = None,
) -> ParsedAnswer:
    return parse_answer_data(_extract_json(text), sources, max_length, field)


def parse_answer_data(
    data: Dict[str, Any],
    sources: Dict[str, Source],
    max_length: Optional[int] = None,
    field: Optional[FieldContext] = None,
) -> ParsedAnswer:
    status = str(data.get("status", "")).strip().lower()
    if status not in STATUSES:
        raise ValueError(f"Unknown status {status!r}")

    answer = str(data.get("answer") or "").strip()
    missing = data.get("missingInformation") or data.get("missing_information")
    missing = str(missing).strip() if missing else None

    if status == "answered" and not answer:
        raise ValueError("Status is answered but the answer is empty")
    if status == "insufficient_information":
        answer = ""
    else:
        answer = _coerce_to_field(answer, field)
        if not (field and (field.is_choice or field.kind == "number")):
            answer = strip_dashes(answer)
    question = data.get("missingQuestion") or data.get("missing_question")
    question = str(question).strip() if question and status == "insufficient_information" else None

    confidence = str(data.get("confidence", "medium")).strip().lower()
    if confidence not in CONFIDENCES:
        confidence = "medium"

    refs = data.get("usedSources") or data.get("used_sources") or []
    if not isinstance(refs, list):
        refs = []
    used = []
    for ref in refs:
        ref = str(ref).strip().strip("[]")
        if ref in sources and ref not in used:
            used.append(ref)

    return ParsedAnswer(
        status=status,
        answer=fit_to_words(fit_to_length(answer, max_length), field.max_words if field else None)
        if not (field and field.is_choice) else answer,
        confidence=confidence,
        used_refs=used,
        missing_information=missing,
        missing_question=question,
    )


def parse_batch(
    text: str, sources: Dict[str, Source], fields: Dict[str, Optional[FieldContext]]
) -> Dict[str, Optional[ParsedAnswer]]:
    """Parses {"answers": [...]}. Raises ValueError if the shape is wrong (so the gateway can try
    another provider); an individual answer that doesn't fit its field comes back as None and is
    retried on its own."""
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.IGNORECASE)
    try:
        data: Any = json.loads(cleaned)
    except json.JSONDecodeError:
        data = _extract_json(text)
    answers = data.get("answers") if isinstance(data, dict) else data
    if not isinstance(answers, list):
        raise ValueError("Batch output has no answers array")
    by_id = {str(a.get("id")): a for a in answers if isinstance(a, dict)}
    if not set(fields) <= set(by_id):
        raise ValueError(f"Batch output is missing ids: {sorted(set(fields) - set(by_id))}")
    results: Dict[str, Optional[ParsedAnswer]] = {}
    for item_id, field in fields.items():
        try:
            results[item_id] = parse_answer_data(by_id[item_id], sources, field.max_length if field else None, field)
        except ValueError:
            results[item_id] = None
    return results
