"""
Similar-Question Detection for Saved Answers.

Lightweight and deterministic: questions match when they ask the same kind of
thing (same classifier intent) and share enough meaning-bearing words, after
folding common synonyms ("proud of" ~ "enjoyed most", "role" ~ "position").
"""

import math
import re
from collections import Counter
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Dict, FrozenSet, List, Optional, Tuple

from .classifier import classify_question

MATCH_THRESHOLD = 0.55

STOPWORDS = {
    "a", "an", "the", "and", "or", "but", "of", "to", "in", "on", "for", "with", "at", "by", "from", "about",
    "as", "is", "are", "was", "were", "be", "been", "being", "do", "does", "did", "have", "has", "had",
    "you", "your", "yours", "you've", "you're", "we", "us", "our", "i", "me", "my", "it", "its", "this",
    "that", "these", "those", "what", "which", "who", "whom", "why", "how", "when", "where", "can", "could",
    "would", "should", "will", "please", "tell", "describe", "share", "give", "explain", "briefly", "any",
    "some", "one", "there", "if", "so", "than", "then", "also", "most", "more", "very", "s", "ve", "re",
}

SYNONYM_GROUPS = [
    {"proud", "favorite", "favourite", "enjoy", "enjoyed", "love", "loved", "best", "like", "liked"},
    {"interest", "interested", "interests", "excite", "excites", "excited", "attract", "attracts",
     "attracted", "appeal", "appeals", "motivate", "motivates", "motivated", "want", "apply", "applying"},
    {"challenge", "challenging", "challenges", "difficult", "hard", "hardest", "obstacle", "complex", "tough"},
    {"role", "position", "job", "opportunity", "opening"},
    {"company", "organization", "organisation", "team", "here"},
    {"project", "projects", "build", "built", "building", "create", "created", "made"},
    {"strength", "strengths", "strong", "good", "excel"},
    {"weakness", "weaknesses", "improve", "improvement"},
    {"experience", "experienced", "background", "worked", "work"},
    {"yourself", "self", "introduce", "introduction"},
]
_CANONICAL = {word: sorted(group)[0] for group in SYNONYM_GROUPS for word in group}


def _stem(word: str) -> str:
    for suffix in ("ing", "ed", "es", "s"):
        if len(word) > len(suffix) + 3 and word.endswith(suffix):
            return word[: -len(suffix)]
    return word


def tokens(text: str) -> List[str]:
    words = re.findall(r"[a-z0-9+#.]+(?:'[a-z]+)?", text.lower().replace("’", "'"))
    out = []
    for w in words:
        w = w.strip(".")
        if not w or w in STOPWORDS:
            continue
        out.append(_CANONICAL.get(w) or _CANONICAL.get(_stem(w)) or _stem(w))
    return out


@dataclass(frozen=True)
class _Features:
    category: str
    intent: str
    skills: FrozenSet[str]
    counts: Tuple[Tuple[str, int], ...]
    norm: float


@lru_cache(maxsize=4096)
def _features(question: str) -> _Features:
    """Classification and token counts for a question. Cached: a saved question is compared on every match."""
    analysis = classify_question(question)
    counts = Counter(tokens(question))
    return _Features(analysis.category, analysis.intent, frozenset(analysis.target_skills),
                     tuple(counts.items()), math.sqrt(sum(v * v for v in counts.values())))


def _cosine(a: _Features, b: _Features) -> float:
    if not a.norm or not b.norm:
        return 0.0
    small, large = (a, b) if len(a.counts) <= len(b.counts) else (b, a)
    other = dict(large.counts)
    dot = sum(count * other.get(token, 0) for token, count in small.counts)
    return dot / (a.norm * b.norm)


def _similarity(f1: _Features, f2: _Features) -> float:
    text_score = _cosine(f1, f2)
    if f1.category != f2.category:
        return round(text_score * 0.8, 3)
    # Different skills asked about are different questions.
    if (f1.skills or f2.skills) and f1.skills != f2.skills:
        return round(text_score * 0.5, 3)
    if f1.intent == f2.intent and f1.intent != "general":
        return round(0.5 + 0.5 * text_score, 3)
    return round(0.2 + 0.6 * text_score, 3)


def similarity(q1: str, q2: str) -> float:
    return _similarity(_features(q1), _features(q2))


def best_match(question: str, saved: List[Dict[str, Any]]) -> Tuple[Optional[Dict[str, Any]], float]:
    best, best_score = None, 0.0
    asked = _features(question)
    for row in saved:
        score = _similarity(asked, _features(row["question"]))
        if score > best_score:
            best, best_score = row, score
    if best_score < MATCH_THRESHOLD:
        return None, best_score
    return best, best_score
