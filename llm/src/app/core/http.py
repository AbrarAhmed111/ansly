"""
Shared HTTP Client.

Opening a connection to Supabase (DNS, TCP, TLS) costs tens of milliseconds, so
the service keeps one pooled client and reuses its connections across requests.
The shared client carries no credentials: callers pass the signed-in user's
headers on every request, so one user's token can never leak into another's call.

An httpx client is bound to the event loop it was first used on. Serverless
runtimes and test runners can start a new loop, so the client is recreated
whenever the running loop changes.
"""

import asyncio
from typing import Optional

import httpx

TIMEOUT = httpx.Timeout(10.0, connect=5.0)
LIMITS = httpx.Limits(max_connections=100, max_keepalive_connections=20, keepalive_expiry=30.0)

_client: Optional[httpx.AsyncClient] = None
_loop: Optional[asyncio.AbstractEventLoop] = None


def shared_client() -> httpx.AsyncClient:
    """The pooled client for the running event loop."""
    global _client, _loop
    loop = asyncio.get_running_loop()
    if _client is None or _client.is_closed or _loop is not loop:
        _client = httpx.AsyncClient(timeout=TIMEOUT, limits=LIMITS)
        _loop = loop
    return _client


async def close_shared_client() -> None:
    global _client, _loop
    if _client is not None and _loop is asyncio.get_running_loop():
        await _client.aclose()
    _client, _loop = None, None
