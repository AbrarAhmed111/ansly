import base64
import email
import os
from email import policy
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient

from src.app.api.deps import get_gateway, get_rest, get_storage
from src.app.api.routes import email_connection as connection_routes
from src.app.api.routes import lead_emails as routes
from src.app.core.auth import AuthUser, get_current_user
from src.app.core.config import get_settings
from src.app.email import crypto, gmail
from src.app.email.mime import Attachment, InvalidMessageError, build_message
from src.app.leads.emails import EmailDraft, InsufficientEvidenceError, parse_email
from src.app.leads.roles import MatchResult, parse_match, parse_role
from src.app.main import app
from tests.fakes import USER_ID, FakeRest, FakeStorage

KEY = base64.b64encode(os.urandom(32)).decode()
POST = "We're hiring a Senior Backend Node.js Engineer. Node.js, PostgreSQL. Send your CV to jobs@acme.test"


@pytest.fixture(autouse=True)
def encryption_key(monkeypatch):
    monkeypatch.setattr(get_settings(), "EMAIL_TOKEN_ENCRYPTION_KEY", KEY)
    yield
    app.dependency_overrides.clear()


# --------------------------------------------------------------------------- units


def test_role_needs_an_evidence_quote_from_the_post():
    role = parse_role({"title": "Senior Backend Engineer", "role_family": "backend", "seniority": "senior",
                       "technologies": ["Node.js", "Kubernetes"], "evidence_quote": "Senior Backend Node.js Engineer"},
                      POST)
    assert role["technologies"] == ["Node.js"]  # Kubernetes isn't in the post
    with pytest.raises(ValueError):
        parse_role({"title": "Engineer", "evidence_quote": "Not in the post"}, POST)


def test_only_high_confidence_matches_attach_and_ids_must_be_candidates():
    assert parse_match({"resume_id": "r1", "confidence": "high", "reason": "x"}, ["r1"], set()).auto_attach
    assert not parse_match({"resume_id": "r1", "confidence": "medium", "reason": "x"}, ["r1"], set()).auto_attach
    invented = parse_match({"resume_id": "zz", "confidence": "high", "reason": "x"}, ["r1"], set())
    assert (invented.resume_id, invented.confidence) == (None, "none")
    unread = parse_match({"resume_id": "r1", "confidence": "high", "reason": "x"}, ["r1"], {"r1"})
    assert unread.confidence == "medium" and not unread.auto_attach


def test_email_output_is_validated():
    assert parse_email({"subject": "Backend Engineer – Sam", "body": "Hello, " + "x" * 60}).subject
    with pytest.raises(InsufficientEvidenceError):
        parse_email({"insufficient_evidence": True})
    with pytest.raises(ValueError):
        parse_email({"subject": "Hi", "body": "Dear [Name], " + "x" * 60})
    # The resume is chosen after writing, so the email never claims one is attached.
    body = "Hello,\n\nI built a resume parser in Python. I've attached my resume.\n\nBest regards,\nSam"
    draft = parse_email({"subject": "Role – Sam", "body": body})
    assert "attached" not in draft.body and "resume parser" in draft.body
    assert "Best regards" not in draft.body  # the footer is added in code, never by the model


def test_years_and_footer_come_from_the_profile():
    from datetime import date

    from src.app.leads.emails import Candidate, candidate_facts, experience_years, footer

    rows = [{"start_date": "2021-03-01"}, {"start_date": "2023-01-01"}, {"start_date": None}]
    assert experience_years(rows, today=date(2026, 11, 15)) == 5
    assert experience_years(rows, today=date(2026, 2, 1)) == 4
    assert experience_years([{"start_date": None}]) is None
    # An undated role counts from the year its description gives.
    undated = [{"start_date": "2023-06-01"}, {"start_date": None, "description": "Freelance developer since 2022."}]
    assert experience_years(undated, today=date(2026, 11, 15)) == 4

    facts = candidate_facts({
        "profile": {"full_name": "Abrar Ahmed", "links": {"portfolio": "https://abrarahmed.pro",
                                                          "github": "https://github.com/AbrarAhmed111"}},
        "experiences": rows,
    })
    assert footer(facts) == (
        "Portfolio: https://abrarahmed.pro\nGitHub: https://github.com/AbrarAhmed111\n\n"
        "Thank you for your time and consideration.\n\nBest regards,\nAbrar Ahmed"
    )
    # No links in the profile: no empty "Portfolio:" lines.
    assert footer(Candidate(name="Sam", years=None, portfolio=None, github=None)).startswith("Thank you")


