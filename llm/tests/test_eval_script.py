"""
The evaluation script runs end to end (with the fake LLM) and its independent
truthfulness checks find nothing, even for an adversarial plan.
"""

import pytest

import scripts.eval_tailoring as evaluation
from tests.docx_files import resume_docx
from tests.fakes import FakeGateway
from tests.tailoring_data import ADVERSARIAL_PLAN, HONEST_PLAN, analysis, master, profile_rows, semantic_answer


@pytest.mark.parametrize("plan", [HONEST_PLAN, ADVERSARIAL_PLAN])
@pytest.mark.asyncio
async def test_eval_run_has_no_truthfulness_problems(tmp_path, monkeypatch, plan):
    monkeypatch.setattr(evaluation, "gateway", FakeGateway({
        "You analyze a job posting": lambda user: analysis().model_dump(mode="json", by_alias=True),
        "You check a candidate's evidence": semantic_answer,
        "You tailor a candidate's resume": lambda user: plan,
        "You audit a tailored resume": lambda user: {"flags": []},
    }))
    job = tmp_path / "company-x.txt"
    job.write_text("Senior Full Stack Engineer\nCompany X\n" + "Build SaaS with React and Kubernetes. " * 20, encoding="utf-8")
    report = await evaluation.run_job(job, master(), profile_rows(), tmp_path, resume_docx(master()))
    assert report["truth_problems"] == [] and report["document_problems"] == []
    assert (tmp_path / "company-x.docx").exists()
    assert "Senior Full Stack Engineer" in evaluation.markdown([report])
