"""Vends short-lived JWTs scoped to (agent_id, tenant_id)."""
import os
import time

import jwt
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

# Admin auth is applied again at include_router() time in api/main.py.
# Keeping this defensive import so the module is usable standalone.
try:
    from nmb_marketplace_agent.api.auth import require_admin
    _auth_deps: list = [Depends(require_admin)]
except Exception:  # pragma: no cover
    _auth_deps = []

router = APIRouter()

JWT_SECRET = os.environ.get("NMB_JWT_SECRET", "dev-only-change-me")
JWT_TTL_SECONDS = int(os.environ.get("NMB_JWT_TTL", "60"))


class TokenRequest(BaseModel):
    agent_id: str
    tenant_id: str = "default"
    user_id: str | None = None


class TokenResponse(BaseModel):
    token: str
    expires_in: int


@router.post("", dependencies=_auth_deps)
async def mint(body: TokenRequest) -> TokenResponse:
    if JWT_SECRET == "dev-only-change-me" and os.environ.get("ENV", "dev") != "dev":
        raise HTTPException(500, "NMB_JWT_SECRET not configured")

    now = int(time.time())
    payload = {
        "sub": body.user_id or "anonymous",
        "agent_id": body.agent_id,
        "tenant_id": body.tenant_id,
        "iat": now,
        "exp": now + JWT_TTL_SECONDS,
        "aud": "langgraph",
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm="HS256")
    return TokenResponse(token=token, expires_in=JWT_TTL_SECONDS)
