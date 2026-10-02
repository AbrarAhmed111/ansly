"""
API tests: auth, rate limits, answer endpoints, saved answers, and events.
Supabase and the LLM gateway are replaced with in-memory fakes.
"""

import json
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient

from src.app.api.deps import answer_engine, get_rest
from src.app.core.auth import AuthUser, get_current_user
from src.app.core.rate_limit import check_rate_limit
from src.app.gateway import GatewayResult, GatewayUnavailableError
from src.app.main import app
from tests.fakes import USER_ID, FakeRest


@pytest.fixture
def rest():
    return FakeRest()


@pytest.fixture
def client(rest):
    app.dependency_overrides[get_current_user] = lambda: AuthUser(id=USER_ID, email="sam@example.com", token="t")
    app.dependency_overrides[get_rest] = lambda: rest
    yield AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
    app.dependency_overrides.clear()


def mock_llm(payload: dict):
    async def generate(system, messages, temperature=None, max_tokens=None, validate=None):
        text = json.dumps(payload)
        return GatewayResult(text=text, value=validate(text), provider="Mock", model="mock-1", usage={})

    return patch.object(answer_engine.gateway, "generate", AsyncMock(side_effect=generate))


ANSWERED = {"status": "answered", "answer": "I built TaskFlow, an open-source task app.", "confidence": "high",
            "usedSources": ["P1"], "missingInformation": None}


@pytest.mark.asyncio
async def test_root():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/")
    assert response.status_code == 200
    assert response.json()["endpoints"]["generate"] == "/api/v1/answers/generate"


@pytest.mark.asyncio
async def test_health():
    with patch("src.app.api.routes.health.check_supabase", AsyncMock(return_value={"status": "ok"})):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["supabase"] == {"status": "ok"}
    assert "total_deployments" in data["gateway"]


@pytest.mark.asyncio
async def test_endpoints_require_auth():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/v1/answers/generate", json={"question": "Tell us about yourself"})
        bad = await client.post("/api/v1/answers/generate", json={"question": "x y"},
                                headers={"Authorization": "Bearer not-a-jwt"})
    assert response.status_code == 401
    assert bad.status_code == 401


@pytest.mark.asyncio
async def test_generate_returns_grounded_answer_and_logs_event(client, rest):
    with mock_llm(ANSWERED):
        response = await client.post("/api/v1/answers/generate", json={
            "question": "Tell us about a project you're proud of.",
            "job_context": {"company": "Example AI", "role": "Product Engineer"},
            "field": {"maxLength": 1000, "kind": "textarea"},
        })
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "answered"
    assert body["usedSources"] == [{"type": "project", "id": "p1", "label": "TaskFlow"}]
    assert body["missingInformation"] is None
    assert body["category"] == "project"
    assert [e["kind"] for e in rest.tables["usage_events"]] == ["generate"]


@pytest.mark.asyncio
async def test_generate_kubernetes_is_insufficient(client):
    with mock_llm({}) as llm:
        response = await client.post("/api/v1/answers/generate", json={"question": "Do you have experience with Kubernetes?"})
    assert response.status_code == 200
    assert response.json()["status"] == "insufficient_information"
    assert response.json()["answer"] == ""
    llm.assert_not_awaited()


@pytest.mark.asyncio
async def test_regenerate(client, rest):
    with mock_llm(ANSWERED) as llm:
        response = await client.post("/api/v1/answers/regenerate", json={
            "question": "Tell us about yourself", "previous_answer": "Old answer", "instruction": "more technical"})
    assert response.status_code == 200
    assert "Old answer" in llm.await_args.kwargs["messages"][0]["content"]
    assert rest.tables["usage_events"][-1]["kind"] == "regenerate"


@pytest.mark.asyncio
async def test_validation_error(client):
    response = await client.post("/api/v1/answers/generate", json={"question": ""})
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_all_providers_down_returns_503(client):
    with patch.object(answer_engine.gateway, "generate", AsyncMock(side_effect=GatewayUnavailableError("down"))):
        response = await client.post("/api/v1/answers/generate", json={"question": "Tell us about yourself"})
    assert response.status_code == 503


@pytest.mark.asyncio
async def test_per_minute_rate_limit(client):
    with patch("src.app.api.routes.answers.get_settings") as settings, mock_llm(ANSWERED):
        settings.return_value.RATE_LIMIT_PER_MINUTE = 2
        settings.return_value.DAILY_GENERATION_LIMIT = 100
        codes = [(await client.post("/api/v1/answers/generate", json={"question": "Tell us about yourself"})).status_code
                 for _ in range(3)]
    assert codes == [200, 200, 429]


@pytest.mark.asyncio
async def test_daily_limit(client, rest):
    rest.tables["usage_events"] = [{"id": i, "kind": "generate"} for i in range(5)]
    with patch("src.app.api.routes.answers.get_settings") as settings, mock_llm(ANSWERED):
        settings.return_value.RATE_LIMIT_PER_MINUTE = 100
        settings.return_value.DAILY_GENERATION_LIMIT = 5
        response = await client.post("/api/v1/answers/generate", json={"question": "Tell us about yourself"})
    assert response.status_code == 429
    assert "Daily limit" in response.json()["detail"]


@pytest.mark.asyncio
async def test_saved_answer_flow(client, rest):
    created = await client.post("/api/v1/saved-answers", json={
        "question": "Tell us about a project you're proud of.", "answer": "My edited answer."})
    assert created.status_code == 201
    saved = created.json()
    assert saved["category"] == "project"

    match = await client.post("/api/v1/saved-answers/match", json={"question": "What's the project you've enjoyed building most?"})
    assert match.json()["match"]["id"] == saved["id"]
    assert match.json()["score"] >= 0.55

    no_match = await client.post("/api/v1/saved-answers/match", json={"question": "What are your salary expectations?"})
    assert no_match.json()["match"] is None

    used = await client.post(f"/api/v1/saved-answers/{saved['id']}/use")
    assert used.json()["use_count"] == 1
    assert [e["kind"] for e in rest.tables["usage_events"]] == ["save_answer", "use_saved_answer"]

    missing = await client.post("/api/v1/saved-answers/does-not-exist/use")
    assert missing.status_code == 404


@pytest.mark.asyncio
async def test_track_event(client, rest):
    response = await client.post("/api/v1/events", json={"kind": "fill", "category": "project"})
    assert response.status_code == 204
    event = rest.tables["usage_events"][0]
    assert (event["kind"], event["category"]) == ("fill", "project")
    bad = await client.post("/api/v1/events", json={"kind": "generate"})
    assert bad.status_code == 422


@pytest.mark.asyncio
async def test_rate_limit_sets_retry_after():
    rest = FakeRest()
    await check_rate_limit(rest, 1)
    with pytest.raises(HTTPException) as exc:
        await check_rate_limit(rest, 1)
    assert exc.value.status_code == 429 and exc.value.headers["Retry-After"] == "60"
