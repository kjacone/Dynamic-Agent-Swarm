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
from nmb_marketplace_agent.config.models import Handoff, HandoffMessage
from nmb_marketplace_agent.enterprise import audit, compliance, metering
from nmb_marketplace_agent.enterprise import handoff as handoff_service
from nmb_marketplace_agent.enterprise import notifications as notification_service
from nmb_marketplace_agent.enterprise import privacy as privacy_service
from nmb_marketplace_agent.enterprise import whatsapp as whatsapp_service
from nmb_marketplace_agent.enterprise.connectors import (
    ConnectorError,
    EgressPolicy,
    build_connector,
)
from nmb_marketplace_agent.enterprise.guardrails import GUARDRAIL_PRESETS, Policy, PolicyEngine
from nmb_marketplace_agent.enterprise.licensing import (
    ALL_MODULES,
    EDITIONS,
    FEATURE_CATALOG,
    current_license,
    require_module,
)
from nmb_marketplace_agent.enterprise.models import (
    Approval,
    ConnectorConfig,
    GuardrailInstruction,
    InstalledSolution,
    LicencePlan,
    LicenceUpgradeRequest,
    Notification,
    NotificationRoute,
    PolicySet,
    PrivacyRequest,
    UsageEvent,
    WhatsAppAccount,
    WhatsAppContact,
    WhatsAppMessage,
    WorkflowDefinition,
    WorkflowRun,
    now_iso,
)
from nmb_marketplace_agent.enterprise.rbac import Principal, current_principal, requires
from nmb_marketplace_agent.enterprise.runtime import build_runtime, load_guards, load_policy
from nmb_marketplace_agent.enterprise.solutions import loader as packs
from nmb_marketplace_agent.enterprise.solutions import marketplace
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


# ── WhatsApp channel ─────────────────────────────────────────────────
class WhatsAppAccountIn(BaseModel):
    phone_number_id: str = Field(min_length=3, max_length=64, pattern="^[0-9]+$")
    agent_id: str = Field(min_length=1, max_length=128)
    display_phone: str = Field(default="", max_length=32)
    enabled: bool = True


class WhatsAppSimulateIn(BaseModel):
    wa_id: str = Field(min_length=7, max_length=24)
    text: str = Field(min_length=1, max_length=3900)
    display_name: str = Field(default="", max_length=120)


class WhatsAppNotifyIn(BaseModel):
    wa_id: str = Field(min_length=7, max_length=24)
    text: str = Field(min_length=1, max_length=2000)
    subject: str = Field(default="[NMB] Account update", max_length=160)


class WhatsAppTaskIn(BaseModel):
    wa_id: str = Field(min_length=7, max_length=24)
    workflow_key: str = Field(min_length=1, max_length=128)
    inputs: dict[str, Any] = Field(default_factory=dict)
    wait: bool = False


def _wa_id_or_422(value: str) -> str:
    wa_id = whatsapp_service.norm_phone(value)
    if not wa_id:
        raise HTTPException(422, "Use an international phone number, digits only")
    return wa_id


@router.get("/whatsapp/config", dependencies=[Depends(require_module("connectors"))])
async def whatsapp_config(p: Principal = Depends(requires("connectors:read")),
                          db: AsyncSession = Depends(get_db)):
    bound = (await db.execute(select(WhatsAppAccount).where(
        WhatsAppAccount.tenant_id == p.tenant_id, WhatsAppAccount.enabled == True))).scalars().all()  # noqa: E712
    return {
        "graph_configured": whatsapp_service.graph_configured(),
        "simulator": whatsapp_service.simulator_enabled(),
        "app_secret_set": bool(whatsapp_service.app_secret()),
        "verify_token_set": bool(whatsapp_service.verify_token()),
        "unsigned_webhooks_allowed": whatsapp_service.unsigned_webhooks_allowed(),
        "webhook_path": "/whatsapp/webhook",
        "bound_numbers": len(bound),
    }