def test_placeholders_of_any_shape_are_rejected():
    for body in ["Hello [Founder's Name], " + "x" * 60, "At {company} we " + "x" * 60, "At <Company Name> " + "x" * 60]:
        with pytest.raises(ValueError):
            parse_email({"subject": "Role – Sam", "body": body})


def test_message_has_one_recipient_and_the_file_unchanged():
    pdf = b"%PDF-1.7 resume bytes \x00\xff"
    raw = build_message("me@gmail.com", "jobs@acme.test", "Backend Engineer – Sam", "Hello,\n\nBody",
                        Attachment("Sam Backend.pdf", "pdf", pdf))
    msg = email.message_from_bytes(raw, policy=policy.default)
    assert msg["To"] == "jobs@acme.test" and msg["Cc"] is None
    parts = list(msg.iter_attachments())
    assert parts[0].get_filename() == "Sam Backend.pdf" and parts[0].get_content() == pdf
    multiple = build_message(
        "me@gmail.com",
        "a@b.test, c@d.test",
        "Multiple recipients",
        "Hello,\n\nBody",
        cc="manager@b.test; director@b.test",
    )
    multiple_msg = email.message_from_bytes(multiple, policy=policy.default)
    assert multiple_msg["To"] == "a@b.test, c@d.test"
    assert multiple_msg["Cc"] == "manager@b.test, director@b.test"
    for bad in ["a@b.test\r\nBcc: x@y.test", "nope"]:
        with pytest.raises(InvalidMessageError):
            build_message("me@gmail.com", bad, "Hi", "Body")
    with pytest.raises(InvalidMessageError):
        build_message("me@gmail.com", "jobs@acme.test", "Hi\r\nBcc: x@y.test", "Body")


def test_tokens_are_encrypted_and_confirm_tokens_cant_be_forged():
    sealed = crypto.encrypt("refresh-token")
    assert "refresh-token" not in sealed and crypto.decrypt(sealed, crypto.key_id()) == "refresh-token"
    with pytest.raises(crypto.TokenCipherError):
        crypto.decrypt(sealed, "old-key")
    token = crypto.sign({"kind": "send", "drafts": {"a": 1}}, 60)
    assert crypto.verify(token)["drafts"] == {"a": 1}
    body, mac = token.split(".")
    forged = base64.urlsafe_b64encode(b'{"drafts":{"a":1,"b":1},"exp":9999999999,"kind":"send"}').decode()
    with pytest.raises(ValueError):
        crypto.verify(f"{forged}.{mac}")


# --------------------------------------------------------------------------- flow


def _lead(email_address="jobs@acme.test", **extra):
    return {"id": str(uuid4()), "user_id": USER_ID, "title": "Senior Backend Engineer", "author_name": "Sam Rivera",
            "description": POST, "status": "new", "contact_info": {"email": email_address} if email_address else {},
            "detected_role": None, **extra}


def _rest(leads, resumes=()):
    return FakeRest({
        "leads": list(leads), "lead_drafts": [], "resumes": list(resumes), "email_connections": [],
        "email_oauth_states": [], "email_send_attempts": [], "targeting_profiles": [],
        "profiles": [{"id": USER_ID, "full_name": "Sam"}], "experiences": [], "projects": [], "skills": [],
        "education": [], "achievements": [], "profile_facts": [],
    })


def _use(rest, storage=None):
    app.dependency_overrides[get_current_user] = lambda: AuthUser(id=USER_ID, email="sam@gmail.com", token="t")
    app.dependency_overrides[get_rest] = lambda: rest
    app.dependency_overrides[get_storage] = lambda: storage or FakeStorage()
    app.dependency_overrides[get_gateway] = lambda: object()


