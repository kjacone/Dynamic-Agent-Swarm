"""Workflows, runs, shadow replays and approval-as-code rules."""
from __future__ import annotations

import asyncio
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from nmb_marketplace_agent.api.deps import get_db
from nmb_marketplace_agent.enterprise import audit
from nmb_marketplace_agent.enterprise.api_common import _bg, _engine, _wf_err
from nmb_marketplace_agent.enterprise.expr import ExprError, safe_eval
from nmb_marketplace_agent.enterprise.licensing import (
    require_module,
)
from nmb_marketplace_agent.enterprise.models import (
    Approval,
    WorkflowDefinition,
    WorkflowRule,
    WorkflowRun,
)
from nmb_marketplace_agent.enterprise.rbac import Principal, requires
from nmb_marketplace_agent.enterprise.runtime import (
    build_runtime,
)
from nmb_marketplace_agent.enterprise.workflows.engine import (
    WorkflowError,
)
from nmb_marketplace_agent.enterprise.workflows.shadow import run_shadow
from nmb_marketplace_agent.enterprise.workflows.spec import WorkflowSpec, validate_spec

router = APIRouter()




# ── workflows ─────────────────────────────────────────────────────────
@router.post("/workflows/validate", dependencies=[Depends(require_module("workflows"))])
async def wf_validate(spec: WorkflowSpec, _: Principal = Depends(requires("workflows:read"))):
    return {"valid": not (errs := validate_spec(spec)), "errors": errs}


@router.post("/workflows", dependencies=[Depends(require_module("workflows"))])
async def wf_save(spec: WorkflowSpec, p: Principal = Depends(requires("workflows:write")), db: AsyncSession = Depends(get_db)):
    try:
        d = await (await _engine(db, p.tenant_id)).save_definition(spec, p.sub)
    except WorkflowError as e:
        raise _wf_err(e) from e
    return {"key": d.key, "version": d.version}


@router.get("/workflows", dependencies=[Depends(require_module("workflows"))])
async def wf_list(p: Principal = Depends(requires("workflows:read")), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(WorkflowDefinition).where(WorkflowDefinition.tenant_id == p.tenant_id)
                             .order_by(WorkflowDefinition.key, WorkflowDefinition.version.desc()))).scalars().all()
    latest: dict[str, WorkflowDefinition] = {}
    for r in rows:
        latest.setdefault(r.key, r)
    return [{"key": r.key, "version": r.version, "name": r.spec.get("name"), "steps": len(r.spec.get("steps", [])),
             "inputs": r.spec.get("inputs", {})} for r in latest.values()]


@router.get("/workflows/{key}", dependencies=[Depends(require_module("workflows"))])
async def wf_get(key: str, version: int | None = None, p: Principal = Depends(requires("workflows:read")),
                 db: AsyncSession = Depends(get_db)):
    try:
        return (await (await _engine(db, p.tenant_id)).get_spec(key, version)).model_dump(by_alias=True)
    except WorkflowError as e:
        raise HTTPException(404, str(e)) from e


class RunRequest(BaseModel):
    inputs: dict[str, Any] = Field(default_factory=dict)
    wait: bool = True


@router.post("/workflows/{key}/runs", dependencies=[Depends(require_module("workflows"))])
async def wf_run(key: str, body: RunRequest, p: Principal = Depends(requires("workflows:run")), db: AsyncSession = Depends(get_db)):
    eng = await _engine(db, p.tenant_id)
    try:
        run = await eng.start(key, body.inputs, p.sub, run_now=body.wait)
    except WorkflowError as e:
        raise _wf_err(e) from e
    if not body.wait:
        async def _bg_run(run_id: str):
            from nmb_marketplace_agent.config.database import async_session
            async with async_session() as s:
                try:
                    await (await _engine(s, p.tenant_id)).advance(run_id)
                except Exception:  # noqa: BLE001 - failure is recorded on the run by the engine
                    pass
        t = asyncio.create_task(_bg_run(run.id))
        _bg.add(t)
        t.add_done_callback(_bg.discard)
    return _run_view(run)




# ── shadow mode (historical replay) ───────────────────────────────────
class ShadowRequest(BaseModel):
    days: int = 30
    limit: int = 100


