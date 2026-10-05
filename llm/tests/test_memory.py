"""
Application Memory, Ask-and-Learn saves and rewrite controls.
Supabase and the LLM gateway are replaced with in-memory fakes.
"""

import json
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from src.app.answers.classifier import classify_question
from src.app.answers.engine import AnswerEngine
from src.app.answers.prompt import length_target
from src.app.answers.rewrite import invented
from src.app.api.deps import answer_engine, get_rest
from src.app.core.auth import AuthUser, get_current_user
from src.app.core.token_budget import job_key
from src.app.gateway import GatewayResult, GatewayUnavailableError
from src.app.main import app
from src.app.memory.service import find_conflicts, is_stale, resolve_fact, scope_facts
from src.app.schemas.answers import FieldContext, GenerateAnswerRequest, JobContext
from tests.fakes import USER_ID, FakeRest

ACME = {"company": "Acme", "role": "Backend Engineer", "url": "https://jobs.example.com/acme/123"}
GLOBEX = {"company": "Globex", "role": "Platform Engineer", "url": "https://jobs.example.com/globex/9"}
YES_NO = {"kind": "choice_single", "options": ["Yes", "No"]}


@pytest.fixture
def rest():
    return FakeRest()


@pytest.fixture
def client(rest):
    app.dependency_overrides[get_current_user] = lambda: AuthUser(id=USER_ID, email="sam@example.com", token="t")
    app.dependency_overrides[get_rest] = lambda: rest
    yield AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
    app.dependency_overrides.clear()


def mock_llm(handler):
    """`handler(user_message) -> dict` is the model's JSON reply."""
    async def generate(system, messages, temperature=None, max_tokens=None, validate=None, stage=None, items=1):
        text = json.dumps(handler(messages[-1]["content"]))
        try:
            value = validate(text) if validate else text
        except ValueError as e:  # like the gateway: an invalid output from every provider
            raise GatewayUnavailableError(str(e)) from e
        return GatewayResult(text=text, value=value, provider="Mock", model="m",
                             usage={"prompt_tokens": 90, "completion_tokens": 30})

    return patch.object(answer_engine.gateway, "generate", AsyncMock(side_effect=generate))


def fact(key, answer, scope="global", **extra):
    now = datetime.now(timezone.utc).isoformat()
    return {"id": f"f-{key}-{scope}-{extra.get('job_key', '')}", "key": key, "answer": answer, "scope": scope,
            "status": "active", "prompt": key, "category": "general", "created_at": now, "updated_at": now,
            "last_confirmed_at": now, **extra}


async def save(client, items, job=None):
    body = {"items": items, **({"job_context": job} if job else {})}
    response = await client.post("/api/v1/profile/missing", json=body)
    assert response.status_code == 200, response.text
    return response.json()["saved"]


async def ask(client, question, field=None, job=None):
    body = {"question": question, **({"field": field} if field else {}), **({"job_context": job} if job else {})}
    response = await client.post("/api/v1/answers/generate", json=body)
    assert response.status_code == 200, response.text
    return response.json()


# --- resolution precedence -------------------------------------------------------------------------------------

def test_profile_overrides_global_memory_but_not_job_memory():
    profile = {"requires_sponsorship": False}
    facts = [fact("requires_sponsorship", "Yes")]
    found = resolve_fact("requires_sponsorship", profile, facts)
    assert (found.value, found.source) == (False, "profile")

    facts.append(fact("requires_sponsorship", "Yes", scope="job", job_key="j1"))
    found = resolve_fact("requires_sponsorship", profile, scope_facts(facts, None, "j1"))
    assert (found.value, found.source) == (True, "job_memory")
    # Another job never sees it.
    found = resolve_fact("requires_sponsorship", profile, scope_facts(facts, None, "j2"))
    assert found.source == "profile"


def test_memory_answers_when_the_profile_is_empty_and_ignores_retired_facts():
    facts = [fact("relocation_preference", "Depends on the role")]
    found = resolve_fact("relocation_preference", {}, facts)
    assert (found.value, found.source) == ("Depends on the role", "memory")
    facts[0]["status"] = "superseded"
    assert resolve_fact("relocation_preference", {}, scope_facts(facts)) is None


