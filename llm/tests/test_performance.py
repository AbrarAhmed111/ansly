"""
Tests for the latency work: one-request resolve, caches, concurrency helpers,
the pooled Supabase client and per-request metrics.
"""

import asyncio
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from httpx import ASGITransport, AsyncClient

from src.app.answers.classifier import classify_question
from src.app.answers.profile_context import fetch_profile_data
from src.app.api.deps import get_rest
from src.app.core import http, metrics
from src.app.core.auth import AuthUser, get_current_user
from src.app.core.concurrency import gather_all
from src.app.core.config import Settings
from src.app.core.ttl_cache import TTLCache
from src.app.db.rest import SupabaseRest
from src.app.main import app
from tests.fakes import USER_ID, FakeRest
from tests.test_api import ANSWERED, mock_llm

PROJECT_QUESTION = "Tell us about a project you're proud of."


@pytest.fixture
def rest():
    return FakeRest()


@pytest.fixture
def client(rest):
    app.dependency_overrides[get_current_user] = lambda: AuthUser(id=USER_ID, email="sam@example.com", token="t")
    app.dependency_overrides[get_rest] = lambda: rest
    yield AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
    app.dependency_overrides.clear()


# --- POST /answers/resolve -----------------------------------------------------

@pytest.mark.asyncio
async def test_resolve_returns_saved_answer_without_model_or_rate_limit(client, rest):
    await client.post("/api/v1/saved-answers", json={"question": PROJECT_QUESTION, "answer": "My saved answer."})
    rest.rate_limit_hits = 10**6  # burst limit exhausted: a saved answer is still returned
    with mock_llm(ANSWERED) as llm:
        response = await client.post("/api/v1/answers/resolve",
                                     json={"question": "What's the project you've enjoyed building most?"})
    assert response.status_code == 200
    body = response.json()
    assert body["savedMatch"]["answer"] == "My saved answer." and body["answer"] is None
    llm.assert_not_awaited()
    assert [e["kind"] for e in rest.tables["usage_events"]] == ["save_answer"]


@pytest.mark.asyncio
async def test_resolve_generates_when_nothing_saved(client, rest):
    with mock_llm(ANSWERED) as llm:
        response = await client.post("/api/v1/answers/resolve", json={"question": PROJECT_QUESTION})
    assert response.status_code == 200
    body = response.json()
    assert body["savedMatch"] is None
    assert body["answer"]["status"] == "answered" and body["answer"]["usedSources"][0]["id"] == "p1"
    llm.assert_awaited_once()
    assert [e["kind"] for e in rest.tables["usage_events"]] == ["generate"]


@pytest.mark.asyncio
async def test_resolve_enforces_rate_limit_when_generating(client, rest):
    rest.rate_limit_hits = 10**6
    with mock_llm(ANSWERED) as llm:
        response = await client.post("/api/v1/answers/resolve", json={"question": PROJECT_QUESTION})
    assert response.status_code == 429
    llm.assert_not_awaited()


@pytest.mark.asyncio
async def test_no_model_answer_ignores_exhausted_daily_limit(client, rest):
    rest.tables["usage_events"] = [{"id": i, "kind": "generate"} for i in range(10**3)]
    with mock_llm({}) as llm:
        response = await client.post("/api/v1/answers/generate", json={
            "question": "Will you require visa sponsorship?", "field": {"kind": "choice_single", "options": ["Yes", "No"]}})
    assert response.status_code == 200 and response.json()["answer"] == "No"
    llm.assert_not_awaited()


# --- caches ----------------------------------------------------------------------

