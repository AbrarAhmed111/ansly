"""
Token reduction: zero-token structured answers, the job description digest,
budgeted profile and evidence selection, per-stage token logging and budgets,
and a regression guard on the benchmark's prompt sizes.
"""

import json
from unittest.mock import AsyncMock

import pytest

from src.app.answers.classifier import classify_question
from src.app.answers.engine import AnswerEngine
from src.app.answers.job_digest import digest, strip_boilerplate
from src.app.answers.lookup import authorized_in_asked_country, degree_level, highest_degree_option, skill_years
from src.app.answers.profile_context import build_context
from src.app.core import metrics, token_budget
from src.app.gateway import GatewayResult
from src.app.gateway.deployment import ProviderDeployment
from src.app.gateway.gateway import LLMGateway
from src.app.resume.matching.evidence import build_corpus
from src.app.resume.matching.match import _evidence_prompt as matching_evidence
from src.app.resume.matching.select import distinct, select_evidence
from src.app.resume.tailoring.plan import _evidence_prompt as plan_evidence
from src.app.resume.tailoring.plan import generate_plan
from src.app.schemas.answers import FieldContext, GenerateAnswerRequest
from src.app.schemas.job import JobRequirement
from src.app.schemas.matching import Evidence
from tests import tailoring_data
from tests.fakes import FakeGateway, FakeRest

YES_NO = ["Yes", "No"]


def _no_model_engine():
    gateway = AsyncMock()
    gateway.generate.side_effect = AssertionError("the model must not be called")
    return AnswerEngine(gateway)


async def _answer(rest, question, kind, options=None):
    engine = _no_model_engine()
    request = GenerateAnswerRequest(question=question, field=FieldContext(kind=kind, options=options))
    return await engine.answer(rest, request)


# --- zero-token structured answers ----------------------------------------------

@pytest.mark.parametrize("question,value,expected", [
    ("Are you legally authorized to work in the United States?", "US citizen", True),
    ("Are you legally authorized to work in the US?", "Green card holder (United States)", True),
    ("Are you authorized to work in Canada?", "Canadian permanent resident", True),
    ("Are you authorized to work for us?", "US citizen", False),            # no country asked: model decides
    ("Are you authorized to work in the UK?", "US citizen", False),         # different country
    ("Are you authorized to work in the US?", "H-1B, need sponsorship", False),
    ("Are you authorized to work in the US?", "Applying for a green card", False),
    ("Are you authorized to work in the US?", None, False),
])
def test_work_authorization_lookup_is_conservative(question, value, expected):
    assert authorized_in_asked_country(question, value) is expected


@pytest.mark.asyncio
async def test_authorization_choice_needs_no_model():
    rest = FakeRest()
    rest.tables["profiles"][0]["work_authorization"] = "US citizen"
    result = await _answer(rest, "Are you legally authorized to work in the United States?", "choice_single", YES_NO)
    assert result.answer == "Yes" and result.provider is None


@pytest.mark.asyncio
async def test_listed_skill_yes_no_and_years_need_no_model():
    rest = FakeRest()
    yes = await _answer(rest, "Do you have experience with React?", "choice_single", YES_NO)
    years = await _answer(rest, "How many years of experience do you have with React?", "number")
    assert (yes.answer, years.answer) == ("Yes", "4")
    assert yes.provider is None and years.provider is None


@pytest.mark.asyncio
async def test_years_without_a_stored_number_still_go_to_the_model():
    rest = FakeRest()  # Python is listed without years
    engine = AnswerEngine(AsyncMock())
    engine.gateway.generate.return_value = GatewayResult(text="", value=None, provider="Mock", model="m", usage={})
    with pytest.raises(Exception):
        await engine.answer(rest, GenerateAnswerRequest(question="How many years of experience do you have with Python?",
                                                        field=FieldContext(kind="number")))
    engine.gateway.generate.assert_awaited_once()


