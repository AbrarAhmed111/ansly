"""
v1.2 API: master resume upload/parse/review (Word .docx only), job analysis,
and the tailoring pipeline end to end (background run, polling, resume after a
stall, the tailored copy of the user's document, preview files, download,
delete), with Supabase, Storage and the LLM replaced by fakes.
"""

from datetime import datetime, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient

from src.app.api.deps import get_gateway, get_pipeline, get_rest, get_storage
from src.app.core.auth import AuthUser, get_current_user
from src.app.main import app
from src.app.resume.docx.package import DOCX_MIME, DocxPackage
from src.app.resume.docx.text import paragraphs, visible_text
from src.app.resume.pipeline import TailoringPipeline
from tests.docx_files import resume_docx
from tests.fakes import USER_ID, FakeGateway, FakeRest, FakeStorage
from tests.resume_files import CLASSIC_PARSED, LAYOUTS, make_layout_docx
from tests.tailoring_data import ADVERSARIAL_PLAN, HONEST_PLAN, analysis, master, profile_rows, semantic_answer

JOB = {
    "title": "Senior Full Stack Engineer", "company": "Company X", "location": "Remote", "url": "https://jobs.example/1",
    "source": "manual",
    "description": "We are looking for a Senior Full Stack Engineer with React, TypeScript and Kubernetes. "
                   "You will build SaaS platforms and have 5+ years of experience. AWS EKS and an AWS certification "
                   "are a plus. You will own features end to end and improve performance by 40%+.",
}


def handlers(plan=HONEST_PLAN):
    return {
        "You convert the text of a resume": lambda user: CLASSIC_PARSED,
        "You analyze a job posting": lambda user: analysis().model_dump(mode="json", by_alias=True),
        "You check a candidate's evidence": semantic_answer,
        "You tailor a candidate's resume": lambda user: plan,
        "You audit a tailored resume": lambda user: {"flags": []},
    }


def tables_with_master():
    data = profile_rows()
    tables = {"profiles": [{**data.pop("profile"), "resume_page_limit": 2}], **data}
    tables["resumes"] = [{
        "id": "r1", "user_id": USER_ID, "name": "Sam Rivera Resume.docx", "file_path": MASTER_PATH,
        "file_type": "docx", "parsed_content": master().to_json(), "parse_status": "parsed", "parse_error": None,
        "version": 1, "is_master": True, "dismissed_discrepancies": [], "created_at": "2026-10-01T00:00:00+00:00",
        "updated_at": "2026-10-01T00:00:00+00:00",
    }]
    return tables


MASTER_PATH = f"{USER_ID}/masters/r1.docx"


class Env:
    def __init__(self, tables=None, plan=HONEST_PLAN, files=None):
        self.rest = FakeRest(tables if tables is not None else tables_with_master())
        self.storage = FakeStorage(files if files is not None else {MASTER_PATH: resume_docx(master())})
        self.content_types = {}
        upload = self.storage.upload

        async def tracked(path, content, content_type, bucket="resumes"):
            self.content_types[path] = content_type
            await upload(path, content, content_type, bucket)

        self.storage.upload = tracked
        self.gateway = FakeGateway(handlers(plan))
        self.pipeline = TailoringPipeline(self.gateway)

    def events(self):
        return [e["kind"] for e in self.rest.tables["usage_events"]]


@pytest.fixture
def env():
    return Env()


def client_for(env: Env) -> AsyncClient:
    app.dependency_overrides[get_current_user] = lambda: AuthUser(id=USER_ID, email="sam@example.com", token="t")
    app.dependency_overrides[get_rest] = lambda: env.rest
    app.dependency_overrides[get_storage] = lambda: env.storage
    app.dependency_overrides[get_gateway] = lambda: env.gateway
    app.dependency_overrides[get_pipeline] = lambda: env.pipeline
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.fixture(autouse=True)
def clear_overrides():
    yield
    app.dependency_overrides.clear()


async def tailor(client: AsyncClient) -> dict:
    job = (await client.post("/api/v1/jobs/analyze", json={"job": JOB})).json()
    started = await client.post("/api/v1/tailorings", json={"jobContextId": job["jobContextId"]})
    assert started.status_code == 200, started.text
    return (await client.get(f"/api/v1/tailorings/{started.json()['id']}?detail=true")).json()


# -- master resume ----------------------------------------------------------------------


