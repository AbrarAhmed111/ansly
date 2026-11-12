"""
Resume Tailoring Pipeline.

Small structured steps, not one giant prompt. The tailoring row's status is the
step to run next, and every step stores its output before moving on, so:

- a failure is debuggable (the analysis, matches, plan and output are all kept),
- a run cut short (serverless hosts may stop background work after the
  response) is resumed by the next status poll from the last finished step.

On hosts that freeze background work (Vercel), status polls drive the run: each
poll runs the next steps itself, for a few seconds, so the tailoring moves on as
soon as a step finishes.

    queued -> analyzing -> matching -> tailoring -> validating -> rendering -> ready
                                                                            \\-> failed

"rendering" applies the validated changes to a copy of the user's own Word
document (the design master) and checks the file's integrity; the original
upload is never modified and nothing is rebuilt from an Ansly template.

Each step claims the row with a conditional update (status and updated_at
unchanged) that sets step_started_at, its lease: while it's fresh nobody else runs
that step. Saving a finished step is conditional on the status too, so a worker
whose lease ran out can't move a run that has already moved on.
"""

import asyncio
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import uuid4

from src.app.core import llm_usage
from src.app.core.token_budget import job_key
from src.app.core.ttl_cache import TTLCache
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
from src.app.resume.tailoring.job_fit import fit_headline
from src.app.resume.tailoring.plan import generate_plan
from src.app.resume.tailoring.review import atomicize, build_review_changes
from src.app.resume.validation.review import review_changes
from src.app.resume.validation.validate import Validator, validate
from src.app.schemas.job import JobAnalysis, JobPosting
from src.app.schemas.matching import MatchAnalysis, RequirementMatch
from src.app.schemas.resume import StructuredResume
from src.app.schemas.tailoring import (
    TailoringChange,
    TailoringPlan,
    TailoringReviewChange,
    ValidationIssue,
    ValidationReport,
)

logger = logging.getLogger("TailoringPipeline")

PIPELINE_VERSION = "1.2.1"
TABLE = "resume_tailorings"
TERMINAL = {"ready", "failed"}
NEXT = {"queued": "analyzing", "analyzing": "matching", "matching": "tailoring", "tailoring": "validating",
        "validating": "rendering", "rendering": "ready"}
# A step not finished in this long is assumed dead (its worker was frozen or killed) and is run again.
LEASE_SECONDS = 75
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


SECTIONS = {"headline", "summary", "experience", "projects", "skills", "education", "achievements", "certifications"}


class PipelineError(Exception):
    """A user-safe reason the tailoring can't continue."""


async def fetch_profile_rows(rest: SupabaseRest) -> Dict[str, Any]:
    profiles, *sections = await asyncio.gather(
        rest.select("profiles", {"limit": "1"}),
        *(rest.select(section, {"order": order, "limit": "100"}) for section, order in PROFILE_SECTIONS.items()),
    )
    data: Dict[str, Any] = {"profile": profiles[0] if profiles else None}
    data.update(zip(PROFILE_SECTIONS, sections))
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


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def needs_worker(row: Dict[str, Any]) -> bool:
    """Unfinished, and nobody is running its current step (or its worker went quiet)."""
    if row.get("status") in TERMINAL:
        return False
    started = row.get("step_started_at")
    return not started or age_seconds(started) > LEASE_SECONDS


def corpus_from(match_analysis: Dict[str, Any]) -> EvidenceCorpus:
    stored = MatchAnalysis.model_validate(match_analysis)
    return EvidenceCorpus(items=stored.evidence, declined=set(stored.declined_skills))


