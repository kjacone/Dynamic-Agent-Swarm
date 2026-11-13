import logging
from typing import Any

from deepagents import AsyncSubAgent

from nmb_marketplace_agent.config.database import async_session
from nmb_marketplace_agent.config.models import SubAgentConfig
from nmb_marketplace_agent.enterprise.hooks import guard_agent_tools
from nmb_marketplace_agent.llm.registry import resolve_model
from nmb_marketplace_agent.rag.registry import resolve_retriever_tool
from nmb_marketplace_agent.tools.registry import resolve_tools

log = logging.getLogger(__name__)


async def _load(sub_id: str) -> SubAgentConfig | None:
    async with async_session() as session:
        return await session.get(SubAgentConfig, sub_id)


async def resolve_sub_tools(cfg: SubAgentConfig) -> list[Any]:
    tools = await resolve_tools(cfg.tool_ids or [])
    for rid in cfg.rag_collection_ids or []:
        try:
            tools.append(await resolve_retriever_tool(rid, tenant_id=cfg.tenant_id))
        except Exception as e:
            log.warning("Skipping RAG collection %s for %s: %s", rid, cfg.name, e)
    return tools


async def build_sync_subagent(
    cfg: SubAgentConfig,
    middleware: list | None = None,
) -> dict[str, Any]:
    tools = await resolve_sub_tools(cfg)
    tools = await guard_agent_tools(tools, cfg.tenant_id, cfg.id)

    out: dict[str, Any] = {
        "name": cfg.name,
        "description": cfg.description,
        "system_prompt": cfg.system_prompt,
        "tools": tools,
    }
    if middleware:
        # SubAgents get their own default stack; `middleware` is appended, so passing
        # the shared DelegationMiddleware here makes nested `task` calls share the
        # supervisor's per-run delegation counter.
        out["middleware"] = list(middleware)
    if cfg.model:
        out["model"] = await resolve_model(cfg.model, cfg.tenant_id)
    return out


def build_async_subagent(cfg: SubAgentConfig) -> AsyncSubAgent:
    if not cfg.graph_id:
        raise ValueError(f"Async subagent '{cfg.name}' missing graph_id")
    kwargs: dict[str, Any] = dict(
        name=cfg.name, description=cfg.description, graph_id=cfg.graph_id,
    )
    if cfg.url:
        kwargs["url"] = cfg.url
    return AsyncSubAgent(**kwargs)


async def build_subagent(
    sub_id: str,
    tenant_id: str = "default",
    *,
    middleware: list | None = None,
):
    cfg = await _load(sub_id)
    if not cfg:
        raise ValueError(f"SubAgentConfig not found: {sub_id}")
    if cfg.tenant_id != tenant_id:
        raise ValueError(
            f"Subagent {sub_id} belongs to tenant {cfg.tenant_id!r}, not {tenant_id!r}"
        )
    if cfg.mode == "async":
        return build_async_subagent(cfg)
    return await build_sync_subagent(cfg, middleware=middleware)


async def build_subagents(
    ids: list[str],
    tenant_id: str = "default",
    *,
    middleware: list | None = None,
) -> list[Any]:
    return [await build_subagent(i, tenant_id=tenant_id, middleware=middleware) for i in ids]