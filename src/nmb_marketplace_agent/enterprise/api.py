"""REST surface of the enterprise layer, mounted at /enterprise (see api/main.py)."""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import os
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import PlainTextResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from nmb_marketplace_agent.api.deps import get_db
from nmb_marketplace_agent.enterprise import audit, compliance, metering
from nmb_marketplace_agent.enterprise.connectors import (
    ConnectorError,
    EgressPolicy,
    build_connector,
)
from nmb_marketplace_agent.enterprise.guardrails import Policy, PolicyEngine
from nmb_marketplace_agent.enterprise.licensing import current_license, require_module
from nmb_marketplace_agent.enterprise.models import (
    Approval,
    ConnectorConfig,
    PolicySet,
    WorkflowDefinition,
    WorkflowRun,
    now_iso,
)
from nmb_marketplace_agent.enterprise.rbac import Principal, current_principal, requires
from nmb_marketplace_agent.enterprise.runtime import build_runtime, load_policy
from nmb_marketplace_agent.enterprise.solutions import loader as packs
from nmb_marketplace_agent.enterprise.workflows.engine import (
    WorkflowEngine,
    WorkflowError,
)
from nmb_marketplace_agent.enterprise.workflows.spec import WorkflowSpec, validate_spec

router = APIRouter()
_bg: set[asyncio.Task] = set()


async def _engine(db: AsyncSession, tenant: str) -> WorkflowEngine:
    return WorkflowEngine(db, await build_runtime(db, tenant), tenant)


def _wf_err(e: Exception) -> HTTPException:
    return HTTPException(422, str(e))


# ── identity (drives role-aware dashboard) ───────────────────────────
@router.get("/me")
async def me(p: Principal = Depends(current_principal)):
    from nmb_marketplace_agent.enterprise.rbac import PERMISSIONS
    perms = sorted({x for r in p.roles for x in PERMISSIONS.get(r, set())})
    return {"sub": p.sub, "tenant_id": p.tenant_id, "roles": sorted(p.roles), "auth": p.auth, "permissions": perms,
            "license": {"edition": current_license().edition, "state": current_license().state,
                        "modules": sorted(current_license().modules)}}


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


# ── policies / guardrails ─────────────────────────────────────────────
class PolicyTest(BaseModel):
    text: str
    direction: str = "input"


@router.post("/policies/test", dependencies=[Depends(require_module("guardrails"))])
async def policy_test(body: PolicyTest, p: Principal = Depends(requires("policies:read")), db: AsyncSession = Depends(get_db)):
    eng = PolicyEngine(await load_policy(db, p.tenant_id))
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


def _run_view(r: WorkflowRun) -> dict:
    ctx = r.state.get("ctx", {})
    return {"id": r.id, "workflow": r.workflow_key, "version": r.workflow_version, "status": r.status,
            "initiator": r.initiator, "outcome": ctx.get("_outcome"), "error": r.error,
            "history": r.state.get("history", []), "created_at": r.created_at, "updated_at": r.updated_at}


@router.get("/runs", dependencies=[Depends(require_module("workflows"))])
async def runs_list(status: str | None = None, limit: int = 100, p: Principal = Depends(requires("workflows:read")),
                    db: AsyncSession = Depends(get_db)):
    q = select(WorkflowRun).where(WorkflowRun.tenant_id == p.tenant_id)
    if status:
        q = q.where(WorkflowRun.status == status)
    return [_run_view(r) for r in (await db.execute(q.order_by(WorkflowRun.created_at.desc()).limit(min(limit, 500)))).scalars()]


@router.get("/runs/{run_id}", dependencies=[Depends(require_module("workflows"))])
async def run_get(run_id: str, p: Principal = Depends(requires("workflows:read")), db: AsyncSession = Depends(get_db)):
    r = await db.get(WorkflowRun, run_id)
    if not r or r.tenant_id != p.tenant_id:
        raise HTTPException(404, "Run not found")
    return _run_view(r) | {"context": {k: v for k, v in r.state.get("ctx", {}).items() if k != "input"}}


@router.post("/runs/{run_id}/cancel", dependencies=[Depends(require_module("workflows"))])
async def run_cancel(run_id: str, p: Principal = Depends(requires("workflows:write")), db: AsyncSession = Depends(get_db)):
    try:
        return _run_view(await (await _engine(db, p.tenant_id)).cancel(run_id, p.sub))
    except WorkflowError as e:
        raise HTTPException(404, str(e)) from e