@router.get("/whatsapp/accounts", dependencies=[Depends(require_module("connectors"))])
async def whatsapp_accounts(p: Principal = Depends(requires("connectors:read")),
                            db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(WhatsAppAccount).where(
        WhatsAppAccount.tenant_id == p.tenant_id).order_by(WhatsAppAccount.created_at))).scalars().all()
    return rows


@router.post("/whatsapp/accounts", dependencies=[Depends(require_module("connectors"))])
async def whatsapp_account_save(body: WhatsAppAccountIn, p: Principal = Depends(requires("connectors:write")),
                                db: AsyncSession = Depends(get_db)):
    from nmb_marketplace_agent.config.models import AgentConfig

    agent = await db.get(AgentConfig, body.agent_id)
    if not agent or agent.tenant_id != p.tenant_id:
        raise HTTPException(422, "Pick an agent that belongs to this tenant")
    pid = body.phone_number_id.strip()
    row = (await db.execute(select(WhatsAppAccount).where(
        WhatsAppAccount.phone_number_id == pid))).scalars().first()
    if row and row.tenant_id != p.tenant_id:
        raise HTTPException(409, "That WhatsApp number is bound to another tenant")
    if not row:
        row = WhatsAppAccount(id=str(uuid.uuid4()), tenant_id=p.tenant_id, phone_number_id=pid)
    row.agent_id = body.agent_id
    row.display_phone = body.display_phone.strip() or whatsapp_service.norm_phone(body.display_phone)
    row.enabled = body.enabled
    db.add(row)
    await db.commit()
    await audit.record(db, tenant_id=p.tenant_id, actor=p.sub, action="whatsapp.account_saved",
                       resource_type="whatsapp_account", resource_id=row.id,
                       details={"agent_id": row.agent_id, "enabled": row.enabled})
    return row


@router.delete("/whatsapp/accounts/{account_id}", dependencies=[Depends(require_module("connectors"))])
async def whatsapp_account_delete(account_id: str, p: Principal = Depends(requires("connectors:write")),
                                  db: AsyncSession = Depends(get_db)):
    row = await db.get(WhatsAppAccount, account_id)
    if not row or row.tenant_id != p.tenant_id:
        raise HTTPException(404, "Account not found")
    await db.delete(row)
    await db.commit()
    await audit.record(db, tenant_id=p.tenant_id, actor=p.sub, action="whatsapp.account_deleted",
                       resource_type="whatsapp_account", resource_id=account_id, details={})
    return {"deleted": account_id}


@router.get("/whatsapp/contacts", dependencies=[Depends(require_module("connectors"))])
async def whatsapp_contacts(p: Principal = Depends(requires("connectors:read")),
                            db: AsyncSession = Depends(get_db)):
    contacts = (await db.execute(select(WhatsAppContact).where(
        WhatsAppContact.tenant_id == p.tenant_id).order_by(
        WhatsAppContact.last_seen_at.desc()).limit(200))).scalars().all()
    counts: dict[str, int] = {}
    if contacts:
        counts = dict((await db.execute(
            select(WhatsAppMessage.contact_id, func.count(WhatsAppMessage.id))
            .where(WhatsAppMessage.tenant_id == p.tenant_id)
            .group_by(WhatsAppMessage.contact_id))).all())
    return [c.model_dump() | {"message_count": int(counts.get(c.id, 0))} for c in contacts]


@router.get("/whatsapp/contacts/{wa_id}/messages", dependencies=[Depends(require_module("connectors"))])
async def whatsapp_transcript(wa_id: str, limit: int = 100,
                              p: Principal = Depends(requires("connectors:read")),
                              db: AsyncSession = Depends(get_db)):
    wa = _wa_id_or_422(wa_id)
    contact = (await db.execute(select(WhatsAppContact).where(
        WhatsAppContact.tenant_id == p.tenant_id, WhatsAppContact.wa_id == wa))).scalars().first()
    if not contact:
        raise HTTPException(404, "Contact not found")
    rows = (await db.execute(select(WhatsAppMessage).where(
        WhatsAppMessage.tenant_id == p.tenant_id, WhatsAppMessage.contact_id == contact.id,
    ).order_by(WhatsAppMessage.created_at.desc()).limit(min(limit, 500)))).scalars().all()
    messages = [{"id": m.id, "direction": m.direction, "kind": m.kind, "status": m.status,
                 "body": m.body, "created_at": m.created_at, "error": m.error}
                for m in reversed(rows)]
    return {"contact": contact, "messages": messages}


