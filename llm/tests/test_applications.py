"""
V2 application tests: answers that use a tracked application's context,
preparation packages, URL lookup for the extension, answer write-back and
autofill data. Supabase and the LLM gateway are in-memory fakes.
"""

import json
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from src.app.answers.engine import AnswerEngine
from src.app.api.deps import answer_engine, get_rest
from src.app.applications.context import normalize_job_url
from src.app.applications.prepare import PREP_SYSTEM_PROMPT, choose_resume, rank_relevant
from src.app.core.auth import AuthUser, get_current_user
from src.app.core.rate_limit import rate_limiter
from src.app.gateway import GatewayResult, GatewayUnavailableError
from src.app.main import app
from src.app.schemas.answers import GenerateAnswerRequest
from tests.fakes import SAMPLE_PROFILE, USER_ID, FakeRest

ANSWER = {"status": "answered", "answer": "I build full-stack products with Next.js.", "confidence": "high",
          "usedSources": ["E1"], "missingInformation": None}
PREP = {"tailored_summary": "Full-stack engineer shipping Next.js and Python products.",
        "cover_letter": "Over the past four years I have built web products...",
        "interview_questions": [{"question": "How did you cut page load time by 40%?", "why": "Performance matters here."}],
        "usedSources": ["E1"]}

APP_ID = "app-1"


def tables():
    return {
        **SAMPLE_PROFILE,
        "jobs": [{"id": "job-1", "title": "Senior Full-Stack Engineer", "company": "Example AI",
                  "url": "https://boards.greenhouse.io/example/jobs/123", "apply_url": None,
                  "description": "We build AI tools with Next.js, TypeScript and Kubernetes.",
                  "skills": ["Next.js", "TypeScript", "Kubernetes"]}],
        "applications": [{"id": APP_ID, "user_id": USER_ID, "job_id": "job-1", "company": "Example AI",
                          "role": "Senior Full-Stack Engineer", "job_url": "https://boards.greenhouse.io/example/jobs/123",
                          "status": "interested", "description": None, "resume_id": None,
                          "updated_at": "2026-10-01T00:00:00+00:00"}],
        "application_answers": [{"id": "aa1", "user_id": USER_ID, "application_id": APP_ID,
                                 "question": "Why are you leaving your current job?",
                                 "answer": "I want to work on AI tooling full time.", "updated_at": "2026-10-01"}],
        "resumes": [
            {"id": "r1", "user_id": USER_ID, "name": "General", "is_default": True, "target_roles": [], "created_at": "1"},
            {"id": "r2", "user_id": USER_ID, "name": "Full-stack", "is_default": False,
             "target_roles": ["Full Stack Engineer"], "created_at": "2"},
        ],
    }


def capture_gateway(gateway, outputs):
    """Patches gateway.generate to answer by system prompt and record every call."""
    calls = []

    async def generate(system, messages, temperature=None, max_tokens=None, validate=None):
        calls.append({"system": system, "message": messages[-1]["content"]})
        payload = outputs["prep"] if system == PREP_SYSTEM_PROMPT else outputs["answer"]
        if isinstance(payload, Exception):
            raise payload
        text = json.dumps(payload)
        return GatewayResult(text=text, value=validate(text), provider="Mock", model="m", usage={})

    return patch.object(gateway, "generate", AsyncMock(side_effect=generate)), calls


@pytest.mark.asyncio
async def test_answer_uses_application_context_and_earlier_answers():
    rest = FakeRest(tables())
    engine = AnswerEngine(answer_engine.gateway)
    patcher, calls = capture_gateway(engine.gateway, {"prep": PREP, "answer": ANSWER})
    with patcher:
        result = await engine.answer(rest, GenerateAnswerRequest(question="Why are you interested in this role?",
                                                                 application_id=APP_ID))
    assert result.status == "answered"
    message = calls[0]["message"]
    assert "Company: Example AI" in message and "Role: Senior Full-Stack Engineer" in message
    assert "Skills the posting asks for: Next.js, TypeScript, Kubernetes" in message
    assert "EARLIER ANSWERS IN THIS SAME APPLICATION" in message
    assert "I want to work on AI tooling full time." in message


def test_rank_relevant_and_choose_resume():
    data = {k: SAMPLE_PROFILE[k] for k in ["experiences", "projects"]}
    relevant = rank_relevant(data, ["Next.js", "TypeScript", "React"], "Full Stack Engineer")
    assert relevant[0]["label"] == "Software Engineer at Acme Labs"
    assert "Next.js" in relevant[0]["why"]
    assert choose_resume(tables()["resumes"], "Senior Full-Stack Engineer")["resume_id"] == "r2"
    assert choose_resume(tables()["resumes"], "Data Scientist")["resume_id"] == "r1"
    assert choose_resume([], "x") is None


