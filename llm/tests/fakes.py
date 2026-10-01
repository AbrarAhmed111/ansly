"""
Test doubles: an in-memory stand-in for SupabaseRest and a sample profile.
"""

import copy
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


class FakeRest:
    """Implements the subset of SupabaseRest the app uses, over in-memory tables."""

    def __init__(self, tables: Optional[Dict[str, List[Dict[str, Any]]]] = None):
        self.tables = copy.deepcopy(tables if tables is not None else SAMPLE_PROFILE)
        for name in ["profiles", "experiences", "projects", "skills", "education", "achievements",
                     "saved_answers", "usage_events"]:
            self.tables.setdefault(name, [])

    @staticmethod
    def _matches(row: Dict[str, Any], params: Dict[str, str]) -> bool:
        for key, value in params.items():
            if key in ("select", "order", "limit"):
                continue
            if value.startswith("eq.") and str(row.get(key)) != value[3:]:
                return False
            if value.startswith("in.("):
                options = value[4:-1].split(",")
                if str(row.get(key)) not in options:
                    return False
        return True

    async def select(self, table: str, params: Optional[Dict[str, str]] = None) -> List[Dict[str, Any]]:
        params = params or {}
        rows = [copy.deepcopy(r) for r in self.tables[table] if self._matches(r, params)]
        if "limit" in params:
            rows = rows[: int(params["limit"])]
        return rows

    async def insert(self, table: str, row: Dict[str, Any]) -> Dict[str, Any]:
        stored = {"id": str(uuid.uuid4()), "user_id": USER_ID, "use_count": 0, **row}
        self.tables[table].append(stored)
        return copy.deepcopy(stored)

    async def update(self, table: str, filters: Dict[str, str], values: Dict[str, Any]) -> List[Dict[str, Any]]:
        updated = []
        for row in self.tables[table]:
            if self._matches(row, filters):
                row.update(values)
                updated.append(copy.deepcopy(row))
        return updated

    async def count(self, table: str, params: Optional[Dict[str, str]] = None) -> int:
        return len([r for r in self.tables[table] if self._matches(r, params or {})])
