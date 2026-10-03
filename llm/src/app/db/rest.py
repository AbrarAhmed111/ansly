"""
Supabase REST (PostgREST) Client.

Queries run with the signed-in user's own access token, so row-level security
scopes every read and write to that user. The server never holds a key that
could read other users' data.

Requests go through the process-wide pooled client (see core/http.py) so
connections are reused; the user's headers are attached to each request.
"""

import time
from typing import Any, Dict, List, Optional

import httpx

from src.app.core import metrics
from src.app.core.config import Settings
from src.app.core.http import shared_client

# A pooled connection can be closed by the server while idle; idempotent reads retry once on a fresh one.
_STALE_CONNECTION_ERRORS = (httpx.RemoteProtocolError, httpx.ReadError)


class SupabaseError(Exception):
    def __init__(self, status_code: int, message: str):
        super().__init__(f"Supabase error {status_code}: {message}")
        self.status_code = status_code


class SupabaseRest:
    def __init__(self, settings: Settings, access_token: str, transport: Optional[httpx.AsyncBaseTransport] = None):
        self.base_url = f"{settings.SUPABASE_URL.rstrip('/')}/rest/v1"
        self.headers = {
            "apikey": settings.SUPABASE_PUBLISHABLE_KEY,
            "Authorization": f"Bearer {access_token}",
        }
        self.transport = transport
        self._own_client: Optional[httpx.AsyncClient] = None

    def _client(self) -> httpx.AsyncClient:
        if self.transport is None:
            return shared_client()
        if self._own_client is None:
            self._own_client = httpx.AsyncClient(timeout=10.0, transport=self.transport)
        return self._own_client

    async def _request(self, method: str, path: str, operation: str, *, headers: Optional[Dict[str, str]] = None,
                       **kwargs: Any) -> httpx.Response:
        url = f"{self.base_url}{path}"
        merged = {**self.headers, **(headers or {})}
        started = time.perf_counter()
        try:
            try:
                return await self._client().request(method, url, headers=merged, **kwargs)
            except _STALE_CONNECTION_ERRORS:
                if method not in ("GET", "HEAD"):
                    raise
                return await self._client().request(method, url, headers=merged, **kwargs)
        finally:
            metrics.record_db(operation, (time.perf_counter() - started) * 1000)

    @staticmethod
    def _check(response: httpx.Response) -> None:
        if response.status_code >= 400:
            try:
                message = response.json().get("message", response.text)
            except ValueError:
                message = response.text
            raise SupabaseError(response.status_code, message)

    async def select(self, table: str, params: Optional[Dict[str, str]] = None) -> List[Dict[str, Any]]:
        response = await self._request("GET", f"/{table}", f"select:{table}", params={"select": "*", **(params or {})})
        self._check(response)
        return response.json()

    async def insert(self, table: str, row: Dict[str, Any]) -> Dict[str, Any]:
        response = await self._request("POST", f"/{table}", f"insert:{table}", json=row,
                                       headers={"Prefer": "return=representation"})
        self._check(response)
        rows = response.json()
        return rows[0] if rows else {}

    async def insert_many(self, table: str, rows: List[Dict[str, Any]]) -> None:
        """Bulk insert in one request, without returning the rows."""
        if not rows:
            return
        response = await self._request("POST", f"/{table}", f"insert_many:{table}", json=rows,
                                       headers={"Prefer": "return=minimal"})
        self._check(response)

    async def upsert(self, table: str, rows: List[Dict[str, Any]], on_conflict: str) -> None:
        """Insert-or-update in one request, matching rows on the `on_conflict` columns (a unique key)."""
        if not rows:
            return
        response = await self._request("POST", f"/{table}", f"upsert:{table}", json=rows,
                                       params={"on_conflict": on_conflict},
                                       headers={"Prefer": "resolution=merge-duplicates,return=minimal"})
        self._check(response)

    async def update(self, table: str, filters: Dict[str, str], values: Dict[str, Any]) -> List[Dict[str, Any]]:
        response = await self._request("PATCH", f"/{table}", f"update:{table}", params=filters, json=values,
                                       headers={"Prefer": "return=representation"})
        self._check(response)
        return response.json()

    async def delete(self, table: str, filters: Dict[str, str]) -> List[Dict[str, Any]]:
        response = await self._request("DELETE", f"/{table}", f"delete:{table}", params=filters,
                                       headers={"Prefer": "return=representation"})
        self._check(response)
        return response.json()

    async def rpc(self, function: str, args: Optional[Dict[str, Any]] = None) -> Any:
        response = await self._request("POST", f"/rpc/{function}", f"rpc:{function}", json=args or {})
        self._check(response)
        return response.json()

    async def count(self, table: str, params: Optional[Dict[str, str]] = None) -> int:
        response = await self._request("HEAD", f"/{table}", f"count:{table}", params={"select": "id", **(params or {})},
                                       headers={"Prefer": "count=exact"})
        self._check(response)
        content_range = response.headers.get("content-range", "*/0")
        total = content_range.rsplit("/", 1)[-1]
        return int(total) if total.isdigit() else 0
