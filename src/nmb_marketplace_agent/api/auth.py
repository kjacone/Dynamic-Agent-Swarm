import collections
import hashlib
import hmac
import logging
import os
import time
from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from nmb_marketplace_agent.api.deps import get_db
from nmb_marketplace_agent.config.models import ApiKey
from nmb_marketplace_agent.enterprise.sessions import decode_session, is_session_token


def hash_key(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def require_admin(authorization: str = Header(default="")):
    token = os.environ.get("ADMIN_TOKEN", "")
    if not token:
        raise HTTPException(503, "ADMIN_TOKEN is not set on the server")
    given = authorization.removeprefix("Bearer ").strip()
    if not hmac.compare_digest(given, token):
        raise HTTPException(401, "Invalid admin token")


log = logging.getLogger(__name__)

_hits: dict[str, collections.deque] = collections.defaultdict(collections.deque)
_redis_client = None
_redis_broken = False
_redis_retry_after = 0.0


def _check_local(key: ApiKey) -> None:
    now, q = time.time(), _hits[key.id]
    while q and q[0] < now - 60:
        q.popleft()
    if len(q) >= key.rate_limit_per_min:
        raise HTTPException(429, "Rate limit exceeded")
    q.append(now)


async def _redis_hit(key: ApiKey) -> int | None:
    """Fixed one-minute window shared by every worker; None means 'use the local limiter'."""
    global _redis_client, _redis_broken, _redis_retry_after
    url = os.environ.get("REDIS_URL", "").strip()
    if not url or _redis_broken or time.time() < _redis_retry_after:
        return None
    if _redis_client is None:
        try:
            from redis.asyncio import from_url
        except ImportError:
            _redis_broken = True
            log.warning("REDIS_URL is set but the 'redis' package is not installed; "
                        "rate limits are per process.")
            return None
        _redis_client = from_url(url, decode_responses=True)
    bucket = f"nmb:rl:{key.id}:{int(time.time() // 60)}"
    try:
        pipe = _redis_client.pipeline()
        pipe.incr(bucket)
        pipe.expire(bucket, 120)
        count, _ = await pipe.execute()
        return int(count)
    except Exception:  # noqa: BLE001 - availability beats strictness here
        _redis_retry_after = time.time() + 30
        log.warning("Redis rate limiter unavailable; falling back to in-process limits.", exc_info=True)
        return None


async def check_rate(key: ApiKey) -> None:
    count = await _redis_hit(key)
    if count is not None:
        if count > key.rate_limit_per_min:
            raise HTTPException(429, "Rate limit exceeded")
        return
    _check_local(key)


def _check_origin(key: ApiKey, request: Request) -> None:
    if key.kind != "publishable":
        return
    # Browsers omit Origin on same-origin GET/HEAD, so a missing header on a safe
    # method is normal (the bearer session still proves who is asking, and CORS
    # keeps other sites from reading the reply). Writes must name their origin.
    if not request.headers.get("origin") and request.method in ("GET", "HEAD"):
        return
    allowed = key.allowed_origins or []
    # An empty allow-list is treated as "unconfigured" and rejects all browser
    # origins; the admin must explicitly set ["*"] or specific origins.
    if "*" not in allowed and request.headers.get("origin", "") not in allowed:
        raise HTTPException(403, "Origin not allowed for this key")


async def _authenticate(request: Request, authorization: str, x_api_key: str, db: AsyncSession) -> ApiKey:
    raw = x_api_key or authorization.removeprefix("Bearer ").strip()
    if not raw:
        raise HTTPException(401, "Missing API key")
    res = await db.execute(select(ApiKey).where(ApiKey.key_hash == hash_key(raw)))
    key = res.scalars().first()
    if not key or key.revoked:
        raise HTTPException(401, "Invalid or revoked API key")
    _check_origin(key, request)
    return key  # <- was missing: every API-key request crashed without it


@dataclass
class ChatPrincipal:
    """The identity behind one public chat request.

    ``user_id`` is only trustworthy when ``auth == "session"``. For raw API-key
    calls it defaults to None and the caller may still pass a label in the body
    (SDK backward compatibility), which is audited as a self-asserted identity.
    """
    tenant_id: str
    agent_id: str
    user_id: str | None = None
    customer_id: str | None = None
    auth: str = "api_key"       # api_key | session
    scope: str = "api_key"      # api_key | public | end_user
    actor: str = ""
    actor_type: str = "api_key"
    key: ApiKey | None = None
    claims: dict | None = None


def _api_principal(key: ApiKey) -> ChatPrincipal:
    return ChatPrincipal(
        tenant_id=key.tenant_id,
        agent_id=key.agent_id,
        auth="api_key",
        scope="api_key",
        actor=f"key:{key.prefix or key.id}",
        actor_type="api_key",
        key=key,
    )


async def _session_principal(raw: str, request: Request, db: AsyncSession) -> ChatPrincipal:
    claims = decode_session(raw)
    key = await db.get(ApiKey, claims.get("kid", ""))
    if not key or key.revoked:
        raise HTTPException(401, "Session key is no longer valid")
    if key.tenant_id != claims.get("tenant_id") or key.agent_id != claims.get("agent_id"):
        raise HTTPException(401, "Session no longer matches its API key")
    _check_origin(key, request)
    sub = str(claims.get("sub"))
    return ChatPrincipal(
        tenant_id=key.tenant_id,
        agent_id=key.agent_id,
        user_id=sub,
        customer_id=claims.get("customer_id"),
        auth="session",
        scope=claims.get("scope", "public"),
        actor=f"session:{sub}",
        actor_type="user",
        key=key,
        claims=claims,
    )


async def _chat_principal(request: Request, authorization: str, x_api_key: str,
                          db: AsyncSession) -> ChatPrincipal:
    raw = x_api_key or authorization.removeprefix("Bearer ").strip()
    if not raw:
        raise HTTPException(401, "Missing API key or session token")
    if is_session_token(raw):
        return await _session_principal(raw, request, db)
    return _api_principal(await _authenticate(request, authorization, x_api_key, db))


async def require_api_key_nocount(
    request: Request,
    authorization: str = Header(default=""),
    x_api_key: str = Header(default=""),
    db: AsyncSession = Depends(get_db),
) -> ApiKey:
    return await _authenticate(request, authorization, x_api_key, db)


async def require_api_key(
    request: Request,
    authorization: str = Header(default=""),
    x_api_key: str = Header(default=""),
    db: AsyncSession = Depends(get_db),
) -> ApiKey:
    key = await _authenticate(request, authorization, x_api_key, db)
    await check_rate(key)
    return key


async def require_chat_principal_nocount(
    request: Request,
    authorization: str = Header(default=""),
    x_api_key: str = Header(default=""),
    db: AsyncSession = Depends(get_db),
) -> ChatPrincipal:
    return await _chat_principal(request, authorization, x_api_key, db)


async def require_chat_principal(
    request: Request,
    authorization: str = Header(default=""),
    x_api_key: str = Header(default=""),
    db: AsyncSession = Depends(get_db),
) -> ChatPrincipal:
    principal = await _chat_principal(request, authorization, x_api_key, db)
    if principal.key:
        await check_rate(principal.key)
    return principal


verify_api_key = require_api_key_nocount