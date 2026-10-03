"""
Provider Adapters.
Each adapter sends one chat completion to one deployment and returns normalized text + usage.

- OpenAI-compatible providers (Gemini, Groq, OpenAI, Mistral, Cerebras, Cohere, OpenRouter)
  go through the official `openai` SDK with a custom base URL.
- Anthropic goes through the official `anthropic` SDK.

SDK clients are reused per deployment so their connection pools (and TLS
sessions to the provider) survive between calls.
"""

import asyncio
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple

import anthropic
import openai

from .deployment import ProviderDeployment


@dataclass
class Completion:
    text: str
    usage: Dict[str, int] = field(default_factory=dict)


class RefusalError(Exception):
    """The model declined the request; the gateway falls back to the next deployment."""


# (kind, key, base_url, timeout, retries) -> (event loop, client). Bounded by the number of deployments.
_clients: Dict[Tuple[Any, ...], Tuple[asyncio.AbstractEventLoop, Any]] = {}


def _cached_client(key: Tuple[Any, ...], factory: Callable[[], Any]) -> Any:
    """An SDK client for this deployment, rebuilt if the event loop changed (it is bound to the first loop it ran on)."""
    loop = asyncio.get_running_loop()
    entry = _clients.get(key)
    if entry is None or entry[0] is not loop:
        entry = (loop, factory())
        _clients[key] = entry
    return entry[1]


def _usage(prompt: Optional[int] = 0, completion: Optional[int] = 0, cached: Optional[int] = 0,
           cache_write: Optional[int] = 0, reasoning: Optional[int] = None) -> Dict[str, int]:
    """Normalized usage: prompt_tokens is all input (cached included), cached_tokens the part read from a cache,
    cache_write_tokens the part written to one, reasoning_tokens the thinking inside completion_tokens (only
    when the provider reports it separately)."""
    prompt, completion = prompt or 0, completion or 0
    usage = {"prompt_tokens": prompt, "completion_tokens": completion, "total_tokens": prompt + completion,
             "cached_tokens": cached or 0, "cache_write_tokens": cache_write or 0}
    if reasoning is not None:
        usage["reasoning_tokens"] = reasoning
    return usage


# Claude models that reject output_config.effort (it errors on Haiku 4.5 and Sonnet 4.5); they run without it.
NO_EFFORT_MODELS = ("claude-haiku", "claude-sonnet-4-5", "claude-3")


def supports_effort(model: str) -> bool:
    return not model.startswith(NO_EFFORT_MODELS)


async def complete_openai_compatible(
    deployment: ProviderDeployment,
    system: str,
    messages: List[Dict[str, str]],
    temperature: Optional[float],
    max_tokens: Optional[int],
    timeout: float,
    max_retries: int,
) -> Completion:
    client = _cached_client(
        ("openai", deployment.api_key, deployment.base_url, timeout, max_retries),
        lambda: openai.AsyncOpenAI(
            api_key=deployment.api_key,
            base_url=deployment.base_url,
            timeout=timeout,
            max_retries=max_retries,
        ),
    )
    kwargs = {}
    if temperature is not None:
        kwargs["temperature"] = temperature
    if max_tokens is not None:
        kwargs["max_tokens"] = max_tokens

    response = await client.chat.completions.create(
        model=deployment.default_model,
        messages=[{"role": "system", "content": system}, *messages],
        **kwargs,
    )
    choice = response.choices[0]
    if getattr(choice, "finish_reason", None) == "content_filter":
        raise RefusalError("content_filter")
    usage = response.usage
    prompt_details = getattr(usage, "prompt_tokens_details", None)
    completion_details = getattr(usage, "completion_tokens_details", None)
    return Completion(
        text=choice.message.content or "",
        usage=_usage(getattr(usage, "prompt_tokens", 0), getattr(usage, "completion_tokens", 0),
                     cached=getattr(prompt_details, "cached_tokens", 0),
                     reasoning=getattr(completion_details, "reasoning_tokens", None)),
    )


async def complete_anthropic(
    deployment: ProviderDeployment,
    system: str,
    messages: List[Dict[str, str]],
    max_tokens: int,
    effort: str,
    timeout: float,
    max_retries: int,
    model: Optional[str] = None,
) -> Completion:
    client = _cached_client(
        ("anthropic", deployment.api_key, timeout, max_retries),
        lambda: anthropic.AsyncAnthropic(api_key=deployment.api_key, timeout=timeout, max_retries=max_retries),
    )
    # Current Claude models reject sampling parameters and keep thinking on, so
    # depth is controlled with effort. Server-side fallbacks re-run a refused
    # request on another Claude model inside the same call. The system prompt is
    # the stable prefix of every call of a stage, so it is cached (prompts under
    # the model's minimum cacheable length simply aren't).
    model = model or deployment.default_model
    extra: Dict[str, Any] = {"output_config": {"effort": effort}} if supports_effort(model) else {}
    response = await client.beta.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
        messages=messages,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        **extra,
    )
    if response.stop_reason == "refusal":
        details = getattr(response, "stop_details", None)
        raise RefusalError(getattr(details, "category", None) or "refusal")
    text = "".join(block.text for block in response.content if block.type == "text")
    # input_tokens excludes cached input; count all of it so token logs and budgets see the real prompt size.
    # Thinking is billed inside output_tokens; Anthropic doesn't report it separately.
    usage = response.usage
    read = getattr(usage, "cache_read_input_tokens", 0) or 0
    write = getattr(usage, "cache_creation_input_tokens", 0) or 0
    return Completion(text=text, usage=_usage(usage.input_tokens + read + write, usage.output_tokens,
                                              cached=read, cache_write=write))
