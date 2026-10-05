"""
Answer engine tests: classification, retrieval, grounding prechecks, prompt,
output parsing, and saved-answer similarity. The LLM is mocked.
"""

import json
from unittest.mock import AsyncMock

import pytest

from src.app.answers.classifier import apply_field_signals, classify_question
from src.app.answers.engine import AnswerEngine
from src.app.answers.parser import fit_to_length, parse_answer
from src.app.answers.profile_context import build_context, canonicalize, fetch_profile_data
from src.app.answers.prompt import SYSTEM_PROMPT, build_user_message
from src.app.answers.similarity import MATCH_THRESHOLD, best_match, similarity
from src.app.gateway import GatewayResult
from src.app.schemas.answers import AnswerStyle, FieldContext, GenerateAnswerRequest, JobContext
from tests.fakes import FakeRest

# --- classification -----------------------------------------------------------

@pytest.mark.parametrize("question,category,intent,skills", [
    ("Why are you interested in this position?", "motivation", "motivation_role", []),
    ("Why do you want to work at Example AI?", "motivation", "motivation_company", []),
    ("Tell us about a project you're proud of.", "project", "favorite_project", []),
    ("What's the project you've enjoyed building most?", "project", "favorite_project", []),
    ("Tell us about a technically challenging project you worked on.", "project", "technical_challenge", []),
    ("Describe your experience with React.", "skill_check", "skill_experience", ["react"]),
    ("Do you have experience with Kubernetes?", "skill_check", "skill_check", ["kubernetes"]),
    ("How many years of experience do you have with Python?", "skill_check", "skill_years", ["python"]),
    ("Have you used Next.js or TypeScript in production?", "skill_check", "skill_check", ["next.js", "typescript"]),
    ("Do you have hands-on experience with AWS, Docker and CI/CD pipelines?", "skill_check", "skill_check",
     ["aws", "docker", "ci-cd pipelines"]),
    ("Do you have experience working with cross-functional teams?", "skill_check", "skill_check", []),
    ("Tell me about a time you had a conflict with a coworker.", "behavioral", "conflict", []),
    ("What are your salary expectations?", "logistics", "salary", []),
    ("Will you now or in the future require visa sponsorship?", "logistics", "sponsorship", []),
    ("What is your notice period?", "logistics", "notice_period", []),
    ("What is your greatest strength?", "strengths", "strengths", []),
    ("Tell us about yourself.", "about_me", "about_me", []),
    ("Anything else you would like us to know?", "general", "general", []),
])
def test_classify_question(question, category, intent, skills):
    analysis = classify_question(question)
    assert (analysis.category, analysis.intent, analysis.target_skills) == (category, intent, skills)


# --- retrieval & context -------------------------------------------------------

@pytest.mark.asyncio
async def test_fetches_only_needed_sections():
    rest = FakeRest()
    rest.select = AsyncMock(wraps=rest.select)
    await fetch_profile_data(rest, classify_question("What is your degree?"))
    tables = [call.args[0] for call in rest.select.await_args_list]
    assert tables == ["profiles", "education", "achievements", "profile_facts"]


@pytest.mark.asyncio
async def test_context_has_source_ids_and_detects_skills():
    rest = FakeRest()
    analysis = classify_question("Do you have experience with Next.js?")
    ctx = build_context(await fetch_profile_data(rest, analysis), analysis)
    assert "[E1] EXPERIENCE: Software Engineer at Acme Labs" in ctx.text
    assert ctx.sources["E1"].id == "e1"
    for present in ["Next.js", "nextjs", "react.js", "Postgres", "CI/CD", "ci-cd pipelines", "LLMs", "llm"]:
        assert ctx.has_skill(present), present
    for absent in ["Kubernetes", "k8s", "Rust", "AWS"]:
        assert not ctx.has_skill(absent), absent


def test_canonicalize_aliases():
    assert canonicalize("Node.js") == canonicalize("node") == "nodejs"
    assert canonicalize("K8s") == "kubernetes"
    assert canonicalize("Next.js") == canonicalize("NextJS")


