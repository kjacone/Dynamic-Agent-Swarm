import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from nmb_marketplace_agent.api.deps import get_db
from nmb_marketplace_agent.config.models import (
    AgentConfig,
    RAGCollection,
    SubAgentConfig,
    ToolConfig,
)


async def _check_refs(db, tenant_id, *, tool_ids=None, rag_ids=None, sub_ids=None):
    for tid in tool_ids or []:
        t = await db.get(ToolConfig, tid)
        if not t or t.tenant_id != tenant_id:
            raise HTTPException(400, f"Tool {tid} not found for this tenant")
    for rid in rag_ids or []:
        r = await db.get(RAGCollection, rid)
        if not r or r.tenant_id != tenant_id:
            raise HTTPException(400, f"RAG collection {rid} not found for this tenant")
    for sid in sub_ids or []:
        s = await db.get(SubAgentConfig, sid)
        if not s or s.tenant_id != tenant_id:
            raise HTTPException(400, f"Subagent {sid} not found for this tenant")

        
router = APIRouter()


class AgentCreate(BaseModel):
    name: str
    model: str = "anthropic:claude-sonnet-4-5-20250929"
    system_prompt: str = ""
    tool_ids: list[str] = []
    rag_collection_ids: list[str] = []
    subagent_ids: list[str] = []
    tenant_id: str = "default"


class AgentPatch(BaseModel):
    name: str | None = None
    model: str | None = None
    system_prompt: str | None = None
    tool_ids: list[str] | None = None
    rag_collection_ids: list[str] | None = None
    subagent_ids: list[str] | None = None


@router.post("")
async def create_agent(body: AgentCreate, db: AsyncSession = Depends(get_db)):
    agent = AgentConfig(id=str(uuid.uuid4()), **body.model_dump())
    await _check_refs(db, body.tenant_id,
                  tool_ids=body.tool_ids,
                  rag_ids=body.rag_collection_ids,
                  sub_ids=body.subagent_ids)
    db.add(agent)
    await db.commit()
    await db.refresh(agent)
    return agent


@router.get("")
async def list_agents(tenant_id: str = "default", db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(AgentConfig).where(AgentConfig.tenant_id == tenant_id))
    return res.scalars().all()


@router.get("/{agent_id}")
async def get_agent(agent_id: str, tenant_id: str = "default", db: AsyncSession = Depends(get_db)):
    agent = await db.get(AgentConfig, agent_id)
    if not agent or agent.tenant_id != tenant_id: 
        raise HTTPException(404, "Agent not found")
    return agent


@router.patch("/{agent_id}")
async def patch_agent(agent_id: str, body: AgentPatch, tenant_id: str = "default", db: AsyncSession = Depends(get_db)):
    agent = await db.get(AgentConfig, agent_id)
    if not agent or agent.tenant_id != tenant_id:  
        raise HTTPException(404, "Agent not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(agent, k, v)
    if body.tool_ids is not None:
        await _check_refs(db, tenant_id, tool_ids=body.tool_ids)
    if body.rag_collection_ids is not None:
        await _check_refs(db, tenant_id, rag_ids=body.rag_collection_ids)
    if body.subagent_ids is not None:
        await _check_refs(db, tenant_id, sub_ids=body.subagent_ids)
    db.add(agent)
    await db.commit()
    await db.refresh(agent)
    return agent


@router.delete("/{agent_id}")
async def delete_agent(agent_id: str, tenant_id: str = "default", db: AsyncSession = Depends(get_db)):
    agent = await db.get(AgentConfig, agent_id)
    if not agent or agent.tenant_id != tenant_id:
        raise HTTPException(404, "Agent not found")
    await db.delete(agent)
    await db.commit()
    return {"ok": True}
