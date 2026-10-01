"""
Source Adapters.

One adapter per kind of `job_sources` row. Each turns a source's public API
response into `NormalizedJob`s. `parse` is pure (tested against recorded
responses); `fetch` does the HTTP.

Only sources whose terms allow this use are added (see the seeded rows in
supabase/migrations and the README). LinkedIn and Indeed are deliberately not
sources.
"""

from typing import Any, Dict, List, Optional, Protocol

import httpx

from .extract import html_to_text, normalize_employment_type
from .normalize import NormalizedJob, build_job, iso_from_millis, iso_from_seconds

USER_AGENT = "AnslyJobIngest/1.0 (+https://github.com/AbrarAhmed111/ansly)"


class SourceError(Exception):
    pass


class SourceAdapter(Protocol):
    kind: str
    # True when one fetch returns the source's whole current listing, so jobs
    # missing from it have closed. Paginated feeds age jobs out instead.
    complete_listing: bool

    async def fetch(self, client: httpx.AsyncClient, identifier: str, name: str) -> List[NormalizedJob]: ...


async def _get_json(client: httpx.AsyncClient, url: str, params: Optional[Dict[str, Any]] = None) -> Any:
    try:
        response = await client.get(url, params=params, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    except httpx.HTTPError as e:
        raise SourceError(f"{type(e).__name__}: {e}") from e
    if response.status_code != 200:
        raise SourceError(f"HTTP {response.status_code} from {url}")
    try:
        return response.json()
    except ValueError as e:
        raise SourceError(f"Invalid JSON from {url}") from e


# --- Greenhouse ----------------------------------------------------------------

class Greenhouse:
    """https://developers.greenhouse.io/job-board.html"""

    kind = "greenhouse"
    complete_listing = True

    @staticmethod
    def parse(payload: Dict[str, Any], identifier: str, name: str) -> List[NormalizedJob]:
        jobs = []
        for j in payload.get("jobs") or []:
            location = (j.get("location") or {}).get("name")
            departments = j.get("departments") or []
            jobs.append(build_job(
                external_id=j["id"],
                url=j["absolute_url"],
                apply_url=j["absolute_url"],
                title=j["title"],
                company=j.get("company_name") or name,
                description_html=j.get("content"),
                location=location,
                workplace_hint=location,
                department=departments[0].get("name") if departments else None,
                posted_at=j.get("first_published") or j.get("updated_at"),
            ))
        return jobs

    async def fetch(self, client: httpx.AsyncClient, identifier: str, name: str) -> List[NormalizedJob]:
        payload = await _get_json(client, f"https://boards-api.greenhouse.io/v1/boards/{identifier}/jobs", {"content": "true"})
        return self.parse(payload, identifier, name)


# --- Lever ---------------------------------------------------------------------

_LEVER_INTERVALS = {"per-year-salary": "year", "per-month-salary": "month", "per-hour-wage": "hour"}


class Lever:
    """https://github.com/lever/postings-api"""

    kind = "lever"
    complete_listing = True

    @staticmethod
    def parse(payload: List[Dict[str, Any]], identifier: str, name: str) -> List[NormalizedJob]:
        jobs = []
        for j in payload or []:
            categories = j.get("categories") or {}
            sections = [j.get("descriptionPlain") or ""]
            for lst in j.get("lists") or []:
                sections.append(f"{lst.get('text', '')}\n{lst.get('content', '')}")
            sections.append(j.get("additionalPlain") or "")
            # List sections are HTML fragments.
            text = "\n\n".join(html_to_text(s) for s in sections if s)
            salary_range = j.get("salaryRange") or {}
            salary = None
            if salary_range.get("min") is not None and salary_range.get("max") is not None:
                salary = (int(salary_range["min"]), int(salary_range["max"]), salary_range.get("currency"),
                          _LEVER_INTERVALS.get(salary_range.get("interval"), "year"))
            workplace = j.get("workplaceType")
            jobs.append(build_job(
                external_id=j["id"],
                url=j["hostedUrl"],
                apply_url=j.get("applyUrl"),
                title=j["text"],
                company=name,
                description_text=text,
                location=categories.get("location"),
                workplace_hint=None if workplace in (None, "unspecified") else workplace,
                employment_type=normalize_employment_type(categories.get("commitment")),
                department=categories.get("team") or categories.get("department"),
                posted_at=iso_from_millis(j.get("createdAt")),
                salary=salary,
            ))
        return jobs

    async def fetch(self, client: httpx.AsyncClient, identifier: str, name: str) -> List[NormalizedJob]:
        payload = await _get_json(client, f"https://api.lever.co/v0/postings/{identifier}", {"mode": "json"})
        if not isinstance(payload, list):
            raise SourceError("Unexpected Lever response")
        return self.parse(payload, identifier, name)


# --- Ashby ---------------------------------------------------------------------

_ASHBY_INTERVALS = {"1 YEAR": "year", "1 MONTH": "month", "1 HOUR": "hour"}


class Ashby:
    """https://developers.ashbyhq.com/docs/public-job-posting-api"""

    kind = "ashby"
    complete_listing = True

    @staticmethod
    def _salary(compensation: Optional[Dict[str, Any]]) -> Optional[tuple]:
        for c in (compensation or {}).get("summaryComponents") or []:
            if c.get("compensationType") == "Salary" and c.get("minValue") is not None and c.get("maxValue") is not None:
                return (int(c["minValue"]), int(c["maxValue"]), c.get("currencyCode"),
                        _ASHBY_INTERVALS.get(c.get("interval"), "year"))
        return None

    @classmethod
    def parse(cls, payload: Dict[str, Any], identifier: str, name: str) -> List[NormalizedJob]:
        jobs = []
        for j in payload.get("jobs") or []:
            if j.get("isListed") is False:
                continue
            workplace = j.get("workplaceType") or ("Remote" if j.get("isRemote") else None)
            jobs.append(build_job(
                external_id=j["id"],
                url=j["jobUrl"],
                apply_url=j.get("applyUrl"),
                title=j["title"],
                company=name,
                description_text=j.get("descriptionPlain"),
                description_html=j.get("descriptionHtml"),
                location=j.get("location"),
                workplace_hint=workplace,
                employment_type=normalize_employment_type(j.get("employmentType")),
                department=j.get("department") or j.get("team"),
                posted_at=j.get("publishedAt"),
                salary=cls._salary(j.get("compensation")),
            ))
        return jobs

    async def fetch(self, client: httpx.AsyncClient, identifier: str, name: str) -> List[NormalizedJob]:
        payload = await _get_json(
            client, f"https://api.ashbyhq.com/posting-api/job-board/{identifier}", {"includeCompensation": "true"}
        )
        return self.parse(payload, identifier, name)


# --- Arbeitnow -----------------------------------------------------------------

class Arbeitnow:
    """https://www.arbeitnow.com/blog/job-board-api: free; link back, don't fetch more than hourly."""

    kind = "arbeitnow"
    complete_listing = False

    def __init__(self, max_pages: int = 3):
        self.max_pages = max_pages

    @staticmethod
    def parse(payload: Dict[str, Any], identifier: str, name: str) -> List[NormalizedJob]:
        jobs = []
        for j in payload.get("data") or []:
            jobs.append(build_job(
                external_id=j["slug"],
                url=j["url"],
                apply_url=j["url"],
                title=j["title"],
                company=j["company_name"],
                description_html=j.get("description"),
                location=j.get("location"),
                workplace_hint="remote" if j.get("remote") else None,
                employment_type=normalize_employment_type(*(j.get("job_types") or [])),
                posted_at=iso_from_seconds(j.get("created_at")),
            ))
        return jobs

    async def fetch(self, client: httpx.AsyncClient, identifier: str, name: str) -> List[NormalizedJob]:
        jobs: List[NormalizedJob] = []
        for page in range(1, self.max_pages + 1):
            payload = await _get_json(client, "https://www.arbeitnow.com/api/job-board-api", {"page": page})
            jobs += self.parse(payload, identifier, name)
            if not (payload.get("links") or {}).get("next"):
                break
        return jobs


def adapters(max_pages: int = 3) -> Dict[str, SourceAdapter]:
    return {a.kind: a for a in [Greenhouse(), Lever(), Ashby(), Arbeitnow(max_pages)]}