def _mock_ai(monkeypatch, match: MatchResult):
    role = {"title": "Senior Backend Engineer", "role_family": "backend", "seniority": "senior",
            "technologies": ["Node.js"], "responsibilities": [], "evidence_quote": "Senior Backend Node.js Engineer",
            "other_roles": []}
    monkeypatch.setattr(routes, "detect_role", AsyncMock(return_value=role))
    monkeypatch.setattr(routes, "match_resume", AsyncMock(return_value=match))
    writer = AsyncMock(side_effect=lambda *a, **k: EmailDraft(subject="Backend role – Sam",
                                                             body=f"Hello Sam,\n\nAbout {k['role']['title']}..." * 2))
    monkeypatch.setattr(routes, "write_email", writer)
    return writer


async def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _generate(client, lead_ids):
    preview = (await client.post("/api/v1/leads/email-drafts/preview", json={"lead_ids": lead_ids})).json()
    response = await client.post("/api/v1/leads/email-drafts/generate",
                                 json={"preview_token": preview["preview_token"], "lead_ids": preview["eligible_lead_ids"]})
    assert response.status_code == 200, response.text
    return preview, response.json()["results"]


@pytest.mark.asyncio
async def test_generation_makes_one_draft_per_lead_and_attaches_only_confident_matches(monkeypatch):
    resume = {"id": str(uuid4()), "user_id": USER_ID, "name": "Backend", "role_label": "Backend Engineer",
              "file_path": f"{USER_ID}/library/a/backend.pdf", "file_type": "pdf", "archived_at": None,
              "parse_status": "parsed", "parsed_content": None, "updated_at": "1"}
    leads = [_lead(), _lead(), _lead(email_address=None)]
    rest = _rest(leads, [resume])
    _use(rest)
    writer = _mock_ai(monkeypatch, MatchResult(resume["id"], "high", "Backend resume with Node.js."))

    async with await _client() as client:
        preview, results = await _generate(client, [lead["id"] for lead in leads])
        assert (preview["eligible"], preview["no_email"]) == (2, 1)
        assert [r["outcome"] for r in results] == ["created", "created"]
        assert all(r["draft"]["resume"]["id"] == resume["id"] for r in results)
        assert all(r["draft"]["resume_selection"] == "auto" and "not_approved" in r["draft"]["issues"] for r in results)
        assert writer.await_count == 2  # written separately, once per lead

        # A second preview offers nothing new: existing drafts are never regenerated silently.
        again = (await client.post("/api/v1/leads/email-drafts/preview", json={"lead_ids": [leads[0]["id"]]})).json()
        assert (again["eligible"], again["existing_drafts"]) == (0, 1)

    # Low confidence: nothing attached, the user must choose.
    rest2 = _rest([_lead()], [resume])
    _use(rest2)
    _mock_ai(monkeypatch, MatchResult(resume["id"], "medium", "Title only."))
    async with await _client() as client:
        _, results = await _generate(client, [rest2.tables["leads"][0]["id"]])
    draft = results[0]["draft"]
    assert draft["resume"] is None and draft["resume_selection"] == "needs_selection"
    assert "resume_not_chosen" in draft["issues"]
    assert all(lead["status"] == "new" for lead in rest.tables["leads"] + rest2.tables["leads"])