def test_company_scope_matches_the_company_only():
    facts = [fact("salary_expectation", "$120k", scope="company", company="Acme Inc.")]
    assert scope_facts(facts, "acme inc", None)
    assert not scope_facts(facts, "Globex", None)


def test_conflicts_are_reported_with_the_rule_that_settles_them():
    profile = {"requires_sponsorship": False, "notice_period": "2 weeks"}
    facts = [fact("requires_sponsorship", "Yes"), fact("notice_period", "2 weeks"),
             fact("salary_expectation", "$120k", scope="job", job_key="j1")]
    [conflict] = find_conflicts(profile, facts)
    assert (conflict.key, conflict.winner, conflict.winner_source, conflict.other) == (
        "requires_sponsorship", "No", "profile", "Yes")


def test_only_drifting_preferences_go_stale():
    old = (datetime.now(timezone.utc) - timedelta(days=400)).isoformat()
    assert is_stale(fact("work_mode", "Remote", last_confirmed_at=old))
    assert not is_stale(fact("work_mode", "Remote"))
    assert not is_stale(fact("requires_sponsorship", "No", last_confirmed_at=old))  # stable: never nagged


# --- Ask-and-Learn ---------------------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_global_preference_goes_to_the_profile_and_is_reused(client, rest):
    [saved] = await save(client, [{"key": "willing_to_relocate", "value": "Yes", "scope": "category",
                                   "target": {"type": "profile_field", "field": "willing_to_relocate"}}], ACME)
    assert saved["destination"] == "profile"
    assert rest.tables["profiles"][0]["willing_to_relocate"] is True
    with mock_llm(lambda m: {}) as llm:
        answer = await ask(client, "Are you willing to relocate?", YES_NO, GLOBEX)
    assert (answer["answer"], answer["origin"]) == ("Yes", "profile")
    llm.assert_not_awaited()


@pytest.mark.asyncio
async def test_depends_on_the_role_is_remembered_in_memory_not_the_profile(client, rest):
    [saved] = await save(client, [{"key": "willing_to_relocate", "value": "Depends on the role",
                                   "target": {"type": "profile_field", "field": "willing_to_relocate"}}], ACME)
    assert saved["destination"] == "memory"
    assert rest.tables["profiles"][0]["willing_to_relocate"] is None
    [row] = rest.tables["profile_facts"]
    assert (row["key"], row["answer"], row["scope"], row["source_type"], row["source_label"]) == (
        "relocation_preference", "Depends on the role", "category", "ask_and_learn", "Acme · Backend Engineer")
    # Not a yes/no: the model answers, with the memory as evidence, instead of Ansly asking again.
    seen = []
    reply = {"status": "answered", "answer": "It depends on the role.", "confidence": "medium", "usedSources": ["PR"],
             "missingInformation": None}
    with mock_llm(lambda m: seen.append(m) or reply):
        answer = await ask(client, "Are you willing to relocate to Austin?", None, GLOBEX)
    assert answer["status"] == "answered"
    assert "Willing to relocate: Depends on the role (from the candidate's application memory)" in seen[0]


@pytest.mark.asyncio
async def test_job_scoped_answer_applies_to_that_job_only(client, rest):
    await save(client, [{"key": "salary_expectation", "value": "$140k", "scope": "job",
                         "target": {"type": "profile_field", "field": "salary_expectation"}}], ACME)
    assert rest.tables["profiles"][0]["salary_expectation"] is None  # never a universal fact
    [row] = rest.tables["profile_facts"]
    assert (row["scope"], row["job_key"]) == ("job", job_key(ACME["url"], ACME["company"], ACME["role"]))
    field = {"kind": "short_text"}
    with mock_llm(lambda m: {}) as llm:
        here = await ask(client, "Expected salary", field, ACME)
    assert (here["answer"], here["origin"], here["usedSources"][0]["type"]) == ("$140k", "memory", "fact")
    llm.assert_not_awaited()
    elsewhere = await ask(client, "Expected salary", field, GLOBEX)
    assert elsewhere["status"] == "insufficient_information"
    assert elsewhere["missing"][0]["key"] == "salary_expectation"


