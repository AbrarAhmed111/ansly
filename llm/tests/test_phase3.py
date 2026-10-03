"""
Third token pass: long answers answered together (one call, shared deduplicated
evidence mapped per question, saved answers and the cache resolved first),
provider-reported token and cost accounting per call and per application,
answer routing, answer-cache keys, and the benchmark's worst-case budget.
"""

import json
import uuid
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from src.app.answers.classifier import classify_question
from src.app.answers.engine import AnswerEngine, _answer_cache, _answer_key, group_questions
from src.app.answers.profile_context import build_context, fetch_profile_data
from src.app.answers.prompt import build_batch_message
from src.app.answers.routing import answer_stage
from src.app.api.deps import answer_engine, get_rest
from src.app.core import llm_usage, pricing
from src.app.core.auth import AuthUser, get_current_user
from src.app.core.config import get_settings
from src.app.core.token_budget import ANSWER, ANSWER_COMPLEX, ANSWER_SIMPLE, REGENERATION, job_key
from src.app.core.ttl_cache import TTLCache
from src.app.gateway import Completion, GatewayResult, LLMGateway
from src.app.gateway.adapters import complete_anthropic, supports_effort
from src.app.gateway.deployment import ProviderDeployment
from src.app.main import app
from src.app.schemas.answers import (
    AnswerStyle,
    BatchItem,
    FieldContext,
    GenerateAnswerRequest,
    GenerateBatchRequest,
    JobContext,
)
from tests.fakes import USER_ID, FakeRest

LONG = FieldContext(kind="textarea")
JOB = JobContext(company="Lumenfield", role="Software Engineer", url="https://jobs.example.com/lumenfield/42",
                 description="Build analytics features with React and Python for hospital operations teams.")
BEHAVIORAL = [
    "Why do you want to work here?",
    "Describe your backend experience.",
    "Tell us about a difficult technical problem.",
    "Why are you a good fit?",
    "Describe relevant projects.",
]
SAVED_OTHER_JOB = {"id": "sa1", "question": "Why do you want to work here?", "company": "Northwind",
                   "role": "Backend Engineer", "category": "motivation", "intent": "motivation_company",
                   "answer": "Northwind's data products match what I enjoy. At Acme Labs I built the customer "
                             "dashboard, and I'd like to bring that to Northwind.",
                   "use_count": 1, "updated_at": "2026-09-01T00:00:00Z"}


class BatchModel:
    """A scripted gateway: answers every batch question, citing the refs its EVIDENCE line names."""

    def __init__(self, adapt_answer: str = "Lumenfield's analytics work matches what I enjoy. At Acme Labs I "
                                           "built the customer dashboard, and I'd like to bring that here."):
        self.calls = []
        self.adapt_answer = adapt_answer

    async def generate(self, system, messages, temperature=None, max_tokens=None, validate=None, stage="unknown",
                       items=1):
        user = messages[-1]["content"]
        self.calls.append((stage, user))
        if stage == "answer_adaptation":
            text = json.dumps({"answer": self.adapt_answer})
        elif stage == "answer_batch":
            answers = []
            for block in user.split("QUESTION id=")[1:]:
                qid = block.split(":", 1)[0]
                refs = block.split("EVIDENCE: ", 1)[1].split("\n", 1)[0].split(", ") if "EVIDENCE: " in block else []
                answers.append({"id": qid, "status": "answered", "answer": f"Grounded answer {qid}.",
                                "confidence": "high", "usedSources": refs[:2]})
            text = json.dumps({"answers": answers})
        else:
            text = json.dumps({"status": "answered", "answer": "Single answer.", "confidence": "high",
                               "usedSources": []})
        value = validate(text) if validate else text
        return GatewayResult(text=text, value=value, provider="Mock", model="mock-1",
                             usage={"prompt_tokens": 100, "completion_tokens": 50})


def _batch(questions, job=JOB, check_saved=False, field=LONG):
    return GenerateBatchRequest(items=[BatchItem(id=f"q{i}", question=q, field=field) for i, q in enumerate(questions)],
                                job_context=job, check_saved=check_saved)