@router.post("/workflows/{key}/shadow", dependencies=[Depends(require_module("workflows"))])
async def workflow_shadow(
    key: str, body: ShadowRequest,
    p: Principal = Depends(requires("workflows:write")),
    db: AsyncSession = Depends(get_db),
):
    """Replay historical runs of `key` against the current config, return the matrix."""
    if body.days < 1 or body.days > 365:
        raise HTTPException(422, "days must be in [1, 365]")
    if body.limit < 1 or body.limit > 500:
        raise HTTPException(422, "limit must be in [1, 500]")

    runtime = await build_runtime(db, p.tenant_id)
    try:
        report = await run_shadow(db, p.tenant_id, runtime, key, days=body.days, limit=body.limit)
    except WorkflowError as e:
        raise HTTPException(404, str(e)) from e

    await audit.record(
        db, tenant_id=p.tenant_id, actor=p.sub, action="workflow.shadow_run",
        resource_type="workflow", resource_id=key,
        details={"days": body.days, "limit": body.limit,
                 "total": report.total, "matched": report.matched},
    )
    return {
        "workflow": report.workflow,
        "version": report.version,
        "window_days": report.window_days,
        "total": report.total,
        "matched": report.matched,
        "agreement": (report.matched / report.total) if report.total else None,
        "matrix": report.matrix,
        "results": [
            {"original_id": r.original_id, "original_shape": r.original_shape,
             "shadow_shape": r.shadow_shape, "matches": r.matches, "error": r.error}
            for r in report.results
        ],
    }




def _run_view(r: WorkflowRun) -> dict:
    ctx = r.state.get("ctx", {})
    return {"id": r.id, "workflow": r.workflow_key, "version": r.workflow_version, "status": r.status,
            "initiator": r.initiator, "outcome": ctx.get("_outcome"), "error": r.error,
            "current_step": r.state.get("cursor"), "history": r.state.get("history", []),
            "created_at": r.created_at, "updated_at": r.updated_at,
            "delegations": ctx.get("_delegations", [])}  
            
async def _run_view_with_delegations(db, r: WorkflowRun, tenant: str) -> dict:
    base = _run_view(r)
    rows = await audit.query(db, tenant, action="agent.delegated",
                             resource_id=r.id, limit=200)
    base["delegations"] = [
        {"delegate": e.details.get("delegate"),
         "task": e.details.get("task"),
         "n": e.details.get("delegation_n")}
        for e in rows
    ]
    return base

@router.get("/runs", dependencies=[Depends(require_module("workflows"))])
async def runs_list(status: str | None = None, limit: int = 100, p: Principal = Depends(requires("workflows:read")),
                    db: AsyncSession = Depends(get_db)):
    q = select(WorkflowRun).where(WorkflowRun.tenant_id == p.tenant_id)
    if status:
        q = q.where(WorkflowRun.status == status)
    return [_run_view(r) for r in (await db.execute(q.order_by(WorkflowRun.created_at.desc()).limit(min(limit, 500)))).scalars()]


@router.get("/runs/{run_id}", dependencies=[Depends(require_module("workflows"))])
async def run_get(run_id: str, p: Principal = Depends(requires("workflows:read")),
                  db: AsyncSession = Depends(get_db)):
    r = await db.get(WorkflowRun, run_id)
    if not r or r.tenant_id != p.tenant_id:
        raise HTTPException(404, "Run not found")
    base = _run_view(r) | {"context": {k: v for k, v in r.state.get("ctx", {}).items() if k != "input"}}
    # Delegation rows come from the audit chain; single extra query, only when the
    # client asks for one run (not on the list endpoint).
    delegations = [
        {"delegate": e.details.get("delegate"),
         "task": e.details.get("task"),
         "n": e.details.get("delegation_n")}
        for e in await audit.query(db, p.tenant_id, action="agent.delegated",
                                   resource_id=run_id, limit=200)
    ]
    base["delegations"] = delegations
    return base

@router.post("/runs/{run_id}/cancel", dependencies=[Depends(require_module("workflows"))])
async def run_cancel(run_id: str, p: Principal = Depends(requires("workflows:write")), db: AsyncSession = Depends(get_db)):
    try:
        return _run_view(await (await _engine(db, p.tenant_id)).cancel(run_id, p.sub))
    except WorkflowError as e:
        raise HTTPException(404, str(e)) from e


# ── workflow rules (approval-as-code) ─────────────────────────────────
class RuleIn(BaseModel):
    name: str = ""
    when_expr: str
    action: str = "route_to"
    target_step: str | None = None
    enabled: bool = True
    created_from_approval_id: str | None = None


class RulePatch(BaseModel):
    name: str | None = None
    when_expr: str | None = None
    action: str | None = None
    target_step: str | None = None
    enabled: bool | None = None


