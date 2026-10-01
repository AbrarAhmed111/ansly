"""
V2 job tests: requirement extraction, source adapters (against recorded API
responses), ingestion with deduplication, matching, saved searches and alerts.
No network: HTTP goes through httpx.MockTransport.
"""

import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock

import httpx
import pytest
from httpx import ASGITransport, AsyncClient

from src.app.api.deps import get_rest
from src.app.core.auth import AuthUser, get_current_user
from src.app.core.rate_limit import rate_limiter
from src.app.jobs.extract import (
    extract_experience_years,
    extract_salary,
    extract_seniority,
    extract_workplace,
    html_to_text,
    normalize_employment_type,
)
from src.app.jobs.ingest import run_ingestion
from src.app.jobs.matching import build_candidate, classify_role, compute_match, role_fit, years_of_experience
from src.app.jobs.normalize import build_job, dedupe_key
from src.app.jobs.searches import job_matches_filters, parse_search_query
from src.app.jobs.service import refresh_user
from src.app.jobs.sources import Arbeitnow, Ashby, Greenhouse, Lever
from src.app.jobs.vocabulary import find_skills
from src.app.main import app
from tests.fakes import SAMPLE_PROFILE, USER_ID, FakeRest

FIXTURES = Path(__file__).parent / "fixtures" / "jobs"


def fixture(name: str):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


# --- Extraction ----------------------------------------------------------------

def test_find_skills_respects_word_sense():
    text = "We use React, Next.js and Go. You will react quickly and go to meetings. Experience with C++ and .NET is a plus."
    skills = find_skills(text)
    assert {"React", "Next.js", "Go", "C++", ".NET"} <= set(skills)
    assert skills.count("React") == 1
    assert "Java" not in find_skills("Strong JavaScript skills")
    assert find_skills("Our OpenAI partnership") == []


@pytest.mark.parametrize("text,years", [
    ("You have 4+ years of professional experience building web apps.", 4),
    ("3-5 years experience with Python", 3),
    ("Minimum experience: 2 years", 2),
    ("Founded 15 years ago, we are a team of 50.", None),
    ("Comfortable with ambiguity.", None),
])
def test_extract_experience_years(text, years):
    assert extract_experience_years(text) == years


@pytest.mark.parametrize("text,expected", [
    ("The salary range is $100k–140k.", (100000, 140000, "USD", "year")),
    ("Pay: $100,000 - $140,000 per year", (100000, 140000, "USD", "year")),
    ("€60.000 – €80.000 brutto", (60000, 80000, "EUR", "year")),
    ("$45 - $60 per hour", (45, 60, "USD", "hour")),
    ("Raised $20M - $30M in funding", None),
    ("No salary here", None),
])
def test_extract_salary(text, expected):
    s = extract_salary(text)
    assert (s.min, s.max, s.currency, s.period) == expected if expected else s is None


def test_extract_workplace_seniority_and_type():
    assert extract_workplace("Hybrid - London") == "hybrid"
    assert extract_workplace(None, "Remote - United States") == "remote"
    assert extract_workplace("Berlin") is None
    assert extract_workplace("This role is on-site in Austin") == "onsite"
    assert extract_seniority("Senior / Staff Fullstack Engineer") == "principal"
    assert extract_seniority("Sr. Backend Engineer") == "senior"
    assert extract_seniority("Software Engineer") is None
    assert normalize_employment_type("FullTime") == "full_time"
    assert normalize_employment_type("Part-time") == "part_time"
    assert normalize_employment_type(None, "Freelance") == "contract"


def test_html_to_text_handles_double_escaping():
    assert html_to_text("&lt;p&gt;Hello &amp;amp; welcome&lt;/p&gt;&lt;ul&gt;&lt;li&gt;One&lt;/li&gt;&lt;/ul&gt;") == "Hello & welcome\n• One"


def test_dedupe_key_ignores_noise():
    assert dedupe_key("Acme GmbH", "Software Engineer (m/w/d)", "Hybrid - Berlin, DE") == \
        dedupe_key("acme gmbh", "Software Engineer", "Berlin")
    assert dedupe_key("Acme", "Engineer", "Remote - United States").endswith("|united states")


def test_build_job_drops_own_company_as_skill():
    job = build_job(external_id="1", url="https://x", title="Engineer", company="Vercel",
                    description_text="Vercel builds tools. You know Next.js and TypeScript.")
    assert job.skills == ["Next.js", "TypeScript"]


