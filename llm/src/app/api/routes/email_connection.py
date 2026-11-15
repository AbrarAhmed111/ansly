"""
Email connection endpoints: connect, check, and disconnect the user's Gmail account (send-only access).

The OAuth `state` is random, stored hashed with the user's id and an encrypted PKCE verifier, valid for 10
minutes, and usable once. Google redirects the browser to the web app, which posts the code back here with the
user's own token, so the exchange is tied to the signed-in user.
"""

import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Response, status

from src.app.api.deps import get_rest
from src.app.core.auth import AuthUser, get_current_user
from src.app.db.rest import SupabaseError, SupabaseRest
from src.app.email import crypto, gmail
from src.app.schemas.lead_emails import CallbackRequest, ConnectRequest, ConnectResponse, EmailConnectionResponse

logger = logging.getLogger("EmailConnectionAPI")
router = APIRouter(prefix="/email", tags=["Email sending"])

STATE_TTL = timedelta(minutes=10)
PROVIDER = "gmail"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _require_configured() -> None:
    if not gmail.is_configured() or not crypto.is_configured():
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Gmail sending isn't set up on this Ansly server. Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET "
            "and EMAIL_TOKEN_ENCRYPTION_KEY on the API.",
        )


async def get_connection(rest: SupabaseRest) -> Optional[Dict[str, Any]]:
    rows = await rest.select("email_connections", {"provider": f"eq.{PROVIDER}", "limit": "1"})
    return rows[0] if rows else None


async def access_for_sending(rest: SupabaseRest) -> Tuple[Dict[str, Any], str]:
    """The connection and a fresh access token. Raises GmailError (with a safe code) when sending can't start."""
    connection = await get_connection(rest)
    if connection is None:
        raise gmail.GmailError("Connect Gmail to send emails.", "not_connected")
    if connection["status"] == "needs_reauth":
        raise gmail.ReauthRequiredError("Gmail access has expired or was removed. Reconnect Gmail to send.")
    try:
        refresh_token = crypto.decrypt(connection["refresh_token_ciphertext"], connection["token_key_id"])
    except crypto.TokenCipherError as e:
        await _mark_reauth(rest, connection, "key_changed")
        raise gmail.ReauthRequiredError("Reconnect Gmail to send (stored access can't be read).") from e
    try:
        token = await gmail.access_token(refresh_token)
    except gmail.ReauthRequiredError:
        await _mark_reauth(rest, connection, "reauth_required")
        raise
    await rest.update("email_connections", {"id": f"eq.{connection['id']}"}, {"last_used_at": _now().isoformat()})
    return connection, token


async def _mark_reauth(rest: SupabaseRest, connection: Dict[str, Any], code: str) -> None:
    try:
        await rest.update("email_connections", {"id": f"eq.{connection['id']}"},
                          {"status": "needs_reauth", "last_error_code": code})
    except SupabaseError as e:
        logger.warning(f"Could not mark email connection for reconnect: {e}")


def _response(connection: Optional[Dict[str, Any]]) -> EmailConnectionResponse:
    configured = gmail.is_configured() and crypto.is_configured()
    if connection is None:
        return EmailConnectionResponse(configured=configured, connected=False)
    return EmailConnectionResponse(
        configured=configured, connected=True, provider=connection["provider"],
        email_address=connection["email_address"], status=connection["status"],
        granted_scopes=list(connection.get("granted_scopes") or []),
    )


@router.get("/connection", response_model=EmailConnectionResponse, summary="The connected sending account, if any")
async def read_connection(rest: SupabaseRest = Depends(get_rest)) -> EmailConnectionResponse:
    try:
        return _response(await get_connection(rest))
    except SupabaseError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Could not load your email connection.") from e


