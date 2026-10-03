"""
V1.1 engine and API tests: choice and number fields, ask-and-learn (structured
missing information, facts, declined skills) and fill-all batches. The LLM is mocked.
"""

import json
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from src.app.answers.classifier import classify_question
from src.app.answers.engine import AnswerEngine
from src.app.answers.parser import match_option, parse_answer, parse_batch
from src.app.answers.profile_context import build_context
from src.app.answers.prompt import build_batch_message, build_user_message
from src.app.api.deps import answer_engine, get_rest
from src.app.core.auth import AuthUser, get_current_user
from src.app.gateway import GatewayResult, GatewayUnavailableError
from src.app.main import app
from src.app.schemas.answers import (
    AnswerStyle,
    BatchItem,
    FieldContext,
    GenerateAnswerRequest,
    GenerateBatchRequest,
)
from tests.fakes import USER_ID, FakeRest

YES_NO = ["Yes", "No"]


def _gateway(*payloads: dict) -> AsyncMock:
    """A gateway that returns each payload in turn (as the model's JSON text)."""
    queue = list(payloads)
    gateway = AsyncMock()

    async def generate(system, messages, temperature=None, max_tokens=None, validate=None, stage=None, items=1):
        text = json.dumps(queue.pop(0) if len(queue) > 1 else queue[0])
        return GatewayResult(text=text, value=validate(text), provider="Mock", model="mock-1",
                             usage={"prompt_tokens": 120, "completion_tokens": 40})

    gateway.generate = AsyncMock(side_effect=generate)
    return gateway


def _ctx(question: str = "Tell us about yourself", tables=None, facts=None):
    analysis = classify_question(question)
    rest = FakeRest(tables)
    data = rest.tables | {"profile": rest.tables["profiles"][0]}
    return analysis, build_context(data, analysis, facts)


# --- choice and number fields ----------------------------------------------------

@pytest.mark.parametrize("answer,expected", [
    ("Yes", "Yes"), ("yes", "Yes"), ("Yes, I am authorized.", "Yes"), ("no.", "No"), ("Maybe", None),
])
def test_match_option(answer, expected):
    assert match_option(answer, YES_NO) == expected


def test_choice_answers_must_be_an_option():
    field = FieldContext(kind="choice_single", options=["0-1 years", "2-4 years", "5+ years"])
    ok = parse_answer(json.dumps({"status": "answered", "answer": "2-4 years", "confidence": "high"}), {}, None, field)
    assert ok.answer == "2-4 years"
    with pytest.raises(ValueError):
        parse_answer(json.dumps({"status": "answered", "answer": "About three", "confidence": "high"}), {}, None, field)
    multi = FieldContext(kind="choice_multi", options=["React", "Vue", "Python"])
    parsed = parse_answer(json.dumps({"status": "answered", "answer": "react | Python"}), {}, None, multi)
    assert parsed.answer == "React | Python"


def test_number_answers_are_numbers():
    field = FieldContext(kind="number")
    assert parse_answer(json.dumps({"status": "answered", "answer": "4 years"}), {}, None, field).answer == "4"
    assert parse_answer(json.dumps({"status": "answered", "answer": "$120,000"}), {}, None, field).answer == "120000"


def test_prompt_lists_options_and_skips_style_for_choices():
    analysis, ctx = _ctx("Are you comfortable working remotely?")
    message = build_user_message(analysis, ctx, None, FieldContext(kind="choice_single", options=YES_NO),
                                 style=AnswerStyle(length="detailed"))
    assert 'Options: "Yes"; "No"' in message
    assert "Length:" not in message


@pytest.mark.asyncio
async def test_logistics_choices_are_deterministic():
    gateway = _gateway({})
    engine = AnswerEngine(gateway)
    sponsorship = await engine.answer(FakeRest(), GenerateAnswerRequest(
        question="Will you now or in the future require visa sponsorship?",
        field=FieldContext(kind="choice_single", options=["Yes", "No"])))
    assert (sponsorship.status, sponsorship.answer, sponsorship.provider) == ("answered", "No", None)
    mode = await engine.answer(FakeRest(), GenerateAnswerRequest(
        question="Are you open to remote, hybrid or on-site work? Which do you prefer?",
        field=FieldContext(kind="choice_single", options=["On-site", "Hybrid", "Remote"])))
    assert mode.answer == "Remote"
    gateway.generate.assert_not_awaited()


# --- ask-and-learn ---------------------------------------------------------------

