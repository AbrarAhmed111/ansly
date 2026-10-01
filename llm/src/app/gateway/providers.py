"""
Provider Registry.
Declares every supported provider and builds deployments from settings.

Keys are discovered as <KEY_PREFIX> and <KEY_PREFIX>1..N, so adding a key is
just adding another numbered line to .env. Each key becomes one deployment on
the provider's primary model; the provider's fallback model (if set) runs on
its first key after all of that provider's primary deployments.
"""

from dataclasses import dataclass
from typing import List, Optional

from src.app.core.config import Settings

from .deployment import ProviderDeployment

MAX_KEYS_PER_PROVIDER = 20


@dataclass(frozen=True)
class ProviderSpec:
    name: str
    label: str
    key_prefix: str
    model_setting: str
    fallback_model_setting: str
    base_url: Optional[str] = None
    kind: str = "openai_compatible"


PROVIDERS = {
    spec.name: spec
    for spec in [
        ProviderSpec("gemini", "Gemini", "GOOGLE_API_KEY", "GEMINI_MODEL", "GEMINI_FALLBACK_MODEL",
                     "https://generativelanguage.googleapis.com/v1beta/openai/"),
        ProviderSpec("groq", "Groq", "GROQ_API_KEY", "GROQ_MODEL", "GROQ_FALLBACK_MODEL",
                     "https://api.groq.com/openai/v1"),
        ProviderSpec("openai", "OpenAI", "OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_FALLBACK_MODEL"),
        ProviderSpec("anthropic", "Anthropic", "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "ANTHROPIC_FALLBACK_MODEL",
                     kind="anthropic"),
        ProviderSpec("mistral", "Mistral", "MISTRAL_API_KEY", "MISTRAL_MODEL", "MISTRAL_FALLBACK_MODEL",
                     "https://api.mistral.ai/v1"),
        ProviderSpec("cerebras", "Cerebras", "CEREBRAS_API_KEY", "CEREBRAS_MODEL", "CEREBRAS_FALLBACK_MODEL",
                     "https://api.cerebras.ai/v1"),
        ProviderSpec("cohere", "Cohere", "COHERE_API_KEY", "COHERE_MODEL", "COHERE_FALLBACK_MODEL",
                     "https://api.cohere.ai/compatibility/v1"),
        ProviderSpec("openrouter", "OpenRouter", "OPENROUTER_API_KEY", "OPENROUTER_MODEL",
                     "OPENROUTER_FALLBACK_MODEL", "https://openrouter.ai/api/v1"),
    ]
}


def discover_keys(settings: Settings, prefix: str) -> List[str]:
    """Returns unique keys from PREFIX and PREFIX1..N, in that order."""
    keys: List[str] = []
    for name in [prefix] + [f"{prefix}{i}" for i in range(1, MAX_KEYS_PER_PROVIDER + 1)]:
        value = settings.lookup(name)
        if value and value not in keys:
            keys.append(value)
    return keys


def build_deployments(settings: Settings, cooldown_seconds: int) -> List[ProviderDeployment]:
    """Builds deployments in GATEWAY_PROVIDER_ORDER, skipping unknown or keyless providers."""
    deployments: List[ProviderDeployment] = []
    for provider in settings.provider_order:
        spec = PROVIDERS.get(provider)
        if spec is None:
            continue
        keys = discover_keys(settings, spec.key_prefix)
        model = settings.lookup(spec.model_setting)
        if not keys or not model:
            continue

        for i, key in enumerate(keys, start=1):
            deployments.append(
                ProviderDeployment(
                    name=f"{spec.label} #{i}" if len(keys) > 1 else spec.label,
                    provider=spec.name,
                    api_key=key,
                    base_url=spec.base_url,
                    default_model=model,
                    kind=spec.kind,
                    cooldown_seconds=cooldown_seconds,
                )
            )

        fallback_model = settings.lookup(spec.fallback_model_setting)
        if fallback_model and fallback_model != model:
            deployments.append(
                ProviderDeployment(
                    name=f"{spec.label} (Quality Fallback)",
                    provider=spec.name,
                    api_key=keys[0],
                    base_url=spec.base_url,
                    default_model=fallback_model,
                    kind=spec.kind,
                    cooldown_seconds=cooldown_seconds,
                )
            )
    return deployments
