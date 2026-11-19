import base64
import email
import os
from email import policy
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient

from src.app.api.deps import get_gateway, get_rest, get_storage
from src.app.api.routes import job_outreach as routes
from src.app.core.auth import AuthUser, get_current_user
from src.app.core.config import get_settings
from src.app.email import gmail
from src.app.email.sending import SendOutcome
from src.app.leads.emails import EmailDraft
from src.app.leads.roles import MatchResult
from src.app.main import app
from tests.fakes import USER_ID, FakeRest, FakeStorage

KEY = base64.b64encode(os.urandom(32)).decode()
POST = (
    "Acme is hiring a Senior Backend Engineer. Requirements include Node.js and PostgreSQL. "
    "Send your resume to jobs@acme.test with the subject: Backend Engineer application."
)
ROLE = {
    "title": "Senior Backend Engineer",
    "company": "Acme",
    "role_family": "backend",
    "seniority": "senior",
    "technologies": ["Node.js", "PostgreSQL"],
    "responsibilities": ["Build backend services"],
    "evidence_quote": "Senior Backend Engineer",
}
APPLICATION = {
    "application_method": "email",
    "application_method_evidence": "Send your resume to jobs@acme.test",
    "application_emails": ["jobs@acme.test"],
    "selected_application_email": "jobs@acme.test",
    "recipient_confident": True,
    "recipient_ambiguous": False,
    "recipient_evidence": "Send your resume to jobs@acme.test",
    "application_instructions": "Send your resume with the requested subject.",
    "instructions_present": True,
    "instructions_confident": True,
    "instructions_evidence": "Send your resume to jobs@acme.test with the subject: Backend Engineer application.",
    "requested_subject": "Backend Engineer application.",
    "subject_confident": True,
    "requirements": ["Node.js", "PostgreSQL"],
}


@pytest.fixture(autouse=True)
def setup(monkeypatch):
    monkeypatch.setattr(get_settings(), "EMAIL_TOKEN_ENCRYPTION_KEY", KEY)
    app.dependency_overrides.clear()
    yield
    app.dependency_overrides.clear()


def _resume():
    return {
        "id": str(uuid4()),
        "user_id": USER_ID,
        "name": "Backend Engineer.pdf",
        "role_label": "Backend Engineer",
        "role_note": "Node.js and APIs",
        "file_name": "Backend Engineer.pdf",
        "file_path": f"{USER_ID}/library/backend.pdf",
        "file_type": "pdf",
        "file_size": 1024,
        "archived_at": None,
        "parse_status": "parsed",
        "parsed_content": {"skills": [{"items": ["Node.js", "PostgreSQL"]}]},
    }


def _rest(resumes=()):
    return FakeRest({
        "job_outreach_drafts": [],
        "email_send_attempts": [],
        "resumes": list(resumes),
        "targeting_profiles": [],
        "profiles": [{"id": USER_ID, "full_name": "Sam Rivera", "headline": "Backend engineer",
                      "summary": "Backend engineer with four years of experience.",
                      "links": {"github": "https://github.com/sam"}}],
        "experiences": [],
        "projects": [],
        "skills": [],
        "education": [],
        "achievements": [],
        "profile_facts": [],
    })


def _use(rest, storage=None):
    app.dependency_overrides[get_current_user] = lambda: AuthUser(
        id=USER_ID, email="sam@gmail.com", token="t",
    )
    app.dependency_overrides[get_rest] = lambda: rest
    app.dependency_overrides[get_storage] = lambda: storage or FakeStorage({
        f"{USER_ID}/library/backend.pdf": b"%PDF-1.7 resume",
    })
    app.dependency_overrides[get_gateway] = lambda: object()


async def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _mock_analysis(monkeypatch, match: MatchResult):
    monkeypatch.setattr(routes, "detect_role", AsyncMock(return_value=ROLE))
    monkeypatch.setattr(routes, "_extract_application", AsyncMock(return_value=routes.parse_application_details(
        APPLICATION, POST,
    )))
    monkeypatch.setattr(routes, "match_resume", AsyncMock(return_value=match))
    monkeypatch.setattr(routes, "_compose", AsyncMock(return_value=EmailDraft(
        subject="Backend Engineer – Sam Rivera",
        body="Hello Hiring Team,\n\nI am applying for the backend role. " + "Relevant profile evidence. " * 4,
    )))


