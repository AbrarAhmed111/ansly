"""
Tailoring engine: job analysis, evidence-backed matching, the plan executor,
validation (including an adversarial set), and added bullets. The Word
document side is in test_docx_tailoring.py.
"""

import pytest

from src.app.resume.analysis.analyze import description_too_short, to_analysis
from src.app.resume.matching.evidence import build_corpus
from src.app.resume.matching.match import match_requirements, summarize
from src.app.resume.tailoring.apply import apply_plan
from src.app.resume.tailoring.changes import summarize_changes, text_diffs
from src.app.resume.tailoring.plan import parse_plan
from src.app.resume.validation.validate import user_warnings, validate
from src.app.schemas.job import JobPosting
from src.app.schemas.resume import ResumeProject
from tests.fakes import FakeGateway
from tests.tailoring_data import ADVERSARIAL_PLAN, HONEST_PLAN, analysis, master, profile_rows, semantic_answer


def corpus():
    return build_corpus(profile_rows(), master())


# -- job analysis -------------------------------------------------------------------


def test_analysis_assigns_ids_and_dedupes():
    job = JobPosting(title="Engineer", company="X", description="d" * 300, source="manual")
    result = to_analysis({
        "role": "Engineer",
        "mustHave": [{"requirement": "React", "type": "skill"}, {"requirement": "react", "type": "skill"},
                     "Communication", {"requirement": "Go", "type": "bogus"}],
        "niceToHave": [{"requirement": "React", "type": "skill"}, {"requirement": "AWS", "type": "skill"}],
        "minYearsExperience": 5,
    }, job)
    assert [(r.id, r.requirement, r.type) for r in result.must_have] == [
        ("req_1", "React", "skill"), ("req_2", "Communication", "other"), ("req_3", "Go", "other")]
    assert [r.requirement for r in result.nice_to_have] == ["AWS"]
    assert result.company == "X" and result.min_years_experience == 5
    with pytest.raises(ValueError):
        to_analysis({"mustHave": [], "niceToHave": []}, job)


def test_minimum_description_guard():
    assert description_too_short("Senior engineer. Apply now.")
    assert not description_too_short("We are hiring. " * 20)


# -- matching -------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_skills_are_matched_deterministically_and_unsupported_ones_are_none():
    gateway = FakeGateway({"You check a candidate's evidence": semantic_answer})
    c = corpus()
    matches = {m.requirement: m for m in await match_requirements(gateway, analysis(), c)}

    assert matches["React"].support == "strong" and matches["React"].method == "deterministic"
    assert matches["Kubernetes"].support == "none"
    assert "don't have" in matches["Kubernetes"].note
    assert matches["AWS EKS"].support == "none"
    assert matches["AWS Certified Solutions Architect"].support == "none"
    # Docker is only listed as a skill, never shown in work.
    assert matches["Docker"].support == "partial"
    # The model is never asked about skills or certifications.
    assert len(gateway.calls) == 1

    # Semantic: cited evidence must exist; an uncited claim is rejected.
    assert matches["Building SaaS platforms"].support == "strong"
    assert matches["Building SaaS platforms"].evidence_ids == ["E1"]
    assert matches["5+ years of professional experience"].support == "none"
    for m in matches.values():
        assert all(c.has(i) for i in m.evidence_ids)
        assert (m.support == "none") == (not m.evidence_ids)

    assert summarize(list(matches.values())).model_dump() == {"analyzed": 8, "supported": 3, "partial": 1, "unsupported": 4}


@pytest.mark.asyncio
async def test_kubernetes_is_none_even_if_the_model_claims_it():
    def liar(user):
        return {"matches": [{"requirementId": "req_3", "support": "strong", "evidenceIds": ["E1"]}]}

    matches = await match_requirements(FakeGateway({"You check a candidate's evidence": liar}), analysis(), corpus())
    assert next(m for m in matches if m.requirement == "Kubernetes").support == "none"