@pytest.mark.asyncio
async def test_logistics_preferences_only_in_logistics_context():
    rest = FakeRest()
    analysis = classify_question("What is your notice period?")
    ctx = build_context(await fetch_profile_data(rest, analysis), analysis)
    assert "Notice period / availability: Two weeks" in ctx.text
    other = classify_question("Tell us about yourself")
    assert "Notice period" not in build_context(await fetch_profile_data(rest, other), other).text


def test_prompt_separates_job_context_from_profile():
    analysis = classify_question("Why are you interested in this role?")
    ctx = build_context(FakeRest().tables | {"profile": FakeRest().tables["profiles"][0]}, analysis)
    message = build_user_message(
        analysis, ctx,
        JobContext(company="Example AI", role="Product Engineer", description="Kubernetes required"),
        FieldContext(max_length=500, kind="textarea"),
    )
    assert "JOB CONTEXT (about the employer, not the candidate)" in message
    assert message.index("JOB CONTEXT") < message.index("CANDIDATE EVIDENCE")
    assert "at most 500 characters" in message
    assert "Candidate facts come only from CANDIDATE EVIDENCE" in SYSTEM_PROMPT


@pytest.mark.parametrize("question", [
    "Cover letter", "Please upload or paste your cover letter", "Covering letter (optional)", "Motivation letter",
    "Letter of motivation",
])
def test_classify_cover_letter(question):
    assert classify_question(question).category == "cover_letter"


def test_field_signals_make_unlimited_letter_textarea_a_cover_letter():
    letter = "Write a short letter to the hiring team"
    assert apply_field_signals(classify_question(letter), "textarea", None).category == "cover_letter"
    assert apply_field_signals(classify_question(letter), "textarea", 300).category != "cover_letter"
    assert apply_field_signals(classify_question(letter), "input", None).category != "cover_letter"


def _message(question: str, style: AnswerStyle | None = None, field: FieldContext | None = None) -> str:
    analysis = classify_question(question)
    ctx = build_context(FakeRest().tables | {"profile": FakeRest().tables["profiles"][0]}, analysis)
    return build_user_message(analysis, ctx, None, field or FieldContext(kind="textarea"), style=style)


@pytest.mark.parametrize("question,length,target", [
    ("Cover letter", "auto", "250-400 words in 3-4 paragraphs"),
    ("Why are you interested in this role?", "auto", "80-150 words"),
    ("Do you have experience with Next.js?", "auto", "40-80 words"),
    ("Cover letter", "concise", "40-80 words"),
    ("Why are you interested in this role?", "detailed", "180-300 words"),
    ("Tell us about yourself", "standard", "80-150 words"),
])
def test_length_targets(question, length, target):
    assert target in _message(question, AnswerStyle(length=length))


def test_max_length_beats_length_target():
    message = _message("Cover letter", AnswerStyle(length="detailed"), FieldContext(kind="textarea", max_length=300))
    assert "never more than 300 characters (roughly 50 words); the limit wins" in message


def test_single_line_fields_get_no_word_target():
    assert "Length:" not in _message("Why this role?", AnswerStyle(length="detailed"), FieldContext(kind="input"))


@pytest.mark.parametrize("tone", ["professional", "friendly", "enthusiastic", "confident", "formal", "technical"])
def test_tone_never_outranks_grounding(tone):
    message = _message("Why are you interested in this role?", AnswerStyle(tone=tone))
    assert f"Tone: {tone}:" in message
    assert "STYLE (wording only; the grounding rules still apply)" in message
    # Grounding lives in the system prompt and explicitly wins over style.
    assert "Grounding (always wins over STYLE)" in SYSTEM_PROMPT
    assert "Never add a fact to sound more enthusiastic, confident or detailed" in SYSTEM_PROMPT


