"""Approval queue, decisions and turning approvals into eval cases."""
from __future__ import annotations

import json
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from nmb_marketplace_agent.api.deps import get_db
from nmb_marketplace_agent.config.models import (
    EvalCase,
    EvalDataset,
)
from nmb_marketplace_agent.enterprise import audit
from nmb_marketplace_agent.enterprise.api_common import _engine
from nmb_marketplace_agent.enterprise.licensing import (
    require_module,
)
from nmb_marketplace_agent.enterprise.models import (
    Approval,
    WorkflowRun,
)
from nmb_marketplace_agent.enterprise.rbac import Principal, requires
from nmb_marketplace_agent.enterprise.workflows.engine import (
    WorkflowError,
)

router = APIRouter()





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
