"""
Token benchmark: runs representative job applications through the real answer
engine and tailoring pipeline (in-memory database, scripted model) and measures
every prompt the code builds, per stage and per context section.

Usage (from llm/):
    uv run python -m scripts.benchmark_tokens [--json out.json] [--calls]

The model is scripted (no API keys needed): its outputs are fixed, plausible
JSON, so output token counts are estimates. Input counts are exact for the
prompts the code builds; tokens are estimated as characters / 4 (close to
real tokenizers for English and JSON). The production gateway logs the
providers' real counts per stage (`llm_call stage=...`).

Scenarios (fictional candidate and job in scripts/benchmark_data.py):
  A  simple job, mostly factual questions (fill all)
  B  typical software-engineering application (fill all; B2: one call per question family)
  C  long job description, behavioral questions answered one by one
  D  resume tailoring for the B job + B's answers (a full application)
  D2 tailoring the same job again (cached job analysis and matches)
  CB C's questions answered together ("Answer the rest together" / Fill all with saved answers resolved on
     the server): one generation call, the saved answer adapted alongside
  S3, S5, S8, S10  batch-size sweep: 10 long fields on one form (C + 4 more), at most N questions per call
"""

import argparse
import asyncio
import json
import math
import re
from collections import defaultdict
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from src.app.answers.adapt import adapt_saved_answer, adaptation_reason
from src.app.answers.engine import AnswerEngine, _answer_cache
from src.app.answers.profile_context import invalidate_profile_cache
from src.app.answers.similarity import best_match
from src.app.gateway import GatewayResult
from src.app.resume.pipeline import PIPELINE_VERSION, StepContext, TailoringPipeline, corpus_from
from src.app.resume.tailoring.apply import apply_plan
from src.app.resume.validation.review import review_changes
from src.app.resume.validation.validate import Validator
from src.app.schemas.answers import (
    AnswerStyle,
    BatchItem,
    FieldContext,
    GenerateAnswerRequest,
    GenerateBatchRequest,
    JobContext,
)
from src.app.schemas.resume import StructuredResume
from src.app.schemas.tailoring import TailoringPlan
from tests.fakes import FakeRest, FakeStorage

from . import benchmark_data as data

STAGES = ["job_analysis", "matching", "tailoring_plan", "validation_review", "answer", "answer_simple",
          "answer_complex", "answer_batch", "answer_adaptation", "answer_regeneration"]

# User-message headers -> the context they carry, for the duplication report.
SECTION_HEADERS = {
    "QUESTION": "question", "FIELD LABEL": "question", "GUIDANCE": "question", "STYLE": "question",
    "CANDIDATE'S INSTRUCTION": "question", "PREVIOUS ANSWER": "question",
    "JOB CONTEXT": "job description", "TITLE": "job description", "COMPANY": "job description",
    "LOCATION": "job description", "EMPLOYMENT TYPE": "job description", "DESCRIPTION": "job description",
    "JOB REQUIREMENTS": "job requirements / matches", "REQUIREMENTS": "job requirements / matches",
    "CANDIDATE PROFILE": "candidate profile", "CANDIDATE EVIDENCE": "candidate evidence",
    "EVIDENCE": "candidate evidence", "RESUME": "resume", "SAVED ANSWER": "saved answer",
    "ID": "changed text", "ORIGINAL": "changed text", "REWRITE": "changed text", "TASK": "question",
}
HEADER = re.compile(r"^(" + "|".join(sorted(map(re.escape, SECTION_HEADERS), key=len, reverse=True))
                    + r")\b[^:\n]{0,80}:")


def tokens(text: str) -> int:
    return math.ceil(len(text) / 4)


def sections(user: str) -> Dict[str, int]:
    out: Dict[str, int] = defaultdict(int)
    current = "other"
    for line in user.splitlines(keepends=True):
        m = HEADER.match(line)
        if m:
            current = SECTION_HEADERS[m.group(1)]
        out[current] += len(line)
    return {k: math.ceil(v / 4) for k, v in out.items()}


@dataclass
class Call:
    stage: str
    system: int
    user: int
    output: int
    items: int
    sections: Dict[str, int]

    @property
    def input(self) -> int:
        return self.system + self.user

    @property
    def total(self) -> int:
        return self.input + self.output


# -- scripted model outputs ---------------------------------------------------------------------------------------

ANSWER_TEXT = ("In my current role at Harborline Analytics I lead the customer analytics platform, where I designed the "
               "FastAPI ingestion service and moved reporting to PostgreSQL materialized views, which brought dashboard "
               "p95 from 4.1 seconds to 900 milliseconds. Before that I rebuilt the booking flow at Copperleaf Health in "
               "React and TypeScript. I enjoy owning a feature from the schema to the UI and measuring the result.")


