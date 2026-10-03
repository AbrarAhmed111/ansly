"""
Second token pass: semantic fallback, saved-answer adaptation, grouped batches
with the answer cache, fast-model routing, per-job token accounting, and the
benchmark's token regression budgets.
"""

import json
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from src.app.answers.adapt import _validate, adaptation_reason
from src.app.answers.classifier import classify_question
from src.app.answers.engine import AnswerEngine, _answer_cache, group_questions
from src.app.answers.semantic import SemanticRetriever, content_hash, invalidate_semantic_cache, record_text
from src.app.api.deps import answer_engine, get_rest
from src.app.core.auth import AuthUser, get_current_user
from src.app.core.token_budget import job_key
from src.app.gateway import GatewayResult
from src.app.gateway.deployment import ProviderDeployment
from src.app.gateway.gateway import LLMGateway
from src.app.main import app
from src.app.schemas.answers import BatchItem, FieldContext, GenerateAnswerRequest, GenerateBatchRequest, JobContext
from tests.fakes import USER_ID, FakeRest

# --- semantic fallback ----------------------------------------------------------------


class FakeEmbedder:
    """Vectors from word overlap with a tiny vocabulary: enough to rank 'disagreed' near 'pushed back'."""

    model = "fake-embed"
    VOCAB = ["conflict", "pushed", "disagree", "teammate", "react", "billing", "dashboard", "led"]

    def __init__(self):
        self.embedded = []

    async def embed(self, texts):
        self.embedded.append(list(texts))
        vectors = []
        for text in texts:
            lower = text.lower()
            vectors.append([1.0 if w in lower else 0.0 for w in self.VOCAB] + [0.01])
        return vectors, 10 * len(texts)


class SemanticRest(FakeRest):
    """FakeRest plus the match_candidate_evidence RPC (cosine similarity over the stored vectors)."""

    async def rpc(self, function, args=None):
        if function != "match_candidate_evidence":
            return await super().rpc(function, args)
        query = json.loads(args["query_embedding"])
        out = []
        for row in self.tables["candidate_evidence"]:
            vec = json.loads(row["embedding"])
            dot = sum(a * b for a, b in zip(query, vec))
            norm = (sum(a * a for a in query) * sum(b * b for b in vec)) ** 0.5 or 1
            out.append({"source_type": row["source_type"], "source_id": row["source_id"], "similarity": dot / norm})
        return sorted(out, key=lambda r: -r["similarity"])[: args["match_count"]]


def _profile_with_pushback():
    rest = SemanticRest()
    rest.tables["experiences"][1]["highlights"] = ["Pushed back on a risky rewrite and agreed a plan with my teammate"]
    return rest


@pytest.mark.asyncio
async def test_embeddings_sync_incrementally():
    invalidate_semantic_cache(USER_ID)
    rest, embedder = _profile_with_pushback(), FakeEmbedder()
    retriever = SemanticRetriever(embedder)
    data = {s: rest.tables[s] for s in ("experiences", "projects", "achievements", "profile_facts")}
    await retriever.sync(rest, USER_ID, data)
    first = len(embedder.embedded[0])
    assert first == len(rest.tables["candidate_evidence"]) == 3  # 2 experiences + 1 project; facts/achievements empty
    stored = rest.tables["candidate_evidence"][0]
    assert stored["content_hash"] == content_hash("fake-embed", record_text("experiences", data["experiences"][0]))

    # Unchanged: nothing embedded. One row edited: only it is re-embedded. A row deleted: its vector goes too.
    invalidate_semantic_cache(USER_ID)  # also from the database, not only the in-process cache
    await retriever.sync(rest, USER_ID, data)
    assert len(embedder.embedded) == 1
    data["experiences"][0] = {**data["experiences"][0], "description": "Rebuilt the billing dashboard."}
    data["projects"] = []
    await retriever.sync(rest, USER_ID, data)
    assert embedder.embedded[-1] == [record_text("experiences", data["experiences"][0])]
    assert {r["source_type"] for r in rest.tables["candidate_evidence"]} == {"experience"}


