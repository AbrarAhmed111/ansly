"""
Supabase Storage Client.

Like SupabaseRest, every call uses the signed-in user's own access token, so the
bucket's storage policies limit each user to their own `{user_id}/` prefix.
"""

from typing import List, Optional
from urllib.parse import quote

import httpx

from src.app.core.config import Settings
from src.app.db.rest import SupabaseError

RESUMES_BUCKET = "resumes"


class SupabaseStorage:
    def __init__(self, settings: Settings, access_token: str, transport: Optional[httpx.AsyncBaseTransport] = None):
        self.root = settings.SUPABASE_URL.rstrip("/")
        self.base_url = f"{self.root}/storage/v1"
        self.headers = {
            "apikey": settings.SUPABASE_PUBLISHABLE_KEY,
            "Authorization": f"Bearer {access_token}",
        }
        self.transport = transport

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

    @staticmethod
    def _path(path: str) -> str:
        return quote(path, safe="/")

    async def download(self, path: str, bucket: str = RESUMES_BUCKET) -> bytes:
        async with self._client() as client:
            response = await client.get(f"/object/authenticated/{bucket}/{self._path(path)}")
        self._check(response)
        return response.content

    async def upload(self, path: str, content: bytes, content_type: str, bucket: str = RESUMES_BUCKET) -> None:
        async with self._client() as client:
            response = await client.post(
                f"/object/{bucket}/{self._path(path)}",
                content=content,
                headers={"Content-Type": content_type, "x-upsert": "true"},
            )
        self._check(response)

    async def signed_url(self, path: str, expires_in: int, bucket: str = RESUMES_BUCKET,
                         download: Optional[str] = None) -> str:
        async with self._client() as client:
            response = await client.post(f"/object/sign/{bucket}/{self._path(path)}", json={"expiresIn": expires_in})
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
        async with self._client() as client:
            response = await client.request("DELETE", f"/object/{bucket}", json={"prefixes": paths})
        self._check(response)
