"""
Tailoring evaluation: runs every job description in a folder through the real
pipeline (real LLM gateway, no database) and writes a report for review by hand.

Usage (from llm/):
    uv run python -m scripts.eval_tailoring --jobs evals/jobs --resume path/to/resume.json [--docx resume.docx] [--profile profile.json] [--out evals/out]

- --jobs: one .txt per job. Line 1 = title, line 2 = company, the rest = the description.
- --resume: a Structured Resume JSON (copy `parsedContent` from GET /api/v1/resumes/master,
  or use packages/types/fixtures/structured-resume/full-stack-engineer.json).
- --docx: optional, the Word document that resume JSON was parsed from. Each job then also writes the
  tailored copy (<job>.docx) and the report lists changes the document couldn't take and any integrity problem.
- --profile: optional profile export JSON from the web app (Settings -> Export profile).

For each job the report lists the requirements and their evidence, every change,
every validation issue, and automatic truthfulness checks on the final resume:
no number and no technology that isn't in the evidence, and protected fields
equal to the master. Read every rewrite yourself: that's the point of the eval.
"""

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from src.app.api.deps import gateway
from src.app.resume.analysis.analyze import analyze_job
from src.app.resume.docx.integrity import check_docx
from src.app.resume.docx.tailor import tailor_docx
from src.app.resume.llm import Usage
from src.app.resume.matching.evidence import build_corpus
from src.app.resume.matching.match import match_requirements, summarize
from src.app.resume.tailoring.apply import apply_plan
from src.app.resume.tailoring.changes import summarize_changes, text_diffs
from src.app.resume.tailoring.plan import generate_plan
from src.app.resume.text import number_set, numbers, tech_terms, terms
from src.app.resume.validation.review import review_changes
from src.app.resume.validation.validate import Validator, user_warnings, validate
from src.app.schemas.job import JobPosting
from src.app.schemas.resume import StructuredResume


def load_profile(path: Path | None) -> Dict[str, Any]:
    if path is None:
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    return {"profile": data.get("profile"), **{k: data.get(k) or [] for k in (
        "experiences", "projects", "skills", "education", "achievements", "profile_facts")}}


def truth_checks(master: StructuredResume, final: StructuredResume, corpus, vocabulary: List[str]) -> List[str]:
    """Independent of the validator: anything here is a bug to investigate."""
    problems: List[str] = []
    evidence_text = "\n".join(f"{e.label} {e.text} {' '.join(e.skills)}" for e in corpus.items)
    allowed_numbers = number_set([evidence_text])
    allowed_terms = terms(evidence_text)
    texts = [final.summary or ""] + [b.text for i in final.experience + final.projects for b in i.bullets]
    for text in texts:
        bad_numbers = set(numbers(text)) - allowed_numbers
        bad_tech = {t for t in tech_terms(text, vocabulary) if t not in allowed_terms}
        if bad_numbers:
            problems.append(f"number not in evidence {sorted(bad_numbers)}: {text}")
        if bad_tech:
            problems.append(f"technology not in evidence {sorted(bad_tech)}: {text}")
    for before, after in zip(master.experience, final.experience):
        for name in ("company", "title", "start_date", "end_date"):
            if getattr(before, name) != getattr(after, name) and before.id == after.id:
                problems.append(f"protected field changed: {name} {getattr(before, name)!r} -> {getattr(after, name)!r}")
    if final.contact != master.contact:
        problems.append("contact details changed")
    return problems


async def run_job(path: Path, master: StructuredResume, profile: Dict[str, Any], out: Path,
                  docx: Optional[bytes] = None) -> Dict[str, Any]:
    lines = path.read_text(encoding="utf-8").strip().split("\n")
    job = JobPosting(title=lines[0].strip(), company=lines[1].strip() if len(lines) > 1 else "",
                     description="\n".join(lines[2:]).strip(), source="manual")
    usage = Usage()
    started = time.monotonic()
    analysis = await analyze_job(gateway, job, usage)
    corpus = build_corpus(profile, master)
    matches = await match_requirements(gateway, analysis, corpus, usage)
    plan = await generate_plan(gateway, analysis, matches, master, corpus, usage)
    applied = apply_plan(master, plan, corpus)
    result = validate(master, applied.resume, applied.applied, corpus, analysis, applied.rejected)
    changes = Validator(master, result.resume, result.applied, corpus).text_changes()
    result.issues += await review_changes(gateway, changes, corpus, usage)
    seconds = time.monotonic() - started
    final, left_out, document_problems = result.resume, [], []
    if docx is not None:
        tailored = tailor_docx(docx, master, result.resume)
        final, left_out = tailored.resume, [s.label for s in tailored.skipped]
        required = [final.summary or ""] + [b.text for i in final.experience + final.projects for b in i.bullets]
        document_problems = check_docx(docx, tailored.content, tailored.expected, required, tailored.removed)
        (out / f"{path.stem}.docx").write_bytes(tailored.content)

    vocabulary = [r.requirement for r in analysis.requirements if r.type == "skill"]
    report = {
        "job": path.stem, "title": job.title, "company": job.company, "seconds": round(seconds, 1),
        "tokens": usage.tokens, "calls": usage.calls, "providers": usage.providers, "docx": docx is not None,
        "summary": summarize(matches).model_dump(),
        "requirements": [(m.requirement, m.priority, m.support, corpus.labels(m.evidence_ids)) for m in matches],
        "changes": [c.label for c in summarize_changes(master, final, result.applied)],
        "diffs": [(d.item_label, d.before, d.after, d.evidence_labels) for d in text_diffs(master, final, result.applied, corpus)],
        "left_out_of_document": left_out,
        "document_problems": document_problems,
        "warnings": user_warnings(result.issues),
        "issues": [(i.check, i.outcome, i.message) for i in result.issues],
        "truth_problems": truth_checks(master, final, corpus, vocabulary) + document_problems,
    }
    return report


