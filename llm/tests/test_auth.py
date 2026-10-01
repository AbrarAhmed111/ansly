"""
Supabase JWT verification tests: asymmetric (JWKS), legacy HS256, and remote fallback.
"""

import time
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec

from src.app.core import auth
from src.app.core.auth import AuthError, verify_token
from src.app.core.config import Settings

URL = "https://example.supabase.co"


def _settings(**kw) -> Settings:
    return Settings(_env_file=None, SUPABASE_URL=URL, SUPABASE_PUBLISHABLE_KEY="pk", **kw)


def _claims(**overrides) -> dict:
    now = int(time.time())
    return {"sub": "user-1", "email": "u@example.com", "role": "authenticated", "aud": "authenticated",
            "iat": now, "exp": now + 3600, **overrides}


@pytest.fixture
def es256_key():
    return ec.generate_private_key(ec.SECP256R1())


@pytest.fixture(autouse=True)
def clear_caches():
    auth._jwks_clients.clear()
    auth._remote_cache.clear()


def _patch_jwks(public_key):
    client = SimpleNamespace(get_signing_key_from_jwt=lambda token: SimpleNamespace(key=public_key))
    return patch.object(auth, "_jwks_client", return_value=client)


@pytest.mark.asyncio
async def test_es256_token_verified_against_jwks(es256_key):
    token = jwt.encode(_claims(), es256_key, algorithm="ES256", headers={"kid": "k1"})
    with _patch_jwks(es256_key.public_key()):
        user = await verify_token(token, _settings())
    assert (user.id, user.email, user.token) == ("user-1", "u@example.com", token)


@pytest.mark.asyncio
async def test_es256_wrong_key_rejected(es256_key):
    token = jwt.encode(_claims(), es256_key, algorithm="ES256")
    other = ec.generate_private_key(ec.SECP256R1()).public_key()
    with _patch_jwks(other), pytest.raises(AuthError):
        await verify_token(token, _settings())


@pytest.mark.asyncio
async def test_expired_and_anon_tokens_rejected(es256_key):
    expired = jwt.encode(_claims(exp=int(time.time()) - 120), es256_key, algorithm="ES256")
    anon = jwt.encode(_claims(role="anon"), es256_key, algorithm="ES256")
    with _patch_jwks(es256_key.public_key()):
        with pytest.raises(AuthError, match="expired"):
            await verify_token(expired, _settings())
        with pytest.raises(AuthError, match="signed-in"):
            await verify_token(anon, _settings())


@pytest.mark.asyncio
async def test_hs256_with_secret():
    secret = "super-secret-jwt-token-with-at-least-32-characters"
    token = jwt.encode(_claims(), secret, algorithm="HS256")
    user = await verify_token(token, _settings(SUPABASE_JWT_SECRET=secret))
    assert user.id == "user-1"
    with pytest.raises(AuthError):
        await verify_token(jwt.encode(_claims(), "x" * 40, algorithm="HS256"), _settings(SUPABASE_JWT_SECRET=secret))


@pytest.mark.asyncio
async def test_hs256_without_secret_asks_supabase_and_caches():
    token = jwt.encode(_claims(), "x" * 40, algorithm="HS256")
    calls = []

    def handler(request: httpx.Request):
        calls.append(request)
        assert request.url.path == "/auth/v1/user"
        assert request.headers["authorization"] == f"Bearer {token}"
        return httpx.Response(200, json={"id": "user-1", "email": "u@example.com"})

    real_client = httpx.AsyncClient
    with patch.object(auth.httpx, "AsyncClient",
                      lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw)):
        assert (await verify_token(token, _settings())).id == "user-1"
        assert (await verify_token(token, _settings())).id == "user-1"
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_malformed_and_unconfigured():
    with pytest.raises(AuthError, match="Malformed"):
        await verify_token("nope", _settings())
    with pytest.raises(AuthError, match="not configured"):
        await verify_token("nope", Settings(_env_file=None, SUPABASE_URL=""))


@pytest.mark.asyncio
async def test_dependency_returns_401():
    from fastapi import HTTPException

    from src.app.core.auth import get_current_user

    with pytest.raises(HTTPException) as exc:
        await get_current_user(None, _settings())
    assert exc.value.status_code == 401
    creds = SimpleNamespace(scheme="Bearer", credentials="bad")
    with patch.object(auth, "verify_token", AsyncMock(side_effect=AuthError("Invalid token"))):
        with pytest.raises(HTTPException) as exc:
            await get_current_user(creds, _settings())
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_small_clock_skew_is_tolerated(es256_key):
    now = int(time.time())
    fresh = jwt.encode(_claims(iat=now + 5), es256_key, algorithm="ES256")
    with _patch_jwks(es256_key.public_key()):
        assert (await verify_token(fresh, _settings())).id == "user-1"
        too_far = jwt.encode(_claims(iat=now + 600), es256_key, algorithm="ES256")
        with pytest.raises(AuthError):
            await verify_token(too_far, _settings())