# --- answering the rest together --------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_five_long_questions_take_one_call_not_five():
    model = BatchModel()
    engine, rest = AnswerEngine(model), FakeRest()
    plan = await engine.plan_batch(rest, _batch(BEHAVIORAL), USER_ID)
    results = await engine.complete_batch(rest, plan)
    assert [stage for stage, _ in model.calls] == ["answer_batch"]
    assert plan.calls == 1
    assert all(r.status == "answered" for r in results)


@pytest.mark.asyncio
async def test_batch_evidence_is_shared_once_and_mapped_per_question():
    rest = FakeRest()
    analyses = [classify_question(q) for q in BEHAVIORAL]
    union = classify_question("x")
    data = await fetch_profile_data(rest, union.__class__(question="", category="general", intent="general",
                                                          sections=["experiences", "projects", "skills", "education",
                                                                    "achievements"]), USER_ID)
    ctx = build_context(data, union, analyses=analyses, job_text=JOB.description)
    # Every record appears once in the shared evidence, however many questions retrieved it.
    lines = [line for line in ctx.text.splitlines() if line.startswith("[") and not line.startswith(("[PR]", "[S]"))]
    assert len(lines) == len(set(lines))
    # Each question knows which of the shared records are its own, and they all exist.
    assert len(ctx.question_refs) == len(analyses)
    assert all(ref in ctx.sources for refs in ctx.question_refs for ref in refs)
    assert any(len(refs) > 0 for refs in ctx.question_refs)
    message = build_batch_message([(f"q{i}", a, LONG) for i, a in enumerate(analyses)], ctx, JOB, None)
    for i, refs in enumerate(ctx.question_refs):
        if refs:
            assert f"QUESTION id=q{i}:\n{BEHAVIORAL[i]}\nEVIDENCE: {', '.join(refs)}" in message
    assert message.count("CANDIDATE EVIDENCE:") == 1


@pytest.mark.asyncio
async def test_only_genuinely_generative_questions_reach_the_model():
    """Deterministic answers, saved answers and cached answers are resolved before the batch call."""
    _answer_cache.invalidate_user(USER_ID)
    model = BatchModel()
    engine, rest = AnswerEngine(model), FakeRest()
    rest.tables["saved_answers"] = [{**SAVED_OTHER_JOB, "id": "sa2", "question": "How did you hear about us?",
                                     "company": None, "role": None, "answer": "Through a friend."}]
    cached_question = "Describe relevant projects."
    # Answer one question first, so it's in the cache.
    await engine.complete_batch(rest, await engine.plan_batch(rest, _batch([cached_question]), USER_ID))
    model.calls.clear()

    request = GenerateBatchRequest(job_context=JOB, check_saved=True, items=[
        BatchItem(id="det", question="Will you require visa sponsorship?",
                  field=FieldContext(kind="choice_single", options=["Yes", "No"])),
        BatchItem(id="saved", question="How did you hear about us?", field=LONG),
        BatchItem(id="cached", question=cached_question, field=LONG),
        BatchItem(id="gen1", question="Tell us about a difficult technical problem.", field=LONG),
        BatchItem(id="gen2", question="Why are you a good fit?", field=LONG),
    ])
    plan = await engine.plan_batch(rest, request, USER_ID, saved=rest.tables["saved_answers"])
    assert plan.sources == {"det": "deterministic", "saved": "saved", "cached": "cache", "gen1": "generated",
                            "gen2": "generated"}
    results = {r.id: r for r in await engine.complete_batch(rest, plan)}
    [(stage, message)] = model.calls
    assert stage == "answer_batch"
    assert "id=gen1" in message and "id=gen2" in message
    assert "id=det" not in message and "id=saved" not in message and "id=cached" not in message
    assert results["det"].answer == "No"
    assert (results["saved"].answer, results["saved"].saved_answer_id) == ("Through a friend.", "sa2")


@pytest.mark.asyncio
async def test_saved_answers_never_fill_choices_or_numbers():
    engine, rest = AnswerEngine(BatchModel()), FakeRest()
    saved = [{**SAVED_OTHER_JOB, "question": "Are you willing to relocate?", "company": None, "answer": "Yes!"}]
    request = GenerateBatchRequest(items=[BatchItem(id="r", question="Are you willing to relocate?",
                                                    field=FieldContext(kind="choice_single", options=["Yes", "No"]))])
    plan = await engine.plan_batch(rest, request, USER_ID, saved=saved)
    assert plan.sources["r"] != "saved"


