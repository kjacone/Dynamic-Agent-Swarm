"""REST surface of the enterprise layer, mounted at /enterprise (see api/main.py).

Routes live in domain modules alongside this file; this module only assembles
them, plus the inbound webhook endpoint and the background SLA sweeper.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import os

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from nmb_marketplace_agent.api.deps import get_db
from nmb_marketplace_agent.enterprise import privacy as privacy_service
from nmb_marketplace_agent.enterprise.api_common import _engine, _wf_err
from nmb_marketplace_agent.enterprise.approvals_api import router as approvals_router
from nmb_marketplace_agent.enterprise.compliance_api import router as compliance_router
from nmb_marketplace_agent.enterprise.connectors_api import router as connectors_router
from nmb_marketplace_agent.enterprise.guardrails_api import router as guardrails_router
from nmb_marketplace_agent.enterprise.handoffs_api import router as handoffs_router
from nmb_marketplace_agent.enterprise.identity_api import router as identity_router
from nmb_marketplace_agent.enterprise.licensing import require_module
from nmb_marketplace_agent.enterprise.licensing_api import router as licensing_router
from nmb_marketplace_agent.enterprise.models import Approval
from nmb_marketplace_agent.enterprise.notifications_api import (
    router as notifications_router,
)
from nmb_marketplace_agent.enterprise.privacy_api import router as privacy_router
from nmb_marketplace_agent.enterprise.solutions_api import router as solutions_router
from nmb_marketplace_agent.enterprise.whatsapp_api import router as whatsapp_router
from nmb_marketplace_agent.enterprise.workflows.engine import WorkflowError
from nmb_marketplace_agent.enterprise.workflows_api import router as workflows_router

router = APIRouter()
for _r in (
    identity_router,
    licensing_router,
    guardrails_router,
    workflows_router,
    approvals_router,
    notifications_router,
    whatsapp_router,
    handoffs_router,
    solutions_router,
    connectors_router,
    privacy_router,
    compliance_router,
):
    router.include_router(_r)

# ── inbound webhooks (events from core systems; HMAC-signed) ─────────
@router.post("/hooks/{tenant_id}/{key}", dependencies=[Depends(require_module("workflows"))])
async def inbound_hook(tenant_id: str, key: str, request: Request, db: AsyncSession = Depends(get_db)):
    secret = os.environ.get("WEBHOOK_SECRET", "")
    if not secret:
        raise HTTPException(503, "WEBHOOK_SECRET is not configured")
    raw = await request.body()
    given = request.headers.get("x-signature", "").removeprefix("sha256=")
    if not hmac.compare_digest(given, hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()):
        raise HTTPException(401, "Bad signature")
    try:
        payload = json.loads(raw or b"{}")
    except ValueError as e:
        raise HTTPException(400, "Body must be JSON") from e
    try:
        run = await (await _engine(db, tenant_id)).start(key, payload, "webhook", run_now=True)
    except WorkflowError as e:
        raise _wf_err(e) from e
    return {"run_id": run.id, "status": run.status}


# ── background SLA sweeper ───────────────────────────────────────────
async def sweeper_loop(interval_s: int | None = None):
    """Started from the app lifespan: escalates approvals and applies retention for every tenant."""
    from nmb_marketplace_agent.config.database import async_session
    from nmb_marketplace_agent.config.models import (
        Citation,
        Feedback,
        Handoff,
        ThreadOwner,
    )
    from nmb_marketplace_agent.enterprise.models import RetentionPolicy

    interval = interval_s or int(os.environ.get("ENTERPRISE_SWEEP_INTERVAL_S", "300"))
    while True:
        await asyncio.sleep(interval)
        try:
            async with async_session() as db:
                approvals = set((await db.execute(select(Approval.tenant_id).where(
                    Approval.status == "pending").distinct())).scalars().all())
                tenants = set(approvals)
                for model in (ThreadOwner, Handoff, Feedback, Citation, RetentionPolicy):
                    tenants |= set((await db.execute(select(model.tenant_id).distinct())).scalars().all())
                for t in approvals:
                    try:
                        await (await _engine(db, t)).sweep_overdue()
                    except Exception:  # noqa: BLE001 - one tenant must not stop the sweep
                        pass
                for t in tenants:
                    try:
                        await privacy_service.retention_sweep(db, t)
                    except Exception:  # noqa: BLE001
                        await db.rollback()
        except Exception:  # noqa: BLE001
            pass