@pytest.mark.asyncio
async def test_send_requires_approval_and_confirmation_and_marks_only_sent_leads_contacted(monkeypatch):
    leads = [_lead(), _lead(), _lead()]
    rest = _rest(leads)
    _use(rest)
    _mock_ai(monkeypatch, MatchResult(None, "none", "No resumes."))
    sent_to = []

    async def fake_send(access, raw):
        msg = email.message_from_bytes(raw, policy=policy.default)
        if msg["To"] == "bad@acme.test":
            raise gmail.RejectedError("Gmail rejected this email.")
        sent_to.append(msg["To"])
        return f"gmail-{len(sent_to)}"

    monkeypatch.setattr(routes, "access_for_sending",
                        AsyncMock(return_value=({"email_address": "sam@gmail.com"}, "access")))
    monkeypatch.setattr(routes.gmail, "send", fake_send)
    rest.tables["email_connections"].append({"id": "c1", "user_id": USER_ID, "provider": "gmail",
                                             "email_address": "sam@gmail.com", "status": "connected"})

    async with await _client() as client:
        _, results = await _generate(client, [lead["id"] for lead in leads])
        drafts = {r["lead_id"]: r["draft"] for r in results}
        ids = [lead["id"] for lead in leads]

        # Nothing is sendable before approval and a resume decision.
        preview = (await client.post("/api/v1/leads/email-drafts/send-preview", json={"all_ready": True})).json()
        assert preview["ready"] == [] and preview["confirm_token"] is None

        for i, lead_id in enumerate(ids[:2]):
            draft = drafts[lead_id]
            body = {"expected_version": draft["version"], "send_without_resume": True}
            if i == 1:
                body["recipient_email"] = "bad@acme.test"
            draft = (await client.patch(f"/api/v1/leads/{lead_id}/email-draft", json=body)).json()
            draft = (await client.post(f"/api/v1/leads/{lead_id}/email-draft/approve",
                                       json={"expected_version": draft["version"]})).json()
            assert draft["approved"] and draft["issues"] == []

        preview = (await client.post("/api/v1/leads/email-drafts/send-preview", json={"all_ready": True})).json()
        assert len(preview["ready"]) == 2 and len(preview["excluded"]) == 1
        ready_ids = [item["draft_id"] for item in preview["ready"]]

        # A token can't be stretched to drafts the user didn't confirm.
        other = drafts[ids[2]]["id"]
        refused = await client.post("/api/v1/leads/email-drafts/send",
                                    json={"confirm_token": preview["confirm_token"], "draft_ids": [other]})
        assert refused.status_code == 409

        sent = (await client.post("/api/v1/leads/email-drafts/send",
                                  json={"confirm_token": preview["confirm_token"], "draft_ids": ready_ids})).json()
        outcomes = {r["lead_id"]: (r["outcome"], r["code"]) for r in sent["results"]}
        assert outcomes[ids[0]] == ("sent", None)
        assert outcomes[ids[1]] == ("failed", "rejected")

        # Double submit: nothing is sent twice.
        again = (await client.post("/api/v1/leads/email-drafts/send",
                                   json={"confirm_token": preview["confirm_token"], "draft_ids": ready_ids})).json()
        assert {r["outcome"] for r in again["results"]} == {"skipped"}

    assert sent_to == ["jobs@acme.test"]
    status = {lead["id"]: lead["status"] for lead in rest.tables["leads"]}
    assert status == {ids[0]: "contacted", ids[1]: "new", ids[2]: "new"}
    attempts = {a["recipient_email"]: a["status"] for a in rest.tables["email_send_attempts"]}
    assert attempts == {"jobs@acme.test": "sent", "bad@acme.test": "failed"}
    history = {row["normalized_email"]: row["status"] for row in rest.tables["outreach_contact_history"]}
    assert history == {"jobs@acme.test": "sent", "bad@acme.test": "failed"}
    by_lead = {d["lead_id"]: d for d in rest.tables["lead_drafts"]}
    assert by_lead[ids[0]]["delivery_status"] == "sent" and by_lead[ids[1]]["delivery_status"] == "failed"