@pytest.mark.asyncio
async def test_saved_answer_for_another_employer_is_adapted_alongside_the_batch():
    model = BatchModel()
    engine, rest = AnswerEngine(model), FakeRest()
    plan = await engine.plan_batch(rest, _batch(BEHAVIORAL, check_saved=True), USER_ID, saved=[SAVED_OTHER_JOB])
    assert [item.id for item, _, _ in plan.adapt] == ["q0"]
    results = {r.id: r for r in await engine.complete_batch(rest, plan)}
    assert sorted(stage for stage, _ in model.calls) == ["answer_adaptation", "answer_batch"]
    assert "Northwind" not in results["q0"].answer
    assert (results["q0"].adapted_from, results["q0"].saved_answer_id) == ("sa1", "sa1")
    batch_message = next(m for s, m in model.calls if s == "answer_batch")
    assert "id=q0" not in batch_message
    assert plan.calls == 2


@pytest.mark.asyncio
async def test_an_adaptation_that_invents_facts_returns_the_saved_answer_unchanged():
    model = BatchModel(adapt_answer="At Lumenfield I'd bring my 12 years of Rust experience.")
    engine, rest = AnswerEngine(model), FakeRest()
    plan = await engine.plan_batch(rest, _batch(BEHAVIORAL[:1], check_saved=True), USER_ID, saved=[SAVED_OTHER_JOB])
    [result] = await engine.complete_batch(rest, plan)
    assert result.answer == SAVED_OTHER_JOB["answer"]
    assert result.saved_answer_id == "sa1" and result.adapted_from is None


@pytest.mark.asyncio
async def test_batch_answers_cite_only_evidence_that_was_sent():
    """Truthfulness under batching: a citation the model invents is dropped, never shown as a source."""

    class Inventing(BatchModel):
        async def generate(self, system, messages, validate=None, stage="unknown", **kwargs):
            user = messages[-1]["content"]
            ids = [b.split(":", 1)[0] for b in user.split("QUESTION id=")[1:]]
            text = json.dumps({"answers": [{"id": i, "status": "answered", "answer": "x", "confidence": "high",
                                            "usedSources": ["E1", "E99", "P42"]} for i in ids]})
            return GatewayResult(text=text, value=validate(text), provider="Mock", model="m", usage={})

    engine, rest = AnswerEngine(Inventing()), FakeRest()
    results = await engine.complete_batch(rest, await engine.plan_batch(rest, _batch(BEHAVIORAL[:3]), USER_ID))
    for r in results:
        assert [s.id for s in r.used_sources] == ["e1"]


def test_batch_prompt_keeps_every_grounding_rule():
    from src.app.answers.prompt import _RULES, BATCH_SYSTEM_PROMPT

    assert BATCH_SYSTEM_PROMPT.startswith(_RULES)
    assert "EVIDENCE line" in BATCH_SYSTEM_PROMPT


def test_chunks_are_as_few_as_possible_and_evenly_filled():
    items = [BatchItem(id=f"q{i}", question=f"Tell us about project number {i}.") for i in range(9)]
    analyses = {i.id: classify_question(i.question) for i in items}
    assert [len(c) for c in group_questions(items, analyses, 6, by_family=False)] == [5, 4]
    assert [len(c) for c in group_questions(items[:6], analyses, 6, by_family=False)] == [6]
    assert [len(c) for c in group_questions(items[:7], analyses, 6, by_family=False)] == [4, 3]


@pytest.mark.asyncio
async def test_generate_batch_endpoint_resolves_saved_answers_on_the_server():
    rest = FakeRest()
    rest.tables["saved_answers"] = [SAVED_OTHER_JOB]
    app.dependency_overrides[get_current_user] = lambda: AuthUser(id=USER_ID, email="sam@example.com", token="t")
    app.dependency_overrides[get_rest] = lambda: rest
    model = BatchModel()
    try:
        with patch.object(answer_engine, "gateway", model):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                response = await client.post("/api/v1/answers/generate-batch", json={
                    "job_context": JOB.model_dump(mode="json"), "check_saved": True,
                    "items": [{"id": f"q{i}", "question": q, "field": {"kind": "open_text"}}
                              for i, q in enumerate(BEHAVIORAL[:3])],
                })
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 200
    by_id = {r["id"]: r for r in response.json()["results"]}
    assert by_id["q0"]["adaptedFrom"] == "sa1" and by_id["q0"]["savedAnswerId"] == "sa1"
    assert "savedAnswerId" in by_id["q1"] and by_id["q1"]["savedAnswerId"] is None
    kinds = sorted(e["kind"] for e in rest.tables["usage_events"])
    assert kinds == ["adapt_saved_answer", "generate", "generate"]