# --- Adapters --------------------------------------------------------------------

def test_greenhouse_adapter():
    jobs = Greenhouse.parse(fixture("greenhouse.json"), "vercel", "Vercel")
    assert len(jobs) == 2
    j = jobs[1]
    assert j.company == "Vercel" and j.workplace == "hybrid"
    assert j.url.startswith("https://job-boards.greenhouse.io/vercel/jobs/")
    assert "<" not in j.description and j.posted_at


def test_lever_adapter():
    jobs = Lever.parse(fixture("lever.json"), "palantir", "Palantir")
    assert jobs[0].workplace == "hybrid"
    assert jobs[0].employment_type == "full_time"
    assert jobs[0].apply_url.endswith("/apply")
    assert "What We Require" in jobs[0].description


def test_ashby_adapter_reads_compensation():
    jobs = Ashby.parse(fixture("ashby.json"), "supabase", "Supabase")
    remote = jobs[0]
    assert remote.workplace == "remote" and remote.employment_type == "full_time"
    assert {"TypeScript", "React", "PostgreSQL"} <= set(remote.skills)
    paid = jobs[1]
    assert (paid.salary_min, paid.salary_max, paid.salary_currency, paid.salary_period) == (200000, 270000, "USD", "year")


def test_arbeitnow_adapter():
    jobs = Arbeitnow.parse(fixture("arbeitnow.json"), "", "Arbeitnow")
    assert jobs[0].workplace == "remote"
    assert jobs[1].location == "Berlin" and jobs[1].company == "Preiswecker"
    assert jobs[0].posted_at.startswith("20")


# --- Ingestion ---------------------------------------------------------------------

def _sources():
    return [
        {"id": "src-gh", "kind": "greenhouse", "identifier": "acme", "name": "Acme", "enabled": True},
        {"id": "src-ab", "kind": "ashby", "identifier": "acme", "name": "Acme", "enabled": True},
    ]


def _greenhouse_payload(titles):
    return {"jobs": [{
        "id": i, "title": t, "absolute_url": f"https://boards.greenhouse.io/acme/jobs/{i}",
        "location": {"name": "Remote - Europe"}, "content": "&lt;p&gt;5+ years of experience with React and TypeScript.&lt;/p&gt;",
        "company_name": "Acme", "updated_at": "2026-09-01T00:00:00Z", "departments": [{"name": "Engineering"}],
    } for i, t in titles]}


def _ashby_payload():
    return {"jobs": [{
        "id": "ab-1", "title": "Frontend Engineer", "location": "Remote - Europe", "isRemote": True, "isListed": True,
        "workplaceType": "Remote", "employmentType": "FullTime", "jobUrl": "https://jobs.ashbyhq.com/acme/ab-1",
        "applyUrl": "https://jobs.ashbyhq.com/acme/ab-1/application", "publishedAt": "2026-09-01T00:00:00Z",
        "descriptionPlain": "React and TypeScript.", "compensation": None,
    }]}


def _transport(gh_titles):
    def handler(request: httpx.Request) -> httpx.Response:
        if "greenhouse" in request.url.host:
            return httpx.Response(200, json=_greenhouse_payload(gh_titles))
        if "ashbyhq" in request.url.host:
            return httpx.Response(200, json=_ashby_payload())
        return httpx.Response(404)
    return httpx.MockTransport(handler)


def _settings():
    s = MagicMock()
    s.INGEST_MAX_PAGES, s.INGEST_STALE_DAYS, s.MATCH_WINDOW_DAYS = 1, 14, 45
    return s


