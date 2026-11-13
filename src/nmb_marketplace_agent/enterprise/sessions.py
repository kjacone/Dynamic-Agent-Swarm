"""Short-lived end-user session tokens for the public chat surface.

An API key identifies the tenant/agent. A session token additionally identifies
the end user (and, for server-minted sessions, the customer that user belongs to).
Widgets and SDKs exchange their API key for a session, then send only the session
token with each chat turn, so the browser never carries a long-lived secret.

Tokens are HS256 and scoped to one API key (``kid``). They are deliberately *not*
tenant-admin JWTs: ``aud`` is ``nmb-session``, and ``rbac.principal_from_token``
refuses that audience, so a browser token can never be replayed against admin APIs.
"""
from __future__ import annotations

import os
import time
import uuid

import jwt
from fastapi import HTTPException

AUDIENCE = "nmb-session"
ISSUER = "nmb-gateway"
DEFAULT_TTL = 900
MAX_TTL = 3600

_SCOPE_PUBLIC = "public"      # publishable key, anonymous/user-label subject
_SCOPE_END_USER = "end_user"  # secret key minted on behalf of an authenticated user
_SCOPES = {_SCOPE_PUBLIC, _SCOPE_END_USER}


def _secret() -> str:
    secret = (os.environ.get("NMB_SESSION_SECRET") or os.environ.get("NMB_JWT_SECRET") or "").strip()
    if len(secret) < 32:
        raise HTTPException(503, "Session tokens need NMB_SESSION_SECRET (>=32 chars)")
    return secret


def mint_session(*, tenant_id: str, agent_id: str, key_id: str, subject: str,
                 customer_id: str | None = None, scope: str = _SCOPE_PUBLIC,
                 ttl_s: int | None = None) -> tuple[str, int]:
    """Return ``(token, ttl_seconds)``. TTL is clamped to [60, MAX_TTL]."""
    if scope not in _SCOPES:
        raise ValueError(f"Unknown session scope: {scope}")
    ttl = int(ttl_s or os.environ.get("NMB_SESSION_TTL", DEFAULT_TTL))
    ttl = max(60, min(ttl, MAX_TTL))
    now = int(time.time())
    claims = {
        "iss": ISSUER,
        "aud": AUDIENCE,
        "sub": subject,
        "tenant_id": tenant_id,
        "agent_id": agent_id,
        "kid": key_id,
        "scope": scope,
        "iat": now,
        "exp": now + ttl,
        "jti": str(uuid.uuid4()),
    }
    if customer_id:
        claims["customer_id"] = customer_id
    return jwt.encode(claims, _secret(), algorithm="HS256"), ttl


def decode_session(token: str) -> dict:
    try:
        claims = jwt.decode(
            token,
            _secret(),
            algorithms=["HS256"],
            audience=AUDIENCE,
            issuer=ISSUER,
            options={"require": ["exp", "iat", "sub", "tenant_id", "agent_id", "kid", "scope"]},
        )
    except jwt.ExpiredSignatureError as e:
        raise HTTPException(401, "Session expired") from e
    except jwt.PyJWTError as e:
        raise HTTPException(401, "Invalid session token") from e
    if claims.get("scope") not in _SCOPES:
        raise HTTPException(401, "Invalid session scope")
    return claims


def is_session_token(raw: str) -> bool:
    """Cheap shape check so API keys and session tokens can share ``Authorization``."""
    return raw.count(".") == 2 and not raw.startswith(("pk_", "sk_"))
