"""
Test doubles: in-memory stand-ins for SupabaseRest, Supabase Storage and the LLM
gateway, and a sample profile.
"""

import copy
import itertools
import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional

from src.app.gateway import GatewayResult, GatewayUnavailableError

USER_ID = "11111111-1111-1111-1111-111111111111"

SAMPLE_PROFILE: Dict[str, List[Dict[str, Any]]] = {
    "profiles": [{
        "id": USER_ID,
        "full_name": "Sam Rivera",
        "headline": "Full-stack engineer building AI products",
        "location": "Remote",
        "summary": "Full-stack engineer with four years of experience shipping web products with React, "
                   "Next.js, TypeScript and Python, most recently LLM-powered features.",
        "links": {"github": "https://github.com/example"},
        "work_authorization": None,
        "requires_sponsorship": False,
        "notice_period": "Two weeks",
        "salary_expectation": None,
        "willing_to_relocate": None,
        "preferred_work_mode": "remote",
    }],
    "experiences": [
        {"id": "e1", "company": "Acme Labs", "title": "Software Engineer", "is_current": True,
         "start_date": "2023-01-01", "end_date": None, "location": "Remote",
         "description": "Built the customer dashboard in Next.js and a FastAPI service for document search.",
         "highlights": ["Cut page load time by 40%"], "technologies": ["Next.js", "TypeScript", "FastAPI", "PostgreSQL"],
         "sort_order": 0},
        {"id": "e2", "company": "Beta Studio", "title": "Frontend Developer", "is_current": False,
         "start_date": "2021-03-01", "end_date": "2022-12-01", "location": None,
         "description": "Built React interfaces for client e-commerce sites.",
         "highlights": [], "technologies": ["React", "JavaScript", "CI/CD"], "sort_order": 1},
    ],
    "projects": [
        {"id": "p1", "name": "TaskFlow", "role": "Creator", "url": None,
         "description": "Open-source task management app with real-time collaboration.",
         "highlights": ["300 GitHub stars"], "technologies": ["React", "Supabase"], "sort_order": 0,
         "start_date": None, "end_date": None},
    ],
    "skills": [
        {"id": "s1", "name": "React", "level": "expert", "years": 4, "sort_order": 0},
        {"id": "s2", "name": "TypeScript", "level": "advanced", "years": 3, "sort_order": 1},
        {"id": "s3", "name": "Python", "level": "advanced", "years": None, "sort_order": 2},
        {"id": "s4", "name": "LLMs", "level": None, "years": None, "sort_order": 3},
    ],
    "education": [
        {"id": "ed1", "institution": "State University", "degree": "BSc", "field_of_study": "Computer Science",
         "start_date": "2016-09-01", "end_date": "2020-06-01", "grade": None, "description": None, "sort_order": 0},
    ],
    "achievements": [],
    "saved_answers": [],
    "usage_events": [],
}


TABLE_DEFAULTS: Dict[str, Dict[str, Any]] = {
    "resumes": {"is_master": False, "dismissed_discrepancies": [], "parsed_content": None, "parse_error": None},
    "job_contexts": {"analysis": None},
    "resume_tailorings": {"status": "queued", "match_analysis": None, "tailoring_plan": None, "tailored_content": None,
                          "validation_report": None, "output_file_path": None, "error": None},
}

_clock = itertools.count()


def _now() -> str:
    """Strictly increasing timestamps, so updated_at always changes on update (like the DB trigger)."""
    return (datetime.now(timezone.utc) + timedelta(microseconds=next(_clock))).isoformat()