@pytest.mark.asyncio
async def test_ingestion_dedupes_across_sources_and_closes_missing_jobs():
    rest = FakeRest({"job_sources": _sources()})
    report = await run_ingestion(rest, _settings(), transport=_transport([(1, "Frontend Engineer"), (2, "Backend Engineer")]))
    assert report.ok, report.summary()

    jobs = rest.tables["jobs"]
    assert sorted(j["title"] for j in jobs) == ["Backend Engineer", "Frontend Engineer"]
    frontend = next(j for j in jobs if j["title"] == "Frontend Engineer")
    # The Ashby listing of the same job is recorded on the Greenhouse record, not stored twice.
    assert frontend["source_id"] == "src-ab" or frontend["also_listed_on"]
    assert frontend["workplace"] == "remote" and frontend["experience_years_min"] in (5.0, None)
    gh_status = next(s for s in rest.tables["job_sources"] if s["id"] == "src-gh")
    assert gh_status["last_status"] == "ok" and gh_status["last_job_count"] == 2

    # Next run: the backend job is gone from Greenhouse, so it is closed.
    for j in jobs:
        j["last_seen_at"] = "2026-01-01T00:00:00+00:00"
    await run_ingestion(rest, _settings(), only=["greenhouse"], transport=_transport([(1, "Frontend Engineer")]))
    backend = next(j for j in rest.tables["jobs"] if j["title"] == "Backend Engineer")
    assert backend["is_active"] is False
    assert len(rest.tables["jobs"]) == 2


@pytest.mark.asyncio
async def test_ingestion_records_source_errors():
    rest = FakeRest({"job_sources": [{"id": "s", "kind": "lever", "identifier": "nope", "name": "Nope", "enabled": True}]})
    report = await run_ingestion(rest, _settings(), transport=httpx.MockTransport(lambda r: httpx.Response(404)))
    assert not report.ok
    assert rest.tables["job_sources"][0]["last_status"] == "error"
    assert "404" in rest.tables["job_sources"][0]["last_error"]


# --- Matching ------------------------------------------------------------------------

def _profile_data():
    return {"profile": SAMPLE_PROFILE["profiles"][0], **{k: SAMPLE_PROFILE[k] for k in
            ["experiences", "projects", "skills", "education", "achievements"]}}


def _job(**overrides):
    job = {"id": "j1", "title": "Senior Full-Stack Engineer", "company": "Example AI", "location": "Remote",
           "workplace": "remote", "skills": ["Next.js", "TypeScript", "Python", "PostgreSQL", "Kubernetes"],
           "experience_years_min": 3, "seniority": "senior", "first_seen_at": "2026-10-01T00:00:00+00:00"}
    return {**job, **overrides}


def test_years_of_experience_merges_overlaps():
    exps = [
        {"start_date": "2020-01-01", "end_date": "2021-01-01"},
        {"start_date": "2020-07-01", "end_date": "2022-01-01"},
        {"start_date": "2023-01-01", "is_current": True},
    ]
    assert years_of_experience(exps, date(2024, 1, 1)) == 3.0
    assert years_of_experience([{"start_date": None}]) is None


def test_role_fit():
    roles = [classify_role("Software Engineer"), classify_role("Full-stack engineer building AI products")]
    assert role_fit("Senior Fullstack Developer", roles) == "match"
    assert role_fit("Backend Engineer", [classify_role("Frontend Developer")]) == "related"
    assert role_fit("Account Executive", roles) == "unrelated"
    assert role_fit("Product Manager", roles) == "unrelated"


def test_strong_match_is_explained():
    candidate = build_candidate(_profile_data(), date(2026, 10, 1))
    m = compute_match(_job(), candidate)
    assert m["tier"] == "strong", m
    assert m["matched_skills"] == ["Next.js", "TypeScript", "Python", "PostgreSQL"]
    assert m["missing_skills"] == ["Kubernetes"]
    assert m["experience"]["fit"] == "meets" and m["workplace_fit"] == "match" and m["role_fit"] == "match"
    assert m["reasons"][0].startswith("Matches 4 of 5 skills")
    assert any("Kubernetes" in r for r in m["reasons"])


def test_unrelated_or_mismatched_jobs_are_not_strong():
    candidate = build_candidate(_profile_data(), date(2026, 10, 1))
    sales = compute_match(_job(title="Account Executive", skills=["Salesforce"]), candidate)
    assert sales["tier"] == "low" and sales["role_fit"] == "unrelated"
    onsite = compute_match(_job(workplace="onsite", location="Austin, TX"), candidate)
    assert onsite["workplace_fit"] == "mismatch" and onsite["tier"] != "strong"
    staff = compute_match(_job(experience_years_min=10), candidate)
    assert staff["experience"]["fit"] == "below" and staff["tier"] != "strong"


# --- Saved searches ---------------------------------------------------------------------

def test_parse_search_query_from_the_product_plan():
    filters = parse_search_query("Find remote Full Stack/Product Engineering roles involving AI, Next.js and TypeScript")
    assert filters["roles"] == ["Full Stack Engineer", "Product Engineer"]
    assert filters["skills"] == ["AI", "Next.js", "TypeScript"]
    assert filters["workplace"] == ["remote"]


