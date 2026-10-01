"""
Supabase JWT Authentication.

Verifies the user's Supabase access token on every request:
- Asymmetric signing keys (ES256/RS256): verified locally against the project's JWKS.
- Legacy HS256 secret: verified locally when SUPABASE_JWT_SECRET is set,
  otherwise by asking Supabase Auth (`GET /auth/v1/user`), cached briefly.
"""

import asyncio
import time
from dataclasses import dataclass
from typing import Dict, Optional, Tuple

import httpx
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from src.app.core.config import Settings, get_settings

AUDIENCE = "authenticated"
REMOTE_CACHE_SECONDS = 60
# Tolerated clock difference with Supabase: fresh tokens can be "issued" a moment in our future.
CLOCK_LEEWAY_SECONDS = 30

bearer_scheme = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class AuthUser:
    id: str
    email: Optional[str]
    token: str


class AuthError(Exception):
    pass


_jwks_clients: Dict[str, jwt.PyJWKClient] = {}
_remote_cache: Dict[str, Tuple[float, AuthUser]] = {}


def _jwks_client(supabase_url: str) -> jwt.PyJWKClient:
    url = f"{supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
    if url not in _jwks_clients:
        _jwks_clients[url] = jwt.PyJWKClient(url, cache_keys=True, lifespan=600)
    return _jwks_clients[url]


def _user_from_claims(claims: dict, token: str) -> AuthUser:
    if claims.get("role") != "authenticated" or not claims.get("sub"):
        raise AuthError("Token is not for a signed-in user")
    return AuthUser(id=claims["sub"], email=claims.get("email"), token=token)


async def _verify_remotely(token: str, settings: Settings) -> AuthUser:
    cached = _remote_cache.get(token)
    if cached and cached[0] > time.time():
        return cached[1]
    async with httpx.AsyncClient(timeout=5.0) as client:
        response = await client.get(
            f"{settings.SUPABASE_URL.rstrip('/')}/auth/v1/user",
            headers={"apikey": settings.SUPABASE_PUBLISHABLE_KEY, "Authorization": f"Bearer {token}"},
        )
    if response.status_code != 200:
        raise AuthError("Supabase rejected the token")
    data = response.json()
    user = AuthUser(id=data["id"], email=data.get("email"), token=token)
    _remote_cache[token] = (time.time() + REMOTE_CACHE_SECONDS, user)
    return user


async def verify_token(token: str, settings: Settings) -> AuthUser:
    if not settings.SUPABASE_URL:
        raise AuthError("Supabase is not configured on the server")
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError as e:
        raise AuthError("Malformed token") from e

    alg = header.get("alg")
    try:
        if alg in ("ES256", "RS256", "EdDSA"):
            # PyJWKClient fetches over blocking I/O on a cache miss.
            signing_key = await asyncio.to_thread(_jwks_client(settings.SUPABASE_URL).get_signing_key_from_jwt, token)
            claims = jwt.decode(token, signing_key.key, algorithms=[alg], audience=AUDIENCE, leeway=CLOCK_LEEWAY_SECONDS)
            return _user_from_claims(claims, token)
        if alg == "HS256":
            if settings.SUPABASE_JWT_SECRET:
                claims = jwt.decode(token, settings.SUPABASE_JWT_SECRET, algorithms=["HS256"], audience=AUDIENCE, leeway=CLOCK_LEEWAY_SECONDS)
                return _user_from_claims(claims, token)
            return await _verify_remotely(token, settings)
    except jwt.ExpiredSignatureError as e:
        raise AuthError("Token has expired") from e
    except jwt.PyJWTError as e:
        raise AuthError(f"Invalid token: {e}") from e
    raise AuthError(f"Unsupported token algorithm: {alg}")


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    settings: Settings = Depends(get_settings),
) -> AuthUser:
    """FastAPI dependency: the signed-in Supabase user, or 401."""
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token", {"WWW-Authenticate": "Bearer"})
    try:
        return await verify_token(credentials.credentials, settings)
    except AuthError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(e), {"WWW-Authenticate": "Bearer"}) from e