def _refs(user: str) -> List[str]:
    return re.findall(r"^\[([A-Z]{1,2}\d*)\]", user, re.MULTILINE)


def _answer_for(block: str, refs: List[str]) -> Dict[str, Any]:
    options = re.search(r"Options: (.+?)\. The answer", block)
    if options:
        answer = re.findall(r'"([^"]+)"', options.group(1))[0]
    elif "This is a number field" in block:
        answer = "7"
    elif "single-line field" in block:
        answer = "Three weeks"
    else:
        answer = ANSWER_TEXT
    return {"status": "answered", "answer": answer, "confidence": "high", "usedSources": refs[:2],
            "missingInformation": None, "missingQuestion": None}


def _matching(user: str) -> Dict[str, Any]:
    reqs = re.findall(r"^\[(req_\d+)\] \([^)]*\) (.+)$", user, re.MULTILINE)
    evidence_part = user.split("EVIDENCE:", 1)[-1]
    lines = re.findall(r"^\[([^\]]+)\] (.+)$", evidence_part, re.MULTILINE)
    matches = []
    for req_id, text in reqs:
        words = {w for w in re.findall(r"[a-z]+", text.lower()) if len(w) > 3}
        scored = sorted(lines, key=lambda line: -len(words & set(re.findall(r"[a-z]+", line[1].lower()))))
        ids = [i for i, _ in scored[:2]]
        matches.append({"requirementId": req_id, "support": "partial" if ids else "none", "evidenceIds": ids,
                        "note": "Related work is shown in the cited experience."})
    return {"matches": matches}


def _plan(user: str) -> Dict[str, Any]:
    bullets = re.findall(r"^  - \[(exp_[12]_b\d)\] (.+)$", user, re.MULTILINE)[:3]
    changes = [
        {"section": "experience", "item": b.rsplit("_", 1)[0], "action": "rewrite_bullet", "bulletId": b,
         "text": text.replace("Built", "Developed").replace("Designed", "Architected"),
         "evidenceIds": [f"R:{b}"], "reason": "Foregrounds the job's emphasis on Python services and dashboards."}
        for b, text in bullets
    ]
    changes += [
        {"section": "skills", "action": "emphasize", "values": ["Python", "React", "TypeScript", "PostgreSQL"],
         "evidenceIds": [], "reason": "The job's core stack first."},
        {"section": "projects", "item": "proj_1", "action": "reorder", "position": 0, "evidenceIds": [],
         "reason": "Retrieval project matches the LLM requirement."},
        {"section": "experience", "item": "exp_5", "action": "reduce", "evidenceIds": [],
         "reason": "Oldest role, least relevant."},
    ]
    return {"changes": changes}


def scripted(stage: str, user: str) -> Any:
    if stage == "job_analysis":
        return data.JOB_ANALYSIS
    if stage == "matching":
        return _matching(user)
    if stage == "tailoring_plan":
        return _plan(user)
    if stage == "validation_review":
        return {"flags": []}
    if stage == "answer_adaptation":
        return {"answer": "Lumenfield's focus on analytics for hospital operations matches what I enjoy most. At "
                          "Harborline Analytics I own the ingestion API and reporting service, and I'd like to bring "
                          "that ownership to Lumenfield's Insights team, working closely with product on features "
                          "that save operations teams time."}
    if stage == "answer_batch":
        refs = _refs(user)
        blocks = re.split(r"^QUESTION id=", user, flags=re.MULTILINE)[1:]
        return {"answers": [{"id": b.split(":", 1)[0].strip(), **_answer_for(b, refs)} for b in blocks]}
    return _answer_for(user.split("JOB CONTEXT")[0].split("CANDIDATE PROFILE")[0], _refs(user))


class RecordingGateway:
    def __init__(self) -> None:
        self.calls: List[Call] = []

    async def generate(self, system, messages, temperature=None, max_tokens=None, validate=None, stage="unknown",
                       items=1):
        user = messages[-1]["content"]
        text = json.dumps(scripted(stage, user))
        value = validate(text) if validate else text
        call = Call(stage, tokens(system), tokens(user), tokens(text), items, sections(user))
        call.sections["system prompt"] = call.system
        self.calls.append(call)
        return GatewayResult(text=text, value=value, provider="bench", model="bench",
                             usage={"prompt_tokens": call.input, "completion_tokens": call.output})


# -- scenarios ----------------------------------------------------------------------------------------------------