@router.post("/whatsapp/simulate", dependencies=[Depends(require_module("connectors"))])
async def whatsapp_simulate(body: WhatsAppSimulateIn, p: Principal = Depends(requires("connectors:write")),
                            db: AsyncSession = Depends(get_db)):
    """Feed an inbound WhatsApp message through the real webhook path (demo/testing)."""
    if not whatsapp_service.simulator_enabled() and not whatsapp_service.graph_configured():
        raise HTTPException(409, "WhatsApp is not configured on this deployment")
    account = await whatsapp_service.account_for_tenant(db, p.tenant_id)
    if not account:
        raise HTTPException(409, "Bind a WhatsApp number to an agent first")
    result = await whatsapp_service.handle_message(db, {
        "phone_number_id": account.phone_number_id,
        "wa_id": _wa_id_or_422(body.wa_id),
        "provider_id": f"sim:{uuid.uuid4().hex}",
        "type": "text",
        "text": body.text,
        "name": body.display_name,
    })
    contact = (await db.execute(select(WhatsAppContact).where(
        WhatsAppContact.tenant_id == p.tenant_id,
        WhatsAppContact.wa_id == _wa_id_or_422(body.wa_id)))).scalars().first()
    await audit.record(db, tenant_id=p.tenant_id, actor=p.sub, action="whatsapp.simulated_inbound",
                       resource_type="whatsapp", resource_id=contact.id if contact else "",
                       details={"ok": result.get("ok", False)})
    return result | {"contact_id": contact.id if contact else ""}


@router.post("/whatsapp/notify", dependencies=[Depends(require_module("connectors"))])
async def whatsapp_notify(body: WhatsAppNotifyIn, p: Principal = Depends(requires("connectors:write")),
                          db: AsyncSession = Depends(get_db)):
    """Queue a proactive update and try to deliver it immediately."""
    wa = _wa_id_or_422(body.wa_id)
    account = await whatsapp_service.account_for_tenant(db, p.tenant_id)
    if not account:
        raise HTTPException(409, "Bind a WhatsApp number to an agent first")
    contact = (await db.execute(select(WhatsAppContact).where(
        WhatsAppContact.tenant_id == p.tenant_id, WhatsAppContact.wa_id == wa))).scalars().first()
    if not contact:
        raise HTTPException(404, "This customer has not messaged this agent yet")
    nid = await whatsapp_service.queue_update(
        db, p.tenant_id, wa, body.subject.strip(), body.text.strip(),
        event="console.update", ref=f"console:{uuid.uuid4().hex[:12]}",
    )
    if not nid:
        raise HTTPException(422, "The message was blocked by the output guardrails")
    await notification_service.dispatch_due(limit=20)
    row = await db.get(Notification, nid)
    return {"id": nid, "status": row.status if row else "pending",
            "attempts": row.attempts if row else 0, "error": row.last_error if row else None}


@router.post("/whatsapp/tasks", dependencies=[Depends(require_module("workflows"))])
async def whatsapp_task(body: WhatsAppTaskIn, p: Principal = Depends(requires("workflows:run")),
                        db: AsyncSession = Depends(get_db)):
    """Start a workflow on behalf of a WhatsApp customer so completion reaches them."""
    wa = _wa_id_or_422(body.wa_id)
    account = await whatsapp_service.account_for_tenant(db, p.tenant_id)
    if not account:
        raise HTTPException(409, "Bind a WhatsApp number to an agent first")
    await whatsapp_service.contact_for(db, account, wa)
    eng = await _engine(db, p.tenant_id)
    try:
        run = await eng.start(body.workflow_key, body.inputs, whatsapp_service.user_id_for(wa),
                              run_now=body.wait)
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
    return _run_view(run) | {"wa_id": wa, "initiator": whatsapp_service.user_id_for(wa)}


