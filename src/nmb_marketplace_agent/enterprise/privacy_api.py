"""Privacy: retention, legal holds and subject rights."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from nmb_marketplace_agent.api.deps import get_db
from nmb_marketplace_agent.enterprise import privacy as privacy_service
from nmb_marketplace_agent.enterprise.models import (
    PrivacyRequest,
)
from nmb_marketplace_agent.enterprise.rbac import Principal, requires

router = APIRouter()



# ── privacy: retention, legal hold, subject rights ───────────────────
class _RetentionIn(BaseModel):
    settings: dict = Field(default_factory=dict)


class _HoldIn(BaseModel):
    scope: str = "tenant"
    scope_id: str = Field(default="", max_length=256)
    reason: str = Field(min_length=1, max_length=2000)


class _EraseIn(BaseModel):
    customer_id: str | None = Field(default=None, max_length=128)
    user_id: str | None = Field(default=None, max_length=128)
    thread_ids: list[str] = Field(default_factory=list)
    reason: str = Field(default="", max_length=2000)


@router.get("/privacy/retention")
async def get_retention(p: Principal = Depends(requires("privacy:read")),
                        db: AsyncSession = Depends(get_db)):
    return privacy_service.policy_view(await privacy_service.get_policy(db, p.tenant_id))


@router.put("/privacy/retention")
async def put_retention(body: _RetentionIn, p: Principal = Depends(requires("privacy:write")),
                        db: AsyncSession = Depends(get_db)):
    try:
        policy = await privacy_service.set_policy(db, p.tenant_id, body.settings, p.sub)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    return privacy_service.policy_view(policy)


@router.get("/privacy/holds")
async def get_holds(active: bool | None = True, p: Principal = Depends(requires("privacy:read")),
                    db: AsyncSession = Depends(get_db)):
    rows = await privacy_service.list_holds(db, p.tenant_id, active=active)
    return {"holds": [privacy_service.hold_view(h) for h in rows]}


@router.post("/privacy/holds")
async def post_hold(body: _HoldIn, p: Principal = Depends(requires("privacy:write")),
                    db: AsyncSession = Depends(get_db)):
    try:
        row = await privacy_service.create_hold(db, p.tenant_id, scope=body.scope,
                                                scope_id=body.scope_id, reason=body.reason,
                                                actor=p.sub)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    return {"hold": privacy_service.hold_view(row)}


@router.post("/privacy/holds/{hold_id}/release")
async def release_legal_hold(hold_id: str, p: Principal = Depends(requires("privacy:write")),
                             db: AsyncSession = Depends(get_db)):
    try:
        row = await privacy_service.release_hold(db, p.tenant_id, hold_id, p.sub)
    except privacy_service.PrivacyError as e:
        raise HTTPException(404, str(e)) from e
    return {"hold": privacy_service.hold_view(row)}


@router.post("/privacy/erase")
async def erase_subject(body: _EraseIn, p: Principal = Depends(requires("privacy:write")),
                        db: AsyncSession = Depends(get_db)):
    try:
        result = await privacy_service.erase_subject(
            db, p.tenant_id, customer_id=body.customer_id, user_id=body.user_id,
            thread_ids=body.thread_ids, reason=body.reason, actor=p.sub)
    except privacy_service.PrivacyError as e:
        raise HTTPException(422, str(e)) from e
    if result.get("status") == "blocked":
        raise HTTPException(409, detail=result)
    return result


@router.get("/privacy/requests")
async def list_privacy_requests(limit: int = 50, p: Principal = Depends(requires("privacy:read")),
                                db: AsyncSession = Depends(get_db)):
    n = max(1, min(int(limit), 200))
    rows = (await db.execute(select(PrivacyRequest).where(
        PrivacyRequest.tenant_id == p.tenant_id)
        .order_by(PrivacyRequest.created_at.desc()).limit(n))).scalars().all()
    return {"requests": [privacy_service.request_view(r) for r in rows]}


@router.get("/privacy/requests/{request_id}")
async def get_privacy_request(request_id: str, p: Principal = Depends(requires("privacy:read")),
                              db: AsyncSession = Depends(get_db)):
    row = await db.get(PrivacyRequest, request_id)
    if not row or row.tenant_id != p.tenant_id:
        raise HTTPException(404, "Privacy request not found")
    return privacy_service.request_view(row)


@router.get("/privacy/subject")
async def subject_access(customer_id: str | None = None, user_id: str | None = None,
                         include_transcript: bool = False,
                         p: Principal = Depends(requires("privacy:read")),
                         db: AsyncSession = Depends(get_db)):
    try:
        return await privacy_service.export_subject(
            db, p.tenant_id, customer_id=customer_id, user_id=user_id,
            include_transcript=include_transcript)
    except privacy_service.PrivacyError as e:
        raise HTTPException(422, str(e)) from e