@pytest.mark.asyncio
async def test_missing_logistics_asks_for_the_profile_field():
    response = await AnswerEngine(_gateway({})).answer(
        FakeRest(), GenerateAnswerRequest(question="Are you willing to relocate?"))
    assert response.status == "insufficient_information"
    [item] = response.missing
    assert (item.key, item.input, item.target.type, item.target.field) == (
        "willing_to_relocate", "boolean", "profile_field", "willing_to_relocate")


@pytest.mark.asyncio
async def test_missing_skill_asks_about_the_skill():
    response = await AnswerEngine(_gateway({})).answer(
        FakeRest(), GenerateAnswerRequest(question="Do you have experience with Kubernetes?"))
    [item] = response.missing
    assert (item.key, item.input, item.target.name) == ("skill:kubernetes", "skill", "Kubernetes")


@pytest.mark.asyncio
async def test_declined_skill_answers_no_without_asking():
    rest = FakeRest()
    rest.tables["skills"].append({"id": "s9", "name": "Kubernetes", "level": "none", "years": None, "sort_order": 9})
    gateway = _gateway({})
    engine = AnswerEngine(gateway)
    text = await engine.answer(rest, GenerateAnswerRequest(question="Do you have experience with Kubernetes?"))
    assert (text.status, text.answer) == ("answered", "No, I haven't worked with Kubernetes.")
    choice = await engine.answer(rest, GenerateAnswerRequest(
        question="Do you have experience with Kubernetes?", field=FieldContext(kind="choice_single", options=YES_NO)))
    assert choice.answer == "No"
    gateway.generate.assert_not_awaited()


def test_declined_skills_are_not_skills():
    tables = FakeRest().tables
    tables["skills"].append({"id": "s9", "name": "Rust", "level": "none", "years": None, "sort_order": 9})
    _, ctx = _ctx("Do you have experience with Rust?", tables)
    assert not ctx.has_skill("Rust") and ctx.declined("Rust")
    assert "Rust" not in ctx.text


@pytest.mark.asyncio
async def test_model_gaps_become_fact_questions():
    gateway = _gateway({"status": "insufficient_information", "answer": "", "confidence": "high", "usedSources": [],
                        "missingInformation": "Your profile doesn't describe leading a team.",
                        "missingQuestion": "Describe a time you led a team."})
    response = await AnswerEngine(gateway).answer(
        FakeRest(), GenerateAnswerRequest(question="Tell me about a time you led a team through a hard deadline."))
    [item] = response.missing
    assert (item.key, item.prompt, item.target.type, item.target.category) == (
        "fact:leadership", "Describe a time you led a team.", "fact", "leadership")


def test_facts_and_additional_facts_are_grounding():
    tables = FakeRest().tables
    tables["profile_facts"] = [{"id": "f1", "category": "leadership", "prompt": "Describe a time you led a team",
                                "answer": "I led the four-person checkout rewrite at Acme Labs."}]
    _, ctx = _ctx("Tell me about a time you led a team", tables, facts=["My notice period is one month."])
    assert "[F1] FACT (leadership): Describe a time you led a team" in ctx.text
    assert "checkout rewrite" in ctx.text
    assert "[N1] FACT (from the candidate, just now): My notice period is one month." in ctx.text
    assert ctx.sources["F1"].type == "fact"


@pytest.mark.asyncio
async def test_fact_answers_are_used_in_later_questions():
    rest = FakeRest()
    rest.tables["profile_facts"] = [{"id": "f1", "category": "leadership", "prompt": "Led a team?", "answer": "Yes."}]
    gateway = _gateway({"status": "answered", "answer": "...", "confidence": "high", "usedSources": ["F1"]})
    response = await AnswerEngine(gateway).answer(rest, GenerateAnswerRequest(question="What are your strengths?"))
    assert response.used_sources[0].type == "fact"
    assert "Led a team?" in gateway.generate.await_args.kwargs["messages"][0]["content"]


# --- batches -----------------------------------------------------------------------

def _batch(*items: BatchItem, style=None) -> GenerateBatchRequest:
    return GenerateBatchRequest(items=list(items), style=style)


