"""
Resume Tailoring Pipeline.

Small structured steps, not one giant prompt. The tailoring row's status is the
step to run next, and every step stores its output before moving on, so:

- a failure is debuggable (the analysis, matches, plan and output are all kept),
- a run cut short (serverless hosts may stop background work after the
  response) is resumed by the next status poll from the last finished step.

    queued -> analyzing -> matching -> tailoring -> validating -> rendering -> ready
                                                                            \\-> failed

"rendering" applies the validated changes to a copy of the user's own Word
document (the design master) and checks the file's integrity; the original
upload is never modified and nothing is rebuilt from an Ansly template.

Each step claims the row with a conditional update (status and updated_at
unchanged), so two workers never run the same step.
"""

import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from src.app.db.rest import SupabaseError, SupabaseRest
from src.app.db.storage import SupabaseStorage
from src.app.gateway import GatewayUnavailableError, LLMGateway
from src.app.resume.analysis.analyze import analyze_job, description_too_short
from src.app.resume.docx.integrity import check_docx
from src.app.resume.docx.package import DOCX_MIME, DocxError
from src.app.resume.docx.tailor import tailor_docx
from src.app.resume.llm import Usage
from src.app.resume.matching.evidence import EvidenceCorpus, build_corpus
from src.app.resume.matching.match import match_requirements
from src.app.resume.tailoring.apply import apply_plan
from src.app.resume.tailoring.changes import summarize_changes, text_diffs
from src.app.resume.tailoring.plan import generate_plan
from src.app.resume.validation.review import review_changes
from src.app.resume.validation.validate import Validator, validate
from src.app.schemas.job import JobAnalysis, JobPosting
from src.app.schemas.matching import MatchAnalysis
from src.app.schemas.resume import StructuredResume
from src.app.schemas.tailoring import TailoringPlan, ValidationIssue, ValidationReport

logger = logging.getLogger("TailoringPipeline")

PIPELINE_VERSION = "1.2.1"
TABLE = "resume_tailorings"
TERMINAL = {"ready", "failed"}
NEXT = {"queued": "analyzing", "analyzing": "matching", "matching": "tailoring", "tailoring": "validating",
        "validating": "rendering", "rendering": "ready"}
# A step not finished in this long is assumed dead and is picked up again by the next poll.
STALE_AFTER_SECONDS = 90
# A tailoring still unfinished after this long is given up on.
GIVE_UP_AFTER_SECONDS = 15 * 60

FAILED_MESSAGE = "Resume tailoring failed. Your original resume has not been changed."
NEEDS_DOCX = ("Tailoring needs your master resume as a Word (.docx) file, so Ansly can keep its design. "
              "Upload it as .docx and try again.")
DOCUMENT_INVALID = ("Ansly couldn't produce a tailored Word document that keeps your original formatting intact, "
                    "so no file was created. Your original resume has not been changed.")
PROFILE_SECTIONS = {
    "experiences": "is_current.desc,start_date.desc.nullslast,sort_order.asc",
    "projects": "sort_order.asc,start_date.desc.nullslast",
    "skills": "sort_order.asc,name.asc",
    "education": "end_date.desc.nullslast,sort_order.asc",
    "achievements": "date.desc.nullslast,sort_order.asc",
    "profile_facts": "updated_at.desc",
}


SECTIONS = {"summary", "experience", "projects", "skills", "education", "achievements", "certifications"}


class PipelineError(Exception):
    """A user-safe reason the tailoring can't continue."""


async def fetch_profile_rows(rest: SupabaseRest) -> Dict[str, Any]:
    profiles = await rest.select("profiles", {"limit": "1"})
    data: Dict[str, Any] = {"profile": profiles[0] if profiles else None}
    for section, order in PROFILE_SECTIONS.items():
        data[section] = await rest.select(section, {"order": order, "limit": "100"})
    return data