# --- provider-reported accounting ---------------------------------------------------------------------------------

def test_usage_splits_cached_input_and_prices_it():
    call = llm_usage.from_usage("answer", "anthropic", "claude-opus-5-5",
                                {"prompt_tokens": 1500, "completion_tokens": 400, "cached_tokens": 1000,
                                 "cache_write_tokens": 0}, duration_ms=900)
    assert (call.input_tokens, call.cache_read_tokens, call.output_tokens) == (500, 1000, 400)
    assert call.prompt_tokens == 1500 and call.total_tokens == 1900
    # $4/M uncached input, $0.20/M cache reads, $20/M output.
    assert call.cost_usd == pytest.approx((500 * 4 + 1000 * 0.2 + 400 * 20) / 1e6)


def test_unpriced_models_have_no_cost_and_pricing_is_configurable(monkeypatch):
    assert pricing.cost_usd("some-unknown-model", 1000, 1000) is None
    assert pricing.price_for("claude-haiku-4-5-20251001") == pricing.MODEL_PRICING["claude-haiku-4-5"]
    monkeypatch.setattr(get_settings(), "MODEL_PRICING_JSON", '{"gemini-x": {"input": 0.1, "output": 0.4}}')
    pricing.clear_pricing_cache()
    try:
        assert pricing.cost_usd("gemini-x", 1_000_000, 1_000_000) == pytest.approx(0.5)
        assert pricing.price_for("models/gemini-x") == pricing.price_for("gemini-x")  # provider-prefixed ids
        assert pricing.price_for("x-gemini") is None
    finally:
        monkeypatch.setattr(get_settings(), "MODEL_PRICING_JSON", "")
        pricing.clear_pricing_cache()


def _deployment(kind="openai_compatible", model="m-1"):
    return ProviderDeployment(name="P", provider="openai" if kind != "anthropic" else "anthropic", api_key="k",
                              base_url=None, default_model=model, kind=kind)


@pytest.mark.asyncio
async def test_gateway_records_every_billed_call_including_unusable_output():
    gateway = LLMGateway(deployments=[_deployment(), _deployment(model="m-2")])
    bad = Completion("not json", {"prompt_tokens": 200, "completion_tokens": 20})
    good = Completion('{"ok": 1}', {"prompt_tokens": 210, "completion_tokens": 30, "cached_tokens": 100})

    def validate(text):
        return json.loads(text)

    with patch("src.app.gateway.gateway.complete_openai_compatible", AsyncMock(side_effect=[bad, good])):
        with llm_usage.collect() as calls:
            await gateway.generate("sys", [{"role": "user", "content": "q"}], validate=validate, stage="answer")
    assert [(c.ok, c.prompt_tokens, c.cache_read_tokens) for c in calls] == [(False, 200, 0), (True, 210, 100)]


@pytest.mark.asyncio
async def test_answer_requests_write_one_row_per_call_with_the_job():
    rest = FakeRest()
    gateway = LLMGateway(deployments=[_deployment()])
    completion = Completion(json.dumps({"status": "answered", "answer": "I built TaskFlow.", "confidence": "high",
                                        "usedSources": ["P1"]}),
                            {"prompt_tokens": 900, "completion_tokens": 120, "reasoning_tokens": 40})
    app.dependency_overrides[get_current_user] = lambda: AuthUser(id=USER_ID, email="sam@example.com", token="t")
    app.dependency_overrides[get_rest] = lambda: rest
    try:
        with patch.object(answer_engine, "gateway", gateway), \
                patch("src.app.gateway.gateway.complete_openai_compatible", AsyncMock(return_value=completion)):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                response = await client.post("/api/v1/answers/resolve", json={
                    "question": "What project are you most proud of?", "job_context": JOB.model_dump(mode="json")})
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 200
    [row] = rest.tables["llm_calls"]
    assert row["stage"] == "answer" and row["provider"] == "openai" and row["model"] == "m-1"
    assert (row["input_tokens"], row["output_tokens"], row["thinking_tokens"]) == (900, 120, 40)
    assert row["job_key"] == job_key(JOB.url, JOB.company, JOB.role)
    assert row["request_id"] == response.headers["X-Request-Id"]
    assert row["cost_usd"] is None  # "m-1" has no price


