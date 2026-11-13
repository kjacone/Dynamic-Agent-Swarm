"""REST surface of the enterprise layer, mounted at /enterprise (see api/main.py)."""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import os
from typing import Any
import uuid  
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import PlainTextResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func
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
    UsageEvent,
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

from nmb_marketplace_agent.config.models import EvalCase, EvalDataset
from nmb_marketplace_agent.enterprise.workflows.shadow import run_shadow

from nmb_marketplace_agent.enterprise.expr import ExprError, safe_eval
from nmb_marketplace_agent.enterprise.models import WorkflowRule


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



# ── approvals → eval cases (learning loop) ────────────────────────────
class ToEvalCase(BaseModel):
    dataset_id: str
    input: str | None = None       # override the workflow run's input if provided
    criteria: str | None = None    # override the derived criteria if provided
    expect_delegations: list[str] | None = None


@router.post("/approvals/{approval_id}/to-eval-case", dependencies=[Depends(require_module("approvals"))])
async def approval_to_eval_case(
    approval_id: str, body: ToEvalCase,
    p: Principal = Depends(requires("approvals:read")),
    db: AsyncSession = Depends(get_db),
):
    """Turn a human decision into a labeled eval case on the chosen dataset.

    Defaults:
      input           — the workflow run's original inputs, serialized
      criteria        — describes the human decision ("The reviewer approved/rejected ...")
      expect_delegations — none (orchestration not asserted from a single approval)
    """
    a = await db.get(Approval, approval_id)
    if not a or a.tenant_id != p.tenant_id:
        raise HTTPException(404, "Approval not found")
    if a.status not in ("approved", "rejected"):
        raise HTTPException(409, "Only decided approvals can become eval cases")

    ds = await db.get(EvalDataset, body.dataset_id)
    if not ds or ds.tenant_id != p.tenant_id:
        raise HTTPException(404, "Eval dataset not found")

    run = await db.get(WorkflowRun, a.run_id)
    input_text = body.input
    if input_text is None:
        inputs = ((run.state or {}).get("ctx") or {}).get("input") if run else None
        input_text = json.dumps(inputs or {}, ensure_ascii=False)

    decision = a.status  # "approved" | "rejected"
    criteria = body.criteria or (
        f"A human {decision} this case"
        + (f": {a.decisions[-1].get('comment')}" if a.decisions and a.decisions[-1].get("comment") else "")
        + ". The agent must produce an answer consistent with that decision."
    )

    case = EvalCase(
        id=str(uuid.uuid4()),
        dataset_id=ds.id,
        input=input_text,
        expected_contains=None,
        criteria=criteria,
        expect_delegations=body.expect_delegations,
    )
    db.add(case)
    await db.commit()

    await audit.record(
        db, tenant_id=p.tenant_id, actor=p.sub, action="approval.to_eval_case",
        resource_type="eval_case", resource_id=case.id,
        details={"approval_id": a.id, "dataset_id": ds.id, "decision": decision},
    )
    return {
        "case_id": case.id, "dataset_id": ds.id, "decision": decision,
        "input": input_text, "criteria": criteria,
    }


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
            "history": r.state.get("history", []), "created_at": r.created_at, "updated_at": r.updated_at,
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
async def solutions(p: Principal = Depends(requires("solutions:read")),
                    db: AsyncSession = Depends(get_db)):
    inst = {i.solution_id: i for i in await packs.installed(db, p.tenant_id)}
    lic = current_license()
    out: list[dict] = []
    for d in packs.list_packs():
        i = inst.get(d["id"])
        out.append(d | {
            "installed": i is not None,
            "entitled": lic.has_solution(d["id"]),
            "installed_version": i.version if i else None,
            # Conformance is stored on InstalledSolution.created["conformance"] by
            # install_solution when the pack declares a supervisor. Null until then.
            "conformance": (i.created or {}).get("conformance") if i else None,
        })
    return out


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

@router.post("/solutions/{solution_id}/samples/{case_id}/run",
             dependencies=[Depends(require_module("solutions"))])
