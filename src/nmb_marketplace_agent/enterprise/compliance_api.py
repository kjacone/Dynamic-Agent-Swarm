"""Compliance readiness, capabilities, evidence and cost per case."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from nmb_marketplace_agent.api.deps import get_db
from nmb_marketplace_agent.enterprise import audit, compliance
from nmb_marketplace_agent.enterprise.licensing import (
    require_module,
)
from nmb_marketplace_agent.enterprise.models import (
    UsageEvent,
    WorkflowRun,
)
from nmb_marketplace_agent.enterprise.rbac import Principal, requires

router = APIRouter()




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
