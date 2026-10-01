"""
Similar-Question Detection for Saved Answers.

Lightweight and deterministic: questions match when they ask the same kind of
thing (same classifier intent) and share enough meaning-bearing words, after
folding common synonyms ("proud of" ~ "enjoyed most", "role" ~ "position").
"""

import math
import re
from collections import Counter
from typing import Any, Dict, Iterable, List, Optional, Tuple

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


def _cosine(a: Iterable[str], b: Iterable[str]) -> float:
    ca, cb = Counter(a), Counter(b)
    if not ca or not cb:
        return 0.0
    dot = sum(ca[t] * cb[t] for t in ca)
    return dot / (math.sqrt(sum(v * v for v in ca.values())) * math.sqrt(sum(v * v for v in cb.values())))


def similarity(q1: str, q2: str) -> float:
    a1, a2 = classify_question(q1), classify_question(q2)
    text_score = _cosine(tokens(q1), tokens(q2))
    if a1.category != a2.category:
        return round(text_score * 0.8, 3)
    # Different skills asked about are different questions.
    if (a1.target_skills or a2.target_skills) and set(a1.target_skills) != set(a2.target_skills):
        return round(text_score * 0.5, 3)
    if a1.intent == a2.intent and a1.intent != "general":
        return round(0.5 + 0.5 * text_score, 3)
    return round(0.2 + 0.6 * text_score, 3)


def best_match(question: str, saved: List[Dict[str, Any]]) -> Tuple[Optional[Dict[str, Any]], float]:
    best, best_score = None, 0.0
    for row in saved:
        score = similarity(question, row["question"])
        if score > best_score:
            best, best_score = row, score
    if best_score < MATCH_THRESHOLD:
        return None, best_score
    return best, best_score
