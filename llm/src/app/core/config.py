"""
Application Configuration.
Loads validated environment variables with sensible defaults using Pydantic Settings.

Provider API keys are not declared here: the gateway discovers any number of
numbered keys (e.g. GROQ_API_KEY1..N) through `Settings.lookup`.
"""

import os
from functools import lru_cache
from typing import List, Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Global configuration settings."""

    # Application
    APP_NAME: str = "Ansly LLM"
    ENVIRONMENT: str = "development"
    LOG_LEVEL: str = "INFO"
    HOST: str = "0.0.0.0"
    PORT: int = 8000

    # CORS Whitelist (comma-separated strings)
    ALLOWED_ORIGINS: str = "http://localhost:3000,http://127.0.0.1:3000"

    # Supabase
    SUPABASE_URL: str = ""
    SUPABASE_PUBLISHABLE_KEY: str = ""
    # Only needed if the project still signs user JWTs with the legacy HS256 secret.
    SUPABASE_JWT_SECRET: str = ""

    # Answer generation
    LLM_TEMPERATURE: float = 0.4
    LLM_MAX_TOKENS: int = 2048
    JOB_DESCRIPTION_MAX_CHARS: int = 6000

    # Usage limits (per user)
    RATE_LIMIT_PER_MINUTE: int = 10
    DAILY_GENERATION_LIMIT: int = 100

    # Gateway
    GATEWAY_MAX_ATTEMPTS: int = 10
    GATEWAY_COOLDOWN_SECONDS: int = 60
    GATEWAY_TIMEOUT_SECONDS: float = 30.0
    GATEWAY_RETRIES: int = 0
    # Comma-separated provider names, tried in this order.
    GATEWAY_PROVIDER_ORDER: str = "gemini,groq,openai,anthropic,mistral,cerebras,cohere,openrouter"
    GATEWAY_DISABLED_PROVIDERS: str = ""

    # Provider models (keys are discovered dynamically, see gateway/providers.py)
    GEMINI_MODEL: str = "gemini-2.5-flash-lite"
    GEMINI_FALLBACK_MODEL: str = "gemini-2.5-flash"
    GROQ_MODEL: str = "openai/gpt-oss-20b"
    GROQ_FALLBACK_MODEL: str = "openai/gpt-oss-120b"
    OPENAI_MODEL: str = "gpt-4o-mini"
    OPENAI_FALLBACK_MODEL: str = ""
    ANTHROPIC_MODEL: str = "claude-opus-5-5"
    ANTHROPIC_FALLBACK_MODEL: str = ""
    ANTHROPIC_MAX_TOKENS: int = 16000
    ANTHROPIC_EFFORT: str = "medium"
    MISTRAL_MODEL: str = "mistral-small-latest"
    MISTRAL_FALLBACK_MODEL: str = ""
    CEREBRAS_MODEL: str = "qwen-3.8-27b"
    CEREBRAS_FALLBACK_MODEL: str = ""
    COHERE_MODEL: str = "command-a-03-2025"
    COHERE_FALLBACK_MODEL: str = ""
    OPENROUTER_MODEL: str = "openrouter/auto"
    OPENROUTER_FALLBACK_MODEL: str = ""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="allow",
    )

    def __repr_args__(self):
        """Never let keys or secrets reach logs or tracebacks: show declared, non-secret fields only."""
        for name in type(self).model_fields:
            if any(word in name for word in ("KEY", "SECRET", "TOKEN", "PASSWORD")):
                continue
            yield name, getattr(self, name)

    def lookup(self, name: str) -> Optional[str]:
        """
        Reads a setting that may not be declared on the model, such as a numbered
        provider key. Checks declared fields, process env, then extra .env entries.
        """
        value = getattr(self, name, None) if name in type(self).model_fields else None
        if value in (None, ""):
            value = os.environ.get(name)
        if value in (None, "") and self.model_extra:
            value = self.model_extra.get(name) or self.model_extra.get(name.lower())
        if value is None:
            return None
        value = str(value).strip()
        return value or None

    @property
    def allowed_origins_list(self) -> List[str]:
        """Convert comma-separated origins string into a trimmed list."""
        if not self.ALLOWED_ORIGINS:
            return ["*"]
        return [origin.strip() for origin in self.ALLOWED_ORIGINS.split(",") if origin.strip()]

    @property
    def provider_order(self) -> List[str]:
        disabled = {p.strip().lower() for p in self.GATEWAY_DISABLED_PROVIDERS.split(",") if p.strip()}
        order = [p.strip().lower() for p in self.GATEWAY_PROVIDER_ORDER.split(",") if p.strip()]
        return [p for p in order if p not in disabled]


@lru_cache()
def get_settings() -> Settings:
    """Singleton getter for cached configuration settings."""
    return Settings()