def _field(kind: str, options: Optional[List[str]], max_length: Optional[int]) -> FieldContext:
    return FieldContext(kind=kind, options=options, max_length=max_length)


def _job(job: Dict[str, Any]) -> JobContext:
    return JobContext(company=job["company"], role=job["title"], description=job["description"])


async def fill_all(engine: AnswerEngine, rest: FakeRest, questions, job, group_size: Optional[int] = None,
                   by_family: Optional[bool] = None, check_saved: bool = False) -> None:
    """Like POST /answers/generate-batch (with check_saved: saved answers resolved and adapted on the server)."""
    request = GenerateBatchRequest(
        items=[BatchItem(id=f"q{i}", question=q, field=_field(k, o, m)) for i, (q, k, o, m) in enumerate(questions)],
        job_context=_job(job), style=AnswerStyle(), check_saved=check_saved,
    )
    saved = await rest.select("saved_answers") if check_saved else None
    plan = await engine.plan_batch(rest, request, data.USER_ID, saved=saved)
    kwargs = {} if by_family is None else {"by_family": by_family}
    await engine.complete_batch(rest, plan, group_size=group_size, **kwargs)


async def one_by_one(engine: AnswerEngine, rest: FakeRest, questions, job) -> None:
    """Like POST /answers/resolve: a matching saved answer is used as is, or adapted when it was written for
    another job; otherwise an answer is generated."""
    saved = await rest.select("saved_answers")
    for q, k, o, m in questions:
        request = GenerateAnswerRequest(question=q, job_context=_job(job), field=_field(k, o, m))
        match, _ = best_match(q, saved)
        if match is not None:
            reason = adaptation_reason(match, request)
            if reason:
                analysis = engine.analyze(request)
                await adapt_saved_answer(engine.gateway, match, request, reason, analysis.category, analysis.intent)
            continue
        await engine.answer(rest, request, user_id=data.USER_ID)


def tailoring_tables(rest: FakeRest) -> None:
    rest.tables["resumes"].append({"id": "r1", "parsed_content": data.resume(), "file_type": "docx",
                                   "file_path": f"{data.USER_ID}/masters/r1.docx", "version": 1, "is_master": True})
    job = data.TYPICAL_JOB
    rest.tables["job_contexts"].append({"id": "j1", "title": job["title"], "company": job["company"],
                                        "location": job["location"], "employment_type": None,
                                        "description": job["description"], "url": "", "source": "manual",
                                        "analysis": None})


async def tailor(pipeline: TailoringPipeline, rest: FakeRest, run: int) -> None:
    row = await rest.insert("resume_tailorings", {"job_context_id": "j1", "resume_id": "r1", "resume_version": 1,
                                                  "pipeline_version": PIPELINE_VERSION, "status": "queued"})
    ctx = StepContext(rest=rest, storage=FakeStorage(), user_id=data.USER_ID)
    while row["status"] not in ("rendering", "ready", "failed"):
        row = await pipeline.advance(ctx, row)
        assert row is not None, "step was not claimed"
    assert row["status"] == "rendering", f"tailoring run {run} ended as {row['status']}: {row.get('error')}"
    # The review that runs during rendering (the document step itself needs a .docx and isn't measured).
    master = StructuredResume.model_validate(data.resume())
    corpus = corpus_from(row["match_analysis"])
    applied = apply_plan(master, TailoringPlan.model_validate(row["tailoring_plan"]), corpus).applied
    final = StructuredResume.model_validate(row["tailored_content"])
    await review_changes(pipeline.gateway, Validator(master, final, applied, corpus).text_changes(), corpus, ctx.usage)


