"""
Tests for the Supabase connectivity check.
"""

import httpx
import pytest

from src.app.core import supabase
from src.app.core.config import Settings


def _use_settings(monkeypatch, **overrides):
    monkeypatch.setattr(supabase, "get_settings", lambda: Settings(_env_file=None, **overrides))


def _use_transport(monkeypatch, handler):
    real_client = httpx.AsyncClient
    monkeypatch.setattr(
        supabase.httpx,
        "AsyncClient",
        lambda **kwargs: real_client(transport=httpx.MockTransport(handler), **kwargs),
    )


@pytest.mark.asyncio
async def test_not_configured(monkeypatch):
    _use_settings(monkeypatch, SUPABASE_URL="", SUPABASE_PUBLISHABLE_KEY="")
    assert await supabase.check_supabase() == {"status": "not_configured"}


@pytest.mark.asyncio
async def test_ok_sends_key_to_auth_health(monkeypatch):
    _use_settings(monkeypatch, SUPABASE_URL="https://example.supabase.co/", SUPABASE_PUBLISHABLE_KEY="sb_publishable_x")
    seen = {}

    def handler(request):
        seen["url"] = str(request.url)
        seen["apikey"] = request.headers.get("apikey")
        return httpx.Response(200, json={})

    _use_transport(monkeypatch, handler)
    assert await supabase.check_supabase() == {"status": "ok"}
    assert seen == {"url": "https://example.supabase.co/auth/v1/health", "apikey": "sb_publishable_x"}


@pytest.mark.asyncio
async def test_http_error_status(monkeypatch):
    _use_settings(monkeypatch, SUPABASE_URL="https://example.supabase.co", SUPABASE_PUBLISHABLE_KEY="bad")
    _use_transport(monkeypatch, lambda request: httpx.Response(401))
    assert await supabase.check_supabase() == {"status": "error", "detail": "HTTP 401"}


@pytest.mark.asyncio
async def test_network_error(monkeypatch):
    _use_settings(monkeypatch, SUPABASE_URL="https://example.supabase.co", SUPABASE_PUBLISHABLE_KEY="x")

    def handler(request):
        raise httpx.ConnectError("unreachable")

    _use_transport(monkeypatch, handler)
    result = await supabase.check_supabase()
    assert result["status"] == "error"
    assert "ConnectError" in result["detail"]