# ── human handoff queue ───────────────────────────────────────────────
class HandoffReplyIn(BaseModel):
    text: str = Field(min_length=1, max_length=8000)


class HandoffResolveIn(BaseModel):
    note: str = Field(default="", max_length=2000)


@router.get("/handoffs", dependencies=[Depends(require_module("approvals"))])
async def handoffs_list(status: str | None = None, limit: int = 200,
                        p: Principal = Depends(requires("handoffs:read")),
                        db: AsyncSession = Depends(get_db)):
    q = select(Handoff).where(Handoff.tenant_id == p.tenant_id)
    if status:
        q = q.where(Handoff.status == status)
    rows = (await db.execute(q.order_by(Handoff.created_at.desc()).limit(min(limit, 500)))).scalars().all()

    ids = [h.id for h in rows]
    counts: dict[str, int] = {}
    if ids:
        counts = dict((await db.execute(
            select(HandoffMessage.handoff_id, func.count(HandoffMessage.id))
            .where(HandoffMessage.handoff_id.in_(ids)).group_by(HandoffMessage.handoff_id)
        )).all())
    return [handoff_service.view(h) | {"message_count": int(counts.get(h.id, 0))} for h in rows]


@router.get("/handoffs/{handoff_id}", dependencies=[Depends(require_module("approvals"))])
async def handoff_detail(handoff_id: str, p: Principal = Depends(requires("handoffs:read")),
                         db: AsyncSession = Depends(get_db)):
    h = await db.get(Handoff, handoff_id)
    if not h or h.tenant_id != p.tenant_id:
        raise HTTPException(404, "Handoff not found")
    rows = await handoff_service.messages(db, h.id)
    return handoff_service.view(h) | {"messages": [handoff_service.message_view(m) for m in rows]}


@router.post("/handoffs/{handoff_id}/claim", dependencies=[Depends(require_module("approvals"))])
async def handoff_claim(handoff_id: str, p: Principal = Depends(requires("handoffs:write")),
                        db: AsyncSession = Depends(get_db)):
    h = await db.get(Handoff, handoff_id)
    if not h or h.tenant_id != p.tenant_id:
        raise HTTPException(404, "Handoff not found")
    try:
        await handoff_service.claim(db, h, p.sub)
    except handoff_service.HandoffError as e:
        raise HTTPException(409, str(e)) from e
    return handoff_service.view(h)


@router.post("/handoffs/{handoff_id}/reply", dependencies=[Depends(require_module("approvals"))])
async def handoff_reply(handoff_id: str, body: HandoffReplyIn,
                        p: Principal = Depends(requires("handoffs:write")),
                        db: AsyncSession = Depends(get_db)):
    h = await db.get(Handoff, handoff_id)
    if not h or h.tenant_id != p.tenant_id:
        raise HTTPException(404, "Handoff not found")
    if h.status != "active":
        raise HTTPException(409, "Claim the conversation before replying")
    if h.assigned_to and h.assigned_to != p.sub and not p.has_role("tenant_admin"):
        raise HTTPException(403, f"Conversation is assigned to {h.assigned_to}")
    try:
        text = await handoff_service.screen_reply(db, p.tenant_id, body.text)
    except handoff_service.HandoffError as e:
        raise HTTPException(422, str(e)) from e
    m = await handoff_service.add_message(db, h, role="staff", author=p.sub, text=text)
    return {"handoff": handoff_service.view(h), "message": handoff_service.message_view(m)}


@router.post("/handoffs/{handoff_id}/resolve", dependencies=[Depends(require_module("approvals"))])
async def handoff_resolve(handoff_id: str, body: HandoffResolveIn,
                          p: Principal = Depends(requires("handoffs:write")),
                          db: AsyncSession = Depends(get_db)):
    h = await db.get(Handoff, handoff_id)
    if not h or h.tenant_id != p.tenant_id:
        raise HTTPException(404, "Handoff not found")
    if h.assigned_to and h.assigned_to != p.sub and not p.has_role("tenant_admin"):
        raise HTTPException(403, f"Conversation is assigned to {h.assigned_to}")
    await handoff_service.resolve(db, h, p.sub, body.note)
    return handoff_service.view(h)