async def run_sample(solution_id: str, case_id: str,
                     p: Principal = Depends(requires("workflows:run")),
                     db: AsyncSession = Depends(get_db)):
    pack = packs.load_pack(solution_id)
    case = next(
        (c for c in (pack.get("samples") or {}).get("cases", []) if c["id"] == case_id),
        None,
    )
    if not case:
        raise HTTPException(404, f"Sample case '{case_id}' not found in '{solution_id}'")

    eng = await _engine(db, p.tenant_id)
    try:
        run = await eng.start(case["workflow"], case["inputs"],
                              f"sample:{p.sub}", run_now=False)
    except WorkflowError as e:
        raise _wf_err(e) from e

    t = asyncio.create_task(_advance_in_background(run.id, p.tenant_id))
    _bg.add(t)
    t.add_done_callback(_bg.discard)

    return _run_view(run) | {"expect": case.get("expect")}

async def _advance_in_background(run_id: str, tenant: str):
    from nmb_marketplace_agent.config.database import async_session
    async with async_session() as s:
        try:
            await (await _engine(s, tenant)).advance(run_id)
        except Exception:  # noqa: BLE001 — the engine records failures on the run
            pass

@router.get("/solutions/{solution_id}/embed",
            dependencies=[Depends(require_module("solutions"))])
async def solution_embed(solution_id: str, request: Request,
                         p: Principal = Depends(requires("solutions:read")),
                         db: AsyncSession = Depends(get_db)):
    pack = packs.load_pack(solution_id)
    w = pack.get("widget")
    if pack.get("delivery", "workflow") == "workflow":
        raise HTTPException(409, "This solution is back-office only; there is no widget to embed.")
    if not w:
        raise HTTPException(409, "This solution does not declare a widget.")
    inst = await db.get(InstalledSolution, f"{p.tenant_id}:{solution_id}")
    if not inst:
        raise HTTPException(404, "Install the solution first.")
    supervisor_id = (inst.created or {}).get("supervisor")
    if not supervisor_id:
        raise HTTPException(409, "Install the solution with a supervisor to embed the widget.")

    base = str(request.base_url).rstrip("/")
    return {
        "agent_id": supervisor_id,
        "widget": w,
        "script": (
            f'<script src="{base}/embed.js" '
            f'data-key="pk_YOUR_PUBLISHABLE_KEY" '
            f'data-api="{base}" '
            f'data-title="{w.get("title", "")}"></script>'
        ),
        "steps": [
            "Publish the supervisor agent (Agents → Versions → Publish).",
            "Create a publishable key in Settings, restricted to your site's origin.",
            "Paste the script tag, or use the agent-kit React provider for frontend tools.",
        ],
    }
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

# ── PUT /connectors/{name} ────────────────────────────────────────
# Upsert a connector definition. Inline secrets are rejected with 422; only
# env:NAME / file:/path references are accepted (see connectors.base.resolve_secret).

_SECRET_KEYS = frozenset({"secret", "password", "password_ref", "api_key", "token"})



def _reject_inline_secrets(cfg, path: str = "") -> None:
    from nmb_marketplace_agent.enterprise.connectors.base import ConnectorError, resolve_secret

    if isinstance(cfg, dict):
        for k, v in cfg.items():
            sub = f"{path}.{k}" if path else k
            if isinstance(v, str) and k.lower() in _SECRET_KEYS:
                try:
                    resolve_secret(v)
                except ConnectorError as e:
                    raise ConnectorError(f"{sub}: {e}") from e
            elif isinstance(v, (dict, list)):
                _reject_inline_secrets(v, sub)
    elif isinstance(cfg, list):
        for i, v in enumerate(cfg):
            _reject_inline_secrets(v, f"{path}[{i}]")