def markdown(reports: List[Dict[str, Any]]) -> str:
    out = ["# Tailoring evaluation", ""]
    total_problems = sum(len(r.get("truth_problems", [])) for r in reports)
    out.append(f"{len(reports)} jobs · automatic truthfulness problems: **{total_problems}**")
    out.append("")
    out.append("| Job | Supported | Partial | None | Changes | Warnings | Seconds | Tokens | Problems |")
    out.append("|---|---|---|---|---|---|---|---|---|")
    for r in reports:
        if "error" in r:
            out.append(f"| {r['job']} | – | – | – | – | – | – | – | ERROR: {r['error']} |")
            continue
        s = r["summary"]
        out.append(f"| {r['title']} @ {r['company']} | {s['supported']} | {s['partial']} | {s['unsupported']} | "
                   f"{len(r['changes'])} | {len(r['warnings'])} | {r['seconds']} | {r['tokens']} | {len(r['truth_problems'])} |")
    for r in reports:
        if "error" in r:
            continue
        out += ["", f"## {r['title']} — {r['company']}" + (f" (`{r['job']}.docx`)" if r.get("docx") else ""), "",
                "### Requirements"]
        out += [f"- **{support}** ({priority}) {req}" + (f" — {', '.join(ev)}" if ev else "")
                for req, priority, support, ev in r["requirements"]]
        out += ["", "### Changes"] + [f"- {c}" for c in r["changes"] or ["(none)"]]
        if r.get("left_out_of_document"):
            out += ["", "### Left out of the Word document"] + [f"- {x}" for x in r["left_out_of_document"]]
        out += ["", "### Rewrites (check each one by hand)"]
        for label, before, after, ev in r["diffs"]:
            out += [f"- **{label}**", f"  - before: {before}", f"  - after: {after}", f"  - evidence: {', '.join(ev)}"]
        out += ["", "### Validation"] + [f"- {check} / {outcome}: {message}" for check, outcome, message in r["issues"]] \
            or ["- (no issues)"]
        if r["truth_problems"]:
            out += ["", "### ⚠ Automatic truthfulness problems"] + [f"- {p}" for p in r["truth_problems"]]
    return "\n".join(out) + "\n"


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--jobs", type=Path, required=True)
    parser.add_argument("--resume", type=Path, required=True)
    parser.add_argument("--docx", type=Path)
    parser.add_argument("--profile", type=Path)
    parser.add_argument("--out", type=Path, default=Path("evals/out"))
    args = parser.parse_args()

    master = StructuredResume.model_validate(json.loads(args.resume.read_text(encoding="utf-8")))
    profile = load_profile(args.profile)
    args.out.mkdir(parents=True, exist_ok=True)
    jobs = sorted(args.jobs.glob("*.txt"))
    if not jobs:
        print(f"No .txt job descriptions in {args.jobs}", file=sys.stderr)
        return 1

    reports = []
    for path in jobs:
        print(f"… {path.name}", flush=True)
        try:
            reports.append(await run_job(path, master, profile, args.out,
                                         args.docx.read_bytes() if args.docx else None))
        except Exception as e:  # noqa: BLE001 — report and continue with the next job
            reports.append({"job": path.stem, "error": f"{type(e).__name__}: {e}"})
    (args.out / "report.md").write_text(markdown(reports), encoding="utf-8")
    (args.out / "report.json").write_text(json.dumps(reports, indent=2), encoding="utf-8")
    problems = sum(len(r.get("truth_problems", [])) for r in reports)
    print(f"Wrote {args.out / 'report.md'} — {len(reports)} jobs, {problems} automatic truthfulness problems")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