@pytest.mark.asyncio
async def test_semantic_fallback_only_when_keywords_find_too_little():
    invalidate_semantic_cache(USER_ID)
    rest, embedder = _profile_with_pushback(), FakeEmbedder()
    gateway = AsyncMock()
    gateway.generate = AsyncMock(return_value=GatewayResult(
        text="", value=None, provider="Mock", model="m", usage={}))
    engine = AnswerEngine(gateway, semantic=SemanticRetriever(embedder))

    def message():
        return gateway.generate.await_args.kwargs["messages"][0]["content"]

    with patch("src.app.answers.engine._response"):
        # Behavioral and phrased unlike the profile: keyword retrieval finds too little, so semantic runs.
        await engine.answer(rest, GenerateAnswerRequest(question="Describe a conflict with a coworker."), user_id=USER_ID)
        assert embedder.embedded and "Pushed back on a risky rewrite" in message()
        calls = len(embedder.embedded)
        # A skill question the keywords answer well: no embedding work at all.
        await engine.answer(rest, GenerateAnswerRequest(question="Describe your experience with React and Next.js."),
                            user_id=USER_ID)
        assert len(embedder.embedded) == calls


@pytest.mark.asyncio
async def test_semantic_failure_falls_back_to_keywords():
    class Broken(FakeEmbedder):
        async def embed(self, texts):
            raise RuntimeError("provider down")

    retriever = SemanticRetriever(Broken())
    assert await retriever.search(SemanticRest(), USER_ID, {"experiences": []}, "anything") == []
    assert not SemanticRetriever(None).enabled


# --- saved-answer adaptation ------------------------------------------------------------

SAVED = {"id": "s1", "question": "Why do you want to work here?", "company": "Northwind", "role": "Backend Engineer",
         "answer": "I want to join Northwind because I built 3 billing systems and enjoy backend work."}


@pytest.mark.parametrize("job,field,reason", [
    (JobContext(company="Lumenfield"), None, "other_company"),
    (JobContext(company="Northwind"), None, None),                                  # same company: reuse as is
    (JobContext(company="Lumenfield"), FieldContext(max_length=40), "too_long"),
    (None, None, None),
    (JobContext(company="Acme", role="Backend Engineer"), None, "other_company"),
])
def test_adaptation_only_when_needed(job, field, reason):
    request = GenerateAnswerRequest(question="Why do you want to work here?", job_context=job, field=field)
    assert adaptation_reason(SAVED, request) == reason


def test_adaptation_may_not_add_numbers():
    request = GenerateAnswerRequest(question="Why us?", job_context=JobContext(company="Lumenfield"))
    ok = _validate(json.dumps({"answer": "I want to join Lumenfield because I built 3 billing systems."}), SAVED, request)
    assert ok.startswith("I want to join Lumenfield")
    with pytest.raises(ValueError):
        _validate(json.dumps({"answer": "I built 5 billing systems for Lumenfield."}), SAVED, request)


@pytest.fixture
def api_rest():
    rest = FakeRest()
    rest.tables["saved_answers"] = [dict(SAVED)]
    return rest


@pytest.fixture
def client(api_rest):
    app.dependency_overrides[get_current_user] = lambda: AuthUser(id=USER_ID, email="sam@example.com", token="t")
    app.dependency_overrides[get_rest] = lambda: api_rest
    yield AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
    app.dependency_overrides.clear()


def _mock(payload):
    async def generate(system, messages, temperature=None, max_tokens=None, validate=None, stage=None, items=1):
        text = json.dumps(payload)
        return GatewayResult(text=text, value=validate(text), provider="Mock", model="fast-1",
                             usage={"prompt_tokens": 300, "completion_tokens": 60})

    return patch.object(answer_engine.gateway, "generate", AsyncMock(side_effect=generate))


