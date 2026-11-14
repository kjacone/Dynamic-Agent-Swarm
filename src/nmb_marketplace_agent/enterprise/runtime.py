"""Production wiring for the workflow engine (agents, tools, connectors, cost tracking)."""
from __future__ import annotations

import logging
import os
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from nmb_marketplace_agent.config.models import AgentConfig
from nmb_marketplace_agent.enterprise.connectors import EgressPolicy, build_connector
from nmb_marketplace_agent.enterprise.connectors.base import ConnectorError
from nmb_marketplace_agent.enterprise.guardrails import DEFAULT_POLICY, Policy, PolicyEngine
from nmb_marketplace_agent.enterprise.models import ConnectorConfig, GuardrailInstruction, PolicySet
from nmb_marketplace_agent.enterprise.workflows.engine import Runtime

log = logging.getLogger(__name__)


async def load_policy(db: AsyncSession, tenant_id: str) -> Policy:
    sets = (await db.execute(
        select(PolicySet).where(PolicySet.tenant_id == tenant_id, PolicySet.active == True)  # noqa: E712
    )).scalars().all()
    if not sets:
        return DEFAULT_POLICY
    rules, tool_rules, seen = [], [], set()
    for ps in sets:
        p = Policy.model_validate(ps.spec)
        for r in p.rules:
            if r.id not in seen:
                seen.add(r.id)
                rules.append(r)
        tool_rules += p.tool_rules
    return Policy(name="merged", rules=rules, tool_rules=tool_rules)


async def load_guards(db: AsyncSession, tenant_id: str) -> list[dict]:
    """Enabled tenant injection-shield instructions, in creation order."""
    rows = (await db.execute(
        select(GuardrailInstruction)
        .where(GuardrailInstruction.tenant_id == tenant_id, GuardrailInstruction.enabled == True)  # noqa: E712
        .order_by(GuardrailInstruction.created_at)
    )).scalars().all()
    return [{"id": r.id, "title": r.title, "instruction": r.instruction,
             "action": r.action, "watch_phrases": list(r.watch_phrases or [])} for r in rows]


def _limits_for(agent: AgentConfig | None) -> dict:
    return (agent.limits if agent else None) or {}


def _supervisor_configurable(
    agent_id: str, tenant_id: str, ctx: dict, limits: dict,
) -> dict:
    """The `configurable` dict read by DelegationMiddleware and CostTracker."""
    cfg = {
        "agent_id": agent_id,
        "tenant_id": tenant_id,
        "run_id": ctx.get("_run_id"),
        "max_delegations": int(limits.get("max_delegations", 8)),
    }
    if "max_cost_usd" in limits:
        cfg["max_cost_usd"] = float(limits["max_cost_usd"])
    return cfg


async def _sdk_agent(
    db: AsyncSession, tenant_id: str, agent_id: str, prompt: str, ctx: dict,
) -> Any:
    """Default path: invoke the supervisor via the LangGraph server SDK.

    Cost enforcement here relies on the server-side middleware; cost accounting is
    state-based and undercounts on delegation-heavy runs (deepagents#6555). If exact
    accounting is a hard requirement, use ``SUPERVISOR_RUNTIME=inprocess``.
    """
    from langgraph_sdk import get_client
    from nmb_marketplace_agent.api.routes.public import _final_reply

    agent = (await db.execute(
        select(AgentConfig).where(AgentConfig.id == agent_id, AgentConfig.tenant_id == tenant_id)
    )).scalars().first()
    limits = _limits_for(agent)

    client = get_client(url=os.environ.get("LANGGRAPH_URL", "http://127.0.0.1:2024"))
    thread = await client.threads.create(metadata={"agent_id": agent_id, "source": "workflow"})
    state = await client.runs.wait(
        thread_id=thread["thread_id"],
        assistant_id="supervisor",
        input={"messages": [{"role": "user", "content": prompt}]},
        config={
            "recursion_limit": int(limits.get("max_steps", 100)),
            "configurable": _supervisor_configurable(agent_id, tenant_id, ctx, limits),
        },
    )
    return _final_reply(state)


async def _inprocess_supervisor(
    db: AsyncSession,
    tenant_id: str,
    agent_id: str,
    prompt: str,
    ctx: dict,
    callbacks: list,
) -> Any:
    """In-process path: run the supervisor graph in this process so callbacks fire.

    This is what makes token accounting accurate across `task` boundaries — the
    subagent's `on_llm_end` cannot cross the SDK wire.
    """
    from nmb_marketplace_agent.api.routes.public import _final_reply
    from nmb_marketplace_agent.graph_factory import make_graph

    agent = (await db.execute(
        select(AgentConfig).where(AgentConfig.id == agent_id, AgentConfig.tenant_id == tenant_id)
    )).scalars().first()
    limits = _limits_for(agent)

    graph = await make_graph({"configurable": _supervisor_configurable(agent_id, tenant_id, ctx, limits)})
    state = await graph.ainvoke(
        {"messages": [{"role": "user", "content": prompt}]},
        config={
            "recursion_limit": int(limits.get("max_steps", 100)),
            "callbacks": callbacks,
        },
    )
    return _final_reply(state)


async def build_runtime(db: AsyncSession, tenant_id: str) -> Runtime:
    policy = PolicyEngine(await load_policy(db, tenant_id))

    all_agents = (await db.execute(
        select(AgentConfig).where(AgentConfig.tenant_id == tenant_id)
    )).scalars().all()
    supervisor_ids = {
        a.id for a in all_agents if (a.limits or {}).get("max_delegations")
    }

    mode = os.environ.get("SUPERVISOR_RUNTIME", "inprocess").lower()

    async def agent_runner(agent_id: str, prompt: str, ctx: dict) -> Any:
        return await _sdk_agent(db, tenant_id, agent_id, prompt, ctx)

    async def supervisor_runner(
        agent_id: str, prompt: str, ctx: dict, callbacks: list,
    ) -> Any:
        return await _inprocess_supervisor(db, tenant_id, agent_id, prompt, ctx, callbacks)

    async def tool_runner(name: str, args: dict) -> Any:
        from nmb_marketplace_agent.tools.registry import resolve_tool
        return await (await resolve_tool(name)).ainvoke(args)

    async def connector_runner(name: str, op: str, params: dict) -> Any:
        cfg = (await db.execute(select(ConnectorConfig).where(
            ConnectorConfig.tenant_id == tenant_id, ConnectorConfig.name == name
        ))).scalars().first()
        if not cfg or not cfg.enabled:
            raise ConnectorError(f"Connector '{name}' is not configured or is disabled for this tenant")
        return await build_connector(name, cfg.type, cfg.config, EgressPolicy()).call(op, params)

    return Runtime(
        agent_runner=agent_runner,
        tool_runner=tool_runner,
        connector_runner=connector_runner,
        policy=policy,
        supervisor_runner=supervisor_runner if mode == "inprocess" else None,
        supervisor_ids=supervisor_ids,
    )