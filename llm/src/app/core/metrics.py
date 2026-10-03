"""
Request Performance Metrics.

Collects lightweight timings for one API request (Supabase calls, LLM calls,
token counts, cache hits) and logs them as a single structured line when the
request finishes. Only operation names, tables, models and numbers are recorded,
never user content.
"""

import logging
import time
import uuid
from collections import Counter
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Optional

if TYPE_CHECKING:
    from src.app.core.llm_usage import LLMCall

logger = logging.getLogger("perf")


@dataclass
class RequestMetrics:
    started: float = field(default_factory=time.perf_counter)
    request_id: str = field(default_factory=lambda: uuid.uuid4().hex)
    # Milliseconds from the request's start to its first model call: the pre-LLM path (auth, Supabase reads,
    # retrieval). None when the request made no model call.
    first_llm_ms: Optional[float] = None
    cost_usd: float = 0.0
    cached_tokens: int = 0
    db_calls: int = 0
    db_ms: float = 0.0
    db_slowest: str = ""
    db_slowest_ms: float = 0.0
    llm_calls: int = 0
    llm_ms: float = 0.0
    llm_models: Counter = field(default_factory=Counter)
    tokens_in: int = 0
    tokens_out: int = 0
    # Input + output tokens per pipeline stage (see core/token_budget.py for the stage names).
    stage_tokens: Counter = field(default_factory=Counter)
    cache: Counter = field(default_factory=Counter)

    def record_db(self, operation: str, ms: float) -> None:
        self.db_calls += 1
        self.db_ms += ms
        if ms > self.db_slowest_ms:
            self.db_slowest, self.db_slowest_ms = operation, ms

    def record_llm(self, model: str, ms: float, tokens_in: int, tokens_out: int, stage: str = "unknown") -> None:
        self.llm_calls += 1
        self.llm_ms += ms
        self.llm_models[model] += 1
        self.tokens_in += tokens_in
        self.tokens_out += tokens_out
        self.stage_tokens[stage] += tokens_in + tokens_out

    def llm_started(self) -> None:
        if self.first_llm_ms is None:
            self.first_llm_ms = (time.perf_counter() - self.started) * 1000

    def summary(self, route: str, status: int) -> str:
        parts = [
            f"request_id={self.request_id}",
            f"route={route}",
            f"status={status}",
            f"total_ms={(time.perf_counter() - self.started) * 1000:.0f}",
            f"db_calls={self.db_calls}",
            f"db_ms={self.db_ms:.0f}",
        ]
        if self.db_slowest:
            parts.append(f"db_slowest={self.db_slowest}:{self.db_slowest_ms:.0f}ms")
        if self.llm_calls:
            parts += [
                f"llm_calls={self.llm_calls}",
                f"llm_ms={self.llm_ms:.0f}",
                f"models={','.join(sorted(self.llm_models))}",
                f"tokens_in={self.tokens_in}",
                f"tokens_out={self.tokens_out}",
            ]
            parts += [f"tokens.{stage}={n}" for stage, n in sorted(self.stage_tokens.items())]
            if self.cached_tokens:
                parts.append(f"tokens_cached={self.cached_tokens}")
            if self.cost_usd:
                parts.append(f"cost_usd={self.cost_usd:.6f}")
        if self.first_llm_ms is not None:
            parts.append(f"pre_llm_ms={self.first_llm_ms:.0f}")
        for name, count in sorted(self.cache.items()):
            parts.append(f"cache.{name}={count}")
        return " ".join(parts)


_current: ContextVar[Optional[RequestMetrics]] = ContextVar("request_metrics", default=None)


def start_request() -> RequestMetrics:
    metrics = RequestMetrics()
    _current.set(metrics)
    return metrics


def current() -> Optional[RequestMetrics]:
    return _current.get()


def record_db(operation: str, ms: float) -> None:
    metrics = _current.get()
    if metrics is not None:
        metrics.record_db(operation, ms)


def record_llm(model: str, ms: float, tokens_in: int, tokens_out: int, stage: str = "unknown") -> None:
    metrics = _current.get()
    if metrics is not None:
        metrics.record_llm(model, ms, tokens_in, tokens_out, stage)


def record_call(call: "LLMCall") -> None:
    """One provider call (core/llm_usage.py): tokens, cached tokens and cost on the perf line."""
    metrics = _current.get()
    if metrics is not None:
        metrics.record_llm(call.model, call.duration_ms, call.prompt_tokens, call.output_tokens, call.stage)
        metrics.cached_tokens += call.cache_read_tokens
        metrics.cost_usd += call.cost_usd or 0.0


def llm_started() -> None:
    """Marks the start of a model call (the first one ends the request's pre-LLM path)."""
    metrics = _current.get()
    if metrics is not None:
        metrics.llm_started()


def record_cache(name: str, hit: bool, outcome: Optional[str] = None) -> None:
    """Counts a cache lookup, e.g. record_cache("profile", hit=True) -> cache.profile_hit=1. `outcome` names a
    miss more precisely ("expired", "bypass")."""
    metrics = _current.get()
    if metrics is not None:
        metrics.cache[f"{name}_{'hit' if hit else outcome or 'miss'}"] += 1