JOB_BODY = {"company": "Lumenfield", "role": "Senior Engineer", "url": "https://jobs.example/lumen?ref=x",
            "id": "8f2b2c64-2b5c-4f1e-9a51-3f1e0b4c2d11"}


@pytest.mark.asyncio
async def test_resolve_adapts_a_saved_answer_for_another_company(client, api_rest):
    adapted = "I want to join Lumenfield because I built 3 billing systems and enjoy backend work."
    with _mock({"answer": adapted}) as llm:
        response = await client.post("/api/v1/answers/resolve",
                                     json={"question": "Why do you want to work here?", "job_context": JOB_BODY})
    body = response.json()
    assert body["savedMatch"] is None and body["adaptedFrom"] == "s1" and body["answer"]["answer"] == adapted
    assert llm.await_args.kwargs["stage"] == "answer_adaptation"
    prompt = llm.await_args.kwargs["messages"][0]["content"]
    assert "SAVED ANSWER (written for Backend Engineer at Northwind)" in prompt and "CANDIDATE" not in prompt
    [event] = api_rest.tables["usage_events"]
    assert event["kind"] == "adapt_saved_answer" and event["tokens"] == 360 and event["llm_calls"] == 1
    assert event["job_key"] == job_key("https://jobs.example/lumen", "x", "y")  # query string ignored
    assert event["job_context_id"] == JOB_BODY["id"]


@pytest.mark.asyncio
async def test_resolve_keeps_the_saved_answer_when_the_rewrite_invents_facts(client, api_rest):
    with _mock({"answer": "I built 9 billing systems for Lumenfield."}):
        response = await client.post("/api/v1/answers/resolve",
                                     json={"question": "Why do you want to work here?", "job_context": JOB_BODY})
    body = response.json()
    assert body["savedMatch"]["id"] == "s1" and body["answer"] is None
    assert api_rest.tables["usage_events"] == []


@pytest.mark.asyncio
async def test_generated_answers_carry_the_job_for_per_application_totals(client, api_rest):
    with _mock({"status": "answered", "answer": "I led the TaskFlow project.", "confidence": "high"}):
        await client.post("/api/v1/answers/generate",
                          json={"question": "Tell us about a project you're proud of.", "job_context": JOB_BODY})
    [event] = api_rest.tables["usage_events"]
    assert (event["kind"], event["llm_calls"], event["job_context_id"]) == ("generate", 1, JOB_BODY["id"])
    assert event["job_key"] == job_key(JOB_BODY["url"])


def test_job_key_ignores_query_and_case_and_falls_back_to_company_role():
    assert job_key("https://www.Jobs.example/a/1/?utm=x") == job_key("https://jobs.example/a/1")
    assert job_key(None, "Acme ", "Engineer") == job_key("", "acme", "engineer")
    assert job_key(None) is None


# --- batches: answer cache and grouping ---------------------------------------------------

@pytest.mark.asyncio
async def test_fill_all_reuses_cached_answers():
    _answer_cache.invalidate_user(USER_ID)
    gateway = AsyncMock()

    async def generate(system, messages, temperature=None, max_tokens=None, validate=None, stage=None, items=1):
        text = json.dumps({"answers": [{"id": "q1", "status": "answered", "answer": "Because.", "confidence": "high"}]})
        return GatewayResult(text=text, value=validate(text), provider="Mock", model="m", usage={})

    gateway.generate = AsyncMock(side_effect=generate)
    engine, rest = AnswerEngine(gateway), FakeRest()
    request = GenerateBatchRequest(items=[BatchItem(id="q1", question="Why do you want to work here?")])
    first = await engine.complete_batch(rest, await engine.plan_batch(rest, request, USER_ID))
    plan = await engine.plan_batch(rest, request, USER_ID)
    assert plan.pending == [] and plan.results["q1"].answer == first[0].answer
    gateway.generate.assert_awaited_once()