@pytest.mark.asyncio
async def test_batch_one_model_call_and_deterministic_items_skip_it():
    gateway = _gateway({"answers": [
        {"id": "q1", "status": "answered", "answer": "I want to build AI tools.", "confidence": "high", "usedSources": ["E1"]},
        {"id": "q2", "status": "answered", "answer": "TaskFlow...", "confidence": "medium", "usedSources": ["P1"]},
    ]})
    engine = AnswerEngine(gateway)
    rest = FakeRest()
    plan = await engine.plan_batch(rest, _batch(
        BatchItem(id="q1", question="Why do you want to work here?", field=FieldContext(kind="open_text")),
        BatchItem(id="q2", question="Tell us about a project you're proud of.", field=FieldContext(kind="open_text")),
        BatchItem(id="q3", question="Do you require sponsorship?", field=FieldContext(kind="choice_single", options=YES_NO)),
        BatchItem(id="q4", question="Are you willing to relocate?", field=FieldContext(kind="choice_single", options=YES_NO)),
    ))
    assert [i.id for i in plan.pending] == ["q1", "q2"]
    results = await engine.complete_batch(rest, plan)
    assert [r.id for r in results] == ["q1", "q2", "q3", "q4"]
    assert results[0].answer == "I want to build AI tools." and results[0].provider == "Mock"
    assert (results[2].answer, results[2].provider) == ("No", None)
    assert results[3].status == "insufficient_information" and results[3].missing[0].key == "willing_to_relocate"
    gateway.generate.assert_awaited_once()
    message = gateway.generate.await_args.kwargs["messages"][0]["content"]
    assert "QUESTION id=q1" in message and "QUESTION id=q2" in message
    assert "Do not reuse the same example" in gateway.generate.await_args.kwargs["system"]


@pytest.mark.asyncio
async def test_batch_falls_back_per_item_for_bad_answers():
    gateway = _gateway(
        {"answers": [
            {"id": "a", "status": "answered", "answer": "Fine.", "confidence": "high"},
            {"id": "b", "status": "answered", "answer": "Perhaps", "confidence": "high"},  # not an option
        ]},
        {"status": "answered", "answer": "Yes", "confidence": "high", "usedSources": []},
    )
    engine = AnswerEngine(gateway)
    rest = FakeRest()
    plan = await engine.plan_batch(rest, _batch(
        BatchItem(id="a", question="Tell us about yourself", field=FieldContext(kind="open_text")),
        BatchItem(id="b", question="Have you shipped React apps to production?",
                  field=FieldContext(kind="choice_single", options=YES_NO)),
    ))
    results = await engine.complete_batch(rest, plan)
    assert [r.answer for r in results] == ["Fine.", "Yes"]
    assert gateway.generate.await_count == 2


@pytest.mark.asyncio
async def test_batch_reports_items_it_could_not_generate():
    gateway = AsyncMock()
    gateway.generate = AsyncMock(side_effect=GatewayUnavailableError("down"))
    engine = AnswerEngine(gateway)
    rest = FakeRest()
    plan = await engine.plan_batch(rest, _batch(BatchItem(id="a", question="Tell us about yourself")))
    [result] = await engine.complete_batch(rest, plan)
    assert result.error and result.answer == ""


def test_batch_parse_requires_every_id():
    with pytest.raises(ValueError):
        parse_batch(json.dumps({"answers": [{"id": "a", "status": "answered", "answer": "x"}]}), {}, {"a": None, "b": None})


def test_batch_message_has_one_evidence_block():
    analysis, ctx = _ctx()
    message = build_batch_message([("a", analysis, None), ("b", classify_question("Why us?"), None)], ctx, None, None)
    assert message.count("CANDIDATE EVIDENCE") == 1


# --- API -------------------------------------------------------------------------------

@pytest.fixture
def rest():
    return FakeRest()


@pytest.fixture
def client(rest):
    app.dependency_overrides[get_current_user] = lambda: AuthUser(id=USER_ID, email="sam@example.com", token="t")
    app.dependency_overrides[get_rest] = lambda: rest
    yield AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
    app.dependency_overrides.clear()


def _mock_llm(payload: dict):
    async def generate(system, messages, temperature=None, max_tokens=None, validate=None, stage=None, items=1):
        text = json.dumps(payload)
        return GatewayResult(text=text, value=validate(text), provider="Mock", model="mock-1",
                             usage={"prompt_tokens": 120, "completion_tokens": 40})

    return patch.object(answer_engine.gateway, "generate", AsyncMock(side_effect=generate))


BATCH_BODY = {"items": [
    {"id": "f1", "question": "Why do you want to work here?", "field": {"kind": "open_text"}},
    {"id": "f2", "question": "Do you require sponsorship?", "field": {"kind": "choice_single", "options": ["Yes", "No"]}},
]}


