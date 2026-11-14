import re
from pathlib import Path
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient

from src.app.api.deps import get_rest
from src.app.core.auth import AuthUser, get_current_user
from src.app.db.rest import SupabaseError
from src.app.leads.posts import canonical_post_url, qualify_post
from src.app.main import app
from tests.fakes import USER_ID, FakeRest

PROFILE = {
    "id": str(uuid4()),
    "name": "Product engineering",
    "description": "Relevant software roles",
    "target_roles": ["Product Engineer", "Full-stack Engineer"],
    "keywords": ["React", "TypeScript"],
    "excluded_keywords": ["unpaid"],
    "locations": ["Remote"],
}


def _auth(rest):
    app.dependency_overrides[get_current_user] = lambda: AuthUser(
        id=USER_ID, email="sam@example.com", token="test-token"
    )
    app.dependency_overrides[get_rest] = lambda: rest


def _post(text, activity="1", **extra):
    return {"source_post_id": f"urn:li:activity:{activity}", "post_text": text, **extra}


def test_canonical_post_url_prefers_urn_and_drops_tracking():
    assert canonical_post_url("urn:li:activity:42", None) == "https://www.linkedin.com/feed/update/urn:li:activity:42/"
    assert canonical_post_url(None, "https://www.linkedin.com/posts/sam_hiring-activity-1?utm_source=x#c") == (
        "https://www.linkedin.com/posts/sam_hiring-activity-1/"
    )
    assert canonical_post_url(None, "https://www.linkedin.com/feed/update/urn:li:activity:7/?trk=a") == (
        "https://www.linkedin.com/feed/update/urn:li:activity:7/"
    )
    assert canonical_post_url(None, "https://linkedin.com.attacker.test/posts/x") is None
    assert canonical_post_url("not-a-urn", None) is None


def test_qualify_post_matches_contact_and_filters_bait():
    data = {"post_text": "We are hiring a React engineer. Send your CV to jobs@example.test",
            "canonical_url": "https://www.linkedin.com/feed/update/urn:li:activity:1/",
            "author_profile_url": "https://www.linkedin.com/in/sam/?miniProfile=1"}
    lead = qualify_post(data, PROFILE)
    assert lead["contactability"] == "email_available"
    assert lead["contact_info"]["email"] == "jobs@example.test"
    assert lead["author_profile_url"] == "https://www.linkedin.com/in/sam/"
    assert lead["author_name"] == "Unknown author"

    linked = qualify_post({**data, "post_text": "Need a developer to build an MVP in React. Apply: acme.example/jobs"}, PROFILE)
    assert linked["contactability"] == "application_link_available"
    assert linked["contact_info"]["application_url"] == "https://acme.example/jobs"
    assert linked["confidence"] < lead["confidence"]

    assert qualify_post({**data, "post_text": "Need a React developer for an MVP. DM me."}, PROFILE) is None
    assert qualify_post({**data, "post_text": "Hiring React devs! Comment interested below."}, PROFILE) is None
    assert qualify_post({**data, "post_text": "Hiring React devs with Node.js and Next.js. DM your CV."}, PROFILE) is None
    assert qualify_post({**data, "post_text": "My thoughts on React hooks."}, PROFILE) is None
    assert qualify_post({**data, "post_text": "Hiring a graphic designer, apply via email"}, PROFILE) is None
    assert qualify_post({**data, "post_text": "Hiring unpaid React interns"}, PROFILE) is None


@pytest.mark.asyncio
async def test_collect_linkedin_posts_saves_relevant_and_reports_counts():
    profile = {**PROFILE, "user_id": USER_ID, "is_active": True}
    rest = FakeRest({"targeting_profiles": [profile], "lead_collection_sessions": [], "leads": []})
    _auth(rest)
    body = {
        "loaded_count": 5,
        "candidates": [
            _post("We are hiring a Product Engineer (React). Apply here https://example.test/jobs/1", "1"),
            _post("Duplicate card of the same post: hiring React", "1"),
            _post("Great conference talk about TypeScript.", "2"),
            {"post_text": "Hiring React engineer, no id"},
            _post("Looking for a freelance React developer, DM me", "3"),
            _post("Hiring a React engineer, send CV to jobs@example.test", "4", author_name="Sam Rivera"),
        ],
    }
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post("/api/v1/leads/collect", json=body)
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200, response.text
    data = response.json()
    assert {k: data[k] for k in (
        "status", "loaded_count", "extracted_count", "unidentified_count",
        "relevant_count", "filtered_count", "duplicate_count", "saved_count",
    )} == {
        "status": "completed", "loaded_count": 5, "extracted_count": 6, "unidentified_count": 1,
        "relevant_count": 2, "filtered_count": 2, "duplicate_count": 1, "saved_count": 2,
    }
    saved = rest.tables["leads"]
    assert {lead["source_platform"] for lead in saved} == {"linkedin"}
    assert saved[0]["contact_info"]["application_url"] == "https://example.test/jobs/1"
    assert saved[1]["author_name"] == "Sam Rivera"
    assert rest.tables["lead_collection_sessions"][0]["status"] == "completed"