# job_context_id -> job_key ("" when the job has nothing to key it by).
_job_keys: TTLCache[str] = TTLCache(3600, max_entries=2000)


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
        """Takes the step's lease, only if it's free and nobody else touched the row since we read it."""
        if not needs_worker(row):
            return None
        claimed = await rest.update(
            TABLE,
            {"id": f"eq.{row['id']}", "status": f"eq.{row['status']}", "updated_at": f"eq.{row['updated_at']}"},
            {"step_started_at": now_iso()},
        )
        return claimed[0] if claimed else None

    async def _save(self, rest: SupabaseRest, row: Dict[str, Any], values: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Saves a finished step, unless the run already moved past it (None then)."""
        updated = await rest.update(TABLE, {"id": f"eq.{row['id']}", "status": f"eq.{row['status']}"},
                                    {**values, "step_started_at": None})
        return updated[0] if updated else None

    async def _job_key(self, rest: SupabaseRest, job_context_id: Optional[str]) -> Optional[str]:
        """The job's key (token_budget.job_key), read once per job and remembered."""
        if not job_context_id:
            return None
        key = _job_keys.get((job_context_id,))
        if key is None:
            try:
                jobs = await rest.select("job_contexts", {"id": f"eq.{job_context_id}", "select": "url,company,title",
                                                          "limit": "1"})
            except SupabaseError:
                return None
            if not jobs:
                return None
            key = job_key(jobs[0].get("url"), jobs[0].get("company"), jobs[0].get("title")) or ""
            _job_keys.set((job_context_id,), key)
        return key or None

    async def _record_calls(self, rest: SupabaseRest, row: Dict[str, Any], calls: List[llm_usage.LLMCall]) -> None:
        if calls:
            job_context_id = row.get("job_context_id")
            await llm_usage.write_calls(rest, calls, await self._job_key(rest, job_context_id), job_context_id)

    async def _event(self, rest: SupabaseRest, kind: str, row: Dict[str, Any], usage: Optional[Usage] = None) -> None:
        """A usage event for the run: tokens and calls are the whole run's (summed on the row step by step)."""
        event: Dict[str, Any] = {"kind": kind, "duration_ms": int(age_seconds(row.get("created_at")) * 1000),
                                 "tokens": int(row.get("tokens") or 0), "llm_calls": int(row.get("llm_calls") or 0),
                                 "job_context_id": row.get("job_context_id")}
        if usage is not None:
            event["provider"] = ",".join(usage.providers)[:100] or None
        key = await self._job_key(rest, row.get("job_context_id"))
        if key:
            event["job_key"] = key
        try:
            await rest.insert("usage_events", event)
        except SupabaseError as e:
            logger.warning(f"Could not record usage event {kind}: {e}")

    async def fail(self, rest: SupabaseRest, row: Dict[str, Any], message: str = FAILED_MESSAGE) -> Dict[str, Any]:
        values = {"status": "failed", "error": message, "step_started_at": None}
        updated = await rest.update(TABLE, {"id": f"eq.{row['id']}"}, values)
        row = updated[0] if updated else {**row, **values}
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

    async def _earlier_matches(self, rest: SupabaseRest, row: Dict[str, Any], evidence: Dict[str, Any]) -> Optional[List[RequirementMatch]]:
        """Matches from an earlier run of this resume version against this job, if they were made from exactly
        the same evidence (so a profile edit always matches afresh). Saves a model call on retries and re-runs."""
        rows = await rest.select(TABLE, {
            "job_context_id": f"eq.{row['job_context_id']}", "resume_id": f"eq.{row.get('resume_id')}",
            "resume_version": f"eq.{row.get('resume_version')}", "pipeline_version": f"eq.{PIPELINE_VERSION}",
            "id": f"neq.{row['id']}", "match_analysis": "not.is.null",
            "select": "match_analysis", "order": "created_at.desc", "limit": "1",
        })
        if not rows:
            return None
        earlier = MatchAnalysis.model_validate(rows[0]["match_analysis"])
        same = ([e.model_dump(mode="json") for e in earlier.evidence] == evidence["evidence"]
                and sorted(earlier.declined_skills) == evidence["declined"])
        return earlier.matches if same else None

    async def _matching(self, ctx: StepContext, row: Dict[str, Any]) -> Dict[str, Any]:
        analysis, master, profile = await asyncio.gather(
            self._analysis(ctx, row), self._master(ctx, row), fetch_profile_rows(ctx.rest))
        corpus = build_corpus(profile, master)
        evidence = {"evidence": [e.model_dump(mode="json") for e in corpus.items], "declined": sorted(corpus.declined)}
        matches = await self._earlier_matches(ctx.rest, row, evidence)
        if matches is None:
            matches = await match_requirements(self.gateway, analysis, corpus, ctx.usage)
        else:
            logger.info(f"Tailoring {row['id']}: reused matches from an earlier run with the same evidence")
        stored = MatchAnalysis(matches=matches, evidence=corpus.items, declined_skills=sorted(corpus.declined))
        return {"match_analysis": stored.model_dump(mode="json", by_alias=True)}

    async def _tailoring(self, ctx: StepContext, row: Dict[str, Any]) -> Dict[str, Any]:
        analysis, master = await asyncio.gather(self._analysis(ctx, row), self._master(ctx, row))
        stored = MatchAnalysis.model_validate(row["match_analysis"])
        corpus = corpus_from(row["match_analysis"])
        plan = await generate_plan(self.gateway, analysis, stored.matches, master, corpus, ctx.usage)
        plan = atomicize(plan, master)
        headline = fit_headline(
            master.contact.headline,
            None,
            analysis.role,
            [experience.title for experience in master.experience],
        )
        if headline and headline != master.contact.headline:
            plan.changes.append(TailoringChange(
                section="headline",
                action="update_headline",
                text=headline,
                reason="Align the resume title with the role while preserving the candidate's seniority.",
            ))
        applied = apply_plan(master, plan, corpus)
        return {
            "tailoring_plan": plan.model_dump(mode="json", by_alias=True),
            "tailored_content": applied.resume.to_json(),
        }

    async def _validating(self, ctx: StepContext, row: Dict[str, Any]) -> Dict[str, Any]:
        """Validate suggestions before they reach the review screen."""
        analysis, master = await asyncio.gather(self._analysis(ctx, row), self._master(ctx, row))
        stored = MatchAnalysis.model_validate(row["match_analysis"])
        corpus = corpus_from(row["match_analysis"])
        plan = TailoringPlan.model_validate(row["tailoring_plan"])
        # Applying the plan is deterministic: re-applying gives the same resume plus what each change cited.
        applied = apply_plan(master, plan, corpus)
        result = validate(master, applied.resume, applied.applied, corpus, analysis, applied.rejected)
        valid_plan = TailoringPlan(changes=[change.change for change in result.applied])
        review_records = build_review_changes(master, valid_plan, analysis, stored.matches, corpus)
        flags = await review_changes(
            self.gateway, Validator(master, result.resume, result.applied, corpus).text_changes(), corpus, ctx.usage,
        )
        report = ValidationReport(
            issues=[*result.issues, *flags],
        )
        return {
            "tailoring_plan": valid_plan.model_dump(mode="json", by_alias=True),
            "tailored_content": master.to_json(),
            "review_changes": [change.model_dump(mode="json", by_alias=True) for change in review_records],
            "validation_report": report.model_dump(mode="json", by_alias=True),
        }

    async def render_review(self, ctx: StepContext, row: Dict[str, Any], output_path: str) -> Dict[str, Any]:
        """Render only accepted review changes, always starting from the immutable parsed baseline."""
        baseline = row.get("source_content")
        if baseline is None:
            raise PipelineError("This tailoring has no immutable resume baseline to review.")
        master = StructuredResume.model_validate(baseline)
        if not row.get("resume_id"):
            raise PipelineError("The original Word document for this tailoring is no longer available.")
        resumes = await ctx.rest.select("resumes", {
            "id": f"eq.{row['resume_id']}", "select": "file_path,file_type", "limit": "1",
        })
        if not resumes or resumes[0].get("file_type") != "docx":
            raise PipelineError(NEEDS_DOCX)
        original = await ctx.storage.download(resumes[0]["file_path"])
        analysis = await self._analysis(ctx, row)
        corpus = corpus_from(row["match_analysis"])
        entries = [
            TailoringReviewChange.model_validate(change)
            for change in row.get("review_changes") or []
        ]
        plan = TailoringPlan(changes=[
            entry.change.model_copy(update={"user_confirmed": entry.confirmation_required})
            for entry in entries if entry.status == "accepted"
        ])
        applied = apply_plan(master, plan, corpus)
        validated = validate(master, applied.resume, applied.applied, corpus, analysis, applied.rejected)
        try:
            result = tailor_docx(original, master, validated.resume)
        except DocxError as e:
            raise PipelineError(str(e)) from e
        final = result.resume
        required = [final.summary or ""] + [b.text for item in final.experience + final.projects + final.education
                                            for b in item.bullets]
        if (final.contact.headline or "") != (master.contact.headline or ""):
            required.append(final.contact.headline or "")
        problems = check_docx(original, result.content, result.expected, required, result.removed)
        if problems:
            logger.error(f"Tailoring {row['id']}: reviewed document failed integrity checks: {problems}")
            raise PipelineError(DOCUMENT_INVALID)
        report = ValidationReport.model_validate(row.get("validation_report") or {})
        report.issues = [
            issue for issue in report.issues
            if issue.check not in {"document", "formatting", "unverified_skill"}
            and (issue.outcome != "flagged" or any(
                entry.status == "accepted" and entry.change.text == issue.attempted for entry in entries
            ))
        ] + validated.issues
        report.issues += [
            ValidationIssue(
                check="document", outcome="warning", section=skip.section if skip.section in SECTIONS else None,
                item=skip.item,
                message=f"Left unchanged in your document: {skip.label}. That part of the layout "
                        "couldn't be edited without risking its formatting.",
            )
            for skip in result.skipped
        ]
        report.changes = summarize_changes(master, final, validated.applied)
        report.diffs = text_diffs(master, final, validated.applied, corpus)
        report.page_count = None
        await ctx.storage.upload(output_path, result.content, DOCX_MIME)
        return {
            "output_file_path": output_path,
            "tailored_content": final.to_json(),
            "validation_report": report.model_dump(mode="json", by_alias=True),
        }

    async def _rendering(self, ctx: StepContext, row: Dict[str, Any]) -> Dict[str, Any]:
        """Create the initial preview from the master; pending suggestions never enter the download."""
        path = f"{ctx.user_id}/tailored/{row['id']}/{uuid4().hex}.docx"
        return await self.render_review(ctx, row, path)

    # -- driver -----------------------------------------------------------------

    async def advance(self, ctx: StepContext, row: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Runs the row's current step. Returns the updated row, or None if another worker owns it or the run moved on."""
        status = row["status"]
        if status in TERMINAL:
            return row
        if age_seconds(row.get("created_at")) > GIVE_UP_AFTER_SECONDS:
            return await self.fail(ctx.rest, row)
        claimed = await self._claim(ctx.rest, row)
        if claimed is None:
            return None
        started = time.monotonic()
        tokens_before, calls_before = ctx.usage.tokens, ctx.usage.calls
        # The step's provider calls, written with the job they were for (failed steps' calls were billed too).
        with llm_usage.collect() as calls:
            try:
                values = await getattr(self, f"_{status}")(ctx, claimed) if status != "queued" else {}
            except PipelineError as e:
                error: Optional[str] = str(e)
            except GatewayUnavailableError as e:
                logger.error(f"Tailoring {row['id']} step {status}: all providers failed: {e}")
                error = FAILED_MESSAGE
            except Exception as e:  # noqa: BLE001 — any failure ends the run safely; the master is never touched.
                logger.exception(f"Tailoring {row['id']} step {status} failed: {type(e).__name__}: {e}")
                error = FAILED_MESSAGE
            else:
                error = None
        await self._record_calls(ctx.rest, claimed, calls)
        if error is not None:
            return await self.fail(ctx.rest, claimed, error)
        logger.info(f"Tailoring {row['id']}: {status} done in {int((time.monotonic() - started) * 1000)}ms")
        next_status = NEXT[status]
        if ctx.usage.calls > calls_before:
            values["tokens"] = int(claimed.get("tokens") or 0) + ctx.usage.tokens - tokens_before
            values["llm_calls"] = int(claimed.get("llm_calls") or 0) + ctx.usage.calls - calls_before
        saved = await self._save(ctx.rest, claimed, {**values, "status": next_status})
        if saved is not None and next_status == "ready":
            await self._event(ctx.rest, "tailoring_completed", saved, ctx.usage)
        return saved

    async def drive(self, ctx: StepContext, row: Dict[str, Any], budget_seconds: Optional[float] = None) -> Dict[str, Any]:
        """Runs steps while they're free to run, starting new ones only within `budget_seconds` (None: until done)."""
        started = time.monotonic()
        latest = row
        while needs_worker(latest):
            if budget_seconds is not None and time.monotonic() - started > budget_seconds:
                break
            advanced = await self.advance(ctx, latest)
            if advanced is None:
                return await self._load(ctx.rest, latest["id"]) or latest
            latest = advanced
        return latest

    async def run(self, ctx: StepContext, tailoring_id: str) -> Optional[Dict[str, Any]]:
        """Runs every remaining step (used as a background task after POST /tailorings)."""
        try:
            row = await self._load(ctx.rest, tailoring_id)
            return await self.drive(ctx, row) if row is not None else None
        except SupabaseError as e:
            logger.error(f"Tailoring {tailoring_id}: Supabase error, will resume on next poll: {e}")
            return None