@pytest.mark.asyncio
async def test_cross_feature_duplicate_is_paused_until_explicit_send_again(monkeypatch):
    lead = _lead(company_name="Acme")
    resume = {
        "id": str(uuid4()),
        "user_id": USER_ID,
        "name": "Backend.pdf",
        "role_label": "Backend Engineer",
        "file_path": f"{USER_ID}/library/a/backend.pdf",
        "file_type": "pdf",
        "archived_at": None,
        "parse_status": "parsed",
        "parsed_content": None,
        "updated_at": "1",
    }
    rest = _rest([lead], [resume])
    rest.tables["outreach_contact_history"].append({
        "id": "previous-job-outreach",
        "normalized_email": "jobs@acme.test",
        "recipient_email": "jobs@acme.test",
        "role_title": "Backend Developer",
        "company_name": "Acme",
        "source": "job_outreach",
        "status": "sent",
        "sent_at": "2026-02-03T10:00:00Z",
    })
    storage = FakeStorage({resume["file_path"]: b"%PDF-1.7 backend resume"})
    _use(rest, storage)
    _mock_ai(monkeypatch, MatchResult(resume["id"], "high", "Backend resume."))
    rest.tables["email_connections"].append({
        "id": "connection",
        "user_id": USER_ID,
        "provider": "gmail",
        "email_address": "sam@gmail.com",
        "status": "connected",
    })
    sent = []

    async def fake_send(access, raw):
        sent.append(email.message_from_bytes(raw, policy=policy.default)["To"])
        return "gmail-repeat"

    monkeypatch.setattr(
        routes,
        "access_for_sending",
        AsyncMock(return_value=({"email_address": "sam@gmail.com"}, "access")),
    )
    monkeypatch.setattr(routes.gmail, "send", fake_send)

    async with await _client() as client:
        generation_preview = (await client.post(
            "/api/v1/leads/email-drafts/preview",
            json={"lead_ids": [lead["id"]]},
        )).json()
        generated = await client.post("/api/v1/leads/email-drafts/write-and-send", json={
            "preview_token": generation_preview["preview_token"],
            "lead_ids": [lead["id"]],
            "confirm_send": True,
        })
        assert generated.status_code == 200
        generated_result = generated.json()["results"][0]
        assert generated_result["outcome"] == "needs_review"
        assert generated_result["previous_contacts"][0]["source"] == "job_outreach"
        draft = generated_result["draft"]
        assert draft["previous_contacts"][0]["source"] == "job_outreach"
        assert sent == []

        preview = (await client.post(
            "/api/v1/leads/email-drafts/send-preview",
            json={"draft_ids": [draft["id"]]},
        )).json()
        assert preview["ready"][0]["previous_contacts"][0]["source"] == "job_outreach"

        paused = (await client.post("/api/v1/leads/email-drafts/send", json={
            "confirm_token": preview["confirm_token"],
            "draft_ids": [draft["id"]],
        })).json()
        assert paused["results"][0]["outcome"] == "needs_review"
        assert paused["results"][0]["previous_contacts"][0]["source"] == "job_outreach"
        assert sent == []

        refreshed = (await client.post(
            "/api/v1/leads/email-drafts/send-preview",
            json={"draft_ids": [draft["id"]]},
        )).json()
        repeated = await client.post("/api/v1/leads/email-drafts/send", json={
            "confirm_token": refreshed["confirm_token"],
            "draft_ids": [draft["id"]],
            "confirm_duplicate_draft_ids": [draft["id"]],
        })

    assert repeated.status_code == 200
    assert repeated.json()["results"][0]["outcome"] == "sent"
    assert sent == ["jobs@acme.test"]
    assert sum(row["status"] == "sent" for row in rest.tables["outreach_contact_history"]) == 2


@pytest.mark.asyncio
async def test_lapsed_gmail_access_sends_nothing_and_leaves_drafts_alone(monkeypatch):
    rest = _rest([_lead()])
    _use(rest)
    _mock_ai(monkeypatch, MatchResult(None, "none", "-"))
    monkeypatch.setattr(routes, "access_for_sending",
                        AsyncMock(side_effect=gmail.ReauthRequiredError("Reconnect Gmail to send.")))
    rest.tables["email_connections"].append({"id": "c1", "user_id": USER_ID, "provider": "gmail",
                                             "email_address": "sam@gmail.com", "status": "connected"})
    async with await _client() as client:
        _, results = await _generate(client, [rest.tables["leads"][0]["id"]])
        draft = results[0]["draft"]
        lead_id = draft["lead_id"]
        draft = (await client.patch(f"/api/v1/leads/{lead_id}/email-draft",
                                    json={"expected_version": draft["version"], "send_without_resume": True})).json()
        await client.post(f"/api/v1/leads/{lead_id}/email-draft/approve", json={"expected_version": draft["version"]})
        preview = (await client.post("/api/v1/leads/email-drafts/send-preview", json={"all_ready": True})).json()
        response = (await client.post("/api/v1/leads/email-drafts/send", json={
            "confirm_token": preview["confirm_token"], "draft_ids": [preview["ready"][0]["draft_id"]]})).json()
    assert response["stopped"] == "reauth_required"
    assert rest.tables["lead_drafts"][0]["delivery_status"] == "draft"
    assert rest.tables["leads"][0]["status"] == "new"


