import uuid

from nmb_marketplace_agent.config.models import (
    AgentConfig,
    EvalCase,
    EvalDataset,
    EvalRun,
)


async def test_execute_scores_orchestration(db, monkeypatch):
    """Two-level eval: answer score + orchestration score, both derived from the same run."""
    from nmb_marketplace_agent.api.routes import evals as evals_route
    from nmb_marketplace_agent.enterprise import audit as audit_mod

    # Fixtures: agent, dataset, one case expecting two delegations
    agent_id = str(uuid.uuid4())
    ds_id = str(uuid.uuid4())
    case_id = str(uuid.uuid4())
    run_id = str(uuid.uuid4())
    thread_id = "t-abc"

    db.add(AgentConfig(id=agent_id, name="sup", tenant_id="t1"))
    db.add(EvalDataset(id=ds_id, name="ds", agent_id=agent_id, tenant_id="t1"))
    db.add(EvalCase(
        id=case_id, dataset_id=ds_id, input="hi",
        expected_contains=None, criteria=None,
        expect_delegations=["a", "b"],
    ))
    db.add(EvalRun(
        id=run_id, dataset_id=ds_id, agent_id=agent_id, tenant_id="t1",
        target="draft", status="running", results=[], summary={},
    ))
    await db.commit()

    # Stub invoke_agent: returns a thread_id whose audit rows we pre-populate.
    async def fake_invoke(agent, tenant, message, **_):
        # Write the delegation rows that would have been produced by the middleware.
        from nmb_marketplace_agent.config.database import async_session
        async with async_session() as s:
            for i, name in enumerate(["a", "b"], start=1):
                await audit_mod.record(
                    s, tenant_id=tenant, actor=agent, actor_type="agent",
                    action="agent.delegated", resource_type="workflow_run",
                    resource_id=thread_id,
                    details={"delegate": name, "delegation_n": i, "task": "x"},
                )
        return {"thread_id": thread_id, "result": {"messages": [
            {"type": "ai", "content": "done"}
        ]}}

    monkeypatch.setattr(evals_route, "invoke_agent", fake_invoke)

    # Execute
    await evals_route._execute(run_id)

    # Reopen and assert
    db.expire_all()
    run = await db.get(EvalRun, run_id)
    assert run.status == "done"
    assert run.summary["orchestration_checked"] == 1
    assert run.summary["orchestration_passed"] == 1
    assert run.summary["orchestration_rate"] == 1.0
    row = run.results[0]
    assert row["delegations_actual"] == ["a", "b"]
    assert row["orchestration_passed"] is True


async def test_execute_missing_delegation_fails(db, monkeypatch):
    from nmb_marketplace_agent.api.routes import evals as evals_route
    from nmb_marketplace_agent.enterprise import audit as audit_mod

    agent_id, ds_id, case_id, run_id = (str(uuid.uuid4()) for _ in range(4))
    thread_id = "t-xyz"

    db.add(AgentConfig(id=agent_id, name="sup", tenant_id="t1"))
    db.add(EvalDataset(id=ds_id, name="ds", agent_id=agent_id, tenant_id="t1"))
    db.add(EvalCase(
        id=case_id, dataset_id=ds_id, input="hi",
        expect_delegations=["a", "b"],
    ))
    db.add(EvalRun(
        id=run_id, dataset_id=ds_id, agent_id=agent_id, tenant_id="t1",
        target="draft", status="running", results=[], summary={},
    ))
    await db.commit()

    async def fake_invoke(agent, tenant, message, **_):
        from nmb_marketplace_agent.config.database import async_session
        async with async_session() as s:
            await audit_mod.record(
                s, tenant_id=tenant, actor=agent, actor_type="agent",
                action="agent.delegated", resource_type="workflow_run",
                resource_id=thread_id, details={"delegate": "a", "delegation_n": 1},
            )
        return {"thread_id": thread_id, "result": {"messages": [{"type": "ai", "content": "done"}]}}

    monkeypatch.setattr(evals_route, "invoke_agent", fake_invoke)
    await evals_route._execute(run_id)
    db.expire_all()
    run = await db.get(EvalRun, run_id)
    assert run.summary["orchestration_rate"] == 0.0
    assert run.results[0]["orchestration_missing"] == ["b"]