@pytest.mark.asyncio
async def test_highest_degree_choice_needs_no_model():
    rest = FakeRest()
    result = await _answer(rest, "What is the highest level of education you have completed?", "choice_single",
                           ["High school", "Bachelor's degree", "Master's degree", "PhD"])
    assert result.answer == "Bachelor's degree"
    assert result.used_sources[0].type == "education" and result.used_sources[0].id == "ed1"


@pytest.mark.parametrize("degree,level", [("B.S.", 3), ("BSc", 3), ("M.S.", 4), ("MBA", 4), ("PhD", 5),
                                          ("Certificate", None), ("Mathematics", None)])
def test_degree_levels(degree, level):
    assert degree_level(degree) == level


def test_highest_degree_ambiguous_options_defer_to_the_model():
    rows = [{"id": "e", "degree": "M.S."}]
    assert highest_degree_option(rows, ["Master's degree", "MSc or MA"]) is None
    assert highest_degree_option([{"degree": "Certificate"}], ["Master's degree"]) is None


def test_skill_years_needs_one_exact_row_with_years():
    rows = [{"name": "React", "years": 4, "level": "expert"}, {"name": "Python", "years": None}]
    assert skill_years(rows, "reactjs") == "4"
    assert skill_years(rows, "python") is None
    assert skill_years([{"name": "Go", "years": 2, "level": "none"}], "go") is None


@pytest.mark.asyncio
async def test_work_arrangement_question_is_logistics():
    analysis = classify_question("Which work arrangement do you prefer?")
    assert (analysis.category, analysis.intent) == ("logistics", "work_mode")
    result = await _answer(FakeRest(), "Which work arrangement do you prefer?", "choice_single",
                           ["Remote", "Hybrid", "On-site"])
    assert result.answer == "Remote"


# --- job description digest ------------------------------------------------------

JOB = """About Acme
Acme builds billing software for clinics.

What you'll do
- Build React and TypeScript features
- Own Python services and PostgreSQL data models

Requirements
- 5+ years of software engineering
- Experience with Kubernetes

Benefits
Health insurance, 401(k) matching and a home office stipend.
Competitive salary
Unlimited PTO.

Interview process
1. Recruiter call
2. Technical interview

We are an equal opportunity employer."""


def test_boilerplate_sections_are_stripped():
    cleaned = strip_boilerplate(JOB)
    assert "401(k)" not in cleaned and "Recruiter call" not in cleaned and "equal opportunity" not in cleaned
    assert "Kubernetes" in cleaned and "Acme builds billing software" in cleaned


def test_competitive_salary_line_never_drops_requirements():
    text = "Requirements\n- Python\nCompetitive salary\n- PostgreSQL\n- Docker"
    assert "PostgreSQL" in strip_boilerplate(text)


def test_digest_keeps_relevant_lines_within_budget():
    out = digest(JOB, 160, "Do you have Kubernetes experience?")
    assert len(out) <= 200 and "Kubernetes" in out


def test_digest_of_one_unbroken_block_is_not_empty():
    assert digest("x" * 5000, 300) == "x" * 300


def test_digest_passes_a_short_posting_through():
    assert digest("Build APIs in Python.", 1000, "anything") == "Build APIs in Python."


# --- budgeted profile context ------------------------------------------------------

def _big_profile():
    rows = {"profile": {"id": "u", "summary": "Engineer."}, "skills": [], "education": [], "achievements": []}
    rows["experiences"] = [{"id": f"e{i}", "title": "Engineer", "company": f"Company {i}",
                            "description": f"Built system number {i}. " + "Long detail. " * 40,
                            "highlights": [], "technologies": []} for i in range(6)]
    rows["projects"] = []
    rows["profile_facts"] = [
        {"id": "f1", "category": "conflict", "prompt": "Describe a disagreement with a teammate",
         "answer": "We disagreed about a rewrite and ran a spike."},
        *[{"id": f"x{i}", "category": "general", "prompt": f"Unrelated fact {i}", "answer": "Lorem ipsum. " * 30}
          for i in range(10)],
        {"id": "f9", "category": "general", "prompt": "Tools", "answer": "I have used Elixir at work."},
    ]
    return rows