@pytest.mark.asyncio
async def test_repeated_question_reuses_answer_until_profile_changes(client, rest):
    with mock_llm(ANSWERED) as llm:
        first = await client.post("/api/v1/answers/generate", json={"question": PROJECT_QUESTION})
        second = await client.post("/api/v1/answers/generate", json={"question": PROJECT_QUESTION})
        assert llm.await_count == 1
        assert second.json()["answer"] == first.json()["answer"]

        # Regenerate always asks the model.
        await client.post("/api/v1/answers/regenerate", json={"question": PROJECT_QUESTION, "previous_answer": "x"})
        assert llm.await_count == 2

        # Saving to the profile through the API drops the cached profile, so the inputs (and the key) change.
        saved = await client.post("/api/v1/profile/missing", json={"items": [
            {"key": "fact:project", "target": {"type": "fact", "category": "project"}, "value": "I also built a CLI."}]})
        assert saved.status_code == 200
        await client.post("/api/v1/answers/generate", json={"question": PROJECT_QUESTION})
        assert llm.await_count == 3


@pytest.mark.asyncio
async def test_profile_rows_are_fetched_in_parallel_and_cached_per_user():
    rest = FakeRest()
    in_flight = peak = 0
    real_select = rest.select

    async def slow_select(table, params=None):
        nonlocal in_flight, peak
        in_flight += 1
        peak = max(peak, in_flight)
        await asyncio.sleep(0.01)
        in_flight -= 1
        return await real_select(table, params)

    rest.select = AsyncMock(side_effect=slow_select)
    analysis = classify_question("Do you have experience with Next.js?")
    first = await fetch_profile_data(rest, analysis, USER_ID)
    assert peak > 1
    calls = rest.select.await_count
    assert await fetch_profile_data(rest, analysis, USER_ID) == first
    assert rest.select.await_count == calls
    # Another user never sees these rows.
    await fetch_profile_data(rest, analysis, "someone-else")
    assert rest.select.await_count == calls * 2


@pytest.mark.asyncio
async def test_saved_answers_cached_and_dropped_on_save(client, rest):
    rest.select = AsyncMock(wraps=rest.select)
    question = {"question": "What's the project you've enjoyed building most?"}
    await client.post("/api/v1/saved-answers/match", json=question)
    await client.post("/api/v1/saved-answers/match", json=question)
    assert [c.args[0] for c in rest.select.await_args_list].count("saved_answers") == 1
    await client.post("/api/v1/saved-answers", json={"question": PROJECT_QUESTION, "answer": "Saved."})
    match = await client.post("/api/v1/saved-answers/match", json=question)
    assert match.json()["match"]["answer"] == "Saved."


def test_ttl_cache_expiry_bound_and_user_invalidation():
    cache: TTLCache[int] = TTLCache(ttl_seconds=60, max_entries=2)
    cache.set(("u1", "a"), 1)
    cache.set(("u2", "a"), 2)
    cache.set(("u1", "b"), 3)
    assert cache.get(("u1", "a")) is None  # evicted: oldest beyond max_entries
    cache.invalidate_user("u1")
    assert cache.get(("u1", "b")) is None and cache.get(("u2", "a")) == 2
    expired: TTLCache[int] = TTLCache(ttl_seconds=0, max_entries=2)
    expired.set(("u1",), 1)
    assert expired.get(("u1",)) is None


# --- concurrency -------------------------------------------------------------------

@pytest.mark.asyncio
async def test_gather_all_cancels_the_rest_on_failure():
    cancelled = asyncio.Event()

    async def slow():
        try:
            await asyncio.sleep(10)
        except asyncio.CancelledError:
            cancelled.set()
            raise

    async def fail():
        raise ValueError("boom")

    with pytest.raises(ValueError):
        await gather_all(slow(), fail())
    assert cancelled.is_set()


# --- pooled Supabase client and metrics ------------------------------------------

@pytest.mark.asyncio
async def test_shared_client_reused_and_user_token_sent_per_request(monkeypatch):
    seen = []

    def handler(request):
        seen.append(request.headers["authorization"])
        return httpx.Response(200, json=[{"id": 1}])

    await http.close_shared_client()
    real_client = httpx.AsyncClient
    monkeypatch.setattr(http.httpx, "AsyncClient",
                        lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw))
    settings = Settings(_env_file=None, SUPABASE_URL="https://x.supabase.co", SUPABASE_PUBLISHABLE_KEY="k")
    request_metrics = metrics.start_request()

    await SupabaseRest(settings, "token-a").select("skills")
    client = http.shared_client()
    await SupabaseRest(settings, "token-b").select("skills")
    assert http.shared_client() is client
    assert seen == ["Bearer token-a", "Bearer token-b"]
    assert request_metrics.db_calls == 2 and request_metrics.db_slowest == "select:skills"
    await http.close_shared_client()


