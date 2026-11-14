"""Demo accounts for walkthroughs.

Off by default outside dev/demo deployments: sign-in only works when
``DEMO_ACCOUNTS`` is on, or when it is unset and the deployment is not a
production, licence-enforced one. Tokens are ordinary HS256 tenant JWTs minted
with ``NMB_JWT_SECRET`` — the same verification path as SSO/tenant users.
"""
from __future__ import annotations

import os
import time

import jwt
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from nmb_marketplace_agent.api.deps import get_db
from nmb_marketplace_agent.enterprise import audit

router = APIRouter()

PERSONAS = [
    {
        "id": "admin", "name": "Demo admin", "title": "Platform administrator",
        "description": "The full console — build agents, govern, manage the licence.",
        "roles": ["platform_admin"], "email": "demo.admin@nmb.example",
    },
    {
        "id": "tenant-admin", "name": "Demo tenant admin", "title": "Bank workspace administrator",
        "description": "Runs the bank workspace: workflows, approvals, connectors, guardrails.",
        "roles": ["tenant_admin"], "email": "demo.tenant-admin@nmb.example",
    },
    {
        "id": "approver", "name": "Demo approver", "title": "Compliance approver",
        "description": "Sees the approval queue and decides requests; no build access.",
        "roles": ["approver"], "email": "demo.approver@nmb.example",
    },
    {
        "id": "auditor", "name": "Demo auditor", "title": "Internal auditor",
        "description": "Read-only: audit chain, compliance posture, usage and licence.",
        "roles": ["auditor"], "email": "demo.auditor@nmb.example",
    },
]

_TTL = 8 * 3600


def _truthy(v: str) -> bool:
    return v.strip().lower() in ("1", "true", "yes", "on")


def demo_enabled() -> bool:
    flag = os.environ.get("DEMO_ACCOUNTS", "").strip().lower()
    if flag:
        return _truthy(flag)
    return (not _truthy(os.environ.get("LICENSE_ENFORCE", "false"))
            and os.environ.get("ENV", "dev").strip().lower() not in ("production", "prod"))


def _tenant() -> str:
    return os.environ.get("DEMO_TENANT", "default").strip() or "default"


def _secret() -> str:
    return os.environ.get("NMB_JWT_SECRET", "").strip()


def _public(p: dict) -> dict:
    return {k: v for k, v in p.items() if k != "email"}


class DemoLogin(BaseModel):
    account: str


@router.get("/accounts")
async def accounts():
    if not demo_enabled():
        return {"enabled": False, "accounts": []}
    return {"enabled": True, "ready": bool(_secret()), "tenant": _tenant(),
            "accounts": [_public(p) for p in PERSONAS]}


@router.post("/login")
async def login(body: DemoLogin, db: AsyncSession = Depends(get_db)):
    if not demo_enabled():
        raise HTTPException(404, "Demo accounts are disabled on this deployment")
    persona = next((p for p in PERSONAS if p["id"] == body.account), None)
    if not persona:
        raise HTTPException(404, "Unknown demo account")
    secret = _secret()
    if not secret:
        raise HTTPException(503, "Set NMB_JWT_SECRET on the server to enable demo sign-in")

    tenant = _tenant()
    now = int(time.time())
    token = jwt.encode(
        {"sub": persona["email"], "tenant_id": tenant, "roles": persona["roles"],
         "iat": now, "exp": now + _TTL, "demo": True},
        secret, algorithm="HS256",
    )
    try:
        await audit.record(db, tenant_id=tenant, actor=persona["email"], action="auth.demo_login",
                           details={"persona": persona["id"], "roles": persona["roles"]})
    except Exception:  # noqa: BLE001 - audit trouble must not block a demo sign-in
        pass
    return {"token": token, "account": _public(persona), "tenant": tenant, "expires_in": _TTL}