class FakeRest:
    """Implements the subset of SupabaseRest the app uses, over in-memory tables."""

    def __init__(self, tables: Optional[Dict[str, List[Dict[str, Any]]]] = None):
        self.tables = copy.deepcopy(tables if tables is not None else SAMPLE_PROFILE)
        for name in ["profiles", "experiences", "projects", "skills", "education", "achievements",
                     "saved_answers", "usage_events", "profile_facts", "resumes", "job_contexts",
                     "resume_tailorings"]:
            self.tables.setdefault(name, [])
        self.rate_limit_hits = 0

    @staticmethod
    def _matches(row: Dict[str, Any], params: Dict[str, str]) -> bool:
        for key, value in params.items():
            if key in ("select", "order", "limit"):
                continue
            if value.startswith("eq.") and str(row.get(key)).lower() != value[3:].lower():
                return False
            if value.startswith("neq.") and str(row.get(key)).lower() == value[4:].lower():
                return False
            if value.startswith("in.("):
                options = value[4:-1].split(",")
                if str(row.get(key)) not in options:
                    return False
        return True

    async def select(self, table: str, params: Optional[Dict[str, str]] = None) -> List[Dict[str, Any]]:
        params = params or {}
        rows = [copy.deepcopy(r) for r in self.tables[table] if self._matches(r, params)]
        if "order" in params:
            column, _, direction = params["order"].split(",")[0].partition(".")
            if all(column in r for r in rows):
                rows.sort(key=lambda r: (r[column] is None, r[column]), reverse=direction.startswith("desc"))
        if "limit" in params:
            rows = rows[: int(params["limit"])]
        return rows

    async def insert(self, table: str, row: Dict[str, Any]) -> Dict[str, Any]:
        now = _now()
        stored = {"id": str(uuid.uuid4()), "user_id": USER_ID, "use_count": 0, "created_at": now, "updated_at": now,
                  **TABLE_DEFAULTS.get(table, {}), **row}
        self.tables[table].append(stored)
        return copy.deepcopy(stored)

    async def update(self, table: str, filters: Dict[str, str], values: Dict[str, Any]) -> List[Dict[str, Any]]:
        updated = []
        for row in self.tables[table]:
            if self._matches(row, filters):
                row.update(copy.deepcopy(values))
                if "updated_at" in row:
                    row["updated_at"] = _now()
                updated.append(copy.deepcopy(row))
        return updated

    async def delete(self, table: str, filters: Dict[str, str]) -> List[Dict[str, Any]]:
        removed = [r for r in self.tables[table] if self._matches(r, filters)]
        self.tables[table] = [r for r in self.tables[table] if r not in removed]
        return copy.deepcopy(removed)

    async def rpc(self, function: str, args: Optional[Dict[str, Any]] = None) -> Any:
        assert function == "check_rate_limit", function
        if self.rate_limit_hits >= args["max_hits"]:
            return args["window_seconds"]
        self.rate_limit_hits += 1
        return 0

    async def count(self, table: str, params: Optional[Dict[str, str]] = None) -> int:
        return len([r for r in self.tables[table] if self._matches(r, params or {})])


class FakeStorage:
    """In-memory Supabase Storage."""

    def __init__(self, files: Optional[Dict[str, bytes]] = None):
        self.files: Dict[str, bytes] = dict(files or {})

    async def download(self, path: str, bucket: str = "resumes") -> bytes:
        from src.app.db.rest import SupabaseError

        if path not in self.files:
            raise SupabaseError(404, "Object not found")
        return self.files[path]

    async def upload(self, path: str, content: bytes, content_type: str, bucket: str = "resumes") -> None:
        self.files[path] = content

    async def signed_url(self, path: str, expires_in: int, bucket: str = "resumes", download: Optional[str] = None) -> str:
        return f"https://storage.test/{bucket}/{path}?token=signed&expires={expires_in}" + (f"&download={download}" if download else "")

    async def remove(self, paths: List[str], bucket: str = "resumes") -> None:
        for path in paths:
            self.files.pop(path, None)


class FakeGateway:
    """
    Scripted LLM: `handlers` maps a phrase from a step's system prompt to a function
    (user message) -> JSON-able dict. Unknown prompts raise GatewayUnavailableError.
    """

    def __init__(self, handlers: Dict[str, Callable[[str], Any]]):
        self.handlers = handlers
        self.calls: List[str] = []

    async def generate(self, system, messages, temperature=None, max_tokens=None, validate=None):
        user = messages[-1]["content"]
        for phrase, handler in self.handlers.items():
            if phrase in system:
                self.calls.append(phrase)
                text = json.dumps(handler(user))
                value = validate(text) if validate else text
                return GatewayResult(text=text, value=value, provider="Mock", model="mock-1",
                                     usage={"prompt_tokens": 100, "completion_tokens": 50})
        raise GatewayUnavailableError("no handler")