def test_style_instruction_on_generate_and_regenerate():
    assert "CANDIDATE'S INSTRUCTION" in _message("Tell us about yourself", AnswerStyle(instruction="mention open source"))
    analysis = classify_question("Tell us about yourself")
    ctx = build_context(FakeRest().tables | {"profile": FakeRest().tables["profiles"][0]}, analysis)
    regen = build_user_message(analysis, ctx, None, None, previous_answer="Old.", style=AnswerStyle(instruction="shorter"))
    assert "The candidate asked: shorter" in regen and "CANDIDATE'S INSTRUCTION" not in regen


# --- parsing ------------------------------------------------------------------

def test_parse_answer_handles_fences_and_unknown_sources():
    sources = {"E1": object(), "P1": object()}
    text = '```json\n{"status": "answered", "answer": "I built it.", "confidence": "HIGH", "usedSources": ["E1", "X9", "[P1]"]}\n```'
    parsed = parse_answer(text, sources)
    assert (parsed.status, parsed.answer, parsed.confidence, parsed.used_refs) == ("answered", "I built it.", "high", ["E1", "P1"])


def test_parse_answer_extracts_json_from_prose():
    parsed = parse_answer('Sure! {"status": "insufficient_information", "answer": "ignored", "missingInformation": "Add X"}', {})
    assert (parsed.status, parsed.answer, parsed.missing_information) == ("insufficient_information", "", "Add X")


@pytest.mark.parametrize("bad", ["no json here", '{"status": "maybe", "answer": "x"}', '{"status": "answered", "answer": ""}', "[1, 2]"])
def test_parse_answer_rejects_invalid_output(bad):
    with pytest.raises(ValueError):
        parse_answer(bad, {})


def test_fit_to_length_cuts_at_sentence():
    text = "First sentence here. Second sentence is longer and will not fit."
    assert fit_to_length(text, 30) == "First sentence here."
    assert fit_to_length(text, 1000) == text


# --- engine -------------------------------------------------------------------

def _gateway_returning(payload: dict) -> AsyncMock:
    gateway = AsyncMock()

    async def generate(system, messages, temperature=None, max_tokens=None, validate=None, stage=None, items=1):
        text = json.dumps(payload)
        return GatewayResult(text=text, value=validate(text), provider="Mock", model="mock-1", usage={})

    gateway.generate = AsyncMock(side_effect=generate)
    return gateway


@pytest.mark.asyncio
async def test_engine_answers_with_resolved_sources():
    gateway = _gateway_returning({"status": "answered", "answer": "I built TaskFlow...", "confidence": "high",
                                  "usedSources": ["P1", "E1"], "missingInformation": None})
    response = await AnswerEngine(gateway).answer(FakeRest(), GenerateAnswerRequest(question="Tell us about a project you're proud of."))
    assert response.status == "answered"
    assert [(s.type, s.id, s.label) for s in response.used_sources] == [
        ("project", "p1", "TaskFlow"), ("experience", "e1", "Software Engineer at Acme Labs")]
    assert (response.category, response.provider) == ("project", "Mock")


@pytest.mark.asyncio
async def test_engine_refuses_skill_not_in_profile_without_calling_llm():
    gateway = _gateway_returning({})
    response = await AnswerEngine(gateway).answer(FakeRest(), GenerateAnswerRequest(question="Do you have experience with Kubernetes?"))
    assert response.status == "insufficient_information"
    assert "Kubernetes".lower() in response.missing_information.lower()
    gateway.generate.assert_not_awaited()


@pytest.mark.asyncio
async def test_engine_flags_partially_missing_skills_to_model():
    gateway = _gateway_returning({"status": "answered", "answer": "Yes, TypeScript...", "confidence": "medium", "usedSources": []})
    await AnswerEngine(gateway).answer(FakeRest(), GenerateAnswerRequest(question="Have you used TypeScript or Rust?"))
    message = gateway.generate.await_args.kwargs["messages"][0]["content"]
    assert "NOT IN THE PROFILE: rust" in message


