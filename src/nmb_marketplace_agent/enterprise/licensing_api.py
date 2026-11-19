"""Licence, usage metering, audit trail and the licence plan."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from nmb_marketplace_agent.api.deps import get_db
from nmb_marketplace_agent.enterprise import audit, metering
from nmb_marketplace_agent.enterprise.licensing import (
    ALL_MODULES,
    EDITIONS,
    FEATURE_CATALOG,
    current_license,
)
from nmb_marketplace_agent.enterprise.models import (
    LicencePlan,
    LicenceUpgradeRequest,
    now_iso,
)
from nmb_marketplace_agent.enterprise.rbac import Principal, requires

router = APIRouter()




# ── license / usage ───────────────────────────────────────────────────
@router.get("/license")
async def get_license(_: Principal = Depends(requires("license:read"))):
    return current_license().as_dict()


@router.get("/usage")
async def usage(period: str | None = None, p: Principal = Depends(requires("usage:read")), db: AsyncSession = Depends(get_db)):
    return {"period": period or metering.period_of(), "usage": await metering.summarize(db, p.tenant_id, period),
            "quotas": await metering.quota_status(db, p.tenant_id)}


@router.get("/usage/export.csv", response_class=PlainTextResponse)
async def usage_csv(period: str | None = None, p: Principal = Depends(requires("usage:read")), db: AsyncSession = Depends(get_db)):
    return await metering.export_csv(db, p.tenant_id, period)


# ── audit ─────────────────────────────────────────────────────────────
@router.get("/audit")
async def audit_query(action: str | None = None, actor: str | None = None, resource_id: str | None = None,
                      since_seq: int = 0, limit: int = 200, p: Principal = Depends(requires("audit:read")),
                      db: AsyncSession = Depends(get_db)):
    rows = await audit.query(db, p.tenant_id, action=action, actor=actor, resource_id=resource_id, since_seq=since_seq, limit=limit)
    return [r.model_dump() for r in rows]


@router.get("/audit/verify")
async def audit_verify(p: Principal = Depends(requires("audit:read")), db: AsyncSession = Depends(get_db)):
    return (await audit.verify_chain(db, p.tenant_id)).as_dict()


@router.get("/audit/checkpoint")
async def audit_checkpoint(p: Principal = Depends(requires("audit:read")), db: AsyncSession = Depends(get_db)):
    return await audit.checkpoint(db, p.tenant_id)


@router.get("/audit/export")
async def audit_export(since_seq: int = 0, p: Principal = Depends(requires("audit:export")), db: AsyncSession = Depends(get_db)):
    await audit.record(db, tenant_id=p.tenant_id, actor=p.sub, action="audit.exported", details={"since_seq": since_seq})
    return StreamingResponse(audit.export_jsonl(db, p.tenant_id, since_seq), media_type="application/x-ndjson")




# ── licence plan + upgrade requests ───────────────────────────────────
class LicencePlanIn(BaseModel):
    customer: str = ""
    edition: str = "enterprise"
    features: list[str] = Field(default_factory=list)
    seats: int = 100
    expires_on: str | None = None
    note: str = ""


class UpgradeRequestIn(BaseModel):
    target_edition: str
    add_features: list[str] = Field(default_factory=list)
    message: str = ""


def _plan_public(row: LicencePlan | None, tenant_id: str) -> dict:
    if row is None:
        lic = current_license()
        modules = set(lic.modules)
        features = sorted(ALL_MODULES) if "*" in modules else [m for m in ALL_MODULES if m in modules]
        return {"id": tenant_id, "tenant_id": tenant_id, "customer": lic.customer,
                "edition": lic.edition, "features": features, "seats": lic.max_seats,
                "expires_on": None, "note": "", "updated_by": "", "updated_at": None, "derived": True}
    d = row.model_dump()
    d["derived"] = False
    return d


def _checked_features(values: list[str]) -> list[str]:
    wanted = list(dict.fromkeys(str(v) for v in values or []))
    unknown = [v for v in wanted if v not in ALL_MODULES]
    if unknown:
        raise HTTPException(422, f"Unknown features: {', '.join(unknown)}")
    if "audit" not in wanted:
        wanted.append("audit")  # evidence is never optional
    return [m for m in ALL_MODULES if m in wanted]


@router.get("/licence/plan")
async def licence_plan_get(p: Principal = Depends(requires("license:read")), db: AsyncSession = Depends(get_db)):
    row = await db.get(LicencePlan, p.tenant_id)
    return {"plan": _plan_public(row, p.tenant_id), "license": current_license().as_dict(),
            "features": FEATURE_CATALOG, "editions": EDITIONS}


@router.put("/licence/plan")
async def licence_plan_save(body: LicencePlanIn, p: Principal = Depends(requires("license:write")),
                            db: AsyncSession = Depends(get_db)):
    if body.edition not in EDITIONS:
        raise HTTPException(422, f"Edition must be one of {', '.join(EDITIONS)}")
    if not 1 <= body.seats <= 500_000:
        raise HTTPException(422, "Seats must be between 1 and 500000")
    if body.expires_on:
        from datetime import date
        try:
            date.fromisoformat(body.expires_on)
        except ValueError as e:
            raise HTTPException(422, "expires_on must be YYYY-MM-DD") from e
    row = await db.get(LicencePlan, p.tenant_id) or LicencePlan(id=p.tenant_id, tenant_id=p.tenant_id)
    row.customer = body.customer.strip()
    row.edition = body.edition
    row.features = _checked_features(body.features)
    row.seats = body.seats
    row.expires_on = body.expires_on
    row.note = body.note.strip()
    row.updated_by = p.sub
    row.updated_at = now_iso()
    db.add(row)
    await db.commit()
    await audit.record(db, tenant_id=p.tenant_id, actor=p.sub, action="licence.plan_saved",
                       resource_type="licence", resource_id=p.tenant_id,
                       details={"edition": row.edition, "features": row.features, "seats": row.seats})
    return {"plan": _plan_public(row, p.tenant_id), "features": FEATURE_CATALOG, "editions": EDITIONS}


@router.get("/licence/upgrade-requests")
async def upgrade_requests(p: Principal = Depends(requires("license:read")), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(LicenceUpgradeRequest).where(LicenceUpgradeRequest.tenant_id == p.tenant_id)
        .order_by(LicenceUpgradeRequest.created_at.desc())
    )).scalars().all()
    return [r.model_dump() for r in rows]


@router.post("/licence/upgrade-requests")
async def upgrade_request(body: UpgradeRequestIn, p: Principal = Depends(requires("license:write")),
                          db: AsyncSession = Depends(get_db)):
    if body.target_edition not in EDITIONS:
        raise HTTPException(422, f"Edition must be one of {', '.join(EDITIONS)}")
    plan = await db.get(LicencePlan, p.tenant_id)
    current = plan.edition if plan else current_license().edition
    row = LicenceUpgradeRequest(
        id=str(uuid.uuid4()), tenant_id=p.tenant_id, current_edition=current,
        target_edition=body.target_edition, add_features=_checked_features(body.add_features),
        message=body.message.strip()[:4000], requested_by=p.sub,
    )
    db.add(row)
    await db.commit()
    await audit.record(db, tenant_id=p.tenant_id, actor=p.sub, action="licence.upgrade_requested",
                       resource_type="licence", resource_id=row.id,
                       details={"from": row.current_edition, "to": row.target_edition,
                                "features": row.add_features})
    return row.model_dump()
