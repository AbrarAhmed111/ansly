"""
Model Output Parsing.
Turns the model's JSON reply into a validated answer, or raises ValueError so
the gateway can try the next provider.
"""

import json
import re
from dataclasses import dataclass
from typing import Dict, List, Optional

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


def fit_to_length(answer: str, max_length: Optional[int]) -> str:
    """Trims an over-long answer at the last sentence end that fits."""
    if not max_length or len(answer) <= max_length:
        return answer
    cut = answer[:max_length]
    last_stop = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "), cut.rfind(".\n"))
    if last_stop >= max_length * 0.5:
        return cut[:last_stop + 1].strip()
    return cut[: cut.rfind(" ")].rstrip(",;:- ") if " " in cut else cut


def parse_answer(text: str, sources: Dict[str, Source], max_length: Optional[int] = None) -> ParsedAnswer:
    data = _extract_json(text)

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
        answer=fit_to_length(answer, max_length),
        confidence=confidence,
        used_refs=used,
        missing_information=missing,
    )
