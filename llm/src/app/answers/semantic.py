"""
Semantic Retrieval (fallback).

Answers retrieve evidence by keywords and metadata first (profile_context). Only
when that finds too little for a question whose wording is likely to differ from
the profile's ("a time you disagreed" vs "pushed back on a rewrite"), the engine
asks this module for the records most similar to the question.

- Embeddings live in public.candidate_evidence (pgvector, RLS: users see only
  their own), one row per experience, project, achievement and saved fact,
  keyed by a content hash. They are computed lazily, the first time a fallback
  needs them, and only for records that are new or changed since; records that
  no longer exist are removed. Simple fields (location, salary, authorization)
  are never embedded: structured lookups answer those.
- The vectors hold no text: the records stay in their own tables.
- Off unless EMBEDDING_PROVIDER is set; then failures are logged and the answer
  goes ahead with keyword evidence alone.
"""

import hashlib
import logging
import time
from typing import Any, Dict, List, Optional, Protocol, Tuple

from src.app.core import llm_usage
from src.app.core.config import get_settings
from src.app.core.pricing import cost_usd
from src.app.core.token_budget import EMBEDDING_PROFILE, EMBEDDING_QUERY
from src.app.core.ttl_cache import TTLCache
from src.app.db.rest import SupabaseError, SupabaseRest
from src.app.gateway.providers import discover_keys

logger = logging.getLogger("SemanticRetrieval")

TABLE = "candidate_evidence"
EMBEDDING_VERSION = 1
# Question categories whose wording often differs from the profile's.
SEMANTIC_CATEGORIES = {"behavioral", "strengths", "motivation", "project", "experience", "achievement", "general",
                       "about_me"}
# Score added to a record semantic retrieval found (profile_context scores shared terms at 4 each).
SEMANTIC_BOOST = 5.0
MATCH_COUNT = 4
MIN_SIMILARITY = 0.3

SOURCES = {"experiences": "experience", "projects": "project", "achievements": "achievement",
           "profile_facts": "fact"}
DEFAULT_MODELS = {"openai": "text-embedding-3-small", "gemini": "gemini-embedding-001"}
BASE_URLS = {"openai": None, "gemini": "https://generativelanguage.googleapis.com/v1beta/openai/"}
KEY_SETTINGS = {"openai": "OPENAI_API_KEY", "gemini": "GOOGLE_API_KEY"}

# What's already embedded per user ((source_type, source_id) -> content hash), so a sync is one read per user
# every few minutes, and query embeddings, so asking the same question again costs nothing.
_synced: TTLCache[Dict[Tuple[str, str], str]] = TTLCache(300, max_entries=2000)
_queries: TTLCache[List[float]] = TTLCache(3600, max_entries=2000)


class Embedder(Protocol):
    model: str

    async def embed(self, texts: List[str]) -> Tuple[List[List[float]], int]:
        """Vectors for `texts`, and the tokens it cost."""