@router.post("/gmail/connect", response_model=ConnectResponse, summary="Start connecting Gmail (send-only)")
async def connect_gmail(
    request: ConnectRequest,
    user: AuthUser = Depends(get_current_user),
    rest: SupabaseRest = Depends(get_rest),
) -> ConnectResponse:
    _require_configured()
    state = secrets.token_urlsafe(32)
    verifier, challenge = gmail.new_pkce()
    try:
        await rest.delete("email_oauth_states", {"expires_at": f"lt.{_now().isoformat()}"})
        await rest.insert("email_oauth_states", {
            "state_hash": crypto.sha256_hex(state),
            "provider": PROVIDER,
            "code_verifier_ciphertext": crypto.encrypt(verifier),
            "expires_at": (_now() + STATE_TTL).isoformat(),
        })
    except SupabaseError as e:
        logger.error(f"Could not start Gmail connection for user {user.id}: {e}")
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Could not start connecting Gmail. Please try again.") from e
    return ConnectResponse(authorization_url=gmail.authorization_url(state, challenge, request.login_hint or user.email))


@router.post("/gmail/callback", response_model=EmailConnectionResponse, summary="Finish connecting Gmail")
async def gmail_callback(
    request: CallbackRequest,
    user: AuthUser = Depends(get_current_user),
    rest: SupabaseRest = Depends(get_rest),
) -> EmailConnectionResponse:
    _require_configured()
    state_hash = crypto.sha256_hex(request.state)
    try:
        # RLS limits this to the signed-in user's states; deleting it makes the state single-use.
        rows = await rest.delete("email_oauth_states", {"state_hash": f"eq.{state_hash}"})
    except SupabaseError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Could not finish connecting Gmail. Please try again.") from e
    row = rows[0] if rows else None
    if row is None or row.get("provider") != PROVIDER or str(row.get("user_id")) != str(user.id):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This Gmail sign-in link isn't valid. Start connecting again.")
    if datetime.fromisoformat(str(row["expires_at"]).replace("Z", "+00:00")) < _now():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This Gmail sign-in expired. Start connecting again.")

    try:
        verifier = crypto.decrypt(row["code_verifier_ciphertext"], crypto.key_id())
        grant = await gmail.exchange_code(request.code, verifier)
    except gmail.GmailError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    except crypto.TokenCipherError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Start connecting Gmail again.") from e

    values = {
        "provider": PROVIDER,
        "email_address": grant.email,
        "granted_scopes": grant.scopes,
        "refresh_token_ciphertext": crypto.encrypt(grant.refresh_token),
        "token_key_id": crypto.key_id(),
        "status": "connected",
        "last_error_code": None,
        "connected_at": _now().isoformat(),
    }
    try:
        existing = await get_connection(rest)
        if existing:
            updated = await rest.update("email_connections", {"id": f"eq.{existing['id']}"}, values)
            connection = updated[0] if updated else {**existing, **values}
        else:
            connection = await rest.insert("email_connections", values)
    except SupabaseError as e:
        logger.error(f"Could not save Gmail connection for user {user.id}: {e}")
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Could not save the Gmail connection. Please try again.") from e
    return _response(connection)


@router.delete("/connection", status_code=status.HTTP_204_NO_CONTENT, summary="Disconnect Gmail and revoke access")
async def disconnect(rest: SupabaseRest = Depends(get_rest)) -> Response:
    try:
        connection = await get_connection(rest)
        if connection is None:
            return Response(status_code=status.HTTP_204_NO_CONTENT)
        try:
            refresh_token = crypto.decrypt(connection["refresh_token_ciphertext"], connection["token_key_id"])
            if not await gmail.revoke(refresh_token):
                logger.warning("Google didn't confirm token revocation; the connection is removed anyway.")
        except crypto.TokenCipherError:
            logger.warning("Stored Gmail token couldn't be decrypted for revocation; removing the connection.")
        await rest.delete("email_connections", {"id": f"eq.{connection['id']}"})
    except SupabaseError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Could not disconnect Gmail. Please try again.") from e
    return Response(status_code=status.HTTP_204_NO_CONTENT)
