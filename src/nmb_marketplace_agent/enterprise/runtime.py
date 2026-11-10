"""Production wiring for the workflow engine (agents via the LangGraph runtime, tools, connectors)."""
from __future__ import annotations

import os
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from nmb_marketplace_agent.enterprise.connectors import EgressPolicy, build_connector
from nmb_marketplace_agent.enterprise.connectors.base import ConnectorError
from nmb_marketplace_agent.enterprise.guardrails import DEFAULT_POLICY, Policy, PolicyEngine
from nmb_marketplace_agent.enterprise.models import ConnectorConfig, PolicySet
from nmb_marketplace_agent.enterprise.workflows.engine import Runtime


async def load_policy(db: AsyncSession, tenant_id: str) -> Policy:
    """Union of the tenant's active policy sets (rules de-duplicated by id)."""
    sets = (await db.execute(select(PolicySet).where(PolicySet.tenant_id == tenant_id, PolicySet.active == True))).scalars().all()  # noqa: E712
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


async def build_runtime(db: AsyncSession, tenant_id: str) -> Runtime:
    policy = PolicyEngine(await load_policy(db, tenant_id))

    async def agent_runner(agent_id: str, prompt: str, ctx: dict) -> Any:
        from langgraph_sdk import get_client

        from nmb_marketplace_agent.api.routes.public import _final_reply
        client = get_client(url=os.environ.get("LANGGRAPH_URL", "http://127.0.0.1:2024"))
        t = await client.threads.create(metadata={"agent_id": agent_id, "source": "workflow"})
        state = await client.runs.wait(
            thread_id=t["thread_id"], assistant_id="supervisor",
            input={"messages": [{"role": "user", "content": prompt}]},
            config={"configurable": {"agent_id": agent_id, "tenant_id": tenant_id}})
        return _final_reply(state)

    async def tool_runner(name: str, args: dict) -> Any:
        from nmb_marketplace_agent.tools.registry import resolve_tool
        return await (await resolve_tool(name)).ainvoke(args)

    async def connector_runner(name: str, op: str, params: dict) -> Any:
        cfg = (await db.execute(select(ConnectorConfig).where(
            ConnectorConfig.tenant_id == tenant_id, ConnectorConfig.name == name))).scalars().first()
        if not cfg or not cfg.enabled:
            raise ConnectorError(f"Connector '{name}' is not configured or is disabled for this tenant")
        return await build_connector(name, cfg.type, cfg.config, EgressPolicy()).call(op, params)

    return Runtime(agent_runner=agent_runner, tool_runner=tool_runner, connector_runner=connector_runner, policy=policy)
