"""
Supabase REST (PostgREST) Client.

Queries run with the signed-in user's own access token, so row-level security
scopes every read and write to that user. The server never holds a key that
could read other users' data.
"""

from typing import Any, Dict, List, Optional

import httpx

from src.app.core.config import Settings


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

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(base_url=self.base_url, headers=self.headers, timeout=10.0, transport=self.transport)

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

    async def insert(self, table: str, row: Dict[str, Any]) -> Dict[str, Any]:
        async with self._client() as client:
            response = await client.post(f"/{table}", json=row, headers={"Prefer": "return=representation"})
        self._check(response)
        rows = response.json()
        return rows[0] if rows else {}

    async def update(self, table: str, filters: Dict[str, str], values: Dict[str, Any]) -> List[Dict[str, Any]]:
        async with self._client() as client:
            response = await client.patch(
                f"/{table}", params=filters, json=values, headers={"Prefer": "return=representation"}
            )
        self._check(response)
        return response.json()

    async def count(self, table: str, params: Optional[Dict[str, str]] = None) -> int:
        async with self._client() as client:
            response = await client.head(
                f"/{table}", params={"select": "id", **(params or {})}, headers={"Prefer": "count=exact"}
            )
        self._check(response)
        content_range = response.headers.get("content-range", "*/0")
        total = content_range.rsplit("/", 1)[-1]
        return int(total) if total.isdigit() else 0
