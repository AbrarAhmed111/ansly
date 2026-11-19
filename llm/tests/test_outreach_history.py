import pytest

from src.app.db.rest import SupabaseError
from src.app.email.outreach_history import (
    OutreachCandidate,
    find_in_progress_contacts,
    find_previous_contacts,
    normalize_company,
    normalize_role,
)
from src.app.email.sending import send_gmail_email
from tests.fakes import FakeRest, FakeStorage


class DuplicateRaceRest(FakeRest):
    def __init__(self):
        super().__init__({
            "outreach_contact_history": [{
                "id": "concurrent-send",
                "normalized_email": "jobs@example.com",
                "recipient_email": "jobs@example.com",
                "role_title": "Backend Engineer",
                "company_name": "Acme",
                "source": "job_outreach",
                "status": "sent",
                "sent_at": "2026-02-03T10:00:00Z",
            }],
        })
        self.history_reads = 0

    async def select(self, table, params=None):
        if table == "outreach_contact_history":
            self.history_reads += 1
            if self.history_reads < 3:
                return []
        return await super().select(table, params)

    async def insert_many(self, table, rows):
        if table == "outreach_contact_history":
            raise SupabaseError(409, "outreach_contact_history_active_send")
        await super().insert_many(table, rows)


@pytest.mark.asyncio
async def test_job_outreach_matches_a_successful_linkedin_contact_for_equivalent_role():
    rest = FakeRest({
        "outreach_contact_history": [{
            "id": "history-1",
            "normalized_email": "hiring@example.com",
            "recipient_email": "Hiring@Example.com",
            "role_title": "Senior Full Stack Developer",
            "company_name": "Acme, Inc.",
            "source": "linkedin_leads",
            "status": "sent",
            "sent_at": "2026-02-03T10:00:00Z",
        }],
    })

    matches = await find_previous_contacts(rest, [
        OutreachCandidate(
            "hiring@example.com",
            "Full Stack / Architect-Level Developer",
            "Acme",
        ),
    ])

    assert len(matches["hiring@example.com"]) == 1
    assert matches["hiring@example.com"][0].source == "linkedin_leads"
    assert matches["hiring@example.com"][0].sent_at == "2026-02-03T10:00:00Z"


@pytest.mark.asyncio
async def test_linkedin_contact_matches_successful_job_outreach():
    rest = FakeRest({
        "outreach_contact_history": [{
            "id": "history-2",
            "normalized_email": "careers@example.com",
            "recipient_email": "careers@example.com",
            "role_title": "Backend Engineer",
            "company_name": "Example LLC",
            "source": "job_outreach",
            "status": "sent",
        }],
    })

    matches = await find_previous_contacts(rest, [
        OutreachCandidate("careers@example.com", "Senior Backend Developer", "Example"),
    ])

    assert matches["careers@example.com"][0].source == "job_outreach"


@pytest.mark.asyncio
async def test_failed_or_unrelated_history_does_not_match():
    rest = FakeRest({
        "outreach_contact_history": [
            {
                "id": "failed",
                "normalized_email": "jobs@example.com",
                "recipient_email": "jobs@example.com",
                "role_title": "Backend Engineer",
                "company_name": "Acme",
                "source": "linkedin_leads",
                "status": "failed",
            },
            {
                "id": "different-company",
                "normalized_email": "jobs@example.com",
                "recipient_email": "jobs@example.com",
                "role_title": "Backend Developer",
                "company_name": "Other Corp",
                "source": "job_outreach",
                "status": "sent",
            },
            {
                "id": "different-role",
                "normalized_email": "jobs@example.com",
                "recipient_email": "jobs@example.com",
                "role_title": "Frontend Developer",
                "company_name": "Acme",
                "source": "linkedin_leads",
                "status": "sent",
            },
        ],
    })

    matches = await find_previous_contacts(rest, [
        OutreachCandidate("JOBS@example.com", "Senior Backend Engineer", "Acme"),
    ])

    assert matches["jobs@example.com"] == []


@pytest.mark.asyncio
async def test_previous_contacts_are_identified_per_recipient():
    rest = FakeRest({
        "outreach_contact_history": [
            {
                "id": "history-to",
                "normalized_email": "to@example.com",
                "recipient_email": "to@example.com",
                "role_title": "Full Stack Developer",
                "company_name": "Acme",
                "source": "linkedin_leads",
                "status": "sent",
            },
            {
                "id": "history-cc",
                "normalized_email": "cc@example.com",
                "recipient_email": "cc@example.com",
                "role_title": "Full Stack Engineer",
                "company_name": "Acme",
                "source": "job_outreach",
                "status": "sent",
            },
        ],
    })

    matches = await find_previous_contacts(rest, [
        OutreachCandidate("to@example.com", "Full Stack Developer", "Acme"),
        OutreachCandidate("cc@example.com", "Full Stack Developer", "Acme"),
        OutreachCandidate("new@example.com", "Full Stack Developer", "Acme"),
    ])

    assert [item.recipient_email for item in matches["to@example.com"]] == ["to@example.com"]
    assert [item.recipient_email for item in matches["cc@example.com"]] == ["cc@example.com"]
    assert matches["new@example.com"] == []


@pytest.mark.asyncio
async def test_active_send_blocks_concurrent_equivalent_outreach():
    rest = FakeRest({
        "outreach_contact_history": [{
            "id": "in-flight",
            "normalized_email": "jobs@example.com",
            "recipient_email": "jobs@example.com",
            "role_title": "Senior Backend Developer",
            "company_name": "Acme",
            "source": "job_outreach",
            "status": "sending",
        }],
    })
    candidates = [OutreachCandidate("jobs@example.com", "Backend Engineer", "Acme")]

    active = await find_in_progress_contacts(rest, candidates)

    assert len(active) == 1


def test_role_and_company_normalization():
    assert normalize_role("Senior Full Stack Developer") == normalize_role(
        "Full Stack / Architect-Level Developer"
    )
    assert normalize_company("Example, Inc.") == normalize_company("Example")


@pytest.mark.asyncio
async def test_database_duplicate_race_returns_reviewable_previous_contact(monkeypatch):
    rest = DuplicateRaceRest()
    async def unexpected_send(*args, **kwargs):
        pytest.fail("Gmail must not be called after the database rejects a duplicate send")

    monkeypatch.setattr("src.app.email.sending.gmail.send", unexpected_send)
    outcome = await send_gmail_email(
        rest,
        FakeStorage(),
        {"email_address": "sender@example.com"},
        "access-token",
        recipient="jobs@example.com",
        subject="Backend Engineer application",
        body="Hello",
        resume_id=None,
        role_title="Backend Engineer",
        company_name="Acme",
        outreach_source="linkedin_leads",
    )

    assert not outcome.sent
    assert outcome.code == "duplicate_contact"
    assert outcome.previous_contacts[0].source == "job_outreach"