def _parse_time(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def age_seconds(value: Any) -> float:
    parsed = _parse_time(value)
    return (datetime.now(timezone.utc) - parsed).total_seconds() if parsed else 0.0


def is_stalled(row: Dict[str, Any]) -> bool:
    return row.get("status") not in TERMINAL and age_seconds(row.get("updated_at")) > STALE_AFTER_SECONDS


def corpus_from(match_analysis: Dict[str, Any]) -> EvidenceCorpus:
    stored = MatchAnalysis.model_validate(match_analysis)
    return EvidenceCorpus(items=stored.evidence, declined=set(stored.declined_skills))


@dataclass
class StepContext:
    rest: SupabaseRest
    storage: SupabaseStorage
    user_id: str
    usage: Usage = field(default_factory=Usage)


class TailoringPipeline:
    def __init__(self, gateway: LLMGateway):
        self.gateway = gateway

    async def _load(self, rest: SupabaseRest, tailoring_id: str) -> Optional[Dict[str, Any]]:
        rows = await rest.select(TABLE, {"id": f"eq.{tailoring_id}", "limit": "1"})
        return rows[0] if rows else None

    async def _claim(self, rest: SupabaseRest, row: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Bumps updated_at only if nobody else touched the row since we read it."""
        claimed = await rest.update(
            TABLE,
            {"id": f"eq.{row['id']}", "status": f"eq.{row['status']}", "updated_at": f"eq.{row['updated_at']}"},
            {"status": row["status"]},
        )
        return claimed[0] if claimed else None

    async def _save(self, rest: SupabaseRest, row: Dict[str, Any], values: Dict[str, Any]) -> Dict[str, Any]:
        updated = await rest.update(TABLE, {"id": f"eq.{row['id']}"}, values)
        return updated[0] if updated else {**row, **values}

    async def _event(self, rest: SupabaseRest, kind: str, row: Dict[str, Any], usage: Optional[Usage] = None) -> None:
        event: Dict[str, Any] = {"kind": kind, "duration_ms": int(age_seconds(row.get("created_at")) * 1000)}
        if usage is not None:
            event["tokens"] = usage.tokens
            event["provider"] = ",".join(usage.providers)[:100] or None
        try:
            await rest.insert("usage_events", event)
        except SupabaseError as e:
            logger.warning(f"Could not record usage event {kind}: {e}")

    async def fail(self, rest: SupabaseRest, row: Dict[str, Any], message: str = FAILED_MESSAGE) -> Dict[str, Any]:
        row = await self._save(rest, row, {"status": "failed", "error": message})
        await self._event(rest, "tailoring_failed", row)
        return row

    # -- steps ------------------------------------------------------------------

    async def _analyzing(self, ctx: StepContext, row: Dict[str, Any]) -> Dict[str, Any]:
        jobs = await ctx.rest.select("job_contexts", {"id": f"eq.{row['job_context_id']}", "limit": "1"})
        if not jobs:
            raise PipelineError("The job for this tailoring was deleted.")
        job = jobs[0]
        if job.get("analysis"):
            return {}
        if description_too_short(job.get("description")):
            raise PipelineError("There's not enough job information to tailor your resume.")
        posting = JobPosting(title=job["title"], company=job.get("company") or "", location=job.get("location"),
                             employment_type=job.get("employment_type"), description=job["description"],
                             url=job.get("url") or "", source=job["source"])
        analysis = await analyze_job(self.gateway, posting, ctx.usage)
        await ctx.rest.update("job_contexts", {"id": f"eq.{job['id']}"},
                              {"analysis": analysis.model_dump(mode="json", by_alias=True)})
        return {}

    async def _master(self, ctx: StepContext, row: Dict[str, Any]) -> StructuredResume:
        if not row.get("resume_id"):
            raise PipelineError("The resume this tailoring was built from was deleted.")
        resumes = await ctx.rest.select("resumes", {"id": f"eq.{row['resume_id']}", "limit": "1"})
        if not resumes or not resumes[0].get("parsed_content"):
            raise PipelineError("The resume this tailoring was built from was deleted.")
        return StructuredResume.model_validate(resumes[0]["parsed_content"])

    async def _analysis(self, ctx: StepContext, row: Dict[str, Any]) -> JobAnalysis:
        jobs = await ctx.rest.select("job_contexts", {"id": f"eq.{row['job_context_id']}", "limit": "1"})
        if not jobs or not jobs[0].get("analysis"):
            raise PipelineError("The job analysis is missing.")
        return JobAnalysis.model_validate(jobs[0]["analysis"])

    async def _matching(self, ctx: StepContext, row: Dict[str, Any]) -> Dict[str, Any]:
        analysis = await self._analysis(ctx, row)
        master = await self._master(ctx, row)
        corpus = build_corpus(await fetch_profile_rows(ctx.rest), master)
        matches = await match_requirements(self.gateway, analysis, corpus, ctx.usage)
        stored = MatchAnalysis(matches=matches, evidence=corpus.items, declined_skills=sorted(corpus.declined))
        return {"match_analysis": stored.model_dump(mode="json", by_alias=True)}

    async def _tailoring(self, ctx: StepContext, row: Dict[str, Any]) -> Dict[str, Any]:
        analysis = await self._analysis(ctx, row)
        master = await self._master(ctx, row)
        stored = MatchAnalysis.model_validate(row["match_analysis"])
        corpus = corpus_from(row["match_analysis"])
        plan = await generate_plan(self.gateway, analysis, stored.matches, master, corpus, ctx.usage)
        applied = apply_plan(master, plan, corpus)
        return {
            "tailoring_plan": plan.model_dump(mode="json", by_alias=True),
            "tailored_content": applied.resume.to_json(),
        }

    async def _validating(self, ctx: StepContext, row: Dict[str, Any]) -> Dict[str, Any]:
        analysis = await self._analysis(ctx, row)
        master = await self._master(ctx, row)
        corpus = corpus_from(row["match_analysis"])
        plan = TailoringPlan.model_validate(row["tailoring_plan"])
        # Applying the plan is deterministic: re-applying gives the same resume plus what each change cited.
        applied = apply_plan(master, plan, corpus)
        result = validate(master, applied.resume, applied.applied, corpus, analysis, applied.rejected)
        changes = Validator(master, result.resume, result.applied, corpus).text_changes()
        result.issues += await review_changes(self.gateway, changes, corpus, ctx.usage)
        report = ValidationReport(
            issues=result.issues,
            changes=summarize_changes(master, result.resume, result.applied),
            diffs=text_diffs(master, result.resume, result.applied, corpus),
        )
        return {
            "tailored_content": result.resume.to_json(),
            "validation_report": report.model_dump(mode="json", by_alias=True),
        }

    async def _rendering(self, ctx: StepContext, row: Dict[str, Any]) -> Dict[str, Any]:
        """Validated resume -> tailored copy of the user's .docx, checked, stored next to the original."""
        resumes = await ctx.rest.select("resumes", {"id": f"eq.{row.get('resume_id')}", "limit": "1"}) \
            if row.get("resume_id") else []
        if not resumes or not resumes[0].get("parsed_content"):
            raise PipelineError("The resume this tailoring was built from was deleted.")
        source = resumes[0]
        if source.get("file_type") != "docx":
            raise PipelineError(NEEDS_DOCX)
        master = StructuredResume.model_validate(source["parsed_content"])
        validated = StructuredResume.model_validate(row["tailored_content"])
        original = await ctx.storage.download(source["file_path"])
        try:
            result = tailor_docx(original, master, validated)
        except DocxError as e:
            raise PipelineError(str(e)) from e
        final = result.resume
        required = [final.summary or ""] + [b.text for i in final.experience + final.projects + final.education
                                            for b in i.bullets]
        problems = check_docx(original, result.content, result.expected, required, result.removed)
        if problems:
            logger.error(f"Tailoring {row['id']}: tailored document failed integrity checks: {problems}")
            raise PipelineError(DOCUMENT_INVALID)

        path = f"{ctx.user_id}/tailored/{row['id']}.docx"
        await ctx.storage.upload(path, result.content, DOCX_MIME)

        # The report describes the document as it is: changes it couldn't take are gone from the diffs.
        corpus = corpus_from(row["match_analysis"])
        applied = apply_plan(master, TailoringPlan.model_validate(row["tailoring_plan"]), corpus).applied
        report = ValidationReport.model_validate(row.get("validation_report") or {})
        written = {final.summary or ""} | {b.text for i in final.experience + final.projects for b in i.bullets}
        report.issues = [i for i in report.issues if i.outcome != "flagged" or i.attempted in written]
        report.issues += [
            ValidationIssue(check="document", outcome="warning", section=s.section if s.section in SECTIONS else None,
                            item=s.item, message=f"Left unchanged in your document: {s.label}. That part of the layout "
                                                 "couldn't be edited without risking its formatting.")
            for s in result.skipped
        ]
        report.changes = summarize_changes(master, final, applied)
        report.diffs = text_diffs(master, final, applied, corpus)
        report.page_count = None  # Pages depend on how Word lays the document out; the preview shows them.
        return {"output_file_path": path, "tailored_content": final.to_json(),
                "validation_report": report.model_dump(mode="json", by_alias=True)}

    # -- driver -----------------------------------------------------------------

    async def advance(self, ctx: StepContext, row: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Runs the row's current step. Returns the updated row, or None if another worker owns it."""
        status = row["status"]
        if status in TERMINAL:
            return row
        if age_seconds(row.get("created_at")) > GIVE_UP_AFTER_SECONDS:
            return await self.fail(ctx.rest, row)
        claimed = await self._claim(ctx.rest, row)
        if claimed is None:
            return None
        started = time.monotonic()
        try:
            values = await getattr(self, f"_{status}")(ctx, claimed) if status != "queued" else {}
        except PipelineError as e:
            return await self.fail(ctx.rest, claimed, str(e))
        except GatewayUnavailableError as e:
            logger.error(f"Tailoring {row['id']} step {status}: all providers failed: {e}")
            return await self.fail(ctx.rest, claimed)
        except Exception as e:  # noqa: BLE001 — any failure ends the run safely; the master is never touched.
            logger.exception(f"Tailoring {row['id']} step {status} failed: {type(e).__name__}: {e}")
            return await self.fail(ctx.rest, claimed)
        logger.info(f"Tailoring {row['id']}: {status} done in {int((time.monotonic() - started) * 1000)}ms")
        next_status = NEXT[status]
        row = await self._save(ctx.rest, claimed, {**values, "status": next_status})
        if next_status == "ready":
            await self._event(ctx.rest, "tailoring_completed", row, ctx.usage)
        return row

    async def run(self, ctx: StepContext, tailoring_id: str) -> Optional[Dict[str, Any]]:
        """Runs every remaining step (used as a background task after POST /tailorings)."""
        try:
            row = await self._load(ctx.rest, tailoring_id)
            while row is not None and row["status"] not in TERMINAL:
                row = await self.advance(ctx, row)
            return row
        except SupabaseError as e:
            logger.error(f"Tailoring {tailoring_id}: Supabase error, will resume on next poll: {e}")
            return None
