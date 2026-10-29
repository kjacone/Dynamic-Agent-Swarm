"""Dynamic graph factory consumed by the LangGraph server."""
import logging

from deepagents import create_deep_agent
from langchain_core.runnables import RunnableConfig

from nmb_marketplace_agent.config.database import async_session
from nmb_marketplace_agent.config.models import AgentConfig
from nmb_marketplace_agent.config.settings import settings
from nmb_marketplace_agent.config.versioning import effective_config
from nmb_marketplace_agent.llm.registry import resolve_model
from nmb_marketplace_agent.observability import attach
from nmb_marketplace_agent.prompts.resolver import resolve_system_prompt
from nmb_marketplace_agent.prompts.system import (
    FALLBACK_SYSTEM_PROMPT,
    MAIN_SYSTEM_PROMPT,
)
from nmb_marketplace_agent.rag.registry import resolve_retriever_tool
from nmb_marketplace_agent.subagents.registry import build_subagents
from nmb_marketplace_agent.tools.builtin.calculator import calculator
from nmb_marketplace_agent.tools.registry import resolve_tools

log = logging.getLogger(__name__)


def _fallback_graph():
    return create_deep_agent(
        model=settings.main_model,
        tools=[calculator],
        system_prompt=FALLBACK_SYSTEM_PROMPT,
    )


async def _load_agent(agent_id: str) -> AgentConfig | None:
    async with async_session() as session:
        return await session.get(AgentConfig, agent_id)


def _thread_id(config: RunnableConfig, cfgurable: dict) -> str | None:
    return (
        (config.get("metadata") or {}).get("thread_id")
        or cfgurable.get("thread_id")
        or (config.get("configurable") or {}).get("thread_id")
    )


async def make_graph(config: RunnableConfig):
    try:
        cfgurable = config.get("configurable", {}) if config else {}
        agent_id = cfgurable.get("agent_id")
        tenant_id = cfgurable.get("tenant_id", "default")

        if not agent_id:
            log.info("No agent_id in config; returning fallback graph.")
            return _fallback_graph()

        agent = await _load_agent(agent_id)
        if not agent:
            log.warning("AgentConfig %s not found; fallback.", agent_id)
            return _fallback_graph()

        if agent.tenant_id != tenant_id:
            log.warning("Tenant mismatch for agent %s; fallback.", agent_id)
            return _fallback_graph()

        cfg, version = await effective_config(agent, bool(cfgurable.get("use_draft")))

        # Langfuse prompt-ref support: `langfuse:name:label` / `langfuse:name@version`
        system_prompt = await resolve_system_prompt(
            cfg.get("system_prompt") or "", MAIN_SYSTEM_PROMPT
        )

        tools = await resolve_tools(cfg["tool_ids"])
        for rag_id in cfg["rag_collection_ids"]:
            try:
                tools.append(await resolve_retriever_tool(rag_id, tenant_id=tenant_id))
            except Exception as e:
                log.warning("Skipping RAG collection %s: %s", rag_id, e)

        subagents = await build_subagents(cfg["subagent_ids"])
        model = await resolve_model(cfg["model"] or settings.main_model, tenant_id)

        graph = create_deep_agent(
            model=model,
            tools=tools,
            subagents=subagents,
            system_prompt=system_prompt,
        )
        return attach(graph, {
            "langfuse_session_id": _thread_id(config, cfgurable),
            "langfuse_user_id": cfgurable.get("user_id"),
            "langfuse_tags": [
                f"tenant:{tenant_id}",
                f"agent:{cfg['name']}",
                f"version:{version if version else 'draft'}",
            ],
            "agent_id": agent.id,
            "agent_version": version if version else "draft",
        })
    except Exception:
        log.exception("Failed to build dynamic graph; using fallback.")
        return _fallback_graph()