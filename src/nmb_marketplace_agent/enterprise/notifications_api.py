"""Notification routes and the outbox."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from nmb_marketplace_agent.api.deps import get_db
from nmb_marketplace_agent.enterprise import audit
from nmb_marketplace_agent.enterprise import notifications as notification_service
from nmb_marketplace_agent.enterprise import whatsapp as whatsapp_service
from nmb_marketplace_agent.enterprise.licensing import (
    require_module,
)
from nmb_marketplace_agent.enterprise.models import (
    Notification,
    NotificationRoute,
    now_iso,
)
from nmb_marketplace_agent.enterprise.rbac import Principal, requires

router = APIRouter()




# ── notification routes + outbox ──────────────────────────────────────
class NotificationRouteIn(BaseModel):
    role: str = Field(min_length=1, max_length=128)
    channel: str = Field(pattern="^(webhook|email|whatsapp)$")
    target: str = Field(min_length=1, max_length=2048)
    enabled: bool = True


@router.get("/notification-routes", dependencies=[Depends(require_module("approvals"))])
async def notification_routes_list(p: Principal = Depends(requires("approvals:read")),
                                   db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(NotificationRoute).where(
        NotificationRoute.tenant_id == p.tenant_id,
    ).order_by(NotificationRoute.role))).scalars().all()
    return rows


@router.post("/notification-routes", dependencies=[Depends(require_module("approvals"))])
async def notification_route_create(body: NotificationRouteIn,
                                    p: Principal = Depends(requires("workflows:write")),
                                    db: AsyncSession = Depends(get_db)):
    if body.channel == "webhook" and not body.target.startswith(("http://", "https://")):
        raise HTTPException(422, "Webhook targets must be http(s) URLs")
    if body.channel == "email" and "@" not in body.target:
        raise HTTPException(422, "Email targets must be addresses")
    if body.channel == "whatsapp" and not whatsapp_service.norm_phone(body.target):
        raise HTTPException(422, "WhatsApp targets must be phone numbers in international format")
    route = NotificationRoute(id=str(uuid.uuid4()), tenant_id=p.tenant_id,
                              role=body.role.strip(), channel=body.channel, target=body.target.strip(),
                              enabled=body.enabled)
    db.add(route)
    try:
        await db.commit()
    except Exception as e:  # unique target
        await db.rollback()
        raise HTTPException(409, "That route already exists") from e
    await audit.record(db, tenant_id=p.tenant_id, actor=p.sub, action="notification_route.created",
                       resource_type="notification_route", resource_id=route.id,
                       details={"role": route.role, "channel": route.channel})
    return route


@router.delete("/notification-routes/{route_id}", dependencies=[Depends(require_module("approvals"))])
async def notification_route_delete(route_id: str, p: Principal = Depends(requires("workflows:write")),
                                    db: AsyncSession = Depends(get_db)):
    route = await db.get(NotificationRoute, route_id)
    if not route or route.tenant_id != p.tenant_id:
        raise HTTPException(404, "Route not found")
    await db.delete(route)
    await db.commit()
    await audit.record(db, tenant_id=p.tenant_id, actor=p.sub, action="notification_route.deleted",
                       resource_type="notification_route", resource_id=route_id,
                       details={"role": route.role, "channel": route.channel})
    return {"deleted": route_id}


@router.get("/notifications", dependencies=[Depends(require_module("approvals"))])
async def notifications_list(status: str | None = None, limit: int = 100,
                             p: Principal = Depends(requires("approvals:read")),
                             db: AsyncSession = Depends(get_db)):
    q = select(Notification).where(Notification.tenant_id == p.tenant_id)
    if status:
        q = q.where(Notification.status == status)
    rows = (await db.execute(q.order_by(Notification.created_at.desc()).limit(min(limit, 500)))).scalars().all()
    return rows


@router.post("/notifications/dispatch", dependencies=[Depends(require_module("approvals"))])
async def notifications_dispatch(p: Principal = Depends(requires("workflows:write"))):
    return await notification_service.dispatch_due()


class TestNotification(BaseModel):
    channel: str = Field(pattern="^(webhook|email|whatsapp)$")
    target: str = Field(min_length=1, max_length=2048)


@router.post("/notifications/test", dependencies=[Depends(require_module("approvals"))])
async def notification_test(body: TestNotification, p: Principal = Depends(requires("workflows:write")),
                            db: AsyncSession = Depends(get_db)):
    n = Notification(id=str(uuid.uuid4()), tenant_id=p.tenant_id, event="notification.test",
                     approval_id="", channel=body.channel, target=body.target.strip(),
                     subject="[NMB] Notification test",
                     body="This is a test notification from the NMB approval channel.",
                     status="pending", next_attempt_at=now_iso())
    db.add(n)
    await db.commit()
    await notification_service.dispatch_due(limit=20)
    await db.refresh(n)
    return {"id": n.id, "status": n.status, "attempts": n.attempts, "error": n.last_error}