@pytest.mark.asyncio
async def test_memory_only_fact_travel_is_asked_saved_and_reused(client):
    first = await ask(client, "Are you willing to travel for work?", YES_NO)
    [item] = first["missing"]
    assert (item["input"], item["group"], item["target"]) == (
        "select", "Preferences", {"type": "fact", "category": "Preferences", "key": "travel_willingness"})
    await save(client, [{"key": item["key"], "target": item["target"], "value": "No"}])
    with mock_llm(lambda m: {}) as llm:
        again = await ask(client, "Are you willing to travel for work?", YES_NO)
    assert (again["answer"], again["origin"]) == ("No", "memory")
    llm.assert_not_awaited()


@pytest.mark.asyncio
async def test_saving_the_same_fact_again_updates_it(client, rest):
    target = {"type": "fact", "category": "Preferences", "key": "travel_willingness"}
    await save(client, [{"key": "travel_willingness", "target": target, "value": "Yes"}])
    await save(client, [{"key": "travel_willingness", "target": target, "value": "Occasionally"}])
    assert [r["answer"] for r in rest.tables["profile_facts"]] == ["Occasionally"]


@pytest.mark.asyncio
async def test_several_missing_facts_save_in_one_request(client, rest):
    saved = await save(client, [
        {"key": "requires_sponsorship", "target": {"type": "profile_field", "field": "requires_sponsorship"}, "value": True},
        {"key": "skill:terraform", "target": {"type": "skill", "name": "Terraform"}, "value": "Some exposure"},
        {"key": "skill:rust", "target": {"type": "skill", "name": "Rust"}, "value": {"have": False}},
        {"key": "fact:motivation_company", "target": {"type": "fact", "category": "motivation_company"},
         "value": "I use Acme's API every day.", "prompt": "Why Acme?", "scope": "job"},
    ], ACME)
    assert [s["destination"] for s in saved] == ["profile", "skills", "skills", "memory"]
    skills = {s["name"]: s["level"] for s in rest.tables["skills"]}
    assert (skills["Terraform"], skills["Rust"]) == ("beginner", "none")
    assert rest.tables["profile_facts"][0]["scope"] == "job"
    kinds = [e["kind"] for e in rest.tables["usage_events"]]
    assert kinds.count("memory_fact_saved") == 4 and "ask_and_learn_completed" in kinds
    # No question or answer text in analytics.
    assert all(set(e) <= {"id", "user_id", "use_count", "created_at", "updated_at", "kind", "category"}
               for e in rest.tables["usage_events"])


@pytest.mark.asyncio
async def test_invalid_values_are_rejected(client):
    for item in [
        {"key": "requires_sponsorship", "target": {"type": "profile_field", "field": "requires_sponsorship"}, "value": "maybe"},
        {"key": "willing_to_relocate", "target": {"type": "profile_field", "field": "willing_to_relocate"}, "value": "Mars"},
        {"key": "travel_willingness", "target": {"type": "fact", "category": "x", "key": "travel_willingness"}, "value": "  "},
    ]:
        response = await client.post("/api/v1/profile/missing", json={"items": [item]})
        assert response.status_code == 422, item


@pytest.mark.asyncio
async def test_declined_skill_answers_no_without_asking(client):
    await save(client, [{"key": "skill:docker", "target": {"type": "skill", "name": "Docker"}, "value": {"have": False}}])
    answer = await ask(client, "How many years of Docker experience do you have?", {"kind": "number"})
    assert answer["answer"] == "0"