@router.get("/workflows/{key}/rules", dependencies=[Depends(require_module("workflows"))])
async def rules_list(key: str, p: Principal = Depends(requires("workflows:read")),
                     db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(WorkflowRule)
        .where(WorkflowRule.tenant_id == p.tenant_id, WorkflowRule.workflow_key == key)
        .order_by(WorkflowRule.created_at)
    )).scalars().all()
    return [r.model_dump() for r in rows]


@router.post("/workflows/{key}/rules", dependencies=[Depends(require_module("workflows"))])
async def rule_create(key: str, body: RuleIn, p: Principal = Depends(requires("workflows:write")),
                      db: AsyncSession = Depends(get_db)):
    if body.action not in ("route_to", "block"):
        raise HTTPException(422, "action must be 'route_to' or 'block'")
    try:
        safe_eval(body.when_expr, {})
    except ExprError as e:
        raise HTTPException(422, f"Invalid when_expr: {e}") from e

    spec = await (await _engine(db, p.tenant_id)).get_spec(key)
    if body.action == "route_to":
        if not body.target_step:
            raise HTTPException(422, "route_to requires target_step")
        if body.target_step not in spec.by_id():
            raise HTTPException(422, f"target_step '{body.target_step}' not in workflow '{key}'")

    if body.created_from_approval_id:
        ap = await db.get(Approval, body.created_from_approval_id)
        if not ap or ap.tenant_id != p.tenant_id:
            raise HTTPException(404, "Source approval not found")

    rule = WorkflowRule(
        id=str(uuid.uuid4()), tenant_id=p.tenant_id, workflow_key=key,
        name=body.name, when_expr=body.when_expr, action=body.action,
        target_step=body.target_step, enabled=body.enabled,
        created_by=p.sub, created_from_approval_id=body.created_from_approval_id,
    )
    db.add(rule)
    await db.commit()

    await audit.record(
        db, tenant_id=p.tenant_id, actor=p.sub, action="workflow.rule.created",
        resource_type="workflow_rule", resource_id=rule.id,
        details={"workflow": key, "when": body.when_expr, "action": body.action,
                 "target": body.target_step,
                 "from_approval": body.created_from_approval_id},
    )
    return rule.model_dump()


@router.patch("/workflows/{key}/rules/{rule_id}", dependencies=[Depends(require_module("workflows"))])
async def rule_patch(key: str, rule_id: str, body: RulePatch,
                     p: Principal = Depends(requires("workflows:write")),
                     db: AsyncSession = Depends(get_db)):
    rule = await db.get(WorkflowRule, rule_id)
    if not rule or rule.tenant_id != p.tenant_id or rule.workflow_key != key:
        raise HTTPException(404, "Rule not found")

    data = body.model_dump(exclude_unset=True)
    if "when_expr" in data and data["when_expr"] is not None:
        try:
            safe_eval(data["when_expr"], {})
        except ExprError as e:
            raise HTTPException(422, f"Invalid when_expr: {e}") from e
    if "action" in data and data["action"] is not None and data["action"] not in ("route_to", "block"):
        raise HTTPException(422, "action must be 'route_to' or 'block'")

    new_action = data.get("action", rule.action)
    new_target = data.get("target_step", rule.target_step)
    if new_action == "route_to":
        if not new_target:
            raise HTTPException(422, "route_to requires target_step")
        spec = await (await _engine(db, p.tenant_id)).get_spec(key)
        if new_target not in spec.by_id():
            raise HTTPException(422, f"target_step '{new_target}' not in workflow '{key}'")

    for k, v in data.items():
        setattr(rule, k, v)
    db.add(rule)
    await db.commit()

    await audit.record(
        db, tenant_id=p.tenant_id, actor=p.sub, action="workflow.rule.updated",
        resource_type="workflow_rule", resource_id=rule.id,
        details={"workflow": key, "fields": list(data.keys())},
    )
    return rule.model_dump()


@router.delete("/workflows/{key}/rules/{rule_id}", dependencies=[Depends(require_module("workflows"))])
async def rule_delete(key: str, rule_id: str, p: Principal = Depends(requires("workflows:write")),
                      db: AsyncSession = Depends(get_db)):
    rule = await db.get(WorkflowRule, rule_id)
    if not rule or rule.tenant_id != p.tenant_id or rule.workflow_key != key:
        raise HTTPException(404, "Rule not found")
    await db.delete(rule)
    await db.commit()
    await audit.record(
        db, tenant_id=p.tenant_id, actor=p.sub, action="workflow.rule.deleted",
        resource_type="workflow_rule", resource_id=rule_id,
        details={"workflow": key},
    )
    return {"deleted": rule_id}
