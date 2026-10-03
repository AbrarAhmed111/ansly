"""
Request Performance Metrics.

Collects lightweight timings for one API request (Supabase calls, LLM calls,
token counts, cache hits) and logs them as a single structured line when the
request finishes. Only operation names, tables, models and numbers are recorded,
never user content.
"""

import logging
import time
from collections import Counter
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger("perf")


@dataclass
class RequestMetrics:
    started: float = field(default_factory=time.perf_counter)
    db_calls: int = 0
    db_ms: float = 0.0
    db_slowest: str = ""
    db_slowest_ms: float = 0.0
    llm_calls: int = 0
    llm_ms: float = 0.0
    llm_models: Counter = field(default_factory=Counter)
    tokens_in: int = 0
    tokens_out: int = 0
    cache: Counter = field(default_factory=Counter)

    def record_db(self, operation: str, ms: float) -> None:
        self.db_calls += 1
        self.db_ms += ms
        if ms > self.db_slowest_ms:
            self.db_slowest, self.db_slowest_ms = operation, ms

    def record_llm(self, model: str, ms: float, tokens_in: int, tokens_out: int) -> None:
        self.llm_calls += 1
        self.llm_ms += ms
        self.llm_models[model] += 1
        self.tokens_in += tokens_in
        self.tokens_out += tokens_out

    def summary(self, route: str, status: int) -> str:
        parts = [
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


def record_llm(model: str, ms: float, tokens_in: int, tokens_out: int) -> None:
    metrics = _current.get()
    if metrics is not None:
        metrics.record_llm(model, ms, tokens_in, tokens_out)


def record_cache(name: str, hit: bool) -> None:
    """Counts a cache lookup, e.g. record_cache("profile", hit=True) -> cache.profile_hit=1."""
    metrics = _current.get()
    if metrics is not None:
        metrics.cache[f"{name}_{'hit' if hit else 'miss'}"] += 1