# --- memory page API -------------------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_memory_lists_profile_learned_facts_and_provenance(client, rest):
    await save(client, [{"key": "travel_willingness", "value": "Yes",
                         "target": {"type": "fact", "category": "Preferences", "key": "travel_willingness"}}], ACME)
    await save(client, [{"key": "skill:go", "target": {"type": "skill", "name": "Go"}, "value": {"have": False}}])
    data = (await client.get("/api/v1/memory")).json()
    by_label = {i["label"]: i for i in data["items"]}
    assert by_label["Notice period"]["sourceType"] == "profile"  # from the sample profile
    travel = by_label["Willingness to travel"]
    assert (travel["value"], travel["scope"], travel["sourceType"], travel["sourceLabel"], travel["group"]) == (
        "Yes", "category", "ask_and_learn", "Acme · Backend Engineer", "Preferences")
    assert by_label["Go"]["value"] == "No professional experience"
    assert data["counts"]["learned"] == 1 and data["groups"][0] == "Personal"


@pytest.mark.asyncio
async def test_edit_rescope_confirm_outdated_and_delete(client, rest):
    await save(client, [{"key": "travel_willingness", "value": "Yes",
                         "target": {"type": "fact", "category": "Preferences", "key": "travel_willingness"}}], ACME)
    fact_id = rest.tables["profile_facts"][0]["id"]
    edited = await client.patch(f"/api/v1/memory/{fact_id}", json={"value": "occasionally"})
    assert (edited.json()["value"], edited.json()["sourceType"]) == ("Occasionally", "memory_edit")
    scoped = await client.patch(f"/api/v1/memory/{fact_id}", json={"scope": "company", "company": "Acme"})
    assert (scoped.json()["scope"], scoped.json()["company"]) == ("company", "Acme")
    outdated = await client.patch(f"/api/v1/memory/{fact_id}", json={"status": "outdated"})
    assert outdated.json()["status"] == "outdated"
    # An outdated fact never answers.
    first = await ask(client, "Are you willing to travel for work?", YES_NO, ACME)
    assert first["status"] == "insufficient_information"
    confirmed = await client.post(f"/api/v1/memory/{fact_id}/confirm")
    assert confirmed.json()["status"] == "active"
    assert (await client.delete(f"/api/v1/memory/{fact_id}")).status_code == 204
    assert rest.tables["profile_facts"] == []
    assert (await client.delete(f"/api/v1/memory/{fact_id}")).status_code == 404
    kinds = [e["kind"] for e in rest.tables["usage_events"]]
    assert {"memory_fact_edited", "memory_fact_confirmed", "memory_fact_deleted"} <= set(kinds)


@pytest.mark.asyncio
async def test_inline_edit_of_a_profile_preference(client, rest):
    edited = await client.patch("/api/v1/memory/profile:notice_period", json={"value": "1 month"})
    assert edited.json()["value"] == "1 month"
    assert rest.tables["profiles"][0]["notice_period"] == "1 month"
    # "Depends on the role" doesn't fit the yes/no column: it becomes global memory, the column is cleared.
    rest.tables["profiles"][0]["willing_to_relocate"] = True
    moved = await client.patch("/api/v1/memory/profile:willing_to_relocate", json={"value": "Depends on the role"})
    assert (moved.json()["sourceType"], moved.json()["value"]) == ("memory_edit", "Depends on the role")
    assert rest.tables["profiles"][0]["willing_to_relocate"] is None


@pytest.mark.asyncio
async def test_resolving_a_conflict(client, rest):
    rest.tables["profile_facts"].append(fact("requires_sponsorship", "Yes"))
    data = (await client.get("/api/v1/memory")).json()
    [conflict] = data["conflicts"]
    assert (conflict["winner"], conflict["winnerSource"], conflict["other"]) == ("No", "profile", "Yes")
    after = (await client.post("/api/v1/memory/conflicts/resolve",
                               json={"id": conflict["otherId"], "use": "memory"})).json()
    assert after["conflicts"] == []
    assert rest.tables["profiles"][0]["requires_sponsorship"] is True
    assert rest.tables["profile_facts"][0]["status"] == "superseded"


