"""Seed built-in tools + a working sample agent (Ollama by default)."""
import asyncio
import uuid

from sqlmodel import select

from nmb_marketplace_agent.config.database import async_session, init_db
from nmb_marketplace_agent.config.models import AgentConfig, SubAgentConfig, ToolConfig
from nmb_marketplace_agent.prompts.system import MAIN_SYSTEM_PROMPT
from nmb_marketplace_agent.subagents.defaults import RESEARCHER_PROMPT

DEFAULT_AGENT_MODEL = "ollama:llama3.1:8b"

# One tool per UI spec component; any model can drive them with plain JSON.
GENERATIVE_UI_TOOLS = {
    "ui_cards": "Render a card strip for listings, results or any comparable set.",
    "ui_table": "Render a data table for transactions, line items or comparisons.",
    "ui_stats": "Render KPI tiles for balances, scores and summaries.",
    "ui_chart": "Render a small bar or line chart.",
    "ui_timeline": "Render a vertical timeline of events or steps.",
    "ui_status": "Render a checklist of pass / warn / fail states.",
    "ui_form": "Ask the customer for input with an inline form.",
    "ui_alert": "Render a short notice, optionally with action chips.",
    "ui_render": "Render a ready-made generative-UI spec passed as JSON.",
}


async def main():
    await init_db()
    async with async_session() as db:
        async def upsert_tool(name: str, type_: str, description: str, config: dict):
            res = await db.execute(select(ToolConfig).where(
                ToolConfig.name == name, ToolConfig.tenant_id == "default"))
            existing = res.scalars().first()
            if existing:
                return existing
            t = ToolConfig(
                id=str(uuid.uuid4()), name=name, type=type_,
                description=description, config=config,
            )
            db.add(t)
            await db.commit()
            await db.refresh(t)
            return t

        search = await upsert_tool("tavily_search", "builtin", "Web search", {})
        calc = await upsert_tool("calculator", "builtin", "Math evaluator", {})
        for name, description in GENERATIVE_UI_TOOLS.items():
            await upsert_tool(name, "builtin", description, {})

        res = await db.execute(select(SubAgentConfig).where(SubAgentConfig.name == "researcher_sync"))
        sync_res = res.scalars().first()
        if not sync_res:
            sync_res = SubAgentConfig(
                id=str(uuid.uuid4()),
                name="researcher_sync",
                description="Researches a focused question using web search.",
                system_prompt=RESEARCHER_PROMPT,
                mode="sync",
                tool_ids=[search.id],
            )
            db.add(sync_res)
            await db.commit()
            await db.refresh(sync_res)

        res = await db.execute(select(SubAgentConfig).where(SubAgentConfig.name == "researcher_async"))
        async_res = res.scalars().first()
        if not async_res:
            async_res = SubAgentConfig(
                id=str(uuid.uuid4()),
                name="researcher_async",
                description="Long-running background research.",
                system_prompt=RESEARCHER_PROMPT,
                mode="async",
                tool_ids=[search.id],
                graph_id="researcher",
            )
            db.add(async_res)
            await db.commit()
            await db.refresh(async_res)

        res = await db.execute(select(AgentConfig).where(AgentConfig.name == "default"))
        agent = res.scalars().first()
        if not agent:
            agent = AgentConfig(
                id=str(uuid.uuid4()),
                name="default",
                model=DEFAULT_AGENT_MODEL,
                system_prompt=MAIN_SYSTEM_PROMPT,
                tool_ids=[search.id, calc.id],
                subagent_ids=[sync_res.id],
            )
            db.add(agent)
            await db.commit()
            await db.refresh(agent)

        print("Seeded.")
        print(f"agent_id={agent.id}")
        print(f"tool_ids={[search.id, calc.id]}")
        print(f"sync_sub_id={sync_res.id}  async_sub_id={async_res.id}")


if __name__ == "__main__":
    asyncio.run(main())