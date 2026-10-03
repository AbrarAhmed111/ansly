"""
Model Pricing (USD per million tokens).

The one place prices live. Every LLM call's cost is computed from it when the
call is recorded (core/llm_usage.py), so changing a price here changes the
cost of new calls only; stored rows keep the cost they were recorded with.

- `input`: uncached input. `cache_write`: input written to a provider cache
  (Anthropic bills 1.25x input for 5-minute writes). `cache_read`: input
  served from a cache. `output`: output, including thinking/reasoning tokens,
  which every provider here bills as output.
- Models not listed have no cost (recorded as null, "unpriced"), never a guess.
  Add them here or, without a deploy, in MODEL_PRICING_JSON:
  {"gemini-2.5-flash-lite": {"input": 0.1, "output": 0.4, "cache_read": 0.025}}
- Embedding models price input only.

Anthropic prices as of 2026-09-25 (first-party API). Check before relying on
cost figures for other providers: they are only what MODEL_PRICING_JSON sets.
"""

import json
import logging
from dataclasses import dataclass
from functools import lru_cache
from typing import Dict, Optional

from src.app.core.config import get_settings

logger = logging.getLogger("pricing")


@dataclass(frozen=True)
class Price:
    input: float
    output: float = 0.0
    # None: billed like input (no cache discount known).
    cache_read: Optional[float] = None
    cache_write: Optional[float] = None


MODEL_PRICING: Dict[str, Price] = {
    "claude-fable-5-1": Price(input=10.00, output=50.00, cache_read=0.25, cache_write=12.50),
    "claude-opus-5-5": Price(input=4.00, output=20.00, cache_read=0.20, cache_write=5.00),
    "claude-sonnet-5-5": Price(input=2.00, output=10.00, cache_read=0.20, cache_write=2.50),
    "claude-haiku-4-5": Price(input=1.00, output=5.00, cache_read=0.10, cache_write=1.25),
}


@lru_cache()
def _pricing() -> Dict[str, Price]:
    table = dict(MODEL_PRICING)
    raw = get_settings().MODEL_PRICING_JSON.strip()
    if raw:
        try:
            for model, values in json.loads(raw).items():
                table[model] = Price(**values)
        except (ValueError, TypeError) as e:
            logger.warning(f"MODEL_PRICING_JSON ignored: {e}")
    return table


def price_for(model: Optional[str]) -> Optional[Price]:
    """The model's price, matching a dated or prefixed id ("claude-haiku-4-5-2025...", "openai/gpt-oss-20b")."""
    if not model:
        return None
    table = _pricing()
    if model in table:
        return table[model]
    for name in sorted(table, key=len, reverse=True):
        if model.startswith(name) or model.endswith("/" + name):
            return table[name]
    return None


def cost_usd(model: Optional[str], input_tokens: int = 0, output_tokens: int = 0, cache_read_tokens: int = 0,
             cache_write_tokens: int = 0) -> Optional[float]:
    """Cost of one call. `input_tokens` is uncached input only. None when the model has no price."""
    price = price_for(model)
    if price is None:
        return None
    read = price.input if price.cache_read is None else price.cache_read
    write = price.input if price.cache_write is None else price.cache_write
    total = (input_tokens * price.input + output_tokens * price.output + cache_read_tokens * read
             + cache_write_tokens * write) / 1_000_000
    return round(total, 8)


def clear_pricing_cache() -> None:
    _pricing.cache_clear()