@pytest.mark.asyncio
async def test_unknown_or_malformed_ids_are_not_found(client):
    assert (await client.patch("/api/v1/memory/not-there", json={"value": "x"})).status_code == 404
    assert (await client.delete("/api/v1/memory/a,b)or(id.neq.0")).status_code == 404


# --- rewrite ---------------------------------------------------------------------------------------------------

ORIGINAL = ("At Acme Labs I built the customer dashboard in Next.js and cut page load time by 40%. "
            "I also wrote a FastAPI service for document search that the support team relies on every day.")


async def rewrite(client, action, text=ORIGINAL, **extra):
    response = await client.post("/api/v1/answers/rewrite", json={"text": text, "action": action, **extra})
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.asyncio
async def test_rewrite_sends_only_the_answer_and_instruction(client, rest):
    seen = []
    shorter = "At Acme Labs I built the Next.js customer dashboard and cut page load time by 40%."
    with mock_llm(lambda m: seen.append(m) or {"answer": shorter}):
        result = await rewrite(client, "shorter", question="Tell us about a project", job_context=ACME)
    assert result == {"answer": shorter, "changed": True, "reason": None}
    assert "noticeably shorter" in seen[0] and ORIGINAL in seen[0]
    assert "Sam Rivera" not in seen[0] and "TaskFlow" not in seen[0]  # no profile
    assert [e["kind"] for e in rest.tables["usage_events"]] == ["rewrite"]


@pytest.mark.asyncio
async def test_rewrite_uses_the_text_it_is_given(client):
    edited = "I built the Acme Labs dashboard in Next.js. It loads 40% faster now."
    seen = []
    with mock_llm(lambda m: seen.append(m) or {"answer": "I built the Acme Labs dashboard in Next.js; it loads 40% faster."}):
        await rewrite(client, "natural", text=edited)
    assert edited in seen[0] and ORIGINAL not in seen[0]


@pytest.mark.parametrize("added", [
    "At Acme Labs I built the customer dashboard and cut load time by 60%.",          # a new number
    "At Acme Labs and Google I built the customer dashboard, cutting load by 40%.",   # a new employer
    "As a senior engineer at Acme Labs I cut page load time by 40%.",                 # a new seniority
    "At Acme Labs I built the dashboard in Next.js and node.js, cutting load by 40%.",  # a new technology
    "With my master's degree, at Acme Labs I cut page load time by 40%.",             # a new degree
])
@pytest.mark.asyncio
async def test_rewrite_that_adds_facts_is_rejected_and_the_original_kept(client, added):
    with mock_llm(lambda m: {"answer": added}):
        result = await rewrite(client, "professional")
    assert result["changed"] is False and result["answer"] == ORIGINAL
    assert "kept" in result["reason"]


@pytest.mark.asyncio
async def test_fit_to_limit_respects_the_limit(client, rest):
    too_long = ORIGINAL + " It handles thousands of searches."
    fits = "At Acme Labs I built the Next.js customer dashboard and cut page load time by 40%."
    seen = []
    with mock_llm(lambda m: seen.append(m) or {"answer": fits}):
        result = await rewrite(client, "fit", text=too_long, field={"maxLength": 120})
    assert result["changed"] and len(result["answer"]) <= 120
    assert "at most 120 characters" in seen[0]
    assert rest.tables["usage_events"][0]["kind"] == "fit_to_limit"
    # A rewrite still over the limit is not accepted.
    with mock_llm(lambda m: {"answer": too_long[:-5]}):
        result = await rewrite(client, "fit", text=too_long, field={"maxLength": 120})
    assert result["changed"] is False


@pytest.mark.asyncio
async def test_custom_rewrite_needs_an_instruction(client):
    response = await client.post("/api/v1/answers/rewrite", json={"text": ORIGINAL, "action": "custom"})
    assert response.status_code == 422
    seen = []
    with mock_llm(lambda m: seen.append(m) or {"answer": ORIGINAL.replace("I also", "And I")}):
        await rewrite(client, "custom", instruction="emphasize backend experience")
    assert "emphasize backend experience" in seen[0]


