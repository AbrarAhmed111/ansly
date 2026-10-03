"""
Per-Call LLM Usage (production token and cost accounting).

Every provider call the gateway makes, and every embedding request, becomes one
`LLMCall`: stage, provider, model, provider-reported tokens split into uncached
input / cache read / cache write / output (thinking included, and reported
separately where the provider does), duration, and cost from core/pricing.py.
Calls whose output failed validation are recorded too: the provider billed them.

Calls collect in a per-request list (a context variable, so concurrent
`asyncio.gather` branches share it) and are written to `public.llm_calls` in
one insert, tagged with the job they were for. That table, not the benchmark's
estimates, is the source of truth for tokens and cost per application (see the
`application_usage` view). No prompt or answer text is ever recorded.
"""

import logging
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Dict, Iterator, List, Optional

from src.app.core import metrics
from src.app.core.config import get_settings
from src.app.core.pricing import cost_usd

logger = logging.getLogger("llm_usage")

TABLE = "llm_calls"


@dataclass
class LLMCall:
    stage: str
    provider: str
    model: str
    # Uncached input; cached input is in cache_read_tokens / cache_write_tokens.
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    # Reasoning/thinking tokens when the provider reports them separately (already included in output_tokens).
    thinking_tokens: Optional[int] = None
    duration_ms: int = 0
    # Time to first token; only streaming calls have one.
    ttft_ms: Optional[int] = None
    # Questions this call answered (batches).
    items: int = 1
    # False: the provider answered but the output failed validation (billed, not used).
    ok: bool = True
    cost_usd: Optional[float] = None

    @property
    def prompt_tokens(self) -> int:
        """All input, cached or not: the prompt's real size."""
        return self.input_tokens + self.cache_read_tokens + self.cache_write_tokens

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.output_tokens

    def row(self, job_key: Optional[str], job_context_id: Optional[str], request_id: Optional[str]) -> Dict[str, Any]:
        return {
            "stage": self.stage, "provider": self.provider, "model": self.model[:100],
            "input_tokens": self.input_tokens, "output_tokens": self.output_tokens,
            "cache_read_tokens": self.cache_read_tokens, "cache_write_tokens": self.cache_write_tokens,
            "thinking_tokens": self.thinking_tokens, "duration_ms": self.duration_ms, "ttft_ms": self.ttft_ms,
            "items": self.items, "ok": self.ok, "cost_usd": self.cost_usd,
            "job_key": job_key, "job_context_id": job_context_id, "request_id": request_id,
        }


def from_usage(stage: str, provider: str, model: str, usage: Dict[str, int], duration_ms: int,
               items: int = 1, ok: bool = True) -> LLMCall:
    """A call from an adapter's normalized usage (gateway/adapters.py): prompt_tokens is all input."""
    prompt = int(usage.get("prompt_tokens", 0) or 0)
    read = int(usage.get("cached_tokens", 0) or 0)
    write = int(usage.get("cache_write_tokens", 0) or 0)
    output = int(usage.get("completion_tokens", 0) or 0)
    thinking = usage.get("reasoning_tokens")
    call = LLMCall(stage=stage, provider=provider, model=model, input_tokens=max(0, prompt - read - write),
                   output_tokens=output, cache_read_tokens=read, cache_write_tokens=write,
                   thinking_tokens=int(thinking) if thinking is not None else None, duration_ms=duration_ms,
                   items=items, ok=ok)
    call.cost_usd = cost_usd(model, call.input_tokens, output, read, write)
    return call


_sink: ContextVar[Optional[List[LLMCall]]] = ContextVar("llm_calls", default=None)


def record(call: LLMCall) -> None:
    """Adds a call to the current request's list (if one is collecting) and to its perf line."""
    calls = _sink.get()
    if calls is not None:
        calls.append(call)
    metrics.record_call(call)


@contextmanager
def collect() -> Iterator[List[LLMCall]]:
    """Collects the calls made inside the block (including in tasks it starts)."""
    calls: List[LLMCall] = []
    token = _sink.set(calls)
    try:
        yield calls
    finally:
        _sink.reset(token)


def start_collecting() -> List[LLMCall]:
    """Starts a list for this request (the middleware does this for every API request)."""
    calls: List[LLMCall] = []
    _sink.set(calls)
    return calls


async def write_calls(rest: Any, calls: List[LLMCall], job_key: Optional[str] = None,
                      job_context_id: Optional[str] = None) -> None:
    """One insert for the calls. Accounting never fails the user's request."""
    if not calls:
        return
    request = metrics.current()
    request_id = request.request_id if request else None
    try:
        await rest.insert_many(TABLE, [c.row(job_key, job_context_id, request_id) for c in calls])
    except Exception as e:  # noqa: BLE001 — e.g. the migration isn't applied yet
        logger.warning(f"Could not record {len(calls)} LLM call(s): {type(e).__name__}: {e}")


def drain() -> List[LLMCall]:
    """The calls collected so far, removed from the list (so a later write doesn't repeat them)."""
    calls = _sink.get()
    if not calls:
        return []
    taken = list(calls)
    calls.clear()
    return taken


async def defer(background: Any, work: Callable[[], Awaitable[None]]) -> None:
    """Runs analytics `work` after the response (FastAPI BackgroundTasks) when USAGE_WRITE_BACKGROUND is on and a
    background is given, otherwise now. The user's answer never waits for it unless it must."""
    if background is not None and get_settings().USAGE_WRITE_BACKGROUND:
        background.add_task(work)
        return
    try:
        await work()
    except Exception as e:  # noqa: BLE001
        logger.warning(f"Usage write failed: {type(e).__name__}: {e}")


async def flush(rest: Any, background: Any = None, job_key: Optional[str] = None,
                job_context_id: Optional[str] = None) -> None:
    """Writes this request's calls so far (see `defer` for when)."""
    calls = drain()
    if calls:
        await defer(background, lambda: write_calls(rest, calls, job_key, job_context_id))
