import uuid

import pytest
from fastapi import HTTPException

from nmb_marketplace_agent.config.models import EvalDataset
from nmb_marketplace_agent.enterprise.models import Approval, WorkflowRun


async def _seed(db, tenant, status="approved"):
    run_id = str(uuid.uuid4())
    ap_id = str(uuid.uuid4())
    ds_id = str(uuid.uuid4())
    db.add(WorkflowRun(
        id=run_id, tenant_id=tenant, workflow_key="wf",
        state={"ctx": {"input": {"customer_name": "Jane", "country": "KE"}}},
    ))
    db.add(Approval(
        id=ap_id, tenant_id=tenant, run_id=run_id, step_id="review",
        title="t", summary="s", requester="ops", status=status,
        required_approvals=1, allowed_roles=["compliance_officer"],
        decisions=[{"by": "officer1", "decision": "approve", "comment": "verified source", "ts": "x"}],
    ))
    db.add(EvalDataset(id=ds_id, name="ds", agent_id="a", tenant_id=tenant))
    await db.commit()
    return ap_id, ds_id


async def test_approval_to_eval_defaults_from_run(db):
    from nmb_marketplace_agent.enterprise.approvals_api import (
        ToEvalCase,
        approval_to_eval_case,
    )
    from nmb_marketplace_agent.enterprise.rbac import Principal

    ap_id, ds_id = await _seed(db, "t1")
    p = Principal("auditor1", "t1", {"auditor"}, "jwt")

    r = await approval_to_eval_case(ap_id, ToEvalCase(dataset_id=ds_id), p, db)
    assert r["decision"] == "approved"
    assert "Jane" in r["input"]
    assert "human approved" in r["criteria"].lower()
    assert "verified source" in r["criteria"]


async def test_approval_to_eval_rejects_pending(db):
    from nmb_marketplace_agent.enterprise.approvals_api import (
        ToEvalCase,
        approval_to_eval_case,
    )
    from nmb_marketplace_agent.enterprise.rbac import Principal

    ap_id, ds_id = await _seed(db, "t1", status="pending")
    p = Principal("auditor1", "t1", {"auditor"}, "jwt")
    with pytest.raises(HTTPException) as exc:
        await approval_to_eval_case(ap_id, ToEvalCase(dataset_id=ds_id), p, db)
    assert exc.value.status_code == 409


async def test_approval_to_eval_rejects_other_tenant(db):
    from nmb_marketplace_agent.enterprise.approvals_api import (
        ToEvalCase,
        approval_to_eval_case,
    )
    from nmb_marketplace_agent.enterprise.rbac import Principal

    ap_id, ds_id = await _seed(db, "t1")
    p = Principal("auditor1", "t2", {"auditor"}, "jwt")
    with pytest.raises(HTTPException) as exc:
        await approval_to_eval_case(ap_id, ToEvalCase(dataset_id=ds_id), p, db)
    assert exc.value.status_code == 404