def _validate_secret_refs(cfg, path: str = "") -> None:
    if isinstance(cfg, dict):
        for k, v in cfg.items():
            sub = f"{path}.{k}" if path else k
            if isinstance(v, str) and k.lower() in _SECRET_KEYS:
                if not (v.startswith("env:") or v.startswith("file:")):
                    raise HTTPException(
                        status_code=422,
                        detail=(
                            f"{sub}: secrets must be 'env:NAME' or 'file:/path' "
                            "references, never inline values"
                        ),
                    )
            elif isinstance(v, (dict, list)):
                _validate_secret_refs(v, sub)
    elif isinstance(cfg, list):
        for i, v in enumerate(cfg):
            _validate_secret_refs(v, f"{path}[{i}]")


class _ConnectorIn(BaseModel):
    type: str
    config: dict = Field(default_factory=dict)




@router.put(
    "/connectors/{name}",
    dependencies=[Depends(require_module("connectors"))],
)
async def upsert_connector(name: str, body: _ConnectorIn):
    _validate_secret_refs(body.config)
    # TODO: persist via your existing connector repo / write admin audit row.
    return {"name": name, "type": body.type, "ok": True}

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

@router.get("/governance/cost", dependencies=[Depends(require_module("compliance"))])
async def governance_cost(
    days: int = 30,
    p: Principal = Depends(requires("usage:read")),
    db: AsyncSession = Depends(get_db),
):
    """Cost per case, per workflow, over the last N days.

    Reads the `llm_tokens` metering rows written by CostTracker.flush(). Each row
    carries `run_id`, `usd`, `calls`, `input_tokens`, `output_tokens`, `model`.
    Joins to `workflow_runs` to attribute cost to a workflow key.
    """
    from datetime import UTC, datetime, timedelta

    cutoff = (datetime.now(UTC) - timedelta(days=max(1, min(days, 365)))).strftime(
        "%Y-%m-%dT%H:%M:%S.%fZ"
    )

    rows = (await db.execute(
        select(UsageEvent).where(
            UsageEvent.tenant_id == p.tenant_id,
            UsageEvent.metric == "llm_tokens",
            UsageEvent.ts >= cutoff,
        )
    )).scalars().all()

    # run_id -> { workflow, usd, calls, input, output }
    by_run: dict[str, dict] = {}
    for r in rows:
        dims = r.dims or {}
        run_id = dims.get("run_id") or ""
        if not run_id:
            continue
        entry = by_run.setdefault(run_id, {
            "workflow": None, "usd": 0.0, "calls": 0,
            "input_tokens": 0, "output_tokens": 0,
        })
        entry["usd"] += float(dims.get("usd") or 0.0)
        entry["calls"] += int(dims.get("calls") or 0)
        entry["input_tokens"] += int(dims.get("input_tokens") or 0)
        entry["output_tokens"] += int(dims.get("output_tokens") or 0)

    if by_run:
        run_ids = list(by_run.keys())
        run_rows = (await db.execute(
            select(WorkflowRun).where(
                WorkflowRun.tenant_id == p.tenant_id,
                WorkflowRun.id.in_(run_ids),
            )
        )).scalars().all()
        for rr in run_rows:
            by_run[rr.id]["workflow"] = rr.workflow_key

    # Aggregate per workflow
    by_workflow: dict[str, dict] = {}
    for entry in by_run.values():
        wf = entry["workflow"] or "unknown"
        agg = by_workflow.setdefault(wf, {
            "workflow": wf, "cases": 0, "total_usd": 0.0,
            "total_calls": 0, "total_input": 0, "total_output": 0,
        })
        agg["cases"] += 1
        agg["total_usd"] += entry["usd"]
        agg["total_calls"] += entry["calls"]
        agg["total_input"] += entry["input_tokens"]
        agg["total_output"] += entry["output_tokens"]

    out = []
    for agg in by_workflow.values():
        avg = (agg["total_usd"] / agg["cases"]) if agg["cases"] else 0.0
        out.append({
            "workflow": agg["workflow"],
            "cases": agg["cases"],
            "total_usd": round(agg["total_usd"], 6),
            "avg_usd": round(avg, 6),
            "total_calls": agg["total_calls"],
            "total_tokens": agg["total_input"] + agg["total_output"],
        })
    return sorted(out, key=lambda r: r["total_usd"], reverse=True)
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