def test_batches_use_few_calls_and_keep_related_questions_together():
    questions = ["Why us?", "Tell me about a conflict.", "Describe a project.", "Why this role?",
                 "What is your greatest strength?", "Describe your React experience."]
    items = [BatchItem(id=f"q{i}", question=q) for i, q in enumerate(questions)]
    analyses = {i.id: classify_question(i.question) for i in items}
    assert len(group_questions(items, analyses, 6, by_family=False)) == 1
    [one] = group_questions(items, analyses, 6, by_family=False)
    assert [i.question for i in one[:2]] == ["Why us?", "Why this role?"]  # same family, side by side
    assert len(group_questions(items, analyses, 6, by_family=True)) == 3


# --- fast model routing ---------------------------------------------------------------

@pytest.mark.parametrize("kind,fast,stage,model", [
    ("anthropic", "claude-haiku-4-5", "answer_adaptation", "claude-haiku-4-5"),
    ("anthropic", "claude-haiku-4-5", "tailoring_plan", "claude-opus-5-5"),
    ("anthropic", "", "answer_adaptation", "claude-opus-5-5"),
    ("openai_compatible", "claude-haiku-4-5", "answer_adaptation", "claude-opus-5-5"),
])
def test_fast_model_only_for_light_stages_when_configured(kind, fast, stage, model, monkeypatch):
    from src.app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "ANTHROPIC_FAST_MODEL", fast)
    deployment = ProviderDeployment(name="x", provider="anthropic", api_key="k", base_url=None,
                                    default_model="claude-opus-5-5", kind=kind, cooldown_seconds=60)
    assert LLMGateway.model_for(deployment, stage) == model


# --- token regression budgets ------------------------------------------------------------

@pytest.mark.asyncio
async def test_benchmark_token_budgets():
    """The second pass's targets, on the benchmark (estimated tokens; scripts/benchmark_tokens.py)."""
    from scripts.benchmark_tokens import run_scenarios, summarize

    summary = summarize(await run_scenarios())
    for name in ("C", "D"):
        for call in summary[name]["calls"]:
            if call["stage"] == "answer":
                assert call["input"] <= 1500, call             # a normal answer
            if call["stage"] == "answer_complex":
                assert call["input"] <= 2500, call             # cover letter / about me
            if call["stage"] == "tailoring_plan":
                assert call["input"] <= 2500, call
            if call["stage"] == "answer_adaptation":
                assert call["input"] + call["output"] <= 700, call
    assert summary["B"]["total_tokens"] <= 3500                 # Fill all
    assert summary["D"]["total_tokens"] <= 15000                # a full normal application
    assert summary["D"]["total_tokens"] + summary["C"]["total_tokens"] <= 18000  # with long answers one by one


# --- per-job accounting through tailoring ----------------------------------------------------

@pytest.mark.asyncio
async def test_tailoring_usage_adds_up_per_job():
    from tests.test_resume_api import JOB, Env, client_for, tailor

    env = Env()
    try:
        async with client_for(env) as client:
            result = await tailor(client)
    finally:
        app.dependency_overrides.clear()
    assert result["status"] == "ready"
    events = {e["kind"]: e for e in env.rest.tables["usage_events"]}
    analyzed, completed = events["job_analyzed"], events["tailoring_completed"]
    key = job_key(JOB["url"], JOB["company"], JOB["title"])
    assert analyzed["job_key"] == completed["job_key"] == key
    assert (analyzed["tokens"], analyzed["llm_calls"]) == (150, 1)  # FakeGateway: 150 tokens per call
    # Every model call the run made (matching, plan, review), summed across steps on the row.
    row = env.rest.tables["resume_tailorings"][0]
    assert completed["llm_calls"] == row["llm_calls"] == len(env.gateway.calls) - 1
    assert completed["tokens"] == row["tokens"] == 150 * completed["llm_calls"]
    assert completed["job_context_id"] == analyzed["job_context_id"]
