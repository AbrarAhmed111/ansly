"""
Test doubles: an in-memory stand-in for SupabaseRest and a sample profile.
"""

import copy
import re
import uuid
from typing import Any, Dict, List, Optional

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


TABLES = [
    "profiles", "experiences", "projects", "skills", "education", "achievements", "saved_answers", "usage_events",
    "job_sources", "jobs", "job_matches", "saved_searches", "job_alerts", "resumes", "applications",
    "application_events", "application_answers",
]

# Tables whose rows are owned by a user; other tables (jobs, sources) are shared.
OWNED = {
    "experiences", "projects", "skills", "education", "achievements", "saved_answers", "usage_events",
    "job_matches", "saved_searches", "job_alerts", "resumes", "applications", "application_events",
    "application_answers",
}


def _compare(actual: Any, op: str, expected: str) -> bool:
    if actual is None:
        return False
    try:
        a, e = float(actual), float(expected)
    except (TypeError, ValueError):
        a, e = str(actual), expected
    return {"lt": a < e, "lte": a <= e, "gt": a > e, "gte": a >= e}[op]


def _in_values(value: str) -> List[str]:
    inner = value[4:-1]
    return [v.strip().strip('"').replace('\\"', '"') for v in re.findall(r'"(?:[^"\\]|\\.)*"|[^,]+', inner)]


class FakeRest:
    """Implements the subset of SupabaseRest the app uses, over in-memory tables."""

    def __init__(self, tables: Optional[Dict[str, List[Dict[str, Any]]]] = None):
        self.tables = copy.deepcopy(tables if tables is not None else SAMPLE_PROFILE)
        for name in TABLES:
            self.tables.setdefault(name, [])
        # Like the column default auth.uid(): owned rows belong to the signed-in user.
        for name in OWNED:
            for row in self.tables[name]:
                row.setdefault("user_id", USER_ID)

    @staticmethod
    def _matches(row: Dict[str, Any], params: Dict[str, str]) -> bool:
        for key, value in params.items():
            if key in ("select", "order", "limit", "offset", "on_conflict"):
                continue
            actual = row.get(key)
            if value.startswith("eq.") and str(actual) != value[3:]:
                return False
            if value.startswith("neq.") and str(actual) == value[4:]:
                return False
            if value.startswith("in.(") and str(actual) not in _in_values(value):
                return False
            if value.startswith("is."):
                expected = {"true": True, "false": False, "null": None}[value[3:]]
                if actual is not expected and actual != expected:
                    return False
            op = value.split(".", 1)[0]
            if op in ("lt", "lte", "gt", "gte") and not _compare(actual, op, value.split(".", 1)[1]):
                return False
        return True

    async def select(self, table: str, params: Optional[Dict[str, str]] = None) -> List[Dict[str, Any]]:
        params = params or {}
        rows = [copy.deepcopy(r) for r in self.tables[table] if self._matches(r, params)]
        offset = int(params.get("offset", 0))
        rows = rows[offset:]
        if "limit" in params:
            rows = rows[: int(params["limit"])]
        return rows

    async def select_all(self, table: str, params: Optional[Dict[str, str]] = None) -> List[Dict[str, Any]]:
        return await self.select(table, {k: v for k, v in (params or {}).items() if k not in ("limit", "offset")})

    def _new_row(self, table: str, row: Dict[str, Any]) -> Dict[str, Any]:
        defaults: Dict[str, Any] = {"id": str(uuid.uuid4()), "created_at": "2026-10-02T00:00:00+00:00"}
        if table in OWNED:
            defaults["user_id"] = USER_ID
        if table == "saved_answers":
            defaults["use_count"] = 0
        return {**defaults, **row}

    async def insert(self, table: str, row: Dict[str, Any]) -> Dict[str, Any]:
        stored = self._new_row(table, row)
        self.tables[table].append(stored)
        return copy.deepcopy(stored)

    async def upsert(self, table: str, rows: List[Dict[str, Any]], on_conflict: str,
                     ignore_duplicates: bool = False, returning: bool = False) -> List[Dict[str, Any]]:
        keys = [k.strip() for k in on_conflict.split(",")]
        def key_of(r: Dict[str, Any]) -> tuple:
            # question_key is a generated column: lower(btrim(question)).
            return tuple(str(r.get("question", "")).strip().lower() if k == "question_key" else str(r.get(k)) for k in keys)

        out = []
        for row in rows:
            existing = next((r for r in self.tables[table] if key_of(r) == key_of(row)), None)
            if existing is None:
                existing = self._new_row(table, row)
                self.tables[table].append(existing)
            elif not ignore_duplicates:
                existing.update(row)
            out.append(copy.deepcopy(existing))
        return out if returning else []

    async def update(self, table: str, filters: Dict[str, str], values: Dict[str, Any]) -> List[Dict[str, Any]]:
        updated = []
        for row in self.tables[table]:
            if self._matches(row, filters):
                row.update(values)
                updated.append(copy.deepcopy(row))
        return updated

    async def delete(self, table: str, filters: Dict[str, str]) -> None:
        self.tables[table] = [r for r in self.tables[table] if not self._matches(r, filters)]

    async def count(self, table: str, params: Optional[Dict[str, str]] = None) -> int:
        return len([r for r in self.tables[table] if self._matches(r, params or {})])
