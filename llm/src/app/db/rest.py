"""
Supabase REST (PostgREST) Client.

API requests run with the signed-in user's own access token, so row-level
security scopes every read and write to that user. Only the ingestion worker
(scripts/ingest_jobs.py) uses the secret key, through `SupabaseRest.service`;
the API server never holds it.
"""

from typing import Any, Dict, List, Optional

import httpx

from src.app.core.config import Settings

# PostgREST returns at most this many rows per request (supabase/config.toml max_rows).
PAGE_SIZE = 1000


class SupabaseError(Exception):
    def __init__(self, status_code: int, message: str):
        super().__init__(f"Supabase error {status_code}: {message}")
        self.status_code = status_code


def in_list(values: List[str]) -> str:
    """A PostgREST `in.(...)` filter with every value quoted, so commas and pipes are safe."""
    quoted = ",".join('"' + str(v).replace("\\", "\\\\").replace('"', '\\"') + '"' for v in values)
    return f"in.({quoted})"


class SupabaseRest:
    def __init__(self, settings: Settings, access_token: str, transport: Optional[httpx.AsyncBaseTransport] = None,
                 api_key: Optional[str] = None):
        self.base_url = f"{settings.SUPABASE_URL.rstrip('/')}/rest/v1"
        self.headers = {
            "apikey": api_key or settings.SUPABASE_PUBLISHABLE_KEY,
            "Authorization": f"Bearer {access_token}",
        }
        self.transport = transport

    @classmethod
    def service(cls, settings: Settings, transport: Optional[httpx.AsyncBaseTransport] = None) -> "SupabaseRest":
        """A client with the secret key: bypasses row-level security. Worker use only."""
        if not settings.SUPABASE_SECRET_KEY:
            raise SupabaseError(0, "SUPABASE_SECRET_KEY is not set (needed only by the ingestion worker)")
        return cls(settings, settings.SUPABASE_SECRET_KEY, transport, api_key=settings.SUPABASE_SECRET_KEY)

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(base_url=self.base_url, headers=self.headers, timeout=30.0, transport=self.transport)

    @staticmethod
    def _check(response: httpx.Response) -> None:
        if response.status_code >= 400:
            try:
                message = response.json().get("message", response.text)
            except ValueError:
                message = response.text
            raise SupabaseError(response.status_code, message)

    async def select(self, table: str, params: Optional[Dict[str, str]] = None) -> List[Dict[str, Any]]:
        async with self._client() as client:
            response = await client.get(f"/{table}", params={"select": "*", **(params or {})})
        self._check(response)
        return response.json()

    async def select_all(self, table: str, params: Optional[Dict[str, str]] = None) -> List[Dict[str, Any]]:
        """Every matching row, fetched a page at a time. `params` should include a stable `order`."""
        rows: List[Dict[str, Any]] = []
        while True:
            page = await self.select(table, {**(params or {}), "limit": str(PAGE_SIZE), "offset": str(len(rows))})
            rows += page
            if len(page) < PAGE_SIZE:
                return rows

    async def insert(self, table: str, row: Dict[str, Any]) -> Dict[str, Any]:
        async with self._client() as client:
            response = await client.post(f"/{table}", json=row, headers={"Prefer": "return=representation"})
        self._check(response)
        rows = response.json()
        return rows[0] if rows else {}

    async def upsert(self, table: str, rows: List[Dict[str, Any]], on_conflict: str,
                     ignore_duplicates: bool = False, returning: bool = False) -> List[Dict[str, Any]]:
        """Insert rows, updating (or skipping) those that conflict on `on_conflict` columns."""
        if not rows:
            return []
        resolution = "ignore-duplicates" if ignore_duplicates else "merge-duplicates"
        prefer = f"resolution={resolution},return={'representation' if returning else 'minimal'}"
        async with self._client() as client:
            response = await client.post(f"/{table}", params={"on_conflict": on_conflict}, json=rows,
                                         headers={"Prefer": prefer})
        self._check(response)
        return response.json() if returning else []

    async def update(self, table: str, filters: Dict[str, str], values: Dict[str, Any]) -> List[Dict[str, Any]]:
        async with self._client() as client:
            response = await client.patch(
                f"/{table}", params=filters, json=values, headers={"Prefer": "return=representation"}
            )
        self._check(response)
        return response.json()

    async def delete(self, table: str, filters: Dict[str, str]) -> None:
        async with self._client() as client:
            response = await client.delete(f"/{table}", params=filters)
        self._check(response)

    async def count(self, table: str, params: Optional[Dict[str, str]] = None) -> int:
        async with self._client() as client:
            response = await client.head(
                f"/{table}", params={"select": "id", **(params or {})}, headers={"Prefer": "count=exact"}
            )
        self._check(response)
        content_range = response.headers.get("content-range", "*/0")
        total = content_range.rsplit("/", 1)[-1]
        return int(total) if total.isdigit() else 0