class OpenAICompatibleEmbedder:
    def __init__(self, api_key: str, model: str, dimensions: int, base_url: Optional[str]):
        import openai

        self.model = model
        self.dimensions = dimensions
        self._client = openai.AsyncOpenAI(api_key=api_key, base_url=base_url, timeout=15.0, max_retries=1)

    async def embed(self, texts: List[str]) -> Tuple[List[List[float]], int]:
        response = await self._client.embeddings.create(model=self.model, input=texts, dimensions=self.dimensions)
        usage = getattr(response, "usage", None)
        tokens = int(getattr(usage, "total_tokens", 0) or 0)
        # Gemini's OpenAI-compatible endpoint reports no usage: estimate (characters / 4) rather than record zero.
        return [d.embedding for d in response.data], tokens or sum(-(-len(t) // 4) for t in texts)


def record_text(section: str, row: Dict[str, Any]) -> str:
    """The text a record is embedded from: what it is and what it says, without dates or URLs."""
    if section == "profile_facts":
        return f"{row.get('prompt', '')}: {row.get('answer') or ''}"
    head = {"experiences": f"{row.get('title')} at {row.get('company')}", "projects": f"Project {row.get('name')}",
            "achievements": f"Achievement {row.get('title')}"}[section]
    parts = [head, row.get("description") or "", "; ".join(map(str, row.get("highlights") or [])),
             ", ".join(map(str, row.get("technologies") or []))]
    return ". ".join(p for p in parts if p)


def content_hash(model: str, text: str) -> str:
    return hashlib.sha256(f"{model}\n{EMBEDDING_VERSION}\n{text}".encode()).hexdigest()


def _vector(values: List[float]) -> str:
    return "[" + ",".join(f"{v:.7g}" for v in values) + "]"


class SemanticRetriever:
    def __init__(self, embedder: Optional[Embedder]):
        self.embedder = embedder

    @property
    def enabled(self) -> bool:
        return self.embedder is not None

    @classmethod
    def from_settings(cls) -> "SemanticRetriever":
        settings = get_settings()
        provider = settings.EMBEDDING_PROVIDER.strip().lower()
        # The provider's first key, plain or numbered (GOOGLE_API_KEY1...), as the gateway finds them.
        keys = discover_keys(settings, KEY_SETTINGS[provider]) if provider in KEY_SETTINGS else []
        key = keys[0] if keys else None
        if not key:
            return cls(None)
        model = settings.EMBEDDING_MODEL or DEFAULT_MODELS[provider]
        return cls(OpenAICompatibleEmbedder(key, model, settings.EMBEDDING_DIMENSIONS, BASE_URLS[provider]))

    async def _embed(self, texts: List[str], stage: str) -> List[List[float]]:
        """Embeds `texts`; the request is recorded on its own stage, so embedding cost never mixes with generation."""
        started = time.perf_counter()
        vectors, tokens = await self.embedder.embed(texts)
        model = self.embedder.model
        llm_usage.record(llm_usage.LLMCall(stage=stage, provider=get_settings().EMBEDDING_PROVIDER or "embedding",
                                           model=model, input_tokens=tokens,
                                           duration_ms=int((time.perf_counter() - started) * 1000),
                                           items=len(texts), cost_usd=cost_usd(model, tokens)))
        return vectors

    async def sync(self, rest: SupabaseRest, user_id: str, data: Dict[str, Any]) -> None:
        """Embeds new and changed records and removes ones that are gone. Unchanged records cost nothing."""
        model = self.embedder.model
        stored = _synced.get((user_id, model))
        if stored is None:
            rows = await rest.select(TABLE, {"select": "source_type,source_id,content_hash",
                                             "embedding_model": f"eq.{model}"})
            stored = {(r["source_type"], str(r["source_id"])): r["content_hash"] for r in rows}
        current: Dict[Tuple[str, str], Tuple[str, str]] = {}
        for section, source_type in SOURCES.items():
            for row in data.get(section) or []:
                if row.get("id"):
                    text = record_text(section, row)
                    current[(source_type, str(row["id"]))] = (text, content_hash(model, text))
        changed = [key for key, (_, digest) in current.items() if stored.get(key) != digest]
        if changed:
            vectors = await self._embed([current[key][0] for key in changed], EMBEDDING_PROFILE)
            await rest.upsert(TABLE, [
                {"source_type": key[0], "source_id": key[1], "content_hash": current[key][1],
                 "embedding": _vector(vec), "embedding_model": model, "embedding_version": EMBEDDING_VERSION}
                for key, vec in zip(changed, vectors)
            ], on_conflict="user_id,source_type,source_id")
        # Only sections that were fetched can tell what's gone.
        fetched = {SOURCES[s] for s in SOURCES if s in data}
        gone = [key for key in stored if key not in current and key[0] in fetched]
        for source_type in {k[0] for k in gone}:
            ids = ",".join(k[1] for k in gone if k[0] == source_type)
            await rest.delete(TABLE, {"source_type": f"eq.{source_type}", "source_id": f"in.({ids})"})
        _synced.set((user_id, model), {**{k: v for k, v in stored.items() if k not in gone},
                                       **{k: current[k][1] for k in changed}})

    async def search(self, rest: SupabaseRest, user_id: str, data: Dict[str, Any], query: str) -> List[str]:
        """Ids of the user's records most similar to `query` (empty when disabled or on any failure)."""
        if not self.enabled or not query.strip():
            return []
        try:
            await self.sync(rest, user_id, data)
            key = (self.embedder.model, hashlib.sha256(query.encode()).hexdigest())
            vector = _queries.get(key)
            if vector is None:
                vector = (await self._embed([query], EMBEDDING_QUERY))[0]
                _queries.set(key, vector)
            rows = await rest.rpc("match_candidate_evidence", {"query_embedding": _vector(vector),
                                                               "model": self.embedder.model,
                                                               "match_count": MATCH_COUNT})
        except (SupabaseError, Exception) as e:  # noqa: BLE001 — keyword evidence alone is still a safe answer
            logger.warning(f"Semantic retrieval skipped: {type(e).__name__}: {e}")
            return []
        return [str(r["source_id"]) for r in rows if (r.get("similarity") or 0) >= MIN_SIMILARITY]


def invalidate_semantic_cache(user_id: str) -> None:
    _synced.invalidate_user(user_id)