@pytest.mark.asyncio
async def test_upload_parses_versions_and_promotes_the_master():
    env = Env(tables={}, files={f"{USER_ID}/masters/a.docx": make_layout_docx(LAYOUTS["classic"]),
                                f"{USER_ID}/masters/b.docx": make_layout_docx(LAYOUTS["classic"])})
    async with client_for(env) as client:
        bad_path = await client.post("/api/v1/resumes", json={"name": "x", "filePath": "someone-else/masters/a.docx", "fileType": "docx"})
        first = await client.post("/api/v1/resumes", json={"name": "A.docx", "filePath": f"{USER_ID}/masters/a.docx", "fileType": "docx"})
        second = await client.post("/api/v1/resumes", json={"name": "B.docx", "filePath": f"{USER_ID}/masters/b.docx", "fileType": "docx"})
        listing = await client.get("/api/v1/resumes")
    assert bad_path.status_code == 400
    assert first.json()["parseStatus"] == "parsed" and first.json()["version"] == 1
    assert second.json()["isMaster"] is True and second.json()["version"] == 2
    assert [(r["version"], r["isMaster"]) for r in listing.json()["items"]] == [(2, True), (1, False)]
    assert second.json()["parsedContent"]["experience"][0]["company"] == "Northwind Labs"
    assert env.events().count("resume_uploaded") == 2


@pytest.mark.asyncio
async def test_pdf_uploads_are_rejected(env):
    env.storage.files[f"{USER_ID}/masters/cv.pdf"] = b"%PDF-1.7"
    async with client_for(env) as client:
        as_pdf = await client.post("/api/v1/resumes", json={"name": "cv.pdf", "filePath": f"{USER_ID}/masters/cv.pdf", "fileType": "pdf"})
        renamed = await client.post("/api/v1/resumes", json={"name": "cv.pdf", "filePath": f"{USER_ID}/masters/cv.pdf", "fileType": "docx"})
    for response in (as_pdf, renamed):
        assert response.status_code == 415
        assert "Word (.docx)" in response.json()["detail"]
    assert len(env.rest.tables["resumes"]) == 1


@pytest.mark.asyncio
async def test_unreadable_upload_fails_safely_and_keeps_the_old_master(env):
    # Named .docx, but really a PDF: the contents are checked too.
    env.storage.files[f"{USER_ID}/masters/bad.docx"] = b"%PDF-1.7 garbage"
    async with client_for(env) as client:
        response = await client.post("/api/v1/resumes", json={"name": "bad.docx", "filePath": f"{USER_ID}/masters/bad.docx", "fileType": "docx"})
        master_now = await client.get("/api/v1/resumes/master")
    assert response.json()["parseStatus"] == "failed"
    assert "Word (.docx)" in response.json()["parseError"]
    assert response.json()["isMaster"] is False
    assert master_now.json()["resume"]["id"] == "r1"
    assert "resume_parse_failed" in env.events()


@pytest.mark.asyncio
async def test_master_discrepancies_can_be_dismissed_and_corrections_confirm(env):
    env.rest.tables["experiences"][0]["title"] = "Senior Software Engineer"
    async with client_for(env) as client:
        before = (await client.get("/api/v1/resumes/master")).json()
        keys = [d["key"] for d in before["discrepancies"]]
        assert "title:northwindlabs" in keys
        await client.patch("/api/v1/resumes/r1", json={"dismissedDiscrepancies": ["title:northwindlabs"]})
        after = (await client.get("/api/v1/resumes/master")).json()

        env.rest.tables["resumes"][0]["parse_status"] = "needs_review"
        corrected = master()
        corrected.summary = "Corrected summary."
        confirmed = await client.patch("/api/v1/resumes/r1", json={"parsedContent": corrected.to_json()})
    assert "title:northwindlabs" not in [d["key"] for d in after["discrepancies"]]
    assert confirmed.json()["parseStatus"] == "parsed"
    assert confirmed.json()["parsedContent"]["summary"] == "Corrected summary."


@pytest.mark.asyncio
async def test_resume_delete_removes_the_file(env):
    async with client_for(env) as client:
        response = await client.delete("/api/v1/resumes/r1")
    assert response.status_code == 204
    assert env.storage.files == {} and env.rest.tables["resumes"] == []


# -- job analysis ----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_job_analysis_requires_enough_description(env):
    async with client_for(env) as client:
        short = await client.post("/api/v1/jobs/analyze", json={"job": {**JOB, "description": "React dev. Apply now."}})
        ok = await client.post("/api/v1/jobs/analyze", json={"job": JOB})
    assert short.status_code == 422 and "not enough job information" in short.json()["detail"]
    assert ok.status_code == 200
    assert len(ok.json()["analysis"]["mustHave"]) == 5
    stored = env.rest.tables["job_contexts"][0]
    assert stored["description"] == JOB["description"] and stored["analysis"]["role"] == "Senior Full Stack Engineer"