# ── approvals ─────────────────────────────────────────────────────────
@router.get("/approvals", dependencies=[Depends(require_module("approvals"))])
async def approvals_list(status: str | None = "pending", p: Principal = Depends(requires("approvals:read")),
                         db: AsyncSession = Depends(get_db)):
    q = select(Approval).where(Approval.tenant_id == p.tenant_id)
    if status:
        q = q.where(Approval.status == status)
    rows = (await db.execute(q.order_by(Approval.created_at.desc()).limit(200))).scalars().all()
    mine = [a for a in rows if set(a.allowed_roles) & p.roles or p.has_role("tenant_admin") or p.can("audit:read")]
    return [{k: v for k, v in a.model_dump().items() if k != "payload"} | {"context": a.payload.get("context", {})} for a in mine]


class Decision(BaseModel):
    decision: str
    comment: str = ""


@router.post("/approvals/{approval_id}/decide", dependencies=[Depends(require_module("approvals"))])
async def approval_decide(approval_id: str, body: Decision, p: Principal = Depends(requires("approvals:decide")),
                          db: AsyncSession = Depends(get_db)):
    try:
        a = await (await _engine(db, p.tenant_id)).decide(approval_id, p, body.decision, body.comment)
    except WorkflowError as e:
        raise HTTPException(403 if "cannot" in str(e) or "role" in str(e) else 409, str(e)) from e
    return {"id": a.id, "status": a.status, "decisions": a.decisions}


@router.post("/approvals/sweep", dependencies=[Depends(require_module("approvals"))])
async def approvals_sweep(p: Principal = Depends(requires("workflows:write")), db: AsyncSession = Depends(get_db)):
    return await (await _engine(db, p.tenant_id)).sweep_overdue()


# ── solutions ─────────────────────────────────────────────────────────
@router.get("/solutions", dependencies=[Depends(require_module("solutions"))])
async def solutions(p: Principal = Depends(requires("solutions:read")), db: AsyncSession = Depends(get_db)):
    inst = {i.solution_id: i for i in await packs.installed(db, p.tenant_id)}
    lic = current_license()
    return [d | {"installed": d["id"] in inst, "entitled": lic.has_solution(d["id"]),
                 "installed_version": inst[d["id"]].version if d["id"] in inst else None} for d in packs.list_packs()]


class InstallRequest(BaseModel):
    parameters: dict[str, Any] = Field(default_factory=dict)


@router.post("/solutions/{solution_id}/install", dependencies=[Depends(require_module("solutions"))])
async def solution_install(solution_id: str, body: InstallRequest, p: Principal = Depends(requires("solutions:write")),
                           db: AsyncSession = Depends(get_db)):
    try:
        inst = await packs.install_solution(db, p.tenant_id, solution_id, p.sub, body.parameters)
    except (packs.PackError, WorkflowError) as e:
        raise HTTPException(422, str(e)) from e
    return {"solution": solution_id, "version": inst.version, "created": inst.created, "parameters": inst.parameters}


# ── connectors ────────────────────────────────────────────────────────


def _needs_setup(cfg: dict) -> bool:
    # pack templates ship with placeholder hosts; flag them so the UI can say "finish setup"
    return ".example." in json.dumps(cfg)


@router.get("/connectors", dependencies=[Depends(require_module("connectors"))])
async def connectors(p: Principal = Depends(requires("connectors:read")), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(ConnectorConfig).where(ConnectorConfig.tenant_id == p.tenant_id))).scalars().all()
    return [{"name": c.name, "type": c.type, "enabled": c.enabled, "needs_setup": _needs_setup(c.config),
             "operations": list((c.config.get("operations") or {}).keys()) or c.config.get("scripts", [])} for c in rows]


async def _get_cfg(db: AsyncSession, tenant: str, name: str) -> ConnectorConfig:
    row = (await db.execute(select(ConnectorConfig).where(
        ConnectorConfig.tenant_id == tenant, ConnectorConfig.name == name))).scalars().first()
    if not row:
        raise HTTPException(404, f"Connector '{name}' not found")
    return row


