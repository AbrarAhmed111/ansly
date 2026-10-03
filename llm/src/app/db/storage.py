"""
Supabase Storage Client.

Like SupabaseRest, every call uses the signed-in user's own access token, so the
bucket's storage policies limit each user to their own `{user_id}/` prefix, and
requests reuse the pooled client's connections.
"""

import time
from typing import Any, Dict, List, Optional
from urllib.parse import quote

import httpx

from src.app.core import metrics
from src.app.core.config import Settings
from src.app.core.http import shared_client
from src.app.db.rest import SupabaseError

RESUMES_BUCKET = "resumes"
TIMEOUT = httpx.Timeout(30.0, connect=5.0)


class SupabaseStorage:
    def __init__(self, settings: Settings, access_token: str, transport: Optional[httpx.AsyncBaseTransport] = None):
        self.root = settings.SUPABASE_URL.rstrip("/")
        self.base_url = f"{self.root}/storage/v1"
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
            self._own_client = httpx.AsyncClient(transport=self.transport)
        return self._own_client

    async def _request(self, method: str, path: str, operation: str, *,
                       headers: Optional[Dict[str, str]] = None, **kwargs: Any) -> httpx.Response:
        started = time.perf_counter()
        try:
            return await self._client().request(method, f"{self.base_url}{path}",
                                                headers={**self.headers, **(headers or {})}, timeout=TIMEOUT, **kwargs)
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

    @staticmethod
    def _path(path: str) -> str:
        return quote(path, safe="/")

    async def download(self, path: str, bucket: str = RESUMES_BUCKET) -> bytes:
        response = await self._request("GET", f"/object/authenticated/{bucket}/{self._path(path)}", "storage:download")
        self._check(response)
        return response.content

    async def upload(self, path: str, content: bytes, content_type: str, bucket: str = RESUMES_BUCKET) -> None:
        response = await self._request(
            "POST",
            f"/object/{bucket}/{self._path(path)}",
            "storage:upload",
            content=content,
            headers={"Content-Type": content_type, "x-upsert": "true"},
        )
        self._check(response)

    async def signed_url(self, path: str, expires_in: int, bucket: str = RESUMES_BUCKET,
                         download: Optional[str] = None) -> str:
        response = await self._request("POST", f"/object/sign/{bucket}/{self._path(path)}", "storage:sign",
                                       json={"expiresIn": expires_in})
        self._check(response)
        signed = response.json().get("signedURL") or response.json().get("signedUrl")
        if not signed:
            raise SupabaseError(502, "Storage returned no signed URL")
        url = f"{self.base_url}{signed}" if signed.startswith("/") else signed
        if download:
            url += ("&" if "?" in url else "?") + "download=" + quote(download)
        return url

    async def remove(self, paths: List[str], bucket: str = RESUMES_BUCKET) -> None:
        if not paths:
            return
        response = await self._request("DELETE", f"/object/{bucket}", "storage:remove", json={"prefixes": paths})
        self._check(response)
