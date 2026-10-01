"""
Supabase Connectivity.
Checks that the configured Supabase project is reachable with the configured key.
"""

import httpx

from src.app.core.config import get_settings


async def check_supabase() -> dict:
    """
    Pings the Supabase Auth health endpoint.
    Returns a status dict suitable for the /health response.
    """
    settings = get_settings()
    if not settings.SUPABASE_URL or not settings.SUPABASE_PUBLISHABLE_KEY:
        return {"status": "not_configured"}

    url = f"{settings.SUPABASE_URL.rstrip('/')}/auth/v1/health"
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(url, headers={"apikey": settings.SUPABASE_PUBLISHABLE_KEY})
    except httpx.HTTPError as exc:
        return {"status": "error", "detail": f"{type(exc).__name__}: {exc}"}

    if response.status_code != 200:
        return {"status": "error", "detail": f"HTTP {response.status_code}"}
    return {"status": "ok"}