@pytest.mark.asyncio
async def test_edits_in_another_tab_and_edited_regeneration_are_refused(monkeypatch):
    rest = _rest([_lead()])
    _use(rest)
    _mock_ai(monkeypatch, MatchResult(None, "none", "-"))
    async with await _client() as client:
        _, results = await _generate(client, [rest.tables["leads"][0]["id"]])
        draft = results[0]["draft"]
        lead_id = draft["lead_id"]
        edited = await client.patch(f"/api/v1/leads/{lead_id}/email-draft",
                                    json={"expected_version": draft["version"], "body": "My own words, " * 5})
        assert edited.status_code == 200 and edited.json()["is_user_edited"]
        stale = await client.patch(f"/api/v1/leads/{lead_id}/email-draft",
                                   json={"expected_version": draft["version"], "subject": "Other"})
        assert stale.status_code == 409
        regenerate = await client.post(f"/api/v1/leads/{lead_id}/email-draft/regenerate",
                                       json={"expected_version": edited.json()["version"], "confirm_replace": True})
        assert regenerate.status_code == 409 and "edits" in regenerate.json()["detail"]
    assert rest.tables["lead_drafts"][0]["body"].startswith("My own words")


@pytest.mark.asyncio
async def test_gmail_callback_rejects_unknown_reused_and_expired_states(monkeypatch):
    monkeypatch.setattr(get_settings(), "GOOGLE_OAUTH_CLIENT_ID", "client")
    monkeypatch.setattr(get_settings(), "GOOGLE_OAUTH_CLIENT_SECRET", "secret")
    rest = _rest([])
    _use(rest)
    exchange = AsyncMock(return_value=gmail.TokenGrant(refresh_token="rt", email="sam@gmail.com",
                                                       scopes=gmail.SCOPES))
    monkeypatch.setattr(connection_routes.gmail, "exchange_code", exchange)
    async with await _client() as client:
        connect = (await client.post("/api/v1/email/gmail/connect", json={})).json()
        assert "gmail.send" in connect["authorization_url"] and "code_challenge" in connect["authorization_url"]
        state = connect["authorization_url"].split("state=")[1].split("&")[0]

        assert (await client.post("/api/v1/email/gmail/callback",
                                  json={"code": "c", "state": "x" * 20})).status_code == 400
        ok = await client.post("/api/v1/email/gmail/callback", json={"code": "c", "state": state})
        assert ok.status_code == 200 and ok.json()["email_address"] == "sam@gmail.com"
        reused = await client.post("/api/v1/email/gmail/callback", json={"code": "c", "state": state})
        assert reused.status_code == 400

    stored = rest.tables["email_connections"][0]
    assert stored["refresh_token_ciphertext"] != "rt"
    assert crypto.decrypt(stored["refresh_token_ciphertext"], stored["token_key_id"]) == "rt"