@pytest.mark.asyncio
async def test_rewrite_when_providers_are_down(client):
    with patch.object(answer_engine.gateway, "generate", AsyncMock(side_effect=GatewayUnavailableError("down"))):
        response = await client.post("/api/v1/answers/rewrite", json={"text": ORIGINAL, "action": "shorter"})
    assert response.status_code == 503


def test_invented_allows_reordering_and_sentence_case():
    assert invented("Page load time dropped 40% after I rebuilt the Acme Labs dashboard in Next.js.", [ORIGINAL]) == []


# --- generating to a limit -------------------------------------------------------------------------------------

def test_generation_targets_a_range_inside_the_limit():
    analysis = classify_question("Why do you want to work here?")
    assert length_target("standard", analysis, 500).startswith("about 350-450 characters, but never more than 500")
    words = length_target("detailed", analysis, None, max_words=150)
    assert words.startswith("about 105-135 words") and "never more than 150 words" in words
    # A generous limit keeps the usual word target.
    assert length_target("concise", analysis, 2000).startswith("1-3 sentences, about 40-80 words")


@pytest.mark.asyncio
async def test_word_limit_is_a_hard_guard():
    long_answer = " ".join(["I built dashboards."] * 40)
    gateway_reply = {"status": "answered", "answer": long_answer, "confidence": "high", "usedSources": [],
                     "missingInformation": None}

    class Gateway:
        async def generate(self, system, messages, temperature=None, max_tokens=None, validate=None, stage=None, items=1):
            text = json.dumps(gateway_reply)
            return GatewayResult(text=text, value=validate(text), provider="Mock", model="m", usage={})

    response = await AnswerEngine(Gateway()).answer(FakeRest(), GenerateAnswerRequest(
        question="Tell us about a project", field=FieldContext(kind="textarea", max_words=20),
        job_context=JobContext(company="Acme")))
    assert len(response.answer.split()) <= 20


@pytest.mark.asyncio
async def test_memory_reuse_is_counted_without_text(client, rest):
    target = {"type": "fact", "category": "Preferences", "key": "travel_willingness"}
    await save(client, [{"key": "travel_willingness", "target": target, "value": "Yes"}])
    rest.tables["usage_events"].clear()
    await ask(client, "Are you willing to travel for work?", YES_NO)
    response = await client.post("/api/v1/answers/generate-batch", json={"items": [
        {"id": "a", "question": "Are you willing to travel for work?", "field": YES_NO}]})
    assert response.json()["results"][0]["origin"] == "memory"
    assert [e["kind"] for e in rest.tables["usage_events"]].count("memory_used") == 2


@pytest.mark.asyncio
async def test_memory_that_answers_is_stamped_as_used(client, rest):
    target = {"type": "fact", "category": "Preferences", "key": "travel_willingness"}
    await save(client, [{"key": "travel_willingness", "target": target, "value": "Yes"}])
    assert rest.tables["profile_facts"][0].get("last_used_at") is None
    await ask(client, "Are you willing to travel for work?", YES_NO)
    assert rest.tables["profile_facts"][0]["last_used_at"]


@pytest.mark.asyncio
async def test_declined_skill_listed_in_experience_is_a_conflict(client, rest):
    await save(client, [{"key": "skill:nextjs", "target": {"type": "skill", "name": "Next.js"}, "value": {"have": False}}])
    [conflict] = (await client.get("/api/v1/memory")).json()["conflicts"]
    assert (conflict["label"], conflict["winner"], conflict["other"]) == (
        "Next.js", "Used at Software Engineer at Acme Labs", "You said you don't have it")
    refused = await client.post("/api/v1/memory/conflicts/resolve", json={"id": conflict["otherId"], "use": "memory"})
    assert refused.status_code == 422
    after = await client.post("/api/v1/memory/conflicts/resolve", json={"id": conflict["otherId"], "use": "profile"})
    assert after.json()["conflicts"] == []
    assert not [s for s in rest.tables["skills"] if s["name"] == "Next.js"]