@pytest.mark.asyncio
async def test_engine_logistics_needs_profile_field():
    gateway = _gateway_returning({"status": "answered", "answer": "Two weeks.", "confidence": "high", "usedSources": ["PR"]})
    engine = AnswerEngine(gateway)
    salary = await engine.answer(FakeRest(), GenerateAnswerRequest(question="What are your salary expectations?"))
    assert salary.status == "insufficient_information" and "salary" in salary.missing_information
    notice = await engine.answer(FakeRest(), GenerateAnswerRequest(question="What is your notice period?"))
    assert notice.status == "answered"


@pytest.mark.asyncio
async def test_engine_empty_profile():
    rest = FakeRest({"profiles": [{"id": "u", "summary": None, "links": {}}]})
    response = await AnswerEngine(_gateway_returning({})).answer(rest, GenerateAnswerRequest(question="Tell us about yourself"))
    assert response.status == "insufficient_information"


@pytest.mark.asyncio
async def test_engine_regenerate_includes_previous_answer():
    gateway = _gateway_returning({"status": "answered", "answer": "New take.", "confidence": "high", "usedSources": []})
    await AnswerEngine(gateway).answer(
        FakeRest(), GenerateAnswerRequest(question="Tell us about yourself"),
        previous_answer="Old take.", instruction="shorter")
    kwargs = gateway.generate.await_args.kwargs
    assert "PREVIOUS ANSWER" in kwargs["messages"][0]["content"] and "shorter" in kwargs["messages"][0]["content"]


@pytest.mark.asyncio
async def test_engine_passes_style_and_detects_cover_letter_fields():
    gateway = _gateway_returning({"status": "answered", "answer": "Letter.", "confidence": "high", "usedSources": []})
    response = await AnswerEngine(gateway).answer(FakeRest(), GenerateAnswerRequest(
        question="Write a letter to the team", field=FieldContext(kind="textarea"), style=AnswerStyle(tone="formal")))
    message = gateway.generate.await_args.kwargs["messages"][0]["content"]
    assert response.category == "cover_letter"
    assert "250-400 words" in message and "Tone: formal:" in message


# --- similarity ---------------------------------------------------------------

@pytest.mark.parametrize("a,b,similar", [
    ("Tell us about a project you're proud of.", "What's the project you've enjoyed building most?", True),
    ("Why are you interested in this role?", "What excites you about this position?", True),
    ("What is your greatest strength?", "What are your strengths?", True),
    ("Do you have experience with React?", "Do you have experience with Kubernetes?", False),
    ("Why are you interested in this role?", "Tell us about a project you are proud of", False),
    ("Tell us about a project you are proud of", "Describe a situation where you had a conflict", False),
])
def test_similarity(a, b, similar):
    assert (similarity(a, b) >= MATCH_THRESHOLD) is similar


def test_best_match_picks_highest():
    saved = [{"question": "Why do you want this job?", "id": 1},
             {"question": "Tell us about a project you're proud of", "id": 2}]
    match, score = best_match("Which project are you most proud of?", saved)
    assert match["id"] == 2 and score >= MATCH_THRESHOLD
    assert best_match("What are your salary expectations?", saved)[0] is None


@pytest.mark.asyncio
async def test_additional_context_is_part_of_every_answer_and_counts_as_evidence():
    rest = FakeRest()
    rest.tables["profiles"][0]["additional_context"] = (
        "I want platform engineering roles. At Acme Labs I owned our Kubernetes deploys and mentored two juniors."
    )
    analysis = classify_question("Do you have experience with Kubernetes?")
    ctx = build_context(await fetch_profile_data(rest, analysis), analysis)
    assert "More about the candidate: I want platform engineering roles." in ctx.text
    assert ctx.has_skill("Kubernetes")  # The skill precheck sees it, so the answer isn't refused.

    about = classify_question("Tell us about yourself")
    assert "mentored two juniors" in build_context(await fetch_profile_data(rest, about), about).text


def test_additional_context_alone_is_not_an_empty_profile():
    profile = {"id": "u", "summary": None, "links": {}, "additional_context": "Ten years in retail banking operations."}
    ctx = build_context({"profile": profile}, classify_question("Tell us about yourself"))
    assert ctx.is_empty is False