DISAGREE = "Tell me about a time you disagreed with a teammate."


def test_only_evidence_for_the_question_is_sent():
    rows = _big_profile()
    rows["profile_facts"].append({"id": "f2", "category": "conflict", "prompt": "Pushback on a design",
                                  "answer": "I disagreed with a teammate's caching design and we benchmarked both."})
    ctx = build_context(rows, classify_question(DISAGREE))
    assert not ctx.low_confidence
    assert "disagreed about a rewrite" in ctx.text and "benchmarked both" in ctx.text
    # Two records clearly answer it: no section gets a row just because it exists.
    assert "EXPERIENCE:" not in ctx.text and "Unrelated fact" not in ctx.text


def test_low_confidence_adds_more_evidence_within_bounds():
    ctx = build_context(_big_profile(), classify_question(DISAGREE))
    assert ctx.low_confidence  # one clear record: the engine may try semantic retrieval
    assert "disagreed about a rewrite" in ctx.text
    records = [line for line in ctx.text.splitlines() if line.startswith("[") and not line.startswith("[PR]")]
    assert 2 <= len(records) <= 4


def test_evidence_stops_at_the_budget_but_keeps_the_best_record():
    ctx = build_context(_big_profile(), classify_question(DISAGREE), budget_chars=300)
    records = [line for line in ctx.text.splitlines() if line.startswith("[") and not line.startswith("[PR]")]
    assert len(records) == 1 and "disagreed about a rewrite" in records[0]


def test_semantic_hits_are_boosted_into_the_evidence():
    ctx = build_context(_big_profile(), classify_question(DISAGREE), boost={"e4": 5.0})
    # The boosted row ranks first among the records (right after the candidate line).
    assert "Company 4" in ctx.text.splitlines()[1]


def test_skill_presence_still_reads_every_fact():
    ctx = build_context(_big_profile(), classify_question(DISAGREE))
    assert "Elixir" not in ctx.text  # the fact isn't shown for this question...
    assert ctx.has_skill("Elixir")    # ...but still counts as evidence of the skill


# --- evidence selection ------------------------------------------------------------

def test_resume_lines_repeating_a_shown_profile_row_are_dropped():
    items = [Evidence(id="E1", source="experience", source_id="e1", label="Dev at X",
                      text="Built the billing API. Cut costs by 20% with caching."),
             Evidence(id="R:exp_1_b1", source="resume", source_id="exp_1_b1", label="Dev at X",
                      text="Cut costs by 20% with caching."),
             Evidence(id="R:exp_1_b2", source="resume", source_id="exp_1_b2", label="Dev at X",
                      text="Mentored two interns on testing.")]
    assert [e.id for e in distinct(items)] == ["E1", "R:exp_1_b2"]


def test_selection_respects_the_budget_and_puts_must_first():
    corpus = build_corpus(tailoring_data.profile_rows(), tailoring_data.master())
    chosen = select_evidence(corpus, ["PostgreSQL indexes"], 400, must=["E2"])
    assert "E2" in [e.id for e in chosen]
    assert sum(len(f"[{e.id}] {e.label}: {e.text}") for e in chosen) <= 600


def test_years_requirement_sees_every_dated_role():
    corpus = build_corpus(tailoring_data.profile_rows(), tailoring_data.master())
    req = JobRequirement(id="req_1", requirement="5+ years of professional experience", type="experience")
    text = matching_evidence(corpus, [(req, "must_have")])
    assert "[E1]" in text and "[E2]" in text


def test_plan_evidence_leaves_out_what_the_resume_already_says():
    rows = tailoring_data.profile_rows()
    # E1's highlight is now a resume bullet word for word; its description isn't in the resume.
    rows["experiences"][0]["highlights"] = ["Reduced API response times by 35% by adding PostgreSQL indexes and query caching."]
    corpus = build_corpus(rows, tailoring_data.master())
    text = plan_evidence(tailoring_data.analysis(), [], tailoring_data.master(), corpus)
    assert "[R:" not in text
    assert "Reduced API response times" not in text and "billing dashboard" in text