def test_normalize_job_url():
    assert normalize_job_url("https://www.jobs.lever.co/acme/123/apply?lever-source=x") == "jobs.lever.co/acme/123"
    assert normalize_job_url("https://jobs.ashbyhq.com/acme/abc/application") == "jobs.ashbyhq.com/acme/abc"


@pytest.fixture
def client():
    rest = FakeRest(tables())
    app.dependency_overrides[get_current_user] = lambda: AuthUser(id=USER_ID, email="sam@example.com", token="t")
    app.dependency_overrides[get_rest] = lambda: rest
    rate_limiter.reset()
    yield AsyncClient(transport=ASGITransport(app=app), base_url="http://test"), rest
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_prepare_application(client):
    http, rest = client
    patcher, calls = capture_gateway(answer_engine.gateway, {"prep": PREP, "answer": ANSWER})
    with patcher:
        response = await http.post(f"/api/v1/applications/{APP_ID}/prepare")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["llm_available"] is True
    application = body["application"]
    assert application["status"] == "preparing"
    assert application["cover_letter"].startswith("Over the past four years")
    assert application["resume_id"] == "r2"
    prep = application["prep"]
    assert prep["matched_skills"] == ["Next.js", "TypeScript"] and prep["missing_skills"] == ["Kubernetes"]
    assert prep["relevant"][0]["type"] == "experience"
    assert prep["interview_questions"][0]["question"].startswith("How did you cut")
    # The prep prompt marks Kubernetes as something never to claim.
    prep_call = next(c for c in calls if c["system"] == PREP_SYSTEM_PROMPT)
    assert "ASKED FOR BUT NOT IN THE PROFILE (never claim these): Kubernetes" in prep_call["message"]
    # Common questions were answered and stored as prepared answers, next to the earlier one.
    prepared = [a for a in rest.tables["application_answers"] if a.get("source") == "prepared"]
    assert any("Why do you want to work at Example AI?" == a["question"] for a in prepared)
    assert len(body["answers"]) == len(prepared) + 1
    assert [e["kind"] for e in rest.tables["application_events"]] == ["prepared"]
    assert rest.tables["usage_events"][-1]["kind"] == "prepare"


@pytest.mark.asyncio
async def test_prepare_falls_back_when_providers_are_busy(client):
    http, rest = client
    busy = GatewayUnavailableError("busy")
    patcher, _ = capture_gateway(answer_engine.gateway, {"prep": busy, "answer": busy})
    with patcher:
        response = await http.post(f"/api/v1/applications/{APP_ID}/prepare")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["llm_available"] is False
    prep = body["application"]["prep"]
    assert prep["tailored_summary"] is None and prep["interview_questions"]
    assert any("Kubernetes" in q["question"] for q in prep["interview_questions"])


@pytest.mark.asyncio
async def test_prepare_unknown_application(client):
    http, _ = client
    response = await http.post("/api/v1/applications/missing/prepare")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_lookup_application_by_url(client):
    http, _ = client
    found = await http.get("/api/v1/applications/lookup",
                           params={"url": "https://boards.greenhouse.io/example/jobs/123?gh_src=abc#app"})
    assert found.status_code == 200
    application = found.json()["application"]
    assert application["id"] == APP_ID and application["skills"] == ["Next.js", "TypeScript", "Kubernetes"]
    missing = await http.get("/api/v1/applications/lookup", params={"url": "https://example.com/other"})
    assert missing.json()["application"] is None


@pytest.mark.asyncio
async def test_save_application_answer_upserts_by_question(client):
    http, rest = client
    first = await http.post(f"/api/v1/applications/{APP_ID}/answers",
                            json={"question": "Why us?", "answer": "First."})
    again = await http.post(f"/api/v1/applications/{APP_ID}/answers",
                            json={"question": "  why us? ", "answer": "Edited."})
    assert first.status_code == again.status_code == 201
    rows = [a for a in rest.tables["application_answers"] if a["question"].strip().lower() == "why us?"]
    assert len(rows) == 1 and rows[0]["answer"] == "Edited." and rows[0]["source"] == "extension"
    missing = await http.post("/api/v1/applications/nope/answers", json={"question": "Why us?", "answer": "x"})
    assert missing.status_code == 404


@pytest.mark.asyncio
async def test_autofill_profile(client):
    http, _ = client
    response = await http.get("/api/v1/profile/autofill")
    data = response.json()
    assert data["first_name"] == "Sam" and data["last_name"] == "Rivera"
    assert data["github"] == "https://github.com/example"
    assert data["email"] == "sam@example.com"