# -- tailoring ---------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_tailoring_needs_a_confirmed_master():
    env = Env(tables={})
    async with client_for(env) as client:
        job = (await client.post("/api/v1/jobs/analyze", json={"job": JOB})).json()
        none = await client.post("/api/v1/tailorings", json={"jobContextId": job["jobContextId"]})
        env.rest.tables["resumes"] = tables_with_master()["resumes"]
        env.rest.tables["resumes"][0]["parse_status"] = "needs_review"
        unconfirmed = await client.post("/api/v1/tailorings", json={"jobContextId": job["jobContextId"]})
    assert none.status_code == 409 and none.json()["detail"] == "Upload your master resume first."
    assert unconfirmed.status_code == 409 and "confirm" in unconfirmed.json()["detail"]


@pytest.mark.asyncio
async def test_a_pdf_master_from_before_must_be_uploaded_again_as_docx(env):
    env.rest.tables["resumes"][0].update(file_type="pdf", file_path=f"{USER_ID}/masters/r1.pdf", name="Resume.pdf")
    async with client_for(env) as client:
        job = (await client.post("/api/v1/jobs/analyze", json={"job": JOB})).json()
        response = await client.post("/api/v1/tailorings", json={"jobContextId": job["jobContextId"]})
    assert response.status_code == 409
    assert "master resume as a Word (.docx) file" in response.json()["detail"]


@pytest.mark.asyncio
async def test_tailoring_runs_end_to_end_and_master_is_unchanged(env):
    master_before = dict(env.rest.tables["resumes"][0])
    async with client_for(env) as client:
        result = await tailor(client)
        download = await client.get(f"/api/v1/tailorings/{result['id']}/download")
        files = await client.get(f"/api/v1/tailorings/{result['id']}/files")
        history = await client.get("/api/v1/tailorings")

    assert result["status"] == "ready", result
    assert result["summary"] == {"analyzed": 8, "supported": 3, "partial": 1, "unsupported": 4}
    assert "Kubernetes" in result["unsupportedRequirements"]
    labels = [c["label"] for c in result["changes"]]
    assert "1 experience bullet rewritten" in labels and "Summary updated" in labels
    assert result["warnings"] == []
    assert result["pipelineVersion"] == "1.2.1"
    assert {d["itemLabel"] for d in result["detail"]["diffs"]} == {"Summary", "Software Engineer at Northwind Labs"}

    row = env.rest.tables["resume_tailorings"][0]
    for column in ("match_analysis", "tailoring_plan", "tailored_content", "validation_report"):
        assert row[column], column
    assert row["output_file_path"] == f"{USER_ID}/tailored/{row['id']}.docx"
    assert env.content_types[row["output_file_path"]] == DOCX_MIME
    tailored = DocxPackage(env.storage.files[row["output_file_path"]])
    lines = [visible_text(p) for p in paragraphs(tailored.body)]
    assert "Built SaaS web applications using React, TypeScript and Node.js." in lines
    # The original upload and its record are untouched; the master stays available for the next job.
    assert env.rest.tables["resumes"][0] == master_before
    assert env.storage.files[MASTER_PATH] == resume_docx(master())

    assert download.json()["fileName"] == "Sam Rivera Resume - Tailored - Company X.docx"
    assert "download=Sam Rivera Resume - Tailored - Company X.docx" in download.json()["url"]
    preview = files.json()
    assert preview["format"] == "docx"
    assert row["output_file_path"] in preview["tailored"]["url"] and "download=" not in preview["tailored"]["url"]
    assert MASTER_PATH in preview["original"]["url"] and preview["original"]["fileName"] == "Sam Rivera Resume.docx"
    assert history.json()["items"][0]["jobTitle"] == "Senior Full Stack Engineer"
    assert [e for e in env.events() if e.startswith(("tailoring", "resume_"))] == [
        "tailoring_started", "tailoring_completed", "resume_downloaded", "resume_previewed"]
    completed = next(e for e in env.rest.tables["usage_events"] if e["kind"] == "tailoring_completed")
    assert completed["tokens"] > 0 and completed["duration_ms"] >= 0