@pytest.mark.asyncio
async def test_accounting_failures_never_fail_the_answer():
    class Broken(FakeRest):
        async def insert_many(self, table, rows):
            if table == "llm_calls":
                raise RuntimeError("relation llm_calls does not exist")
            await super().insert_many(table, rows)

    await llm_usage.write_calls(Broken(), [llm_usage.LLMCall(stage="answer", provider="p", model="m")])


@pytest.mark.asyncio
async def test_anthropic_usage_reports_cache_reads_and_writes():
    from types import SimpleNamespace

    response = SimpleNamespace(stop_reason="end_turn", content=[SimpleNamespace(type="text", text="ok")],
                               usage=SimpleNamespace(input_tokens=300, output_tokens=50, cache_read_input_tokens=600,
                                                     cache_creation_input_tokens=0))
    create = AsyncMock(return_value=response)
    client = SimpleNamespace(beta=SimpleNamespace(messages=SimpleNamespace(create=create)))
    with patch("src.app.gateway.adapters.anthropic.AsyncAnthropic", return_value=client):
        result = await complete_anthropic(_deployment("anthropic", "claude-opus-5-5"), "sys", [], max_tokens=16000,
                                          effort="low", timeout=20, max_retries=0)
        assert result.usage["prompt_tokens"] == 900 and result.usage["cached_tokens"] == 600
        assert create.await_args.kwargs["output_config"] == {"effort": "low"}
        # Haiku 4.5 rejects effort: it must not be sent (every call would fail over to another provider).
        await complete_anthropic(_deployment("anthropic", "claude-opus-5-5"), "sys", [], max_tokens=16000,
                                 effort="low", timeout=20, max_retries=0, model="claude-haiku-4-5")
        assert "output_config" not in create.await_args.kwargs
    assert not supports_effort("claude-haiku-4-5") and supports_effort("claude-sonnet-5-5")


def test_embedding_calls_are_their_own_stages():
    from src.app.core.token_budget import EMBEDDING_STAGES, STAGE_TIER

    assert EMBEDDING_STAGES == {"embedding_query", "embedding_profile"}
    assert not EMBEDDING_STAGES & set(STAGE_TIER)


@pytest.mark.asyncio
async def test_embedding_cost_is_recorded_apart_from_generation():
    from src.app.answers import semantic
    from tests.test_evidence_and_accounting import FakeEmbedder, SemanticRest

    semantic.invalidate_semantic_cache(USER_ID)
    semantic._queries.clear()
    retriever = semantic.SemanticRetriever(FakeEmbedder())
    rest = SemanticRest()
    data = {s: rest.tables[s] for s in ("experiences", "projects", "achievements", "profile_facts")}
    with llm_usage.collect() as calls:
        await retriever.search(rest, USER_ID, data, "Describe a conflict with a teammate.")
    assert [c.stage for c in calls] == ["embedding_profile", "embedding_query"]
    assert calls[0].items == 3 and calls[1].items == 1


# --- routing ----------------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("question,field,style,stage", [
    ("What experience do you have with FastAPI?", LONG, None, ANSWER_SIMPLE),
    ("Tell us about your degree.", LONG, None, ANSWER_SIMPLE),
    ("Describe your experience with FastAPI and TypeScript.", LONG, None, ANSWER),      # two technologies
    ("What experience do you have with Kubernetes?", LONG, None, ANSWER),               # not in the profile
    ("What experience do you have with FastAPI?", LONG, AnswerStyle(length="detailed"), ANSWER),
    ("What experience do you have with FastAPI?", FieldContext(kind="textarea", max_length=3000), None, ANSWER),
    ("Tell us about a time you influenced stakeholders under uncertainty.", LONG, None, ANSWER),
    ("Cover letter", LONG, None, ANSWER_COMPLEX),
])
@pytest.mark.asyncio
async def test_only_simple_answers_route_to_the_simple_stage(question, field, style, stage):
    rest = FakeRest()
    analysis = classify_question(question)
    data = await fetch_profile_data(rest, analysis, USER_ID)
    ctx = build_context(data, analysis)
    assert answer_stage(analysis, ctx, field, style) == stage
    assert answer_stage(analysis, ctx, field, style, regenerating=True) == REGENERATION


