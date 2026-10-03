"""
Structured LLM Calls for the Resume Pipeline.

Every step asks the gateway for one JSON object and validates it in code; a
provider whose output fails validation is skipped (gateway fallback). Token
usage is accumulated so each tailoring can record its cost.
"""

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, TypeVar

from src.app.answers.parser import _extract_json
from src.app.gateway import LLMGateway

T = TypeVar("T")


@dataclass
class Usage:
    tokens: int = 0
    calls: int = 0
    providers: List[str] = field(default_factory=list)

    def add(self, usage: Dict[str, int], provider: str) -> None:
        self.calls += 1
        self.tokens += int(usage.get("prompt_tokens", 0) or 0) + int(usage.get("completion_tokens", 0) or 0)
        if provider not in self.providers:
            self.providers.append(provider)


async def call_json(
    gateway: LLMGateway,
    system: str,
    user: str,
    parse: Callable[[Dict[str, Any]], T],
    usage: Optional[Usage] = None,
    max_tokens: int = 4096,
    temperature: float = 0.2,
) -> T:
    """Runs one completion and returns `parse(json_object)`. `parse` raising ValueError tries the next provider."""
    result = await gateway.generate(
        system,
        [{"role": "user", "content": user}],
        temperature=temperature,
        max_tokens=max_tokens,
        validate=lambda text: parse(_extract_json(text)),
    )
    if usage is not None:
        usage.add(result.usage, result.provider)
    return result.value
