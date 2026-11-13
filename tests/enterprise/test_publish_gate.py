import uuid

import pytest
from fastapi import HTTPException
from sqlmodel import select

from nmb_marketplace_agent.config.models import (
    AgentConfig,
    EvalDataset,
    EvalRun,
)
from nmb_marketplace_agent.enterprise.models import InstalledSolution


async def test_eval_gate_blocks_when_no_run(db):
    from nmb_marketplace_agent.api.routes.agents import _eval_block

    agent_id = str(uuid.uuid4())
    db.add(AgentConfig(id=agent_id, name="sup", tenant_id="t1"))
    db.add(InstalledSolution(
        id=f"t1:banking-kyc", tenant_id="t1", solution_id="banking-kyc",
        parameters={"publish_gate_min_pass_rate": 0.8},
        created={"supervisor": agent_id, "agents": {}},
    ))
    db.add(EvalDataset(id=str(uuid.uuid4()), name="ds", agent_id=agent_id, tenant_id="t1"))
    await db.commit()

    agent = await db.get(AgentConfig, agent_id)
    block = await _eval_block(db, agent)
    assert block and block["reason"] == "no_eval_run"


async def test_eval_gate_blocks_on_low_pass_rate(db):
    from nmb_marketplace_agent.api.routes.agents import _eval_block

    agent_id = str(uuid.uuid4())
    ds_id = str(uuid.uuid4())
    db.add(AgentConfig(id=agent_id, name="sup", tenant_id="t1"))
    db.add(InstalledSolution(
        id="t1:banking-kyc", tenant_id="t1", solution_id="banking-kyc",
        parameters={"publish_gate_min_pass_rate": 0.9},
        created={"supervisor": agent_id, "agents": {}},
    ))
    db.add(EvalDataset(id=ds_id, name="ds", agent_id=agent_id, tenant_id="t1"))
    db.add(EvalRun(
        id=str(uuid.uuid4()), dataset_id=ds_id, agent_id=agent_id, tenant_id="t1",
        target="draft", status="done",
        results=[], summary={"pass_rate": 0.5, "orchestration_rate": 0.9},
    ))
    await db.commit()

    agent = await db.get(AgentConfig, agent_id)
    block = await _eval_block(db, agent)
    assert block and any(f["dimension"] == "answer" for f in block["failures"])


async def test_eval_gate_passes_above_threshold(db):
    from nmb_marketplace_agent.api.routes.agents import _eval_block

    agent_id = str(uuid.uuid4())
    ds_id = str(uuid.uuid4())
    db.add(AgentConfig(id=agent_id, name="sup", tenant_id="t1"))
    db.add(InstalledSolution(
        id="t1:banking-kyc", tenant_id="t1", solution_id="banking-kyc",
        parameters={"publish_gate_min_pass_rate": 0.8},
        created={"supervisor": agent_id, "agents": {}},
    ))
    db.add(EvalDataset(id=ds_id, name="ds", agent_id=agent_id, tenant_id="t1"))
    db.add(EvalRun(
        id=str(uuid.uuid4()), dataset_id=ds_id, agent_id=agent_id, tenant_id="t1",
        target="draft", status="done",
        results=[], summary={"pass_rate": 0.9, "orchestration_rate": 0.85},
    ))
    await db.commit()

    agent = await db.get(AgentConfig, agent_id)
    block = await _eval_block(db, agent)
    assert block is None


async def test_eval_gate_checks_orchestration_when_configured(db):
    from nmb_marketplace_agent.api.routes.agents import _eval_block

    agent_id = str(uuid.uuid4())
    ds_id = str(uuid.uuid4())
    db.add(AgentConfig(id=agent_id, name="sup", tenant_id="t1"))
    db.add(InstalledSolution(
        id="t1:banking-kyc", tenant_id="t1", solution_id="banking-kyc",
        parameters={
            "publish_gate_min_pass_rate": 0.8,
            "publish_gate_min_orchestration_rate": 0.9,
        },
        created={"supervisor": agent_id, "agents": {}},
    ))
    db.add(EvalDataset(id=ds_id, name="ds", agent_id=agent_id, tenant_id="t1"))
    db.add(EvalRun(
        id=str(uuid.uuid4()), dataset_id=ds_id, agent_id=agent_id, tenant_id="t1",
        target="draft", status="done",
        results=[], summary={"pass_rate": 0.95, "orchestration_rate": 0.5},
    ))
    await db.commit()

    agent = await db.get(AgentConfig, agent_id)
    block = await _eval_block(db, agent)
    assert block and any(f["dimension"] == "orchestration" for f in block["failures"])


async def test_publish_rejects_without_override(db):
    """Publish route must return 409 eval_failed when gate trips and no override."""
    from nmb_marketplace_agent.api.routes import agents as agents_route

    agent_id = str(uuid.uuid4())
    ds_id = str(uuid.uuid4())
    db.add(AgentConfig(id=agent_id, name="sup", tenant_id="t1"))
    db.add(InstalledSolution(
        id="t1:banking-kyc", tenant_id="t1", solution_id="banking-kyc",
        parameters={"publish_gate_min_pass_rate": 0.9},
        created={"supervisor": agent_id, "agents": {}},
    ))
    db.add(EvalDataset(id=ds_id, name="ds", agent_id=agent_id, tenant_id="t1"))
    db.add(EvalRun(
        id=str(uuid.uuid4()), dataset_id=ds_id, agent_id=agent_id, tenant_id="t1",
        target="draft", status="done",
        results=[], summary={"pass_rate": 0.5},
    ))
    await db.commit()

    with pytest.raises(HTTPException) as exc:
        await agents_route.publish_agent(agent_id, {}, db)
    assert exc.value.status_code == 409
    assert exc.value.detail["error"] == "eval_failed"


async def test_publish_accepts_with_override_and_audits(db):
    from nmb_marketplace_agent.api.routes import agents as agents_route
    from nmb_marketplace_agent.enterprise import audit as audit_mod

    agent_id = str(uuid.uuid4())
    ds_id = str(uuid.uuid4())
    db.add(AgentConfig(id=agent_id, name="sup", tenant_id="t1", system_prompt="inline prompt"))
    db.add(InstalledSolution(
        id="t1:banking-kyc", tenant_id="t1", solution_id="banking-kyc",
        parameters={"publish_gate_min_pass_rate": 0.9},
        created={"supervisor": agent_id, "agents": {}},
    ))
    db.add(EvalDataset(id=ds_id, name="ds", agent_id=agent_id, tenant_id="t1"))
    db.add(EvalRun(
        id=str(uuid.uuid4()), dataset_id=ds_id, agent_id=agent_id, tenant_id="t1",
        target="draft", status="done",
        results=[], summary={"pass_rate": 0.5},
    ))
    await db.commit()

    result = await agents_route.publish_agent(
        agent_id, {"override_reason": "ship for pilot"}, db,
    )
    assert result["published"] is True
    assert result["eval"]["override"] is True
    assert result["provenance"]["prompt"]["kind"] == "inline"

    rows = await audit_mod.query(db, "t1", action="agent.published_with_eval_override")
    assert rows and rows[0].details["eval_override_reason"] == "ship for pilot"