@router.get("/connectors/{name}", dependencies=[Depends(require_module("connectors"))])
async def connector_get(name: str, p: Principal = Depends(requires("connectors:read")), db: AsyncSession = Depends(get_db)):
    c = await _get_cfg(db, p.tenant_id, name)
    # config only ever holds secret *references* (env:/file:), so it is safe to return
    return {"name": c.name, "type": c.type, "enabled": c.enabled, "config": c.config, "needs_setup": _needs_setup(c.config),
            "egress_allowed_hosts": EgressPolicy().allowed}


@router.post("/connectors/{name}/enabled", dependencies=[Depends(require_module("connectors"))])
async def connector_enable(name: str, body: dict, p: Principal = Depends(requires("connectors:write")),
                           db: AsyncSession = Depends(get_db)):
    c = await _get_cfg(db, p.tenant_id, name)
    want = bool(body.get("enabled"))
    if want and _needs_setup(c.config):
        raise HTTPException(422, "Replace the placeholder endpoint before enabling this connector")
    c.enabled = want
    db.add(c)
    await db.commit()
    await audit.record(db, tenant_id=p.tenant_id, actor=p.sub, action="connector.enabled" if want else "connector.disabled",
                       resource_type="connector", resource_id=name)
    return {"name": name, "enabled": c.enabled}


@router.delete("/connectors/{name}", dependencies=[Depends(require_module("connectors"))])
async def connector_delete(name: str, p: Principal = Depends(requires("connectors:write")), db: AsyncSession = Depends(get_db)):
    c = await _get_cfg(db, p.tenant_id, name)
    await db.delete(c)
    await db.commit()
    await audit.record(db, tenant_id=p.tenant_id, actor=p.sub, action="connector.deleted", resource_type="connector", resource_id=name)
    return {"deleted": name}


@router.post("/connectors/{name}/test/{operation}", dependencies=[Depends(require_module("connectors"))])
async def connector_test(name: str, operation: str, params: dict | None = None,
                         p: Principal = Depends(requires("connectors:write")), db: AsyncSession = Depends(get_db)):
    c = await _get_cfg(db, p.tenant_id, name)  # works while disabled: test first, then enable
    try:
        res = await build_connector(name, c.type, c.config, EgressPolicy()).call(operation, params or {})
        ok, err = True, None
    except ConnectorError as e:
        res, ok, err = None, False, str(e)
    await audit.record(db, tenant_id=p.tenant_id, actor=p.sub, action="connector.tested", resource_type="connector",
                       resource_id=name, outcome="success" if ok else "error", details={"operation": operation, "error": err})
    return {"ok": ok, "result": res, "error": err}  # 200 either way so the UI can show the reason inline

# ── compliance ────────────────────────────────────────────────────────
@router.get("/compliance/readiness", dependencies=[Depends(require_module("compliance"))])
async def readiness(frameworks: str | None = None, p: Principal = Depends(requires("compliance:read")), db: AsyncSession = Depends(get_db)):
    return await compliance.readiness(db, p.tenant_id, frameworks.split(",") if frameworks else None)


@router.get("/compliance/capabilities", dependencies=[Depends(require_module("compliance"))])
async def capabilities(_: Principal = Depends(requires("compliance:read"))):
    return {k: {"description": d, "status": s} for k, (d, s) in compliance.CAPABILITIES.items()}


@router.get("/compliance/evidence", dependencies=[Depends(require_module("compliance"))])
async def evidence(p: Principal = Depends(requires("compliance:read")), db: AsyncSession = Depends(get_db)):
    await audit.record(db, tenant_id=p.tenant_id, actor=p.sub, action="compliance.evidence_exported")
    return await compliance.evidence_bundle(db, p.tenant_id)


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
    """Started from the app lifespan; escalates/expires overdue approvals for every tenant."""
    from nmb_marketplace_agent.config.database import async_session
    interval = interval_s or int(os.environ.get("ENTERPRISE_SWEEP_INTERVAL_S", "300"))
    while True:
        await asyncio.sleep(interval)
        try:
            async with async_session() as db:
                tenants = (await db.execute(select(Approval.tenant_id).where(Approval.status == "pending").distinct())).scalars().all()
                for t in tenants:
                    await (await _engine(db, t)).sweep_overdue()
        except Exception:  # noqa: BLE001
            pass