@pytest.mark.asyncio
async def test_write_and_send_sends_only_confident_matches(monkeypatch):
    resume = {"id": str(uuid4()), "user_id": USER_ID, "name": "Backend.pdf", "role_label": "Backend Engineer",
              "file_path": f"{USER_ID}/library/a/backend.pdf", "file_type": "pdf", "archived_at": None,
              "parse_status": "parsed", "parsed_content": None, "updated_at": "1"}
    confident, unsure, contacted = _lead(), _lead(email_address="team@other.test"), _lead(status="contacted")
    for lead in (confident, unsure, contacted):
        lead["description"] = POST.replace("jobs@acme.test", lead["contact_info"].get("email", ""))
    rest = _rest([confident, unsure, contacted], [resume])
    storage = FakeStorage({resume["file_path"]: b"%PDF-1.7 backend resume"})
    _use(rest, storage)
    _mock_ai(monkeypatch, MatchResult(resume["id"], "high", "Backend resume."))

    async def match(gateway, role, text, library):
        return MatchResult(resume["id"], "high" if "jobs@acme.test" in text else "medium", "-")

    monkeypatch.setattr(routes, "match_resume", match)
    sent = []

    async def fake_send(access, raw):
        sent.append(email.message_from_bytes(raw, policy=policy.default))
        return "gmail-1"

    monkeypatch.setattr(routes, "access_for_sending",
                        AsyncMock(return_value=({"email_address": "sam@gmail.com"}, "access")))
    monkeypatch.setattr(routes.gmail, "send", fake_send)
    ids = [confident["id"], unsure["id"], contacted["id"]]

    async with await _client() as client:
        preview = (await client.post("/api/v1/leads/email-drafts/preview", json={"lead_ids": ids})).json()
        body = {"preview_token": preview["preview_token"], "lead_ids": ids}
        unconfirmed = await client.post("/api/v1/leads/email-drafts/write-and-send", json=body)
        assert unconfirmed.status_code == 409
        response = await client.post("/api/v1/leads/email-drafts/write-and-send", json={**body, "confirm_send": True})

    assert response.status_code == 200, response.text
    outcomes = {r["lead_id"]: (r["outcome"], r["code"]) for r in response.json()["results"]}
    assert outcomes[confident["id"]] == ("sent", None)
    assert outcomes[unsure["id"]] == ("needs_review", "resume_not_chosen")
    assert outcomes[contacted["id"]] == ("skipped", "already_contacted")

    assert [m["To"] for m in sent] == ["jobs@acme.test"]
    assert list(sent[0].iter_attachments())[0].get_content() == b"%PDF-1.7 backend resume"
    status_by_id = {lead["id"]: lead["status"] for lead in rest.tables["leads"]}
    assert status_by_id == {confident["id"]: "contacted", unsure["id"]: "new", contacted["id"]: "contacted"}
    drafts = {d["lead_id"]: d for d in rest.tables["lead_drafts"]}
    assert drafts[unsure["id"]]["delivery_status"] == "draft" and drafts[unsure["id"]]["resume_id"] is None
    assert contacted["id"] not in drafts  # nothing written for an already contacted lead


@pytest.mark.asyncio
async def test_write_and_send_writes_nothing_when_gmail_cant_send(monkeypatch):
    rest = _rest([_lead()])
    _use(rest)
    writer = _mock_ai(monkeypatch, MatchResult(None, "none", "-"))
    monkeypatch.setattr(routes, "access_for_sending",
                        AsyncMock(side_effect=gmail.GmailError("Connect Gmail to send emails.", "not_connected")))
    lead_id = rest.tables["leads"][0]["id"]
    async with await _client() as client:
        preview = (await client.post("/api/v1/leads/email-drafts/preview", json={"lead_ids": [lead_id]})).json()
        response = await client.post("/api/v1/leads/email-drafts/write-and-send", json={
            "preview_token": preview["preview_token"], "lead_ids": [lead_id], "confirm_send": True})
    assert response.status_code == 409 and "Connect Gmail" in response.json()["detail"]
    assert rest.tables["lead_drafts"] == [] and writer.await_count == 0


def test_clear_role_matches_attach_without_asking_the_ai():
    from src.app.leads.roles import clear_match

    def summary(id_, label, skills=()):
        return {"id": id_, "label": label, "note": None, "headline": None, "skills": list(skills), "parsed": True,
                "titles": []}

    library = [summary("fs", "Full Stack Engineer", ["React", "Node.js"]), summary("fe", "Frontend Developer", ["React"]),
               summary("mern", "MERN Stack Developer", ["MongoDB", "Express", "React"])]

    def pick(title, family, techs=()):
        match = clear_match({"title": title, "role_family": family, "technologies": list(techs)}, library)
        return match and match["id"]

    assert pick("Senior Full-Stack Developer", "full_stack", ["React", "Node.js"]) == "fs"
    assert pick("Full Stack Developer Intern", "full_stack") == "fs"
    assert pick("MERN Stack Developer", "full_stack", ["MongoDB", "Express"]) == "mern"
    assert pick("React Frontend Engineer", "frontend", ["React"]) == "fe"
    # Same title, but a stack the resume doesn't have: left for the user.
    assert pick("Full Stack .NET Developer", "full_stack", ["C#", ".NET Core", "Azure"]) is None
    assert pick("Backend Engineer", "backend", ["Go"]) is None