async def _analyze_and_compose(client, mode):
    request_id = str(uuid4())
    analyzed = await client.post("/api/v1/job-outreach/analyze", json={"id": request_id, "job_text": POST})
    assert analyzed.status_code == 200, analyzed.text
    composed = await client.post(
        f"/api/v1/job-outreach/{request_id}/compose",
        json={"mode": mode},
    )
    assert composed.status_code == 200, composed.text
    return request_id, composed.json()


def test_recipient_and_subject_extraction_must_match_the_advertisement():
    parsed = routes.parse_application_details(APPLICATION, POST)
    assert parsed["recipient_email"] == "jobs@acme.test"
    assert parsed["requested_subject"] == "Backend Engineer application."

    ambiguous = dict(APPLICATION, application_emails=["jobs@acme.test", "careers@acme.test"],
                     selected_application_email="jobs@acme.test")
    parsed = routes.parse_application_details(
        ambiguous,
        POST + " Or email careers@acme.test.",
    )
    assert parsed["recipient_email"] == "jobs@acme.test, careers@acme.test"
    assert parsed["recipient_emails"] == ["jobs@acme.test", "careers@acme.test"]
    assert parsed["recipient_ambiguous"] is False

    invented = dict(APPLICATION, selected_application_email="apply@acme.test")
    assert routes.parse_application_details(invented, POST)["recipient_email"] is None


def test_multiple_primary_recipients_and_explicit_cc_are_separated():
    text = (
        "Send your resume to mzainab@hussainindustriesgroup.com, "
        "careers@salesteq.com or hiring@salesteq.com."
    )
    parsed = routes.parse_application_details({
        **APPLICATION,
        "application_emails": [
            "mzainab@hussainindustriesgroup.com",
            "careers@salesteq.com",
            "hiring@salesteq.com",
        ],
        "application_cc_emails": [],
        "selected_application_email": None,
        "recipient_confident": False,
        "recipient_ambiguous": True,
    }, text)
    assert parsed["recipient_emails"] == [
        "mzainab@hussainindustriesgroup.com",
        "careers@salesteq.com",
        "hiring@salesteq.com",
    ]
    assert parsed["recipient_email"] == (
        "mzainab@hussainindustriesgroup.com, careers@salesteq.com, hiring@salesteq.com"
    )
    assert parsed["application_cc_emails"] == []
    assert parsed["recipient_ambiguous"] is False


def test_explicit_cc_is_not_treated_as_primary():
    text = (
        "Send your resume to mzainab@hussainindustriesgroup.com\n"
        "CC:\n"
        "ssaleem@hussainindustriesgroup.com\n"
        "asalman@hussainindustriesgroup.com"
    )
    parsed = routes.parse_application_details({
        **APPLICATION,
        "application_emails": [
            "mzainab@hussainindustriesgroup.com",
            "ssaleem@hussainindustriesgroup.com",
            "asalman@hussainindustriesgroup.com",
        ],
        "application_cc_emails": [
            "ssaleem@hussainindustriesgroup.com",
            "asalman@hussainindustriesgroup.com",
        ],
        "selected_application_email": "mzainab@hussainindustriesgroup.com",
        "recipient_evidence": "Send your resume to mzainab@hussainindustriesgroup.com",
    }, text)
    assert parsed["recipient_email"] == "mzainab@hussainindustriesgroup.com"
    assert parsed["recipient_emails"] == ["mzainab@hussainindustriesgroup.com"]
    assert parsed["application_cc_emails"] == [
        "ssaleem@hussainindustriesgroup.com",
        "asalman@hussainindustriesgroup.com",
    ]


