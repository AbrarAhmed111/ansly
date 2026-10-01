"""
LLM Gateway tests: provider discovery, ordered fallback, cooldown/disable rules,
output validation, and the Anthropic adapter. All provider calls are mocked.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from src.app.core.config import Settings
from src.app.gateway import (
    Completion,
    ErrorClassifier,
    GatewayUnavailableError,
    InvalidOutputError,
    LLMGateway,
    ProviderDeployment,
    RefusalError,
    build_deployments,
)
from src.app.gateway.adapters import complete_anthropic


class StatusError(Exception):
    def __init__(self, status_code: int):
        super().__init__(f"Error code: {status_code}")
        self.status_code = status_code


def _settings(**env) -> Settings:
    return Settings(_env_file=None, **env)


def _deployment(name: str, provider: str = "openai", kind: str = "openai_compatible") -> ProviderDeployment:
    return ProviderDeployment(name=name, provider=provider, api_key="sk-test", base_url=None,
                              default_model=f"{name}-model", kind=kind)


@pytest.fixture
def gateway():
    return LLMGateway(max_attempts=5, cooldown_seconds=60,
                      deployments=[_deployment("Primary"), _deployment("Secondary"), _deployment("Tertiary")])


def _complete_sequence(*results):
    """Patches the OpenAI-compatible adapter to return/raise each result in turn."""
    return patch("src.app.gateway.gateway.complete_openai_compatible", AsyncMock(side_effect=list(results)))


# --- provider discovery -------------------------------------------------------

def test_discovers_numbered_keys_in_provider_order(monkeypatch):
    for name, value in {
        "GROQ_API_KEY1": "g1", "GROQ_API_KEY2": "g2", "GOOGLE_API_KEY1": "gem1",
        "ANTHROPIC_API_KEY1": "a1", "COHERE_API_KEY1": "c1",
    }.items():
        monkeypatch.setenv(name, value)
    settings = _settings(GATEWAY_PROVIDER_ORDER="groq,anthropic,gemini,cohere", GEMINI_FALLBACK_MODEL="")
    names = [(d.name, d.kind) for d in build_deployments(settings, 60)]
    assert names == [
        ("Groq #1", "openai_compatible"),
        ("Groq #2", "openai_compatible"),
        ("Groq (Quality Fallback)", "openai_compatible"),
        ("Anthropic", "anthropic"),
        ("Gemini", "openai_compatible"),
        ("Cohere", "openai_compatible"),
    ]


def test_disabled_and_keyless_providers_are_skipped(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "o")
    monkeypatch.setenv("MISTRAL_API_KEY1", "m")
    settings = _settings(GATEWAY_PROVIDER_ORDER="openai,mistral,cerebras", GATEWAY_DISABLED_PROVIDERS="mistral")
    assert [d.provider for d in build_deployments(settings, 60)] == ["openai"]


def test_duplicate_keys_are_ignored(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "same")
    monkeypatch.setenv("OPENAI_API_KEY1", "same")
    settings = _settings(GATEWAY_PROVIDER_ORDER="openai")
    assert len(build_deployments(settings, 60)) == 1


# --- fallback -----------------------------------------------------------------

@pytest.mark.asyncio
async def test_primary_success(gateway):
    with _complete_sequence(Completion("hello", {"prompt_tokens": 3, "completion_tokens": 1, "total_tokens": 4})):
        result = await gateway.generate("sys", [{"role": "user", "content": "hi"}])
    assert (result.text, result.provider, result.status_events) == ("hello", "Primary", [])
    assert result.usage["total_tokens"] == 4


@pytest.mark.asyncio
async def test_rate_limit_cools_down_and_switches(gateway):
    with _complete_sequence(StatusError(429), Completion("from secondary")):
        result = await gateway.generate("sys", [{"role": "user", "content": "hi"}])
    assert result.provider == "Secondary"
    assert [e.status for e in result.status_events] == ["fallback", "switched"]
    primary = gateway.deployments[0]
    assert not primary.is_available and not primary.is_permanently_disabled


@pytest.mark.asyncio
async def test_invalid_key_and_missing_model_disable_deployment(gateway):
    with _complete_sequence(StatusError(401), StatusError(404), Completion("ok")):
        result = await gateway.generate("sys", [{"role": "user", "content": "hi"}])
    assert result.provider == "Tertiary"
    assert gateway.deployments[0].is_permanently_disabled
    assert gateway.deployments[1].is_permanently_disabled


@pytest.mark.asyncio
async def test_bad_request_falls_back_instead_of_failing(gateway):
    with _complete_sequence(StatusError(400), Completion("ok")):
        result = await gateway.generate("sys", [{"role": "user", "content": "hi"}])
    assert result.provider == "Secondary"


@pytest.mark.asyncio
async def test_invalid_output_skips_without_cooldown(gateway):
    def validate(text):
        if text != "good":
            raise ValueError("bad format")
        return text.upper()

    with _complete_sequence(Completion("garbage"), Completion("good")):
        result = await gateway.generate("sys", [{"role": "user", "content": "hi"}], validate=validate)
    assert (result.value, result.provider) == ("GOOD", "Secondary")
    assert gateway.deployments[0].is_available  # a formatting slip is not an outage


@pytest.mark.asyncio
async def test_all_providers_fail(gateway):
    with _complete_sequence(StatusError(500), StatusError(503), StatusError(429)):
        with pytest.raises(GatewayUnavailableError):
            await gateway.generate("sys", [{"role": "user", "content": "hi"}])


@pytest.mark.asyncio
async def test_max_attempts_is_respected():
    gw = LLMGateway(max_attempts=2, deployments=[_deployment(f"D{i}") for i in range(4)])
    mock = AsyncMock(side_effect=[StatusError(500)] * 4)
    with patch("src.app.gateway.gateway.complete_openai_compatible", mock):
        with pytest.raises(GatewayUnavailableError):
            await gw.generate("sys", [{"role": "user", "content": "hi"}])
    assert mock.await_count == 2


@pytest.mark.asyncio
async def test_all_cooling_down_tries_soonest_available():
    gw = LLMGateway(deployments=[_deployment("A"), _deployment("B")])
    gw.deployments[0].mark_cooldown(100)
    gw.deployments[1].mark_cooldown(10)
    with _complete_sequence(Completion("ok")):
        result = await gw.generate("sys", [{"role": "user", "content": "hi"}])
    assert result.provider == "B"


@pytest.mark.asyncio
async def test_anthropic_deployments_use_anthropic_adapter():
    gw = LLMGateway(deployments=[_deployment("Claude", provider="anthropic", kind="anthropic")])
    anthropic_mock = AsyncMock(return_value=Completion("from claude"))
    with patch("src.app.gateway.gateway.complete_anthropic", anthropic_mock):
        result = await gw.generate("sys", [{"role": "user", "content": "hi"}], max_tokens=100)
    assert result.text == "from claude"
    assert anthropic_mock.await_args.kwargs["max_tokens"] >= 16000  # room for thinking


# --- adapters & classification -----------------------------------------------

@pytest.mark.asyncio
async def test_anthropic_adapter_request_and_refusal():
    response = SimpleNamespace(
        stop_reason="end_turn",
        content=[SimpleNamespace(type="thinking", thinking=""), SimpleNamespace(type="text", text="Answer")],
        usage=SimpleNamespace(input_tokens=10, output_tokens=5),
    )
    create = AsyncMock(return_value=response)
    client = SimpleNamespace(beta=SimpleNamespace(messages=SimpleNamespace(create=create)))
    deployment = _deployment("Claude", provider="anthropic", kind="anthropic")
    with patch("src.app.gateway.adapters.anthropic.AsyncAnthropic", return_value=client):
        result = await complete_anthropic(deployment, "sys", [{"role": "user", "content": "q"}],
                                          max_tokens=16000, effort="medium", timeout=20, max_retries=0)
        assert result.text == "Answer" and result.usage["total_tokens"] == 15
        kwargs = create.await_args.kwargs
        assert kwargs["system"] == "sys" and "temperature" not in kwargs
        assert kwargs["output_config"] == {"effort": "medium"}
        assert kwargs["fallbacks"] == "default"

        response.stop_reason = "refusal"
        response.stop_details = SimpleNamespace(category="cyber")
        with pytest.raises(RefusalError):
            await complete_anthropic(deployment, "sys", [], max_tokens=16000, effort="medium",
                                     timeout=20, max_retries=0)


@pytest.mark.parametrize("error,reason,action", [
    (StatusError(429), "rate_limit_or_quota", "cooldown"),
    (StatusError(529), "provider_server_error", "cooldown"),
    (StatusError(401), "invalid_api_key", "disable"),
    (StatusError(404), "model_or_endpoint_not_found", "disable"),
    (StatusError(402), "payment_required", "disable"),
    (StatusError(400), "bad_request", "cooldown"),
    (InvalidOutputError("x"), "invalid_output", "skip"),
    (RefusalError("x"), "refusal", "skip"),
    (TimeoutError("Request timed out"), "network_or_timeout", "cooldown"),
    (Exception("Resource exhausted: quota"), "rate_limit_or_quota", "cooldown"),
])
def test_error_classifier(error, reason, action):
    assert ErrorClassifier.classify(error) == reason
    assert ErrorClassifier.action(reason) == action
