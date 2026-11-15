import re
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient

from src.app.api.deps import get_gateway, get_rest
from src.app.core.auth import AuthUser, get_current_user
from src.app.gateway import GatewayUnavailableError
from src.app.leads import cleanup
from src.app.leads.cleanup import classify, decide, keyword_hits, parse_batch, profile_terms
from src.app.main import app
from tests.fakes import USER_ID, FakeGateway, FakeRest

PROFILE = {
    "id": str(uuid4()), "name": "Full stack", "is_active": True,
    "target_roles": ["Full Stack Developer"],
    "keywords": ["React", "Next.js", "JavaScript"],
    "excluded_keywords": ["Java", "Laravel", "PHP"],
}
TERMS = profile_terms(PROFILE, ["Node.js", "TypeScript"])


def _lead(title, description=None, status="new"):
    return {"id": str(uuid4()), "user_id": USER_ID, "title": title, "description": description or title,
            "status": status}


def test_included_keywords_outnumbering_excluded_ones_keep_the_lead():
    lead = _lead("Hiring", "We need someone who knows React, Next.js, JavaScript and Java. jobs@acme.test")
    hits = keyword_hits(lead, TERMS)
    assert sorted(hits.included) == ["JavaScript", "Next.js", "React"]
    assert hits.excluded == ["Java"]  # "Java" never matches inside "JavaScript"
    assert cleanup.keyword_verdict(lead["id"], hits) is None
    # Even if the AI calls it off-stack, the keyword rule keeps it.
    verdict = decide(lead["id"], hits, {"category": "stack_mismatch", "remove": True, "confident": True, "reason": ""})
    assert verdict.action == "keep"


@pytest.mark.parametrize("text", ["We need a Java Mobile developer", "We need a Laravel developer"])
def test_only_excluded_keywords_is_a_clear_removal_without_the_ai(text):
    lead = _lead(text)
    verdict = cleanup.keyword_verdict(lead["id"], keyword_hits(lead, TERMS))
    assert verdict.action == "remove" and verdict.category == "stack_mismatch" and verdict.decided_by == "keywords"


def test_a_term_in_both_lists_counts_as_excluded():
    terms = profile_terms({**PROFILE, "keywords": ["React", "PHP"]}, ["php"])
    assert "PHP" not in terms["included"] and "php" not in terms["included"]


def test_uncertain_and_partial_stack_calls_go_to_review():
    hits = cleanup.KeywordHits(included=["React"], excluded=["Java", "PHP"])
    unsure = decide("a", hits, {"category": "job_seeker", "remove": True, "confident": False, "reason": "Maybe."})
    assert unsure.action == "review"
    # A stack call on a post that names the user's skills is the user's call, however sure the AI is.
    stack = decide("b", hits, {"category": "stack_mismatch", "remove": True, "confident": True, "reason": "x"})
    assert stack.action == "review"
    seeker = decide("c", hits, {"category": "job_seeker", "remove": True, "confident": True, "reason": "x"})
    assert seeker.action == "remove"
    kept = decide("d", hits, {"category": "match", "remove": False, "confident": True, "reason": "Fits."})
    assert kept.action == "keep"


def test_batch_output_must_answer_every_lead():
    with pytest.raises(ValueError):
        parse_batch({"leads": [{"i": 0, "category": "match", "remove": False}]}, 2)
    parsed = parse_batch({"leads": [{"i": 0, "category": "match", "remove": True}, {"i": 1, "category": "bogus"},
                                    {"i": 7, "category": "match"}]}, 2)
    assert parsed[0]["remove"] is False  # only removal categories can remove
    assert parsed[1]["category"] == "unclear"


def _ai(verdicts_by_phrase):
    """Answers each lead in a batch by the first phrase found in its post."""
    def handler(user):
        answers = []
        for i, body in re.findall(r'<lead i="(\d+)">(.*?)</lead>', user, re.S):
            category, remove, confident = next((v for phrase, v in verdicts_by_phrase.items() if phrase in body),
                                               ("match", False, True))
            answers.append({"i": int(i), "category": category, "remove": remove, "confident": confident,
                            "reason": f"{category}."})
        return {"leads": answers}
    return handler