def test_projects_are_in_the_context_for_most_questions():
    analysis = classify_question("Tell us about a project you are proud of")
    ctx = build_context(FakeRest().tables | {"profile": FakeRest().tables["profiles"][0]}, analysis)
    assert "PROJECT: TaskFlow" in ctx.text and "300 GitHub stars" in ctx.text


def _cover_letter_profile():
    """Eight projects; the AI one is last in the profile's own order, past the usual cut-off."""
    filler = [{"id": f"p{i}", "name": f"Weekend game {i}", "description": "A small browser game built for fun.",
               "highlights": [], "technologies": ["Canvas"]} for i in range(1, 7)]
    return {
        "profile": {"id": "u", "summary": "Engineer.", "links": {}},
        "experiences": [
            {"id": "e1", "company": "Retail Co", "title": "Support Engineer", "description": "Handled customer escalations.",
             "highlights": [], "technologies": []},
            {"id": "e2", "company": "Acme Labs", "title": "Software Engineer",
             "description": "Full stack development of the customer dashboard: React frontend and Node.js APIs.",
             "highlights": [], "technologies": ["React", "Node.js", "PostgreSQL"]},
        ],
        "projects": filler + [
            {"id": "p7", "name": "OpenForms", "description": "Open source full-stack form builder I maintain, with 40 contributors.",
             "highlights": [], "technologies": ["Next.js", "TypeScript"]},
            {"id": "p8", "name": "DocChat", "description": "RAG assistant that answers questions over PDFs using large language models.",
             "highlights": [], "technologies": ["Python", "LangChain", "OpenAI"]},
        ],
        "skills": [], "education": [], "achievements": [],
    }


def _order(ctx, kind):
    return [line.split(": ", 1)[1].split(" (")[0].split(" — ")[0]
            for line in ctx.text.splitlines() if line.split("] ", 1)[-1].startswith(kind + ":")]


def test_cover_letter_leads_with_ai_projects_for_an_ai_job():
    job = "Machine Learning Engineer. You will build LLM features: RAG pipelines, prompt evaluation, Python services."
    ctx = build_context(_cover_letter_profile(), classify_question("Cover letter"), job_text=job)
    assert _order(ctx, "PROJECT")[0] == "DocChat"
    assert "most relevant to this job first" in ctx.text


def test_cover_letter_leads_with_full_stack_and_open_source_work_for_a_full_stack_job():
    job = "Full Stack Engineer: React and Node.js across the stack. Open source contributions are a plus."
    ctx = build_context(_cover_letter_profile(), classify_question("Cover letter"), job_text=job)
    assert _order(ctx, "EXPERIENCE")[0].startswith("Software Engineer at Acme Labs")
    assert _order(ctx, "PROJECT")[0] == "OpenForms"


def test_without_a_job_the_profile_order_is_kept():
    ctx = build_context(_cover_letter_profile(), classify_question("Cover letter"))
    assert _order(ctx, "PROJECT")[0] == "Weekend game 1"
    assert "most relevant" not in ctx.text
    # Nothing in the question or a job says which work matters: a cover letter gets a bounded sample, not all 8.
    assert 1 <= len(_order(ctx, "PROJECT")) <= 6


def test_cover_letter_guidance_maps_job_needs_to_real_work():
    analysis = classify_question("Cover letter")
    ctx = build_context(_cover_letter_profile(), analysis)
    message = build_user_message(analysis, ctx, JobContext(company="X", role="ML Engineer", description="LLM work"), None)
    assert "main needs in the JOB CONTEXT" in message and "AI projects for AI needs" in message
    assert "open-source projects for full-stack needs" in message


@pytest.mark.parametrize("text,expected", [
    ("I built the API — then shipped it.", "I built the API, then shipped it."),
    ("Python—and Go—daily.", "Python, and Go, daily."),
    ("From 2019–2021 I led it.", "From 2019-2021 I led it."),
    ("It worked well —.", "It worked well."),
    ("No dashes here.", "No dashes here."),
])
def test_strip_dashes(text, expected):
    from src.app.answers.parser import strip_dashes
    assert strip_dashes(text) == expected
