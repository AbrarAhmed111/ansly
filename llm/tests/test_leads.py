from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient

from src.app.api.deps import get_rest
from src.app.api.routes import leads as leads_routes
from src.app.core.auth import AuthUser, get_current_user
from src.app.core.config import get_settings
from src.app.leads.search import build_queries, qualify_result, unique_results
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


def test_build_queries_uses_profile_terms_and_is_bounded():
    queries = build_queries(PROFILE)
    assert 1 <= len(queries) <= 3
    assert '"Product Engineer"' in queries[0]
    assert '"React"' in queries[0]
    assert ' -"unpaid"' in queries[0]


def test_qualify_result_requires_relevance_and_hiring_evidence():
    result = {
        "title": "Product Engineer at Example",
        "url": "https://example.com/careers/product-engineer",
        "description": "We are hiring a remote Product Engineer with React and TypeScript experience.",
    }
    lead = qualify_result(result, PROFILE)
    assert lead is not None
    assert lead["company_name"] == "Example"
    assert lead["source_platform"] == "other"
    assert lead["contactability"] == "application_link_available"
    assert lead["original_post_url"] == result["url"]
    assert qualify_result(
        {**result, "title": "Product Engineer opening"},
        PROFILE,
    )["company_name"] == "Unverified employer"

    unrelated = {
        **result,
        "url": "https://example.com/news/product-engineer",
        "description": "A product announcement with React and TypeScript.",
    }
    assert qualify_result(unrelated, PROFILE) is None

    excluded = {**result, "description": "Unpaid role; we are hiring a Product Engineer with React."}
    assert qualify_result(excluded, PROFILE) is None


def test_unique_results_deduplicates_urls_without_query_or_fragment():
    results = [
        {"title": "First", "url": "https://example.com/jobs/1?ref=search", "description": "Hiring"},
        {"title": "Duplicate", "url": "https://example.com/jobs/1#details", "description": "Hiring"},
    ]
    assert len(unique_results(results)) == 1


@pytest.mark.asyncio
async def test_collect_leads_searches_saves_and_updates_session(monkeypatch):
    profile = {**PROFILE, "user_id": USER_ID}
    rest = FakeRest({
        "targeting_profiles": [profile],
        "lead_collection_sessions": [],
        "leads": [],
    })
    app.dependency_overrides[get_current_user] = lambda: AuthUser(
        id=USER_ID, email="sam@example.com", token="test-token"
    )
    app.dependency_overrides[get_rest] = lambda: rest
    monkeypatch.setattr(get_settings(), "BRAVE_SEARCH_API_KEY", "test-key")
    search = AsyncMock(return_value=[{
        "title": "Product Engineer at Example",
        "url": "https://example.com/careers/product-engineer",
        "description": "We are hiring a remote Product Engineer with React and TypeScript.",
    }])
    monkeypatch.setattr(leads_routes, "search_public_web", search)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post(
                "/api/v1/leads/collect",
                json={"targeting_profile_id": PROFILE["id"]},
            )
    finally:
        app.dependency_overrides.clear()
        monkeypatch.setattr(get_settings(), "BRAVE_SEARCH_API_KEY", "")

    assert response.status_code == 200
    assert response.json()["new_leads_saved"] == 1
    assert len(rest.tables["leads"]) == 1
    assert rest.tables["lead_collection_sessions"][0]["status"] == "completed"
    assert search.await_count == 1


@pytest.mark.asyncio
async def test_collect_leads_reports_missing_provider_configuration(monkeypatch):
    rest = FakeRest({"targeting_profiles": [], "lead_collection_sessions": [], "leads": []})
    app.dependency_overrides[get_current_user] = lambda: AuthUser(
        id=USER_ID, email="sam@example.com", token="test-token"
    )
    app.dependency_overrides[get_rest] = lambda: rest
    monkeypatch.setattr(get_settings(), "BRAVE_SEARCH_API_KEY", "")
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post(
                "/api/v1/leads/collect",
                json={"targeting_profile_id": PROFILE["id"]},
            )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 503
    assert "BRAVE_SEARCH_API_KEY" in response.json()["detail"]