def test_resume_prescore_accepts_missing_optional_role_family():
    from src.app.leads.roles import prescore

    role = {"title": "Product Designer", "role_family": None, "technologies": []}
    summary = {"label": "Backend Engineer", "note": None, "headline": None, "skills": [], "parsed": True}

    assert prescore(role, summary) == 0


@pytest.mark.asyncio
async def test_rematch_attaches_confident_resumes_and_approve_ready_never_sends(monkeypatch):
    resume = {"id": str(uuid4()), "user_id": USER_ID, "name": "FS.pdf", "role_label": "Full Stack Engineer",
              "file_path": f"{USER_ID}/library/a/fs.pdf", "file_type": "pdf", "archived_at": None,
              "parse_status": "parsed", "parsed_content": None, "updated_at": "1"}
    clear, unclear, chosen = _lead(), _lead(), _lead()
    rest = _rest([clear, unclear, chosen], [resume])
    _use(rest)
    role = {"title": "Full Stack Developer", "role_family": "full_stack", "technologies": []}
    for lead, selection in ((clear, "needs_selection"), (unclear, "needs_selection"), (chosen, "none_by_user")):
        rest.tables["lead_drafts"].append({
            "id": str(uuid4()), "user_id": USER_ID, "lead_id": lead["id"], "recipient_email": "jobs@acme.test",
            "subject": "Hi", "body": "Hello", "resume_id": None, "resume_selection": selection,
            "delivery_status": "draft", "version": 1, "approved_at": None, "approved_version": None,
            "detected_role": {**role, "title": "Data Analyst", "role_family": "other"} if lead is unclear else role,
        })
    gateway_match = AsyncMock(return_value=MatchResult(None, "none", "-"))
    monkeypatch.setattr("src.app.leads.roles.call_json", gateway_match)
    sent = AsyncMock()
    monkeypatch.setattr(routes.gmail, "send", sent)
    ids = [d["id"] for d in rest.tables["lead_drafts"]]

    async with await _client() as client:
        rematch = (await client.post("/api/v1/leads/email-drafts/rematch", json={"draft_ids": ids})).json()
        approved = (await client.post("/api/v1/leads/email-drafts/approve-ready", json={})).json()

    assert rematch["matched"] == 1  # only the clear Full Stack title; no AI call needed for it
    by_lead = {d["lead_id"]: d for d in rest.tables["lead_drafts"]}
    assert by_lead[clear["id"]]["resume_id"] == resume["id"] and by_lead[clear["id"]]["resume_selection"] == "auto"
    assert by_lead[unclear["id"]]["resume_selection"] == "needs_selection"
    assert by_lead[chosen["id"]]["resume_selection"] == "none_by_user"  # the user's choice is never replaced
    assert approved["approved"] == 2  # the matched one and the "no resume" one; the unclear one isn't ready
    assert all(d["delivery_status"] == "draft" for d in rest.tables["lead_drafts"])
    sent.assert_not_awaited()


async def test_leads_ai_usage_is_recorded_for_the_dashboard():
    from src.app.core import llm_usage
    from src.app.core.llm_usage import LLMCall

    rest = FakeRest({})
    llm_usage.start_collecting()
    dependency = routes.record_lead_usage(rest)
    await dependency.__anext__()
    llm_usage.record(LLMCall(stage="lead_email", provider="anthropic", model="m", input_tokens=900, output_tokens=300))
    llm_usage.record(LLMCall(stage="resume_match", provider="anthropic", model="m", input_tokens=400, output_tokens=50))
    with pytest.raises(StopAsyncIteration):
        await dependency.__anext__()
    assert len(rest.tables["llm_calls"]) == 2
    (event,) = rest.tables["usage_events"]
    assert event["kind"] == "lead_email" and event["tokens"] == 1650 and event["llm_calls"] == 2
