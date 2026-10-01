"""
Settings tests: dynamic key lookup and secret redaction.
"""

from src.app.core.config import Settings


def test_lookup_reads_undeclared_numbered_keys(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY7", "  gk-7  ")
    settings = Settings(_env_file=None)
    assert settings.lookup("GROQ_API_KEY7") == "gk-7"
    assert settings.lookup("GROQ_API_KEY8") is None


def test_repr_never_contains_secrets(monkeypatch):
    monkeypatch.setenv("COHERE_API_KEY1", "very-secret-value")
    settings = Settings(
        _env_file=None,
        SUPABASE_PUBLISHABLE_KEY="sb_publishable_secret",
        SUPABASE_JWT_SECRET="jwt-secret",
        EXTRA_API_KEY="extra-secret",
    )
    text = repr(settings) + str(settings)
    for secret in ["very-secret-value", "sb_publishable_secret", "jwt-secret", "extra-secret"]:
        assert secret not in text


def test_provider_order_skips_disabled():
    settings = Settings(_env_file=None, GATEWAY_PROVIDER_ORDER="Groq, OpenAI ,anthropic",
                        GATEWAY_DISABLED_PROVIDERS="openai")
    assert settings.provider_order == ["groq", "anthropic"]
