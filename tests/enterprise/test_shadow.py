import uuid

from sqlmodel import select

from nmb_marketplace_agent.enterprise.models import Approval, WorkflowRun
from nmb_marketplace_agent.enterprise.workflows.engine import Runtime
from nmb_marketplace_agent.enterprise.workflows.shadow import run_shadow

SPEC = {
    "key": "kyc", "inputs": {"name": {"required": True}},
    "steps": [
        {"id": "a", "type": "agent", "agent": "x", "output": "out", "prompt": "score {{ name }}"},
        {"id": "parse", "type": "set", "values": {"r": "{{ parse_json(out) }}"}},
        {"id": "gate", "type": "condition", "if": "r.score > 50", "then": "review", "else": "auto"},
        {"id": "review", "type": "approval", "title": "t", "roles": ["approver"], "next": "done"},
        {"id": "auto", "type": "end", "outcome": "onboarded"},
        {"id": "done", "type": "end", "outcome": "approved"},
    ],
}


def runtime(score: int) -> Runtime:
    async def agent(aid, prompt, ctx):
        return f'{{"score": {score}}}'
    async def noop(_): return None
    return Runtime(agent_runner=agent, sleep=noop)


async def _seed_history(db, tenant, workflow_key, outcome_shapes):
    from nmb_marketplace_agent.enterprise.workflows.engine import WorkflowEngine
    eng = WorkflowEngine(db, runtime(10), tenant)
    await eng.save_definition(SPEC, "designer")

    for shape in outcome_shapes:
        run_id = str(uuid.uuid4())
        ctx = {"input": {"name": "Jane"}, "name": "Jane"}
        if shape == "auto_completed:onboarded":
            ctx["_outcome"] = "onboarded"
            status = "completed"
        elif shape == "waiting_approval":
            status = "waiting_approval"
        else:
            status = "completed"
            ctx["_outcome"] = shape.split(":", 1)[-1]
        db.add(WorkflowRun(
            id=run_id, tenant_id=tenant, workflow_key=workflow_key,
            workflow_version=1, status=status, initiator="ops", state={"ctx": ctx},
        ))
    await db.commit()


async def test_shadow_agreement_when_same_score(db):
    await _seed_history(db, "t1", "kyc", ["auto_completed:onboarded", "auto_completed:onboarded"])
    report = await run_shadow(db, "t1", runtime(10), "kyc", days=365)
    assert report.total == 2
    assert report.matched == 2
    assert report.matrix["auto_completed:onboarded"]["auto_completed:onboarded"] == 2


async def test_shadow_detects_new_approvals(db):
    await _seed_history(db, "t1", "kyc", ["auto_completed:onboarded"])
    report = await run_shadow(db, "t1", runtime(90), "kyc", days=365)
    assert report.total == 1
    assert report.matched == 0
    assert report.results[0].original_shape == "auto_completed:onboarded"
    assert report.results[0].shadow_shape == "waiting_approval"


async def test_shadow_cleans_up_run_and_approvals(db):
    await _seed_history(db, "t1", "kyc", ["auto_completed:onboarded"])
    before = (await db.execute(select(WorkflowRun).where(WorkflowRun.tenant_id == "t1"))).scalars().all()
    await run_shadow(db, "t1", runtime(90), "kyc", days=365)
    after = (await db.execute(select(WorkflowRun).where(WorkflowRun.tenant_id == "t1"))).scalars().all()
    assert len(after) == len(before)
    apprs = (await db.execute(select(Approval).where(Approval.tenant_id == "t1"))).scalars().all()
    assert len(apprs) == 0


async def test_shadow_skips_runs_without_input(db):
    await _seed_history(db, "t1", "kyc", [])                                    # ← new: definition must exist
    db.add(WorkflowRun(
        id=str(uuid.uuid4()), tenant_id="t1", workflow_key="kyc",
        workflow_version=1, status="completed",
        state={"ctx": {"_outcome": "onboarded"}},
    ))
    await db.commit()
    report = await run_shadow(db, "t1", runtime(10), "kyc", days=365)
    assert report.total == 1
    assert "no input snapshot" in (report.results[0].error or "")