@pytest.mark.asyncio
async def test_classify_batches_hundreds_of_leads():
    leads = [_lead(f"Hiring a React developer #{n}") for n in range(45)]
    gateway = FakeGateway({"You clean a candidate's list": _ai({})})
    verdicts = await classify(gateway, leads, TERMS)
    assert [v.lead_id for v in verdicts] == [lead["id"] for lead in leads]
    assert all(v.action == "keep" for v in verdicts)
    assert len(gateway.calls) == 3  # 20 + 20 + 5


@pytest.mark.asyncio
async def test_a_batch_the_ai_cannot_answer_keeps_its_leads():
    class Down:
        async def generate(self, *args, **kwargs):
            raise GatewayUnavailableError("down")

    lead = _lead("Hiring a React developer")
    laravel = _lead("We need a Laravel developer")
    verdicts = await classify(Down(), [lead, laravel], TERMS)
    assert verdicts[0].action == "keep" and verdicts[0].decided_by == "none"
    assert verdicts[1].action == "remove"  # the keyword rule needs no AI


def _rest(leads):
    return FakeRest({"leads": leads, "lead_drafts": [], "targeting_profiles": [PROFILE],
                     "skills": [{"id": str(uuid4()), "name": "Node.js", "sort_order": 0}], "usage_events": [],
                     "llm_calls": []})


@pytest.mark.asyncio
async def test_cleanup_removes_confident_non_matches_and_returns_unsure_ones_for_review():
    seeker = _lead("Open to work", "We are available for Full Stack Developer opportunities. Reach me at a@b.test")
    seeker_maybe = _lead("Full stack", "I need a full stack developer role or a cofounder. a@b.test")
    laravel = _lead("We need a Laravel developer")
    react = _lead("Hiring", "We need someone who knows React, Next.js, JavaScript and Java")
    contacted_seeker = _lead("Open to work", "Available for Full Stack Developer opportunities", status="contacted")
    rest = _rest([seeker, seeker_maybe, laravel, react, contacted_seeker])
    gateway = FakeGateway({"You clean a candidate's list": _ai({
        "We are available": ("job_seeker", True, True),
        "Available for": ("job_seeker", True, True),
        "or a cofounder": ("job_seeker", True, False),
        "React, Next.js": ("stack_mismatch", True, True),
    })})
    app.dependency_overrides[get_current_user] = lambda: AuthUser(id=USER_ID, email="sam@example.com", token="t")
    app.dependency_overrides[get_rest] = lambda: rest
    app.dependency_overrides[get_gateway] = lambda: gateway
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post("/api/v1/leads/cleanup", json={
                "lead_ids": [l["id"] for l in (seeker, seeker_maybe, laravel, react, contacted_seeker)]})
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200, response.text
    body = response.json()
    by_id = {r["lead_id"]: r for r in body["results"]}
    assert by_id[seeker["id"]]["outcome"] == "removed" and by_id[seeker["id"]]["category"] == "job_seeker"
    assert by_id[laravel["id"]]["outcome"] == "removed" and by_id[laravel["id"]]["excluded_keywords"] == ["Laravel"]
    assert by_id[seeker_maybe["id"]]["outcome"] == "review"
    assert by_id[seeker_maybe["id"]]["title"] == "Full stack" and "cofounder" in by_id[seeker_maybe["id"]]["description"]
    assert by_id[react["id"]]["outcome"] == "kept" and by_id[react["id"]]["description"] is None
    # A contacted lead keeps its email history: it is offered for review, never deleted.
    assert by_id[contacted_seeker["id"]]["outcome"] == "review" and by_id[contacted_seeker["id"]]["contacted"]
    assert (body["removed"], body["review"], body["kept"], body["unchecked"]) == (2, 2, 1, 0)
    assert {l["id"] for l in rest.tables["leads"]} == {seeker_maybe["id"], react["id"], contacted_seeker["id"]}


@pytest.mark.asyncio
async def test_cleanup_limits_each_request():
    app.dependency_overrides[get_current_user] = lambda: AuthUser(id=USER_ID, email="sam@example.com", token="t")
    app.dependency_overrides[get_rest] = lambda: _rest([])
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post("/api/v1/leads/cleanup", json={"lead_ids": [str(uuid4()) for _ in range(51)]})
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 422