@pytest.mark.parametrize("enabled,stage,model", [
    (False, "answer_simple", "claude-opus-5-5"),
    (True, "answer_simple", "claude-haiku-4-5"),
    (True, "answer", "claude-opus-5-5"),
    (True, "answer_batch", "claude-opus-5-5"),
    (True, "tailoring_plan", "claude-opus-5-5"),
    (True, "job_analysis", "claude-haiku-4-5"),
])
def test_simple_answers_use_the_fast_model_only_when_enabled(enabled, stage, model, monkeypatch):
    monkeypatch.setattr(get_settings(), "ANTHROPIC_FAST_MODEL", "claude-haiku-4-5")
    monkeypatch.setattr(get_settings(), "FAST_MODEL_SIMPLE_ANSWERS", enabled)
    assert LLMGateway.model_for(_deployment("anthropic", "claude-opus-5-5"), stage) == model


# --- answer cache --------------------------------------------------------------------------------------------------

def _key(**overrides):
    base = dict(question="Why do you want to work here?", job_context=JOB, field=FieldContext(kind="textarea"))
    return _answer_key(USER_ID, GenerateAnswerRequest(**{**base, **overrides}), {"profile": {"id": "x"}})


def test_cache_key_ignores_what_cannot_change_the_prompt():
    key = _key()
    assert _key(question="  why do you want to work here  ") == key
    assert _key(job_context=JOB.model_copy(update={"id": uuid.UUID(int=1), "url": "https://other.example/x"})) == key
    assert _key(field=FieldContext(kind="open_text", label="Why do you want to work here?")) == key
    assert _key(style=AnswerStyle()) == key


def test_cache_key_still_separates_what_changes_the_answer():
    key = _key()
    assert _key(question="Why are you interested in this company?") != key
    assert _key(job_context=JOB.model_copy(update={"company": "Northwind"})) != key
    assert _key(field=FieldContext(kind="input")) != key
    assert _key(style=AnswerStyle(tone="formal")) != key


def test_cache_lookup_tells_expired_from_missing(monkeypatch):
    cache: TTLCache[str] = TTLCache(10, max_entries=5)
    assert cache.lookup(("u", "k")) == (None, "miss")
    cache.set(("u", "k"), "v")
    assert cache.lookup(("u", "k")) == ("v", "hit")
    import src.app.core.ttl_cache as ttl

    now = ttl.time.monotonic()
    monkeypatch.setattr(ttl.time, "monotonic", lambda: now + 11)
    assert cache.lookup(("u", "k")) == (None, "expired")


# --- the worst case -------------------------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_worst_case_application_budget():
    """Tailoring + six long answers answered together stays inside the third pass's 12k–15k target."""
    from scripts.benchmark_tokens import run_scenarios, summarize

    summary = summarize(await run_scenarios())
    assert summary["CB"]["llm_calls"] == 2                      # one batch + the saved answer's adaptation
    assert summary["D"]["total_tokens"] + summary["CB"]["total_tokens"] <= 15000
    assert summary["CB"]["total_tokens"] < summary["C"]["total_tokens"] / 2


# --- saved-answer adaptation must not invent anything --------------------------------------------------------------

from src.app.answers.adapt import _validate, adaptation_reason  # noqa: E402

ADAPT_SAVED = {"id": "s1", "question": "Why do you want to work here?", "company": "Northwind",
               "role": "Backend Engineer",
               "answer": "Northwind's backend team fits me: at Acme Labs I built 3 billing systems in Python over "
                         "4 years, and I expect $150,000."}
ADAPT_REQUEST = GenerateAnswerRequest(question="Why do you want to work here?", job_context=JobContext(
    company="Lumenfield", role="Platform Engineer", description="Lumenfield builds analytics for hospitals."))