# ── marketplace ───────────────────────────────────────────────────────
@router.get("/marketplace", dependencies=[Depends(require_module("solutions"))])
async def marketplace_catalog(p: Principal = Depends(requires("solutions:read")),
                              db: AsyncSession = Depends(get_db)):
    return await marketplace.catalog(db, p.tenant_id, current_license())


@router.get("/marketplace/{solution_id}", dependencies=[Depends(require_module("solutions"))])
async def marketplace_pack(solution_id: str,
                           p: Principal = Depends(requires("solutions:read")),
                           db: AsyncSession = Depends(get_db)):
    try:
        return await marketplace.detail(db, p.tenant_id, solution_id, current_license())
    except packs.PackError as e:
        raise HTTPException(404, str(e)) from e


@router.post("/marketplace/{solution_id}/upgrade",
             dependencies=[Depends(require_module("solutions"))])
async def marketplace_upgrade(solution_id: str,
                              p: Principal = Depends(requires("solutions:write")),
                              db: AsyncSession = Depends(get_db)):
    inst = await db.get(InstalledSolution, f"{p.tenant_id}:{solution_id}")
    if not inst:
        raise HTTPException(404, "Install the solution first.")
    try:
        pack = packs.load_pack(solution_id)
    except packs.PackError as e:
        raise HTTPException(404, str(e)) from e

    from_version, before = inst.version, dict(inst.parameters)
    latest = pack.get("version", "1.0.0")
    if not marketplace.upgrade_available(latest, from_version):
        raise HTTPException(
            409,
            f"Installed v{from_version} is already current (catalog v{latest}).",
        )
    if not current_license().has_solution(solution_id):
        raise HTTPException(402, f"Solution '{solution_id}' is not included in your license")

    try:
        new = await packs.install_solution(db, p.tenant_id, solution_id, p.sub)
    except (packs.PackError, WorkflowError) as e:
        raise HTTPException(422, str(e)) from e
    return {
        "solution": solution_id,
        "from_version": from_version,
        "to_version": new.version,
        "parameters": new.parameters,
        "parameter_changes": marketplace.parameter_changes(
            before, pack.get("parameters") or {},
        ),
        "created": new.created,
    }


class RollbackRequest(BaseModel):
    version: str | None = None


@router.post("/marketplace/{solution_id}/rollback",
             dependencies=[Depends(require_module("solutions"))])
async def marketplace_rollback(solution_id: str, body: RollbackRequest | None = None,
                               p: Principal = Depends(requires("solutions:write")),
                               db: AsyncSession = Depends(get_db)):
    inst = await db.get(InstalledSolution, f"{p.tenant_id}:{solution_id}")
    if not inst:
        raise HTTPException(404, "Install the solution first.")
    if not current_license().has_solution(solution_id):
        raise HTTPException(402, f"Solution '{solution_id}' is not included in your license")
    try:
        applied, from_version = await packs.rollback_solution(
            db, p.tenant_id, solution_id, p.sub, body.version if body else None,
        )
    except packs.NothingToRollBack as e:
        raise HTTPException(409, str(e)) from e
    except (packs.PackError, WorkflowError) as e:
        raise HTTPException(422, str(e)) from e
    return {
        "solution": solution_id,
        "from_version": from_version,
        "to_version": applied.version,
        "parameters": applied.parameters,
        "created": applied.created,
    }


# ── solutions ─────────────────────────────────────────────────────────
@router.get("/solutions", dependencies=[Depends(require_module("solutions"))])
async def solutions(p: Principal = Depends(requires("solutions:read")),
                    db: AsyncSession = Depends(get_db)):
    return (await marketplace.catalog(db, p.tenant_id, current_license()))["packs"]


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
    """Started from the app lifespan: escalates approvals and applies retention for every tenant."""
    from nmb_marketplace_agent.config.database import async_session
    from nmb_marketplace_agent.config.models import Citation, Feedback, Handoff, ThreadOwner
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
