"""
Gmail through Google OAuth 2.0 (web server flow with PKCE) and the Gmail API.

Scopes: gmail.send (send only; Ansly can't read the mailbox), plus openid and email to show which address is
connected. Messages go through the media upload endpoint as raw RFC 822, so attachments need no extra encoding.
"""

import base64
import hashlib
import json
import secrets
from dataclasses import dataclass
from typing import List, Optional
from urllib.parse import urlencode

import httpx

from src.app.core.config import get_settings

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
REVOKE_URL = "https://oauth2.googleapis.com/revoke"
SEND_URL = "https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media"
SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send"
SCOPES = ["openid", "email", SEND_SCOPE]
TIMEOUT = httpx.Timeout(30.0, connect=10.0)


class GmailError(Exception):
    """A Gmail call failed; `code` is safe to store and show."""

    code = "provider_error"

    def __init__(self, message: str, code: Optional[str] = None):
        super().__init__(message)
        if code:
            self.code = code


class NotConfiguredError(GmailError):
    code = "not_configured"


class ReauthRequiredError(GmailError):
    code = "reauth_required"


class RateLimitedError(GmailError):
    code = "rate_limited"

    def __init__(self, message: str, retry_after: Optional[int] = None):
        super().__init__(message)
        self.retry_after = retry_after


class RejectedError(GmailError):
    """Gmail refused this message (e.g. invalid recipient); other messages can still be sent."""

    code = "rejected"


class OutcomeUnknownError(GmailError):
    """The request may have reached Gmail: the email may or may not have been sent."""

    code = "outcome_unknown"


@dataclass
class TokenGrant:
    refresh_token: str
    email: str
    scopes: List[str]


def _client() -> tuple[str, str]:
    settings = get_settings()
    client_id = settings.lookup("GOOGLE_OAUTH_CLIENT_ID")
    secret = settings.lookup("GOOGLE_OAUTH_CLIENT_SECRET")
    if not client_id or not secret:
        raise NotConfiguredError("Gmail sending isn't set up on this Ansly server (GOOGLE_OAUTH_CLIENT_ID/SECRET).")
    return client_id, secret


def is_configured() -> bool:
    try:
        _client()
    except NotConfiguredError:
        return False
    return True


def new_pkce() -> tuple[str, str]:
    """(verifier, S256 challenge)."""
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


def authorization_url(state: str, code_challenge: str, login_hint: Optional[str] = None) -> str:
    client_id, _ = _client()
    params = {
        "client_id": client_id,
        "redirect_uri": get_settings().GOOGLE_OAUTH_REDIRECT_URI,
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "access_type": "offline",
        # Always show consent so Google returns a refresh token, even on reconnect.
        "prompt": "consent",
        "include_granted_scopes": "false",
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    if login_hint:
        params["login_hint"] = login_hint
    return f"{AUTH_URL}?{urlencode(params)}"


def _id_token_email(id_token: str, client_id: str) -> str:
    """The verified address from an ID token received directly from Google's token endpoint over TLS
    (OpenID Connect allows skipping signature checks in that case); audience and issuer are still checked."""
    try:
        payload = id_token.split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    except (IndexError, ValueError) as e:
        raise GmailError("Google returned an unreadable identity token.") from e
    if claims.get("aud") != client_id or claims.get("iss") not in ("https://accounts.google.com", "accounts.google.com"):
        raise GmailError("Google returned an identity token for a different app.")
    if not claims.get("email") or claims.get("email_verified") is False:
        raise GmailError("Google didn't confirm the account's email address.")
    return str(claims["email"])


async def exchange_code(code: str, code_verifier: str) -> TokenGrant:
    client_id, secret = _client()
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        response = await client.post(TOKEN_URL, data={
            "code": code,
            "client_id": client_id,
            "client_secret": secret,
            "redirect_uri": get_settings().GOOGLE_OAUTH_REDIRECT_URI,
            "grant_type": "authorization_code",
            "code_verifier": code_verifier,
        })
    if response.status_code != 200:
        raise GmailError("Google didn't accept the sign-in. Please try connecting again.", "oauth_exchange_failed")
    data = response.json()
    scopes = str(data.get("scope", "")).split()
    if SEND_SCOPE not in scopes:
        raise GmailError("Ansly needs permission to send email. Connect again and allow sending.", "scope_missing")
    if not data.get("refresh_token"):
        raise GmailError("Google didn't return long-lived access. Please try connecting again.", "no_refresh_token")
    return TokenGrant(refresh_token=data["refresh_token"], email=_id_token_email(data.get("id_token", ""), client_id),
                      scopes=scopes)


async def access_token(refresh_token: str) -> str:
    client_id, secret = _client()
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            response = await client.post(TOKEN_URL, data={
                "client_id": client_id,
                "client_secret": secret,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
            })
    except httpx.HTTPError as e:
        raise GmailError("Couldn't reach Google. Please try again.") from e
    if response.status_code in (400, 401):
        # invalid_grant: revoked, expired (Testing apps expire after 7 days), or the password changed.
        raise ReauthRequiredError("Gmail access has expired or was removed. Reconnect Gmail to send.")
    if response.status_code != 200:
        raise GmailError("Google couldn't refresh access right now. Please try again.")
    return str(response.json()["access_token"])


async def revoke(refresh_token: str) -> bool:
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            response = await client.post(REVOKE_URL, data={"token": refresh_token})
    except httpx.HTTPError:
        return False
    return response.status_code == 200


async def send(token: str, raw_message: bytes) -> str:
    """Sends one message; returns Gmail's message id."""
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            response = await client.post(SEND_URL, content=raw_message, headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "message/rfc822",
            })
    except (httpx.ConnectError, httpx.ConnectTimeout) as e:
        # Never reached Google: nothing was sent.
        raise GmailError("Couldn't reach Gmail. Nothing was sent.") from e
    except httpx.HTTPError as e:
        raise OutcomeUnknownError("Gmail didn't answer in time. The email may have been sent.") from e

    if response.status_code == 200:
        return str(response.json().get("id", ""))
    if response.status_code == 401:
        raise ReauthRequiredError("Gmail access has expired or was removed. Reconnect Gmail to send.")
    if response.status_code == 429 or (response.status_code == 403 and "rateLimit" in response.text):
        retry = response.headers.get("Retry-After")
        raise RateLimitedError("Gmail's sending limit was reached. Try again later.",
                               int(retry) if retry and retry.isdigit() else None)
    if response.status_code == 403:
        raise ReauthRequiredError("Gmail refused to send for this account. Reconnect Gmail and allow sending.")
    if 400 <= response.status_code < 500:
        raise RejectedError("Gmail rejected this email. Check the recipient address.")
    raise GmailError("Gmail had a problem sending this email. Nothing was confirmed as sent.")
