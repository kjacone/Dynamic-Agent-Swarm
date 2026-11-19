"""Policies and tenant guardrail instructions."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from nmb_marketplace_agent.api.deps import get_db
from nmb_marketplace_agent.enterprise import audit
from nmb_marketplace_agent.enterprise.guardrails import (
    GUARDRAIL_PRESETS,
    Policy,
    PolicyEngine,
)
from nmb_marketplace_agent.enterprise.licensing import (
    require_module,
)
from nmb_marketplace_agent.enterprise.models import (
    GuardrailInstruction,
    PolicySet,
    now_iso,
)
from nmb_marketplace_agent.enterprise.rbac import Principal, requires
from nmb_marketplace_agent.enterprise.runtime import (
    load_guards,
    load_policy,
)

router = APIRouter()




# ── policies / guardrails ─────────────────────────────────────────────
class PolicyTest(BaseModel):
    text: str
    direction: str = "input"


@router.post("/policies/test", dependencies=[Depends(require_module("guardrails"))])
async def policy_test(body: PolicyTest, p: Principal = Depends(requires("policies:read")), db: AsyncSession = Depends(get_db)):
    eng = PolicyEngine(await load_policy(db, p.tenant_id), await load_guards(db, p.tenant_id))
    dec = eng.check_text(body.text, body.direction)  # type: ignore[arg-type]
    return dec.as_dict() | {"text": dec.text}


@router.get("/policies")
async def policies_list(p: Principal = Depends(requires("policies:read")), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(PolicySet).where(PolicySet.tenant_id == p.tenant_id))).scalars().all()
    return [r.model_dump() for r in rows]


@router.put("/policies/{name}", dependencies=[Depends(require_module("guardrails"))])
async def policy_put(name: str, spec: Policy, p: Principal = Depends(requires("policies:write")), db: AsyncSession = Depends(get_db)):
    pid = f"{p.tenant_id}:{name}"
    row = await db.get(PolicySet, pid) or PolicySet(id=pid, tenant_id=p.tenant_id, name=name, version=0)
    row.spec, row.version, row.updated_at = spec.model_dump(), (row.version or 0) + 1, now_iso()
    db.add(row)
    await db.commit()
    await audit.record(db, tenant_id=p.tenant_id, actor=p.sub, action="policy.updated", resource_type="policy",
                       resource_id=name, details={"version": row.version, "rules": len(spec.rules)})
    return {"name": name, "version": row.version}


# ── injection shield (tenant guardrail instructions) ──────────────────
class GuardrailIn(BaseModel):
    title: str
    instruction: str = ""
    watch_phrases: list[str] = Field(default_factory=list)
    action: str = "block"
    enabled: bool = True


class GuardrailPatch(BaseModel):
    title: str | None = None
    instruction: str | None = None
    watch_phrases: list[str] | None = None
    action: str | None = None
    enabled: bool | None = None


class GuardrailTest(BaseModel):
    text: str
    direction: str = "input"


def _guard_public(r: GuardrailInstruction) -> dict:
    return {"id": r.id, "title": r.title, "instruction": r.instruction,
            "watch_phrases": list(r.watch_phrases or []), "action": r.action,
            "enabled": r.enabled, "created_at": r.created_at, "updated_at": r.updated_at}


def _clean_phrases(values: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for v in values or []:
        s = str(v).strip()[:120]
        if s and s.lower() not in seen:
            seen.add(s.lower())
            out.append(s)
    return out[:40]


def _guard_action(value: str) -> str:
    if value not in ("block", "log"):
        raise HTTPException(422, "action must be 'block' or 'log'")
    return value


@router.get("/guardrails")
async def guardrails_list(p: Principal = Depends(requires("policies:read")), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(GuardrailInstruction).where(GuardrailInstruction.tenant_id == p.tenant_id)
        .order_by(GuardrailInstruction.created_at)
    )).scalars().all()
    return [_guard_public(r) for r in rows]


@router.post("/guardrails", dependencies=[Depends(require_module("guardrails"))])
async def guardrail_create(body: GuardrailIn, p: Principal = Depends(requires("policies:write")),
                           db: AsyncSession = Depends(get_db)):
    title = body.title.strip()
    if not title:
        raise HTTPException(422, "Give the guardrail a title.")
    row = GuardrailInstruction(
        id=str(uuid.uuid4()), tenant_id=p.tenant_id, title=title[:160],
        instruction=body.instruction.strip(), watch_phrases=_clean_phrases(body.watch_phrases),
        action=_guard_action(body.action), enabled=body.enabled, created_by=p.sub,
    )
    db.add(row)
    await db.commit()
    await audit.record(db, tenant_id=p.tenant_id, actor=p.sub, action="guardrail.created",
                       resource_type="guardrail", resource_id=row.id,
                       details={"title": row.title, "action": row.action, "phrases": len(row.watch_phrases)})
    return _guard_public(row)


@router.post("/guardrails/presets", dependencies=[Depends(require_module("guardrails"))])
async def guardrail_presets(p: Principal = Depends(requires("policies:write")), db: AsyncSession = Depends(get_db)):
    existing = {r.id for r in (await db.execute(
        select(GuardrailInstruction).where(GuardrailInstruction.tenant_id == p.tenant_id)
    )).scalars().all()}
    added = 0
    for preset in GUARDRAIL_PRESETS:
        rid = f"{p.tenant_id}:preset-{preset['slug']}"
        if rid in existing:
            continue
        db.add(GuardrailInstruction(
            id=rid, tenant_id=p.tenant_id, title=preset["title"], instruction=preset["instruction"],
            watch_phrases=list(preset["watch_phrases"]), action=preset["action"], created_by=p.sub,
        ))
        added += 1
    await db.commit()
    if added:
        await audit.record(db, tenant_id=p.tenant_id, actor=p.sub, action="guardrail.presets_added",
                           resource_type="guardrail", details={"count": added})
    rows = (await db.execute(
        select(GuardrailInstruction).where(GuardrailInstruction.tenant_id == p.tenant_id)
        .order_by(GuardrailInstruction.created_at)
    )).scalars().all()
    return {"added": added, "instructions": [_guard_public(r) for r in rows]}


@router.patch("/guardrails/{guardrail_id}", dependencies=[Depends(require_module("guardrails"))])
async def guardrail_patch(guardrail_id: str, body: GuardrailPatch,
                          p: Principal = Depends(requires("policies:write")), db: AsyncSession = Depends(get_db)):
    row = await db.get(GuardrailInstruction, guardrail_id)
    if not row or row.tenant_id != p.tenant_id:
        raise HTTPException(404, "Unknown guardrail")
    if body.title is not None:
        if not body.title.strip():
            raise HTTPException(422, "Give the guardrail a title.")
        row.title = body.title.strip()[:160]
    if body.instruction is not None:
        row.instruction = body.instruction.strip()
    if body.watch_phrases is not None:
        row.watch_phrases = _clean_phrases(body.watch_phrases)
    if body.action is not None:
        row.action = _guard_action(body.action)
    if body.enabled is not None:
        row.enabled = body.enabled
    row.updated_at = now_iso()
    db.add(row)
    await db.commit()
    await audit.record(db, tenant_id=p.tenant_id, actor=p.sub, action="guardrail.updated",
                       resource_type="guardrail", resource_id=row.id, details={"enabled": row.enabled})
    return _guard_public(row)


@router.delete("/guardrails/{guardrail_id}", dependencies=[Depends(require_module("guardrails"))])
async def guardrail_delete(guardrail_id: str, p: Principal = Depends(requires("policies:write")),
                           db: AsyncSession = Depends(get_db)):
    row = await db.get(GuardrailInstruction, guardrail_id)
    if not row or row.tenant_id != p.tenant_id:
        raise HTTPException(404, "Unknown guardrail")
    await db.delete(row)
    await db.commit()
    await audit.record(db, tenant_id=p.tenant_id, actor=p.sub, action="guardrail.deleted",
                       resource_type="guardrail", resource_id=guardrail_id, details={"title": row.title})
    return {"ok": True}


@router.post("/guardrails/test", dependencies=[Depends(require_module("guardrails"))])
async def guardrail_test(body: GuardrailTest, p: Principal = Depends(requires("policies:read")),
                         db: AsyncSession = Depends(get_db)):
    eng = PolicyEngine(await load_policy(db, p.tenant_id), await load_guards(db, p.tenant_id))
    dec = eng.check_text(body.text, body.direction)  # type: ignore[arg-type]
    return dec.as_dict() | {"text": dec.text}
