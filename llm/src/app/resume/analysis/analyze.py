"""
Step 1: JobPosting -> JobAnalysis.

The model splits the description into atomic requirements (one technology or
one capability each), so matching can check them one at a time.
"""

import re
from typing import Any, Dict, List, Optional

from src.app.gateway import LLMGateway
from src.app.resume.llm import Usage, call_json
from src.app.schemas.job import JobAnalysis, JobPosting, JobRequirement

# The card only offers tailoring above this; the API refuses below it.
MIN_DESCRIPTION_CHARS = 200
MAX_DESCRIPTION_CHARS = 12_000
MAX_REQUIREMENTS = 25

TYPES = {"skill", "experience", "education", "certification", "domain", "soft_skill", "other"}

SYSTEM_PROMPT = """You analyze a job posting for a resume-tailoring tool. Extract only what the posting states; never add requirements it doesn't mention.

Return only a JSON object:
{
  "role": str,
  "company": str,
  "mustHave": [{"requirement": str, "type": "skill"|"experience"|"education"|"certification"|"domain"|"soft_skill"|"other"}],
  "niceToHave": [same shape],
  "responsibilities": [str],
  "minYearsExperience": number|null
}

Rules:
- One requirement per item. Split lists: "React, Vue or Angular" -> three skill items; "AWS (EKS, Lambda)" -> "AWS", "AWS EKS", "AWS Lambda".
- type "skill" is only for a named technology, language, framework, tool or platform, written as its name ("PostgreSQL", not "experience with PostgreSQL").
- "experience" is a kind of work done ("building SaaS platforms", "5+ years of professional software development").
- "domain" is industry knowledge (fintech, healthcare); "soft_skill" is communication, leadership, collaboration...
- mustHave: required / must have / you have. niceToHave: preferred / bonus / nice to have / plus.
- responsibilities: up to 10 short phrases describing the work.
- At most 20 items per list. Keep each requirement under 80 characters."""


def _requirements(items: Any, start: int) -> List[JobRequirement]:
    out: List[JobRequirement] = []
    seen = set()
    for item in items if isinstance(items, list) else []:
        if isinstance(item, str):
            item = {"requirement": item, "type": "other"}
        if not isinstance(item, dict):
            continue
        text = re.sub(r"\s+", " ", str(item.get("requirement") or "")).strip()[:200]
        if not text or text.lower() in seen:
            continue
        seen.add(text.lower())
        kind = item.get("type") if item.get("type") in TYPES else "other"
        out.append(JobRequirement(id=f"req_{start + len(out)}", requirement=text, type=kind))
    return out


def to_analysis(data: Dict[str, Any], job: JobPosting) -> JobAnalysis:
    must = _requirements(data.get("mustHave"), 1)[:MAX_REQUIREMENTS]
    nice = _requirements(data.get("niceToHave"), len(must) + 1)[: max(0, MAX_REQUIREMENTS - len(must))]
    nice_texts = {r.requirement.lower() for r in must}
    nice = [r for r in nice if r.requirement.lower() not in nice_texts]
    if not must and not nice:
        raise ValueError("Model found no requirements")
    years = data.get("minYearsExperience")
    return JobAnalysis(
        role=str(data.get("role") or job.title)[:300],
        company=str(data.get("company") or job.company or "")[:300],
        must_have=must,
        nice_to_have=nice,
        responsibilities=[str(r)[:300] for r in (data.get("responsibilities") or []) if str(r).strip()][:10],
        min_years_experience=float(years) if isinstance(years, (int, float)) and 0 < years < 50 else None,
    )


def description_too_short(description: Optional[str]) -> bool:
    return len((description or "").strip()) < MIN_DESCRIPTION_CHARS


async def analyze_job(gateway: LLMGateway, job: JobPosting, usage: Optional[Usage] = None) -> JobAnalysis:
    message = "\n".join([
        f"TITLE: {job.title}",
        f"COMPANY: {job.company or 'unknown'}",
        f"LOCATION: {job.location}" if job.location else "",
        f"EMPLOYMENT TYPE: {job.employment_type}" if job.employment_type else "",
        "",
        "DESCRIPTION:",
        job.description.strip()[:MAX_DESCRIPTION_CHARS],
    ])
    return await call_json(gateway, SYSTEM_PROMPT, message, lambda data: to_analysis(data, job), usage=usage,
                           max_tokens=3000, temperature=0.0)