@pytest.mark.asyncio
async def test_adversarial_plan_never_reaches_the_document():
    env = Env(plan=ADVERSARIAL_PLAN)
    async with client_for(env) as client:
        result = await tailor(client)
    assert result["status"] == "ready"
    document = DocxPackage(env.storage.files[env.rest.tables["resume_tailorings"][0]["output_file_path"]])
    text = "\n".join(visible_text(p) for p in paragraphs(document.body))
    for fabricated in ["40%", "Kubernetes", "EKS", "Certified", "12 engineers", "8 years", "Owned the data platform",
                       "high-traffic", "Senior Software Engineer"]:
        assert fabricated not in text, fabricated
    assert "Software Engineer" in text and "Contoso Digital" in text
    assert any("metric" in w for w in result["warnings"])
    assert any("technolog" in w for w in result["warnings"])
    assert any("rewrite" in w for w in result["warnings"])


@pytest.mark.asyncio
async def test_a_stalled_run_is_resumed_by_polling(env):
    async with client_for(env) as client:
        job = (await client.post("/api/v1/jobs/analyze", json={"job": JOB})).json()
        old = (datetime.now(timezone.utc) - timedelta(minutes=3)).isoformat()
        env.rest.tables["resume_tailorings"].append({
            "id": "t1", "user_id": USER_ID, "resume_id": "r1", "resume_version": 1, "job_context_id": job["jobContextId"],
            "status": "matching", "pipeline_version": "1.2.0", "match_analysis": None, "tailoring_plan": None,
            "tailored_content": None, "validation_report": None, "output_file_path": None, "error": None,
            "created_at": old, "updated_at": old,
        })
        polled = (await client.get("/api/v1/tailorings/t1")).json()
        fresh = (await client.get("/api/v1/tailorings/t1")).json()
    assert polled["status"] == "ready"
    assert fresh["status"] == "ready"


@pytest.mark.asyncio
async def test_provider_failure_fails_safely():
    env = Env()
    env.gateway.handlers.pop("You tailor a candidate's resume")
    async with client_for(env) as client:
        result = await tailor(client)
    assert result["status"] == "failed"
    assert result["error"] == "Resume tailoring failed. Your original resume has not been changed."
    assert "tailoring_failed" in env.events()


@pytest.mark.asyncio
async def test_daily_tailoring_limit(env):
    env.rest.tables["usage_events"] = [{"kind": "tailoring_started"}] * 10
    async with client_for(env) as client:
        job = (await client.post("/api/v1/jobs/analyze", json={"job": JOB})).json()
        response = await client.post("/api/v1/tailorings", json={"jobContextId": job["jobContextId"]})
    assert response.status_code == 429 and "tailored resumes" in response.json()["detail"]


@pytest.mark.asyncio
async def test_delete_removes_the_record_and_its_file(env):
    async with client_for(env) as client:
        result = await tailor(client)
        path = env.rest.tables["resume_tailorings"][0]["output_file_path"]
        deleted = await client.delete(f"/api/v1/tailorings/{result['id']}")
        missing = await client.get(f"/api/v1/tailorings/{result['id']}")
    assert deleted.status_code == 204
    assert path not in env.storage.files and missing.status_code == 404
    assert "tailoring_deleted" in env.events()


@pytest.mark.asyncio
async def test_changes_the_document_cant_take_are_left_out_and_reported():
    env = Env(files={MASTER_PATH: resume_docx(master(), summary_in_text_box=True)})
    async with client_for(env) as client:
        result = await tailor(client)
    assert result["status"] == "ready"
    # The summary sits in a text box: left as it was, and the review shows what the document really says.
    assert "Summary updated" not in [c["label"] for c in result["changes"]]
    assert {d["itemLabel"] for d in result["detail"]["diffs"]} == {"Software Engineer at Northwind Labs"}
    assert "1 change left out to protect your document's formatting" in result["warnings"]
    row = env.rest.tables["resume_tailorings"][0]
    assert row["tailored_content"]["summary"] == master().summary


@pytest.mark.asyncio
async def test_a_document_that_cant_be_edited_fails_clearly_and_offers_no_file():
    plan = {"changes": [HONEST_PLAN["changes"][3]]}  # only the summary, which is in a text box
    env = Env(plan=plan, files={MASTER_PATH: resume_docx(master(), summary_in_text_box=True)})
    async with client_for(env) as client:
        result = await tailor(client)
        download = await client.get(f"/api/v1/tailorings/{result['id']}/download")
        files = await client.get(f"/api/v1/tailorings/{result['id']}/files")
    assert result["status"] == "failed"
    assert "couldn't safely edit this Word document" in result["error"]
    assert download.status_code == 409 and files.status_code == 409
    assert env.rest.tables["resume_tailorings"][0]["output_file_path"] is None
