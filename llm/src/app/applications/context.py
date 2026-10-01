"""
Application Context.

What Ansly knows about a tracked application: the company, role, posting and
its requirements, and the answers already given in it. Answers generated for
that application use this so they fit the job and stay consistent.
"""

import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlsplit

from src.app.db.rest import SupabaseRest
from src.app.jobs.vocabulary import find_skills
from src.app.schemas.answers import JobContext

# Earlier answers included in a prompt, most recent first.
MAX_EARLIER_ANSWERS = 6
EARLIER_ANSWER_CHARS = 700


@dataclass
class ApplicationContext:
    application: Dict[str, Any]
    job: Optional[Dict[str, Any]]
    requirements: List[str] = field(default_factory=list)
    earlier_answers: List[Tuple[str, str]] = field(default_factory=list)

    def job_context(self, given: Optional[JobContext] = None) -> JobContext:
        """The application's job details, with anything the caller sent taking precedence."""
        app, job = self.application, self.job or {}
        return JobContext(
            company=(given.company if given and given.company else None) or app.get("company"),
            role=(given.role if given and given.role else None) or app.get("role"),
            description=(given.description if given and given.description else None)
            or app.get("description") or job.get("description"),
            url=(given.url if given and given.url else None) or app.get("job_url") or job.get("url"),
        )


def _question_key(question: str) -> str:
    return question.strip().lower()


async def load_application_context(rest: SupabaseRest, application_id: str,
                                   question: Optional[str] = None) -> Optional[ApplicationContext]:
    """The context for one of the user's applications (RLS scopes it to them), or None."""
    apps = await rest.select("applications", {"id": f"eq.{application_id}", "limit": "1"})
    if not apps:
        return None
    application = apps[0]
    job = None
    if application.get("job_id"):
        jobs = await rest.select("jobs", {"id": f"eq.{application['job_id']}", "limit": "1"})
        job = jobs[0] if jobs else None

    requirements = list((job or {}).get("skills") or [])
    if not requirements:
        requirements = find_skills(application.get("description") or "")

    answers = await rest.select("application_answers", {
        "application_id": f"eq.{application_id}", "order": "updated_at.desc", "limit": str(MAX_EARLIER_ANSWERS + 1),
    })
    skip = _question_key(question) if question else None
    earlier = [
        (a["question"], a["answer"][:EARLIER_ANSWER_CHARS])
        for a in answers if _question_key(a["question"]) != skip
    ][:MAX_EARLIER_ANSWERS]
    return ApplicationContext(application, job, requirements, earlier)


def normalize_job_url(url: Optional[str]) -> str:
    """Comparable form of a posting URL: host + path, no query, no "/apply" suffix."""
    if not url:
        return ""
    parts = urlsplit(url.strip())
    host = parts.netloc.lower().removeprefix("www.")
    path = re.sub(r"/(?:apply|application|applications)/?$", "", parts.path.rstrip("/"))
    return f"{host}{path}".lower()


def url_matches(page_url: str, candidates: List[Optional[str]]) -> bool:
    page = normalize_job_url(page_url)
    return bool(page) and any(page == normalize_job_url(c) for c in candidates if c)
