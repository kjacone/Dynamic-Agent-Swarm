import collections
import hashlib
import hmac
import os
import time

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from nmb_marketplace_agent.api.deps import get_db
from nmb_marketplace_agent.config.models import ApiKey


def hash_key(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def require_admin(authorization: str = Header(default="")):
    token = os.environ.get("ADMIN_TOKEN", "")
    if not token:
        raise HTTPException(503, "ADMIN_TOKEN is not set on the server")
    given = authorization.removeprefix("Bearer ").strip()
    if not hmac.compare_digest(given, token):
        raise HTTPException(401, "Invalid admin token")


_hits: dict[str, collections.deque] = collections.defaultdict(collections.deque)


def check_rate(key: ApiKey) -> None:
    now, q = time.time(), _hits[key.id]
    while q and q[0] < now - 60:
        q.popleft()
    if len(q) >= key.rate_limit_per_min:
        raise HTTPException(429, "Rate limit exceeded")
    q.append(now)


async def _authenticate(request: Request, authorization: str, x_api_key: str, db: AsyncSession) -> ApiKey:
    raw = x_api_key or authorization.removeprefix("Bearer ").strip()
    if not raw:
        raise HTTPException(401, "Missing API key")
    res = await db.execute(select(ApiKey).where(ApiKey.key_hash == hash_key(raw)))
    key = res.scalars().first()
    if not key or key.revoked:
        raise HTTPException(401, "Invalid or revoked API key")
    if key.kind == "publishable":
        allowed = key.allowed_origins or []
        # An empty allow-list is treated as "unconfigured" and rejects all browser
        # origins — the admin must explicitly set ["*"] or specific origins.
        if "*" not in allowed and request.headers.get("origin", "") not in allowed:
            raise HTTPException(403, "Origin not allowed for this key")



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
    check_rate(key)
    return key

verify_api_key = require_api_key_nocount