@pytest.mark.asyncio
async def test_generate_batch_endpoint(client, rest):
    with _mock_llm({"answers": [{"id": "f1", "status": "answered", "answer": "Because...", "confidence": "high"}]}):
        response = await client.post("/api/v1/answers/generate-batch", json=BATCH_BODY)
    assert response.status_code == 200
    results = response.json()["results"]
    assert [(r["id"], r["answer"]) for r in results] == [("f1", "Because..."), ("f2", "No")]
    assert "usedSources" in results[0] and "missing" in results[0]
    # Only the generated answer counts toward the daily limit.
    assert [e["kind"] for e in rest.tables["usage_events"]] == ["generate"]
    assert rest.tables["usage_events"][0]["tokens"] > 0 and "tokens" not in results[0]


@pytest.mark.asyncio
async def test_generate_batch_over_daily_limit_says_how_many_remain(client, rest):
    rest.tables["usage_events"] = [{"id": i, "kind": "generate"} for i in range(4)]
    body = {"items": [{"id": f"q{i}", "question": f"Tell us about project number {i}"} for i in range(3)]}
    with patch("src.app.api.routes.answers.get_settings") as settings, _mock_llm({}) as llm:
        settings.return_value.RATE_LIMIT_PER_MINUTE = 100
        settings.return_value.DAILY_GENERATION_LIMIT = 5
        response = await client.post("/api/v1/answers/generate-batch", json=body)
    assert response.status_code == 429
    assert "1 left today" in response.json()["detail"]
    llm.assert_not_awaited()


@pytest.mark.asyncio
async def test_match_batch(client, rest):
    rest.tables["saved_answers"] = [{"id": "sa1", "question": "Why do you want to work here?", "answer": "Saved.",
                                     "category": "motivation", "updated_at": "2026-01-01"}]
    response = await client.post("/api/v1/saved-answers/match-batch", json={"items": [
        {"id": "a", "question": "Why do you want to work at Acme?"}, {"id": "b", "question": "What is your degree?"}]})
    results = response.json()["results"]
    assert results[0]["id"] == "a" and results[0]["match"]["id"] == "sa1"
    assert results[1]["match"] is None


@pytest.mark.asyncio
async def test_save_missing_writes_each_target(client, rest):
    response = await client.post("/api/v1/profile/missing", json={"items": [
        {"key": "notice_period", "target": {"type": "profile_field", "field": "notice_period"}, "value": "1 month"},
        {"key": "willing_to_relocate", "target": {"type": "profile_field", "field": "willing_to_relocate"}, "value": "yes"},
        {"key": "skill:kubernetes", "target": {"type": "skill", "name": "Kubernetes"}, "value": {"have": False}},
        {"key": "skill:react", "target": {"type": "skill", "name": "react"}, "value": {"have": True, "years": 5, "level": "expert"}},
        {"key": "fact:leadership", "target": {"type": "fact", "category": "leadership"},
         "value": "I led the checkout rewrite.", "prompt": "Describe a time you led a team"},
    ]})
    assert response.status_code == 200, response.text
    profile = rest.tables["profiles"][0]
    assert (profile["notice_period"], profile["willing_to_relocate"]) == ("1 month", True)
    skills = {s["name"]: s for s in rest.tables["skills"]}
    assert skills["Kubernetes"]["level"] == "none"
    assert (skills["React"]["level"], skills["React"]["years"]) == ("expert", 5)  # updated, not duplicated
    expected = {"category": "leadership", "answer": "I led the checkout rewrite.",
                "prompt": "Describe a time you led a team", "source": "extension"}
    assert expected.items() <= rest.tables["profile_facts"][0].items()

    # Next time: the relocation question is answered without asking or calling the model.
    with _mock_llm({}) as llm:
        again = await client.post("/api/v1/answers/generate", json={
            "question": "Are you willing to relocate?", "field": {"kind": "choice_single", "options": ["Yes", "No"]}})
    assert again.json()["answer"] == "Yes"
    llm.assert_not_awaited()


@pytest.mark.asyncio
async def test_save_missing_rejects_bad_values(client):
    response = await client.post("/api/v1/profile/missing", json={"items": [
        {"key": "preferred_work_mode", "target": {"type": "profile_field", "field": "preferred_work_mode"}, "value": "mars"}]})
    assert response.status_code == 422