async def run_scenarios() -> Dict[str, List[Call]]:
    results: Dict[str, List[Call]] = {}

    async def measure(name: str, work) -> None:
        gateway = RecordingGateway()
        rest = FakeRest(data.tables())
        invalidate_profile_cache(data.USER_ID)
        _answer_cache.invalidate_user(data.USER_ID)  # every scenario starts cold
        await work(gateway, rest)
        results[name] = gateway.calls

    await measure("A", lambda g, r: fill_all(AnswerEngine(g), r, data.SCENARIO_A_QUESTIONS, data.TYPICAL_JOB))
    await measure("B", lambda g, r: fill_all(AnswerEngine(g), r, data.SCENARIO_B_QUESTIONS, data.TYPICAL_JOB))
    # B with one call per question family (up to 4 questions each), to compare against the default.
    await measure("B2", lambda g, r: fill_all(AnswerEngine(g), r, data.SCENARIO_B_QUESTIONS, data.TYPICAL_JOB,
                                              group_size=4, by_family=True))
    await measure("C", lambda g, r: one_by_one(AnswerEngine(g), r, data.SCENARIO_C_QUESTIONS, data.LONG_JOB))

    async def full(gateway, rest, runs=1):
        tailoring_tables(rest)
        pipeline = TailoringPipeline(gateway)
        for run in range(runs):
            before = len(gateway.calls)
            await tailor(pipeline, rest, run)
            if runs > 1 and run == 0:
                del gateway.calls[before:]  # D2 measures only the repeat
        if runs == 1:
            await fill_all(AnswerEngine(gateway), rest, data.SCENARIO_B_QUESTIONS, data.TYPICAL_JOB)

    await measure("D", full)
    await measure("D2", lambda g, r: full(g, r, runs=2))
    await measure("CB", lambda g, r: fill_all(AnswerEngine(g), r, data.SCENARIO_C_QUESTIONS, data.LONG_JOB,
                                              check_saved=True))
    for size in (3, 5, 8, 10):
        await measure(f"S{size}", lambda g, r, size=size: fill_all(
            AnswerEngine(g), r, data.SCENARIO_C_QUESTIONS + data.SCENARIO_C_EXTRA, data.LONG_JOB, group_size=size,
            check_saved=True))
    return results


# -- report -------------------------------------------------------------------------------------------------------

def summarize(results: Dict[str, List[Call]]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for name, calls in results.items():
        by_stage: Dict[str, Dict[str, int]] = {}
        for c in calls:
            s = by_stage.setdefault(c.stage, {"calls": 0, "input": 0, "output": 0, "total": 0})
            s["calls"] += 1
            s["input"] += c.input
            s["output"] += c.output
            s["total"] += c.total
        contexts: Dict[str, Dict[str, int]] = {}
        for c in calls:
            for section, n in c.sections.items():
                entry = contexts.setdefault(section, {"calls": 0, "tokens": 0})
                entry["calls"] += 1
                entry["tokens"] += n
        out[name] = {
            "llm_calls": len(calls),
            "input_tokens": sum(c.input for c in calls),
            "output_tokens": sum(c.output for c in calls),
            "total_tokens": sum(c.total for c in calls),
            "stages": by_stage,
            "contexts": dict(sorted(contexts.items(), key=lambda kv: -kv[1]["tokens"])),
            "calls": [{"stage": c.stage, "input": c.input, "output": c.output, "items": c.items,
                       "sections": c.sections} for c in calls],
        }
    return out


def print_report(summary: Dict[str, Any], show_calls: bool) -> None:
    print("Estimated tokens (chars/4). Output tokens come from scripted model outputs.\n")
    print(f"{'Scenario':<9}{'calls':>6}{'input':>9}{'output':>9}{'total':>9}")
    for name, s in summary.items():
        print(f"{name:<9}{s['llm_calls']:>6}{s['input_tokens']:>9,}{s['output_tokens']:>9,}{s['total_tokens']:>9,}")
    if "C" in summary and "D" in summary:
        old, new = summary["D"]["total_tokens"] + summary["C"]["total_tokens"], None
        print(f"{'D + C':<9}{summary['D']['llm_calls'] + summary['C']['llm_calls']:>6}{'':>18}{old:>9,}"
              "   (long answers one by one)")
    if "CB" in summary and "D" in summary:
        new = summary["D"]["total_tokens"] + summary["CB"]["total_tokens"]
        print(f"{'D + CB':<9}{summary['D']['llm_calls'] + summary['CB']['llm_calls']:>6}{'':>18}{new:>9,}"
              "   (long answers together)")
    for name, s in summary.items():
        print(f"\n== Scenario {name} ==")
        print(f"  {'stage':<22}{'calls':>6}{'input':>9}{'output':>9}{'total':>9}")
        for stage in STAGES:
            if stage in s["stages"]:
                st = s["stages"][stage]
                print(f"  {stage:<22}{st['calls']:>6}{st['input']:>9,}{st['output']:>9,}{st['total']:>9,}")
        print(f"  {'context':<28}{'calls':>6}{'tokens':>9}")
        for section, entry in s["contexts"].items():
            print(f"  {section:<28}{entry['calls']:>6}{entry['tokens']:>9,}")
        if show_calls:
            for c in s["calls"]:
                print(f"    {c['stage']:<20} in={c['input']:>6} out={c['output']:>5} items={c['items']} {c['sections']}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--json", help="also write the full results to this file")
    parser.add_argument("--calls", action="store_true", help="list every call")
    args = parser.parse_args()
    summary = summarize(asyncio.run(run_scenarios()))
    print_report(summary, args.calls)
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(summary, f, indent=2)


if __name__ == "__main__":
    main()
