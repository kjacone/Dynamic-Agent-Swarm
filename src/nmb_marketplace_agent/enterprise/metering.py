"""Usage metering: the basis for subscription true-ups, quotas and chargeback.

Metrics: agent_runs, workflow_runs, workflow_steps, tokens_in, tokens_out, documents,
approvals, tool_calls, policy_blocks. Events are append-only and tenant-scoped.
"""
from __future__ import annotations

import csv
import io
import uuid
from datetime import UTC, datetime

from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from nmb_marketplace_agent.enterprise.licensing import current_license
from nmb_marketplace_agent.enterprise.models import UsageEvent


def period_of(dt: datetime | None = None) -> str:
    return (dt or datetime.now(UTC)).strftime("%Y-%m")


async def record_usage(db: AsyncSession, tenant_id: str, metric: str, quantity: float = 1.0, **dims) -> None:
    db.add(UsageEvent(id=str(uuid.uuid4()), tenant_id=tenant_id, metric=metric, quantity=quantity,
                      period=period_of(), dims=dims))
    await db.commit()


async def summarize(db: AsyncSession, tenant_id: str, period: str | None = None) -> dict[str, float]:
    period = period or period_of()
    rows = (await db.execute(select(UsageEvent.metric, func.sum(UsageEvent.quantity))
                             .where(UsageEvent.tenant_id == tenant_id, UsageEvent.period == period)
                             .group_by(UsageEvent.metric))).all()
    return {m: float(q) for m, q in rows}


# license quota key -> metrics that count against it
_QUOTA = {"agent_runs": ["agent_runs"], "workflow_runs": ["workflow_runs"],
          "tokens": ["tokens_in", "tokens_out"], "documents": ["documents"]}


async def quota_status(db: AsyncSession, tenant_id: str) -> dict[str, dict]:
    used = await summarize(db, tenant_id)
    out = {}
    for key, limit in current_license().quotas.items():
        u = sum(used.get(m, 0) for m in _QUOTA.get(key, [key]))
        out[key] = {"used": u, "limit": limit, "pct": round(100 * u / limit, 1) if limit else None, "exceeded": bool(limit) and u > limit}
    return out


async def export_csv(db: AsyncSession, tenant_id: str, period: str | None = None) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["tenant_id", "period", "metric", "quantity"])
    for m, q in sorted((await summarize(db, tenant_id, period)).items()):
        w.writerow([tenant_id, period or period_of(), m, q])
    return buf.getvalue()
