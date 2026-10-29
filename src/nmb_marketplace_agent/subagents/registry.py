import logging
from typing import Any

from deepagents import AsyncSubAgent

from nmb_marketplace_agent.config.database import async_session
from nmb_marketplace_agent.config.models import SubAgentConfig
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


async def build_sync_subagent(cfg: SubAgentConfig) -> dict[str, Any]:
    return {
        "name": cfg.name,
        "description": cfg.description,
        "system_prompt": cfg.system_prompt,
        "tools": await resolve_sub_tools(cfg),
        **({"model": await resolve_model(cfg.model, cfg.tenant_id)} if cfg.model else {}),
    }


def build_async_subagent(cfg: SubAgentConfig) -> AsyncSubAgent:
    if not cfg.graph_id:
        raise ValueError(f"Async subagent '{cfg.name}' missing graph_id")
    kwargs: dict[str, Any] = dict(
        name=cfg.name, description=cfg.description, graph_id=cfg.graph_id
    )
    if cfg.url:
        kwargs["url"] = cfg.url
    return AsyncSubAgent(**kwargs)


async def build_subagent(sub_id: str):
    cfg = await _load(sub_id)
    if not cfg:
        raise ValueError(f"SubAgentConfig not found: {sub_id}")
    return build_async_subagent(cfg) if cfg.mode == "async" else await build_sync_subagent(cfg)


async def build_subagents(ids: list[str]) -> list[Any]:
    return [await build_subagent(i) for i in ids]