@pytest.mark.asyncio
async def test_plan_citation_without_r_prefix_is_resolved():
    corpus = build_corpus(tailoring_data.profile_rows(), tailoring_data.master())
    gateway = FakeGateway({"tailor a candidate's resume": lambda user: {"changes": [
        {"section": "experience", "item": "exp_1", "action": "rewrite_bullet", "bulletId": "exp_1_b1",
         "text": "Built SaaS web applications using React and Node.js.", "evidenceIds": ["exp_1_b1", "E1"],
         "reason": "r"}]}})
    plan = await generate_plan(gateway, tailoring_data.analysis(), [], tailoring_data.master(), corpus)
    assert plan.changes[0].evidence_ids == ["R:exp_1_b1", "E1"]


# --- per-stage logging, budgets and effort --------------------------------------

def test_over_budget_reports_input_and_output():
    assert token_budget.over_budget("answer", 100, 100) == ""
    assert "input_tokens=5000" in token_budget.over_budget("answer", 5000, 10)
    # Batches scale with the number of questions.
    assert token_budget.over_budget("answer_batch", 2500, 900, items=5) == ""
    assert "input_tokens=2000" in token_budget.over_budget("answer", 2000, 10)          # normal answer: 1,500
    assert token_budget.over_budget("answer_complex", 2000, 10) == ""                  # cover letter: 2,500


@pytest.mark.parametrize("stage,configured,expected", [
    ("job_analysis", "medium", "low"), ("tailoring_plan", "medium", "medium"),
    ("answer", "high", "high"), ("matching", "low", "low"), ("matching", "weird", "weird"),
])
def test_effort_for_stage_never_exceeds_the_configured_effort(stage, configured, expected):
    assert token_budget.effort_for(stage, configured) == expected


@pytest.mark.asyncio
async def test_gateway_records_tokens_per_stage(caplog):
    deployment = ProviderDeployment(name="Mock", provider="openai", api_key="k", base_url=None, default_model="m",
                                    kind="openai_compatible", cooldown_seconds=60)
    gateway = LLMGateway(deployments=[deployment])
    from src.app.gateway.adapters import Completion

    gateway._complete = AsyncMock(return_value=Completion(text="ok", usage={"prompt_tokens": 4000,
                                                                              "completion_tokens": 50}))
    request_metrics = metrics.start_request()
    with caplog.at_level("INFO", logger="tokens"):
        await gateway.generate("sys", [{"role": "user", "content": "q"}], stage="answer")
    assert request_metrics.stage_tokens["answer"] == 4050
    assert "llm_call stage=answer" in caplog.text and "token_budget_exceeded stage=answer" in caplog.text
    assert "tokens.answer=4050" in request_metrics.summary("/x", 200)


# --- benchmark regression guard ------------------------------------------------------

@pytest.mark.asyncio
async def test_benchmark_prompt_sizes_stay_down():
    """Fails when a change makes the benchmark's prompts grow back (estimated tokens; see scripts/benchmark_tokens)."""
    from scripts.benchmark_tokens import run_scenarios, summarize

    summary = summarize(await run_scenarios())
    assert summary["A"]["llm_calls"] == 0                 # factual questions need no model
    assert summary["B"]["total_tokens"] < 6000
    assert summary["C"]["total_tokens"] < 15000
    assert summary["D"]["total_tokens"] < 13000           # tailoring + answers for one job
    assert summary["D2"]["total_tokens"] < 4500           # the same job again: cached analysis and matches
    for call in summary["D"]["calls"]:
        assert "candidate evidence" not in call["sections"] or call["sections"]["candidate evidence"] < 1800
    assert json.dumps(summary)  # serializable for --json
