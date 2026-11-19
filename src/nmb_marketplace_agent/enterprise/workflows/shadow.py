"""Shadow mode: replay historical workflow runs against the current config.

Answers the question every pilot reviewer asks: "if we'd been running the current
version during the trial, would we have made the same decision?" — without touching
the tenant's audit chain or metering quota.
"""
from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from nmb_marketplace_agent.enterprise.models import Approval, WorkflowRun
from nmb_marketplace_agent.enterprise.workflows.engine import (
    Runtime,
    WorkflowEngine,
)

log = logging.getLogger(__name__)


@dataclass
class ShadowResult:
    original_id: str
    original_shape: str
    shadow_shape: str
    matches: bool
    error: str | None = None


@dataclass
class ShadowReport:
    workflow: str
    version: int
    window_days: int
    total: int
    matched: int
    results: list[ShadowResult] = field(default_factory=list)
    matrix: dict[str, dict[str, int]] = field(default_factory=dict)


def _shape(run: WorkflowRun) -> str:
    if run.status == "failed":
        return "failed"
    if run.status == "waiting_approval":
        return "waiting_approval"
    if run.status == "cancelled":
        return "cancelled"
    if run.status == "rejected":
        return "rejected"
    outcome = (run.state or {}).get("ctx", {}).get("_outcome") or "completed"
    return f"auto_completed:{outcome}"


async def _historical(db: AsyncSession, tenant_id: str, workflow_key: str,
                      days: int, limit: int) -> list[WorkflowRun]:
    cutoff = (datetime.now(UTC) - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
    q = (
        select(WorkflowRun)
        .where(
            WorkflowRun.tenant_id == tenant_id,
            WorkflowRun.workflow_key == workflow_key,
            WorkflowRun.created_at >= cutoff,
            ~WorkflowRun.initiator.startswith("shadow:"),  # type: ignore[attr-defined]
            WorkflowRun.status.in_(["completed", "failed", "rejected", "waiting_approval"]),  # type: ignore[attr-defined]
        )
        .order_by(WorkflowRun.created_at.desc())
        .limit(limit)
    )
    return list((await db.execute(q)).scalars().all())


async def _replay_one(
    db: AsyncSession, tenant_id: str, runtime: Runtime, spec_inputs: dict,
    workflow_key: str, original: WorkflowRun,
) -> ShadowResult:
    shadow_engine = WorkflowEngine(db, runtime, tenant_id)
    spec = await shadow_engine.get_spec(workflow_key)
    run = WorkflowRun(
        id=str(uuid.uuid4()),
        tenant_id=tenant_id,
        workflow_key=workflow_key,
        workflow_version=spec.version,
        initiator=f"shadow:{original.id}",
        status="running",
        state={
            "ctx": {"input": spec_inputs, **spec_inputs},
            "cursor": spec.start or spec.steps[0].id,
            "history": [],
            "n": 0,
            "approved_steps": [],
        },
    )
    db.add(run)
    await db.commit()

    error = None
    try:
        await shadow_engine.advance(run.id)
        await db.refresh(run)
        shadow_shape = _shape(run)
    except Exception as e:  # noqa: BLE001
        shadow_shape = "failed"
        error = f"{type(e).__name__}: {e}"[:300]
    finally:
        await db.execute(delete(Approval).where(Approval.run_id == run.id))
        await db.execute(delete(WorkflowRun).where(WorkflowRun.id == run.id))
        await db.commit()

    original_shape = _shape(original)
    return ShadowResult(
        original_id=original.id,
        original_shape=original_shape,
        shadow_shape=shadow_shape,
        matches=(original_shape == shadow_shape),
        error=error,
    )


async def run_shadow(
    db: AsyncSession, tenant_id: str, runtime: Runtime, workflow_key: str,
    days: int = 30, limit: int = 100,
) -> ShadowReport:
    runtime.shadow = True
    originals = await _historical(db, tenant_id, workflow_key, days, limit)
    results: list[ShadowResult] = []
    matrix: dict[str, dict[str, int]] = {}

    spec = await WorkflowEngine(db, runtime, tenant_id).get_spec(workflow_key)

    for orig in originals:
        inputs = ((orig.state or {}).get("ctx") or {}).get("input")
        if not isinstance(inputs, dict):
            results.append(ShadowResult(
                original_id=orig.id, original_shape=_shape(orig),
                shadow_shape="skipped", matches=False,
                error="no input snapshot on original run",
            ))
            continue
        try:
            r = await _replay_one(db, tenant_id, runtime, inputs, workflow_key, orig)
        except Exception as e:  # noqa: BLE001
            r = ShadowResult(
                original_id=orig.id, original_shape=_shape(orig),
                shadow_shape="failed", matches=False,
                error=f"{type(e).__name__}: {e}"[:300],
            )
        results.append(r)
        row = matrix.setdefault(r.original_shape, {})
        row[r.shadow_shape] = row.get(r.shadow_shape, 0) + 1

    matched = sum(1 for r in results if r.matches)
    return ShadowReport(
        workflow=workflow_key,
        version=spec.version,
        window_days=days,
        total=len(results),
        matched=matched,
        results=results,
        matrix=matrix,
    )