def _adapt(answer, request=ADAPT_REQUEST, reason="other_company"):
    return _validate(json.dumps({"answer": answer}), ADAPT_SAVED, request, reason)


def test_adaptation_retargets_without_changing_facts():
    good = ("Lumenfield's hospital analytics fit me: at Acme Labs I built 3 billing systems in Python over 4 years, "
            "and I expect $150,000.")
    assert _adapt(good) == good


@pytest.mark.parametrize("answer,why", [
    ("Northwind and Lumenfield both fit me: at Acme Labs I built 3 billing systems.", "old employer kept"),
    ("Lumenfield fits me: at Acme Labs I built 5 billing systems in Python.", "count changed"),
    ("Lumenfield fits me: I have 8 years of Python at Acme Labs.", "years invented"),
    ("Lumenfield fits me, and I expect $180,000.", "salary changed"),
    ("Lumenfield fits me: at Google I built billing systems in Python.", "employer invented"),
    ("Lumenfield fits me: at Acme Labs I built billing systems in Kubernetes.", "technology invented"),
])
def test_adaptation_rejects_unsupported_changes(answer, why):
    with pytest.raises(ValueError):
        _adapt(answer)


def test_adaptation_reasons_cover_role_and_length():
    same_company = GenerateAnswerRequest(question="Why?", job_context=JobContext(company="Northwind", role="SRE"))
    assert adaptation_reason({**ADAPT_SAVED, "answer": "As a Backend Engineer at Northwind..."}, same_company) \
        == "other_role"
    short = GenerateAnswerRequest(question="Why?", field=FieldContext(max_length=60))
    assert adaptation_reason(ADAPT_SAVED, short) == "too_long"
    fitted = _validate(json.dumps({"answer": "Northwind fits me: at Acme Labs I built 3 billing systems in Python "
                                             "over 4 years."}), ADAPT_SAVED, short, "too_long")
    assert len(fitted) <= 60


# --- semantic retrieval -------------------------------------------------------------------------------------------

def test_embedding_keys_are_found_numbered_too(monkeypatch):
    from src.app.answers.semantic import SemanticRetriever

    monkeypatch.setattr(get_settings(), "EMBEDDING_PROVIDER", "gemini")
    monkeypatch.setenv("GOOGLE_API_KEY3", "g-numbered")
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    with patch("src.app.answers.semantic.discover_keys", return_value=["g-numbered"]) as found:
        assert SemanticRetriever.from_settings().enabled
    assert found.call_args.args[1] == "GOOGLE_API_KEY"


@pytest.mark.asyncio
async def test_retrieval_benchmark_keyword_baseline_is_stable():
    """The retrieval quality set (scripts/benchmark_retrieval.py) without embeddings: the keyword baseline semantic
    fallback is measured against. A drop here means keyword retrieval regressed."""
    from scripts.benchmark_retrieval import run, summarize

    summary = summarize(await run(None))
    assert summary["semantic_ran"] == 0
    assert summary["recall_at_k"] >= 0.85
    assert summary["keyword_top1_hard"] >= 0.5


# --- the answer quality set's checker ------------------------------------------------------------------------------

def test_quality_checks_flag_invented_facts_and_format_errors():
    from scripts.answer_quality_set import CASES
    from scripts.eval_answers import check

    corpus = "Harborline Analytics FastAPI ingestion 12,000 events DocQuery Lumenfield"
    fastapi = next(c for c in CASES if c.id == "tech-fastapi")
    assert check(fastapi, "answered", "At Harborline Analytics I built a FastAPI ingestion service.", corpus) == []
    problems = check(fastapi, "answered", "At Harborline Analytics I built a FastAPI service at Stripe for 50,000 "
                                          "events.", corpus)
    assert any("numbers ['50000']" in p for p in problems) and any("Stripe" in p for p in problems)
    limited = next(c for c in CASES if c.id == "char-limited-why")
    assert any("chars >" in p for p in check(limited, "answered", "x " * 200, corpus))
    letter = next(c for c in CASES if c.id == "long-form")
    assert not [p for p in check(letter, "answered", "Dear Hiring Manager,\n\nLumenfield " + "word " * 160, corpus)
                if "ungrounded" in p]
    no_evidence = next(c for c in CASES if c.id == "no-evidence")
    assert check(no_evidence, "insufficient_information", "", corpus) == []
