from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from nmb_marketplace_agent.api.deps import get_db
from nmb_marketplace_agent.config.models import (
    AgentConfig,
    RAGCollection,
    SubAgentConfig,
    ToolConfig,
)
from nmb_marketplace_agent.config.versioning import published_version

router = APIRouter()


@router.get("/{agent_id}/manifest")
async def manifest(
    agent_id: str,
    tenant_id: str = "default",
    db: AsyncSession = Depends(get_db),
):
    agent = await db.get(AgentConfig, agent_id)
    if not agent or agent.tenant_id != tenant_id:
        raise HTTPException(404, "Agent not found")

    tools = [await db.get(ToolConfig, i) for i in agent.tool_ids]
    subs = [await db.get(SubAgentConfig, i) for i in agent.subagent_ids]
    rags = [await db.get(RAGCollection, i) for i in agent.rag_collection_ids]

    v = await published_version(agent.id)

    return {
        "agent_id": agent.id,
        "version": v.version if v else None,
        # When no version is published, live traffic runs the draft config.
        # The flag makes that explicit rather than pretending a v1 exists.
        "draft": v is None,
        "model": agent.model,
        "tools": [
            {"name": t.name, "type": t.type, "description": t.description}
            for t in tools
            if t
        ],
        "rag": [{"name": r.name, "status": r.status} for r in rags if r],
        "subagents": [
            {"name": s.name, "mode": s.mode, "description": s.description}
            for s in subs
            if s
        ],
    }