@pytest.mark.asyncio
async def test_send_places_multiple_primary_recipients_in_to_and_cc_recipients_in_cc(monkeypatch):
    resume = _resume()
    rest = _rest([resume])
    storage = FakeStorage({resume["file_path"]: b"%PDF-1.7 resume"})
    _use(rest, storage)
    monkeypatch.setattr(routes, "detect_role", AsyncMock(return_value=ROLE))
    monkeypatch.setattr(routes, "_extract_application", AsyncMock(return_value=routes.parse_application_details({
        **APPLICATION,
        "application_emails": ["mzainab@hussainindustriesgroup.com", "careers@salesteq.com"],
        "application_cc_emails": ["ssaleem@hussainindustriesgroup.com"],
        "selected_application_email": "mzainab@hussainindustriesgroup.com",
    }, (
        "Send your resume to mzainab@hussainindustriesgroup.com or careers@salesteq.com\n"
        "CC: ssaleem@hussainindustriesgroup.com"
    ))))
    monkeypatch.setattr(routes, "match_resume", AsyncMock(return_value=MatchResult(
        resume["id"], "medium", "Choose this resume manually.",
    )))
    monkeypatch.setattr(routes, "_compose", AsyncMock(return_value=EmailDraft(
        subject="Senior Developer",
        body="Hello Hiring Team,\n\nI am applying for this role. " + "Relevant evidence. " * 4,
    )))
    sent = []

    async def fake_send(access, raw):
        message = email.message_from_bytes(raw, policy=policy.default)
        sent.append((message["To"], message["Cc"], message["Subject"]))
        return "gmail-message-multi"

    monkeypatch.setattr(routes, "access_for_sending", AsyncMock(return_value=(
        {"email_address": "sam@gmail.com"}, "token",
    )))
    monkeypatch.setattr(gmail, "send", fake_send)

    async with await _client() as client:
        outreach_id, composed = await _analyze_and_compose(client, "analyze")
        response = await client.post(
            f"/api/v1/job-outreach/{outreach_id}/send",
            json={
                "recipient_email": "mzainab@hussainindustriesgroup.com, careers@salesteq.com",
                "cc_email": "ssaleem@hussainindustriesgroup.com",
                "subject": composed["subject"],
                "body": composed["body"],
                "resume_id": resume["id"],
            },
        )

    assert response.status_code == 200, response.text
    assert sent == [(
        "mzainab@hussainindustriesgroup.com, careers@salesteq.com",
        "ssaleem@hussainindustriesgroup.com",
        "Senior Developer",
    )]


@pytest.mark.parametrize("placeholder", [
    "Your Name",
    "[Your Name]",
    "YOUR NAME",
    "Applicant Name",
    "Candidate Name",
    "[Name]",
    "Your Full Name",
])
def test_subject_placeholders_are_personalized(placeholder):
    subject = f"Nodejs Developer - {placeholder}"
    personalized = routes._personalize_subject(
        subject,
        {"profile": {"full_name": "Abrar Ahmed"}},
    )
    assert personalized == "Nodejs Developer - Abrar Ahmed"


def test_subject_missing_profile_name_never_resolves_placeholder():
    personalized = routes._personalize_subject(
        "Nodejs Developer - Your Name",
        {"profile": {"full_name": None}},
    )
    assert personalized == ""


@pytest.mark.asyncio
async def test_analyze_workflow_never_sends_until_the_user_sends_and_duplicate_send_is_safe(monkeypatch):
    resume = _resume()
    rest = _rest([resume])
    storage = FakeStorage({resume["file_path"]: b"%PDF-1.7 resume"})
    _use(rest, storage)
    _mock_analysis(monkeypatch, MatchResult(resume["id"], "medium", "The role is similar, but not certain."))
    sent = []

    async def fake_send(access, raw):
        message = email.message_from_bytes(raw, policy=policy.default)
        sent.append(message["To"])
        return "gmail-message-1"

    monkeypatch.setattr(routes, "access_for_sending", AsyncMock(return_value=({"email_address": "sam@gmail.com"}, "token")))
    monkeypatch.setattr(gmail, "send", fake_send)

    async with await _client() as client:
        outreach_id, composed = await _analyze_and_compose(client, "analyze")
        assert composed["status"] == "draft"
        assert composed["can_auto_send"] is False
        assert sent == []

        payload = {
            "recipient_email": composed["recipient_email"],
            "subject": composed["subject"],
            "body": composed["body"],
            "resume_id": resume["id"],
        }
        first = await client.post(f"/api/v1/job-outreach/{outreach_id}/send", json=payload)
        second = await client.post(f"/api/v1/job-outreach/{outreach_id}/send", json=payload)
        assert first.status_code == second.status_code == 200
        assert first.json()["status"] == second.json()["status"] == "sent"

    assert sent == ["jobs@acme.test"]
    attempts = rest.tables["email_send_attempts"]
    assert len(attempts) == 1 and attempts[0]["job_outreach_id"] == outreach_id