@pytest.mark.asyncio
async def test_collect_linkedin_posts_counts_existing_leads_as_duplicates():
    class ConflictRest(FakeRest):
        async def insert(self, table, row):
            if table == "leads":
                raise SupabaseError(409, "duplicate key")
            return await super().insert(table, row)

    rest = ConflictRest({"targeting_profiles": [{**PROFILE, "user_id": USER_ID}], "lead_collection_sessions": [], "leads": []})
    _auth(rest)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post("/api/v1/leads/collect", json={
                "loaded_count": 1, "candidates": [_post("Hiring a React engineer: jobs@example.test", "9")],
            })
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["duplicate_count"] == 1
    assert response.json()["saved_count"] == 0


@pytest.mark.asyncio
async def test_collect_linkedin_posts_requires_profile_and_bounds_input():
    rest = FakeRest({"targeting_profiles": [], "lead_collection_sessions": [], "leads": []})
    with_profile = FakeRest({"targeting_profiles": [{**PROFILE, "user_id": USER_ID}], "lead_collection_sessions": [], "leads": []})
    _auth(rest)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            missing = await client.post("/api/v1/leads/collect", json={"loaded_count": 0, "candidates": []})
            app.dependency_overrides[get_rest] = lambda: with_profile
            at_cap = await client.post("/api/v1/leads/collect", json={
                "loaded_count": 100, "candidates": [_post("Hiring", str(i)) for i in range(100)],
            })
            too_many = await client.post("/api/v1/leads/collect", json={
                "loaded_count": 100, "candidates": [_post("Hiring", str(i)) for i in range(101)],
            })
            unknown = await client.post("/api/v1/leads/collect", json={
                "loaded_count": 1, "candidates": [{**_post("Hiring"), "cookie": "x"}],
            })
    finally:
        app.dependency_overrides.clear()

    assert missing.status_code == 422
    assert "targeting profile" in missing.json()["detail"]
    assert at_cap.status_code == 200
    assert too_many.status_code == 422
    assert unknown.status_code == 422


FIXTURES = Path(__file__).parent / "fixtures" / "linkedin_posts"
FULL_STACK_PROFILE = {
    "id": str(uuid4()),
    "name": "Full stack",
    "target_roles": ["Full Stack Developer", "Software Engineer", "Full Stack AI Developer", "Backend Developer"],
    "keywords": ["React", "Next.js", "TypeScript", "Python", "Node.js"],
    "excluded_keywords": [],
}


def _fixture_posts(name):
    text = (FIXTURES / f"{name}.txt").read_text(encoding="utf-8")
    return [post.strip() for post in re.split(r"\n---\n", text)]


def _qualify(text):
    return qualify_post(
        {"post_text": text, "canonical_url": "https://www.linkedin.com/feed/update/urn:li:activity:1/"},
        FULL_STACK_PROFILE,
    )


@pytest.mark.parametrize("text", _fixture_posts("best"))
def test_real_posts_with_an_email_are_saved_as_best(text):
    lead = _qualify(text)
    assert lead is not None
    assert lead["contactability"] == "email_available"
    assert lead["contact_info"]["email"].endswith("@example.com")


@pytest.mark.parametrize("text", _fixture_posts("good"))
def test_real_posts_with_only_an_apply_link_are_saved_as_good(text):
    lead = _qualify(text)
    assert lead is not None
    assert lead["contactability"] == "application_link_available"


@pytest.mark.parametrize("text", _fixture_posts("bad"))
def test_real_posts_without_email_or_link_are_ignored(text):
    assert _qualify(text) is None


def test_excluded_keywords_drop_any_post_that_mentions_them():
    profile = {**FULL_STACK_PROFILE, "excluded_keywords": ["angular", "dm"]}
    email = " Send CV to jobs@example.test"

    def qualify(text):
        return qualify_post(
            {"post_text": text + email, "canonical_url": "https://www.linkedin.com/feed/update/urn:li:activity:1/"},
            profile,
        )

    assert qualify("Hiring a Full Stack Developer with React.") is not None
    assert qualify("Hiring a Full Stack Developer with React or Angular.") is None
    assert qualify("Hiring a Full Stack Developer, AngularJS a plus.") is None
    assert qualify("Hiring a Full Stack Developer (Angular.js).") is None
    assert qualify("Hiring a Full Stack Developer. DM me or apply.") is None
    assert qualify("Hiring a Full Stack Developer, open to DMs.") is None
    # Whole words only: "admin" and "dmitri" are not "dm".
    assert qualify("Hiring a Full Stack Developer for our admin panel. Ask Dmitri.") is not None


def test_excluding_java_keeps_javascript_posts():
    profile = {**FULL_STACK_PROFILE, "excluded_keywords": ["java"]}
    data = {"canonical_url": "https://www.linkedin.com/feed/update/urn:li:activity:1/"}
    keep = "Hiring a Full Stack Developer with JavaScript. jobs@example.test"
    drop = "Hiring a Java Full Stack Developer. jobs@example.test"
    assert qualify_post({**data, "post_text": keep}, profile) is not None
    assert qualify_post({**data, "post_text": drop}, profile) is None
