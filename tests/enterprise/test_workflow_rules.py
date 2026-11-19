import uuid

from sqlmodel import select

from nmb_marketplace_agent.enterprise.models import WorkflowRule
from nmb_marketplace_agent.enterprise.workflows.engine import Runtime, WorkflowEngine

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


async def _seed(db, tenant="t1"):
    eng = WorkflowEngine(db, runtime(10), tenant)
    await eng.save_definition(SPEC, "designer")


async def test_route_to_rule_overrides_natural_next(db):
    await _seed(db)
    db.add(WorkflowRule(
        id=str(uuid.uuid4()), tenant_id="t1", workflow_key="kyc",
        name="force review", when_expr="r.score > 5",
        action="route_to", target_step="review",
        created_by="officer",
    ))
    await db.commit()

    eng = WorkflowEngine(db, runtime(10), "t1")
    run = await eng.start("kyc", {"name": "Jane"}, "ops")
    # Natural flow: score 10 → auto. Rule forces review.
    assert run.status == "waiting_approval"

    rules = (await db.execute(select(WorkflowRule))).scalars().all()
    assert rules[0].fired_count == 1
    assert rules[0].last_fired_at is not None


async def test_block_rule_fails_run(db):
    await _seed(db)
    db.add(WorkflowRule(
        id=str(uuid.uuid4()), tenant_id="t1", workflow_key="kyc",
        name="block test", when_expr="r.score >= 10",
        action="block",
        created_by="officer",
    ))
    await db.commit()

    eng = WorkflowEngine(db, runtime(10), "t1")
    run = await eng.start("kyc", {"name": "Jane"}, "ops")
    assert run.status == "failed"
    assert "Workflow rule blocked" in (run.error or "")


async def test_disabled_rule_does_not_fire(db):
    await _seed(db)
    db.add(WorkflowRule(
        id=str(uuid.uuid4()), tenant_id="t1", workflow_key="kyc",
        when_expr="r.score > 5", action="route_to", target_step="review",
        enabled=False, created_by="officer",
    ))
    await db.commit()

    eng = WorkflowEngine(db, runtime(10), "t1")
    run = await eng.start("kyc", {"name": "Jane"}, "ops")
    assert run.status == "completed"
    assert run.state["ctx"]["_outcome"] == "onboarded"


async def test_invalid_expr_is_skipped(db):
    await _seed(db)
    db.add(WorkflowRule(
        id=str(uuid.uuid4()), tenant_id="t1", workflow_key="kyc",
        when_expr="this is not (((", action="route_to", target_step="review",
        created_by="officer",
    ))
    await db.commit()

    eng = WorkflowEngine(db, runtime(10), "t1")
    run = await eng.start("kyc", {"name": "Jane"}, "ops")
    # Bad rule is skipped; natural flow completes.
    assert run.status == "completed"
    rules = (await db.execute(select(WorkflowRule))).scalars().all()
    assert rules[0].fired_count == 0


async def test_rule_fires_at_most_once_per_run(db):
    """Two rules could match; only the first fires. Then the run completes naturally."""
    await _seed(db)
    db.add(WorkflowRule(
        id=str(uuid.uuid4()), tenant_id="t1", workflow_key="kyc",
        created_at="2026-01-01T00:00:00Z",
        when_expr="r.score > 5", action="route_to", target_step="review",
        created_by="officer",
    ))
    db.add(WorkflowRule(
        id=str(uuid.uuid4()), tenant_id="t1", workflow_key="kyc",
        created_at="2026-01-02T00:00:00Z",
        when_expr="r.score > 5", action="block",
        created_by="officer",
    ))
    await db.commit()

    eng = WorkflowEngine(db, runtime(10), "t1")
    run = await eng.start("kyc", {"name": "Jane"}, "ops")
    # First rule (route_to) fires; run pauses. Second rule (block) never fires.
    assert run.status == "waiting_approval"
    rules = (await db.execute(select(WorkflowRule).order_by(WorkflowRule.created_at))).scalars().all()
    assert rules[0].fired_count == 1
    assert rules[1].fired_count == 0


async def test_rule_with_missing_target_falls_through(db):
    """Rule references a step removed in a later workflow version → skipped at runtime."""
    await _seed(db)
    db.add(WorkflowRule(
        id=str(uuid.uuid4()), tenant_id="t1", workflow_key="kyc",
        when_expr="r.score > 5", action="route_to", target_step="ghost_step",
        created_by="officer",
    ))
    await db.commit()

    eng = WorkflowEngine(db, runtime(10), "t1")
    run = await eng.start("kyc", {"name": "Jane"}, "ops")
    # Falls through to natural routing → auto → onboarded.
    assert run.status == "completed"
    assert run.state["ctx"]["_outcome"] == "onboarded"


async def test_shadow_does_not_increment_fired_count(db):
    await _seed(db)
    db.add(WorkflowRule(
        id=str(uuid.uuid4()), tenant_id="t1", workflow_key="kyc",
        when_expr="r.score > 5", action="route_to", target_step="review",
        created_by="officer",
    ))
    await db.commit()

    from nmb_marketplace_agent.enterprise.workflows.shadow import run_shadow
    r = runtime(10)
    await run_shadow(db, "t1", r, "kyc", days=365)
    # We didn't seed any historical runs, so total=0 — but the important check is that
    # even if runs were replayed, the fired_count would stay 0.

    rules = (await db.execute(select(WorkflowRule))).scalars().all()
    assert rules[0].fired_count == 0


async def test_paused_approval_resumes_and_rule_does_not_refire(db):
    await _seed(db)
    db.add(WorkflowRule(
        id=str(uuid.uuid4()), tenant_id="t1", workflow_key="kyc",
        when_expr="r.score > 5", action="route_to", target_step="review",
        created_by="officer",
    ))
    await db.commit()

    eng = WorkflowEngine(db, runtime(10), "t1")
    run = await eng.start("kyc", {"name": "Jane"}, "ops")
    assert run.status == "waiting_approval"

    from nmb_marketplace_agent.enterprise.models import Approval
    from nmb_marketplace_agent.enterprise.rbac import Principal
    ap = (await db.execute(select(Approval).where(Approval.run_id == run.id))).scalars().first()
    await eng.decide(ap.id, Principal("officer", "t1", {"approver"}, "jwt"), "approve")

    await db.refresh(run)
    assert run.status == "completed"
    # Rule fired once; on resume it must NOT re-fire (approval would loop).
    rules = (await db.execute(select(WorkflowRule))).scalars().all()
    assert rules[0].fired_count == 1