@pytest.mark.asyncio
async def test_automated_workflow_sends_only_a_high_confidence_resume_match(monkeypatch):
    resume = _resume()
    rest = _rest([resume])
    _use(rest)
    _mock_analysis(monkeypatch, MatchResult(resume["id"], "high", "The role matches the Backend resume."))
    sent = []

    async def fake_send(access, raw):
        message = email.message_from_bytes(raw, policy=policy.default)
        sent.append((message["To"], message["Subject"]))
        return "gmail-message-1"

    monkeypatch.setattr(routes, "access_for_sending", AsyncMock(return_value=({"email_address": "sam@gmail.com"}, "token")))
    monkeypatch.setattr(gmail, "send", fake_send)

    async with await _client() as client:
        outreach_id, composed = await _analyze_and_compose(client, "analyze_and_send")
        assert composed["can_auto_send"] is True
        assert composed["subject"] == "Backend Engineer application."
        assert sent == []

        sent_response = await client.post(
            f"/api/v1/job-outreach/{outreach_id}/send",
            json={"automatic": True},
        )
        repeated = await client.post(
            f"/api/v1/job-outreach/{outreach_id}/send",
            json={"automatic": True},
        )
        assert sent_response.json()["status"] == repeated.json()["status"] == "sent"

    assert sent == [("jobs@acme.test", "Backend Engineer application.")]


@pytest.mark.asyncio
async def test_ambiguous_recipient_and_uncertain_resume_stop_automatic_sending(monkeypatch):
    resume = _resume()
    rest = _rest([resume])
    _use(rest)
    ambiguous_info = routes.parse_application_details(
        dict(APPLICATION, application_emails=["jobs@acme.test", "careers@acme.test"]),
        POST + " Or email careers@acme.test.",
    )
    monkeypatch.setattr(routes, "detect_role", AsyncMock(return_value=ROLE))
    monkeypatch.setattr(routes, "_extract_application", AsyncMock(return_value=ambiguous_info))
    monkeypatch.setattr(routes, "match_resume", AsyncMock(return_value=MatchResult(
        resume["id"], "medium", "A related resume, not a confident match.",
    )))
    monkeypatch.setattr(routes, "_compose", AsyncMock(return_value=EmailDraft("Generated", "Body " * 20)))
    send = AsyncMock(return_value=SendOutcome(True))
    monkeypatch.setattr(routes, "send_gmail_email", send)

    async with await _client() as client:
        _, response = await _analyze_and_compose(client, "analyze_and_send")
    assert response["status"] == "needs_review"
    assert response["can_auto_send"] is False
    assert send.await_count == 0


@pytest.mark.asyncio
async def test_unknown_send_outcome_is_not_retried_and_preserves_the_draft(monkeypatch):
    resume = _resume()
    rest = _rest([resume])
    _use(rest)
    _mock_analysis(monkeypatch, MatchResult(None, "none", "No confident resume match."))
    send = AsyncMock(return_value=SendOutcome(
        False, code="outcome_unknown", message="Gmail did not confirm the result.",
    ))
    monkeypatch.setattr(routes, "send_gmail_email", send)
    monkeypatch.setattr(routes, "access_for_sending", AsyncMock(return_value=({"email_address": "sam@gmail.com"}, "token")))

    async with await _client() as client:
        outreach_id, composed = await _analyze_and_compose(client, "analyze")
        payload = {
            "recipient_email": composed["recipient_email"],
            "subject": composed["subject"],
            "body": composed["body"],
            "resume_id": resume["id"],
        }
        failed = await client.post(f"/api/v1/job-outreach/{outreach_id}/send", json=payload)
        repeated = await client.post(f"/api/v1/job-outreach/{outreach_id}/send", json=payload)

    stored = rest.tables["job_outreach_drafts"][0]
    assert failed.json()["status"] == "failed"
    assert failed.json()["error_code"] == "outcome_unknown"
    assert stored["body"] == composed["body"]
    assert repeated.status_code == 409
    assert send.await_count == 1