def test_declined_skills_are_never_evidence():
    c = corpus()
    assert not c.has_term("Kubernetes")
    assert c.ids_with_term("Kubernetes") == []
    assert c.has_term("Postgres")  # V1 aliases: Postgres == PostgreSQL


# -- plan executor -------------------------------------------------------------------


def test_honest_plan_is_applied_in_code_and_master_is_untouched():
    source = master()
    before = source.model_copy(deep=True)
    result = apply_plan(source, parse_plan(HONEST_PLAN), corpus())
    assert source == before
    assert not result.rejected
    r = result.resume
    assert r.experience[0].bullets[0].text.startswith("Built SaaS web applications")
    assert r.projects[0].id == "proj_1"
    assert r.skills[0].items[:2] == ["Docker", "TypeScript"] or r.skills[0].items[0] == "TypeScript"
    assert r.summary.startswith("Full stack engineer building SaaS")


def test_executor_rejects_changes_that_do_not_fit():
    plan = parse_plan({"changes": [
        {"section": "experience", "item": "exp_2", "action": "reduce", "reason": "x"},
        {"section": "experience", "item": "nope", "action": "rewrite_bullet", "bulletId": "b", "text": "t"},
        {"section": "projects", "item": "proj_1", "action": "select", "values": ["missing"]},
        {"section": "skills", "action": "emphasize", "values": ["Kubernetes"]},
        {"section": "experience", "action": "teleport"},
    ]})
    result = apply_plan(master(), plan, corpus())
    assert len(result.rejected) == 4  # "teleport" never parses
    assert len(result.resume.experience) == 2
    assert "Kubernetes" not in {s for g in result.resume.skills for s in g.items}


# -- validation: the adversarial set ---------------------------------------------------


def run_adversarial():
    source = master()
    c = corpus()
    applied = apply_plan(source, parse_plan(ADVERSARIAL_PLAN), c)
    # Simulate a buggy step that also edits protected fields and invents a project.
    tailored = applied.resume.model_copy(deep=True)
    tailored.experience[0].title = "Senior Software Engineer"
    tailored.experience[0].start_date = "Jan 2018"
    tailored.contact.email = "someone-else@example.com"
    tailored.projects.append(ResumeProject(id="proj_99", name="Kubernetes Operator", bullets=[], technologies=[]))
    return source, validate(source, tailored, applied.applied, c, analysis(), applied.rejected)


def test_no_fabrication_survives_validation():
    source, result = run_adversarial()
    r = result.resume
    text = r.model_dump_json()
    assert "40%" not in text
    assert "Kubernetes" not in text and "EKS" not in text
    assert "Certified" not in text
    assert "12 engineers" not in text and "8 years" not in text
    assert "Owned the data platform" not in text
    assert "high-traffic" not in text
    # Protected fields and contact are the master's.
    assert r.experience[0].title == "Software Engineer"
    assert r.experience[0].start_date == "Mar 2022"
    assert r.contact == source.contact
    assert [p.id for p in r.projects] == ["proj_1"]
    assert len(r.experience) == 2
    # The honest summary sentence survives; the fabricated ones are gone.
    assert r.summary == "Full stack engineer building SaaS web applications with React and TypeScript."
    # A skill dropped without a reason is restored.
    assert "Python" in {s for g in r.skills for s in g.items}


def test_every_reverted_change_is_reported():
    _, result = run_adversarial()
    checks = {i.check for i in result.issues}
    assert {"metrics", "unsupported_technology", "traceability", "protected_fields", "keyword_integrity"} <= checks
    warnings = user_warnings(result.issues)
    assert any("metric" in w for w in warnings)
    assert any("technolog" in w for w in warnings)
    assert all("Skipped a suggested change" not in w for w in warnings)