def test_metrics_summary_has_no_content():
    m = metrics.RequestMetrics()
    m.record_db("select:profiles", 12.0)
    m.record_llm("model-x", 800.0, 1200, 90)
    m.cache["profile_hit"] += 2
    line = m.summary("POST /answers/generate", 200)
    assert "db_calls=1" in line and "llm_calls=1" in line and "tokens_in=1200" in line
    assert "models=model-x" in line and "cache.profile_hit=2" in line


@pytest.mark.asyncio
async def test_rest_with_explicit_transport_keeps_its_own_client():
    """SupabaseRest with an explicit transport keeps its own client (used by tests and tools)."""
    transport = httpx.MockTransport(lambda r: httpx.Response(200, json=[]))
    settings = Settings(_env_file=None, SUPABASE_URL="https://x.supabase.co", SUPABASE_PUBLISHABLE_KEY="k")
    rest = SupabaseRest(settings, "t", transport=transport)
    with patch.object(http, "shared_client") as shared:
        assert await rest.select("skills") == []
    shared.assert_not_called()


def test_retry_after_follows_who_runs_the_next_step():
    from datetime import datetime, timedelta, timezone

    from src.app.api.routes.tailorings import POLL_AGAIN_MS, retry_after_ms

    now = datetime.now(timezone.utc)
    fresh = {"status": "matching", "created_at": now.isoformat(), "step_started_at": now.isoformat()}
    assert retry_after_ms({**fresh, "status": "ready"}) is None
    assert retry_after_ms({**fresh, "step_started_at": None}) == POLL_AGAIN_MS  # the next poll runs the step
    assert retry_after_ms(fresh) == 1000
    old = (now - timedelta(minutes=2)).isoformat()
    assert retry_after_ms({**fresh, "created_at": old}) == 4000


@pytest.mark.parametrize("intent,value,question,expected", [
    ("notice_period", "Two weeks", "Notice period", "Two weeks"),
    ("notice_period", "Two weeks", "Are you available to start within a week?", None),  # yes/no: the model decides
    ("salary", "$120k", "Expected salary", "$120k"),
    ("sponsorship", False, "Will you now or in the future require visa sponsorship?", "No"),
    ("sponsorship", False, "Do you have a valid work visa?", None),  # opposite polarity: not settled by the value
    ("relocation", True, "Are you willing to relocate?", "Yes"),
    ("work_mode", "hybrid", "Preferred work arrangement", "Hybrid"),
    ("work_mode", "remote", "Are you comfortable working on-site?", None),
])
def test_logistics_text(intent, value, question, expected):
    from src.app.answers.engine import logistics_text

    assert logistics_text(intent, value, question) == expected


@pytest.mark.asyncio
async def test_one_line_logistics_field_needs_no_model(client, rest):
    with mock_llm(ANSWERED) as llm:
        response = await client.post("/api/v1/answers/generate", json={
            "question": "What is your notice period?", "field": {"kind": "input"}})
    assert response.json()["answer"] == "Two weeks"
    llm.assert_not_awaited()


def test_job_description_scaled_to_the_question():
    from src.app.answers.classifier import classify_question
    from src.app.answers.profile_context import ProfileContext
    from src.app.answers.prompt import build_user_message
    from src.app.schemas.answers import JobContext

    job = JobContext(company="Acme", role="Engineer", description="x" * 6000)
    ctx = ProfileContext(text="[PR] PROFILE")
    sizes = {q: len(build_user_message(classify_question(q), ctx, job, None, job_description_max_chars=6000))
             for q in ["What is your notice period?", "Do you have experience with React?", "Why do you want to join us?"]}
    notice, skill, motivation = sizes.values()
    assert notice < skill < motivation
    assert motivation - notice >= 6000  # the full description only where it helps