def test_parse_search_query_details():
    f = parse_search_query("senior backend engineer in Berlin, Python, 5+ years, $120k+, full-time")
    assert f["locations"] == ["Berlin"] and f["experience_years"] == 5 and f["min_salary"] == 120000
    assert f["employment_types"] == ["full_time"] and f["skills"] == ["Python"]


def test_job_matches_filters():
    filters = parse_search_query("remote full stack engineer with Next.js and TypeScript")
    assert job_matches_filters(_job(), filters)
    assert not job_matches_filters(_job(workplace="hybrid"), filters)
    assert not job_matches_filters(_job(title="Data Scientist"), filters)
    assert not job_matches_filters(_job(skills=["Java"]), filters)
    assert job_matches_filters(_job(), {"min_salary": 100000})  # unknown salary doesn't exclude
    assert not job_matches_filters(_job(salary_max=90000, salary_period="year"), {"min_salary": 100000})


# --- Refresh service --------------------------------------------------------------------

@pytest.mark.asyncio
async def test_refresh_user_keeps_choices_and_creates_alerts_once():
    now = datetime(2026, 10, 2, tzinfo=timezone.utc)
    rest = FakeRest()
    rest.tables["job_matches"] = [{"user_id": USER_ID, "job_id": "j1", "tier": "low", "score": 0.1, "saved": True}]
    rest.tables["saved_searches"] = [{
        "id": "ss1", "user_id": USER_ID, "name": "Remote", "query": "remote full stack",
        "filters": parse_search_query("remote full stack engineer"), "alerts_enabled": True,
        "last_checked_at": (now - timedelta(days=2)).isoformat(), "created_at": "2026-09-01T00:00:00+00:00",
    }]
    jobs = [_job(), _job(id="j2", title="Account Executive", skills=[]),
            _job(id="j3", first_seen_at=(now - timedelta(days=10)).isoformat())]

    summary = await refresh_user(rest, USER_ID, jobs, now)
    assert summary["matched"] == 3 and summary["new_alerts"] == 1
    j1 = next(m for m in rest.tables["job_matches"] if m["job_id"] == "j1")
    assert j1["tier"] == "strong" and j1["saved"] is True  # recomputed, choice kept
    assert [a["job_id"] for a in rest.tables["job_alerts"]] == ["j1"]

    # A second refresh doesn't alert again.
    again = await refresh_user(rest, USER_ID, jobs, now + timedelta(hours=1))
    assert again["new_alerts"] == 0 and len(rest.tables["job_alerts"]) == 1


# --- API -----------------------------------------------------------------------------------

@pytest.fixture
def client():
    rest = FakeRest()
    app.dependency_overrides[get_current_user] = lambda: AuthUser(id=USER_ID, email="sam@example.com", token="t")
    app.dependency_overrides[get_rest] = lambda: rest
    rate_limiter.reset()
    yield AsyncClient(transport=ASGITransport(app=app), base_url="http://test"), rest
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_saved_search_endpoints(client):
    http, rest = client
    preview = await http.post("/api/v1/saved-searches/parse", json={"query": "remote React developer roles"})
    assert preview.status_code == 200
    assert preview.json()["filters"]["workplace"] == ["remote"]

    created = await http.post("/api/v1/saved-searches", json={"query": "remote React developer roles"})
    assert created.status_code == 201
    row = rest.tables["saved_searches"][0]
    assert row["filters"]["roles"] == ["React Developer"] and row["name"].startswith("Remote")

    edited = await http.post("/api/v1/saved-searches", json={
        "query": "anything", "name": "Mine", "filters": {"skills": ["Go"], "workplace": ["hybrid"]}})
    assert edited.status_code == 201 and rest.tables["saved_searches"][1]["filters"]["skills"] == ["Go"]


@pytest.mark.asyncio
async def test_refresh_matches_endpoint(client):
    http, rest = client
    rest.tables["jobs"] = [{**_job(), "is_active": True, "first_seen_at": datetime.now(timezone.utc).isoformat()}]
    response = await http.post("/api/v1/jobs/refresh-matches")
    assert response.status_code == 200, response.text
    assert response.json()["by_tier"]["strong"] == 1
    assert rest.tables["job_matches"][0]["user_id"] == USER_ID