def test_honest_changes_pass_validation_and_are_summarized():
    source = master()
    c = corpus()
    applied = apply_plan(source, parse_plan(HONEST_PLAN), c)
    result = validate(source, applied.resume, applied.applied, c, analysis(), applied.rejected)
    assert not result.issues, [i.message for i in result.issues]
    labels = [ch.label for ch in summarize_changes(source, result.resume, result.applied)]
    assert "1 experience bullet rewritten" in labels
    assert "Summary updated" in labels
    assert any(label.endswith("emphasized") for label in labels)
    diffs = text_diffs(source, result.resume, result.applied, c)
    assert {d.item_label for d in diffs} == {"Summary", "Software Engineer at Northwind Labs"}
    assert all(d.evidence_labels for d in diffs)


def test_existing_metrics_may_be_kept():
    source = master()
    c = corpus()
    plan = parse_plan({"changes": [{
        "section": "experience", "item": "exp_1", "action": "rewrite_bullet", "bulletId": "exp_1_b2",
        "text": "Cut API response times by 35% through PostgreSQL indexing and query caching.",
        "evidenceIds": ["R:exp_1_b2"], "reason": "Performance",
    }]})
    applied = apply_plan(source, plan, c)
    result = validate(source, applied.resume, applied.applied, c, analysis())
    assert not result.issues
    assert "35%" in result.resume.experience[0].bullets[1].text


# -- added bullets -------------------------------------------------------------------------


def add(text, item="exp_1", evidence=("E1",), section="experience"):
    return {"section": section, "item": item, "action": "add_bullet", "text": text, "evidenceIds": list(evidence),
            "reason": "Requirement with no bullet"}


def run_plan(changes):
    source, c = master(), corpus()
    applied = apply_plan(source, parse_plan({"changes": changes}), c)
    return source, c, applied, validate(source, applied.resume, applied.applied, c, analysis(), applied.rejected)


def test_supported_bullet_is_added_after_validation_and_summarized():
    text = "Built the SaaS billing dashboard and REST APIs for 200 business customers."
    source, c, applied, result = run_plan([add(text)])
    bullets = result.resume.experience[0].bullets
    assert [b.id for b in bullets] == ["exp_1_b1", "exp_1_b2", "exp_1_b3", "exp_1_added"]
    assert bullets[-1].text == text and not result.issues
    assert "1 experience bullet added" in [ch.label for ch in summarize_changes(source, result.resume, result.applied)]
    diff = text_diffs(source, result.resume, result.applied, c)[0]
    assert diff.before == "" and diff.after == text and diff.evidence_labels == ["Software Engineer at Northwind Labs"]


def test_added_bullet_must_cite_its_own_jobs_evidence():
    # Contoso's evidence can't back a bullet under Northwind.
    _, _, _, result = run_plan([add("Maintained marketing sites and dashboards.", evidence=("E2",))])
    assert [b.id for b in result.resume.experience[0].bullets] == ["exp_1_b1", "exp_1_b2", "exp_1_b3"]
    assert any("same job or project" in i.message for i in result.issues)


@pytest.mark.parametrize("text, check", [
    ("Built the SaaS billing dashboard for 900 business customers.", "metrics"),
    ("Built the SaaS billing dashboard on Kubernetes.", "unsupported_technology"),
])
def test_added_bullet_with_unsupported_claims_is_left_out(text, check):
    _, _, _, result = run_plan([add(text)])
    assert all(b.id != "exp_1_added" for b in result.resume.experience[0].bullets)
    assert any(i.check == check and "left out" in i.message for i in result.issues)


def test_bullet_additions_are_limited():
    _, _, applied, _ = run_plan([
        add("Built the SaaS billing dashboard and REST APIs for 200 business customers."),
        add("Built REST APIs for business customers."),
        add("Open-source collaboration tool.", item="proj_1", evidence=("P1",), section="projects"),
        add("Maintained dashboards.", item="exp_2", evidence=("E2",)),
        add("A bullet for education.", item="edu_1", evidence=("ED1",), section="education"),
    ])
    assert [a.change.item for a in applied.applied] == ["exp_1", "proj_1"]
    assert len(applied.rejected) == 3
