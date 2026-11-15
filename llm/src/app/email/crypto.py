"""
Secrets at rest for email connections.

Refresh tokens and PKCE verifiers are encrypted with AES-256-GCM under a key only the API holds
(EMAIL_TOKEN_ENCRYPTION_KEY). The key id is bound as associated data, so a ciphertext only decrypts under the
key it was written with. Confirm tokens for sends are HMAC-signed with a key derived from the same secret.
"""

import base64
import hashlib
import hmac
import json
import os
import time
from typing import Any, Dict

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from src.app.core.config import get_settings

NONCE_BYTES = 12


class TokenCipherError(Exception):
    """Encryption isn't configured, or a ciphertext can't be decrypted with the current key."""


def _key() -> bytes:
    raw = get_settings().lookup("EMAIL_TOKEN_ENCRYPTION_KEY") or ""
    try:
        key = base64.b64decode(raw, validate=True)
    except (ValueError, TypeError) as e:
        raise TokenCipherError("EMAIL_TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded.") from e
    if len(key) != 32:
        raise TokenCipherError("EMAIL_TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded.")
    return key


def key_id() -> str:
    return get_settings().EMAIL_TOKEN_KEY_ID or "k1"


def is_configured() -> bool:
    try:
        _key()
    except TokenCipherError:
        return False
    return True


def encrypt(plaintext: str) -> str:
    nonce = os.urandom(NONCE_BYTES)
    sealed = AESGCM(_key()).encrypt(nonce, plaintext.encode("utf-8"), key_id().encode())
    return base64.b64encode(nonce + sealed).decode("ascii")


def decrypt(ciphertext: str, stored_key_id: str) -> str:
    if stored_key_id != key_id():
        raise TokenCipherError("This connection was encrypted with a key that is no longer configured.")
    try:
        data = base64.b64decode(ciphertext, validate=True)
        return AESGCM(_key()).decrypt(data[:NONCE_BYTES], data[NONCE_BYTES:], stored_key_id.encode()).decode("utf-8")
    except (ValueError, InvalidTag) as e:
        raise TokenCipherError("Stored credentials could not be decrypted.") from e


def sha256_hex(value: str | bytes) -> str:
    data = value.encode("utf-8") if isinstance(value, str) else value
    return hashlib.sha256(data).hexdigest()


def _signing_key() -> bytes:
    return hmac.new(_key(), b"ansly-confirm-token", hashlib.sha256).digest()


def sign(payload: Dict[str, Any], ttl_seconds: int) -> str:
    """A short-lived token proving the server issued `payload` (e.g. the exact drafts a user confirmed)."""
    body = base64.urlsafe_b64encode(json.dumps({**payload, "exp": int(time.time()) + ttl_seconds},
                                               separators=(",", ":"), sort_keys=True).encode()).decode()
    mac = hmac.new(_signing_key(), body.encode(), hashlib.sha256).hexdigest()
    return f"{body}.{mac}"


def verify(token: str) -> Dict[str, Any]:
    """The payload of a token from `sign`; raises ValueError when forged, malformed or expired."""
    body, _, mac = token.partition(".")
    expected = hmac.new(_signing_key(), body.encode(), hashlib.sha256).hexdigest()
    if not mac or not hmac.compare_digest(mac, expected):
        raise ValueError("invalid token")
    payload = json.loads(base64.urlsafe_b64decode(body.encode()))
    if not isinstance(payload, dict) or payload.get("exp", 0) < time.time():
        raise ValueError("expired token")
    return payload
