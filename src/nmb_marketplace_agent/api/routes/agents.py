import uuid

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from nmb_marketplace_agent.api.deps import get_db
from nmb_marketplace_agent.config.models import (
    AgentConfig,
    AgentVersion,
    RAGCollection,
    SubAgentConfig,
    ToolConfig,
)
from nmb_marketplace_agent.config.versioning import snapshot_of
from nmb_marketplace_agent.enterprise import audit
from nmb_marketplace_agent.enterprise.models import InstalledSolution


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
    model: str = "ollama:llama3.1:8b"
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


async def _conformance_block(db: AsyncSession, agent: AgentConfig) -> dict | None:
    """If the agent is a supervisor from an installed pack, return real failures (if any).

    A result with `error` set is *not* a failure — it means the runner could not
    execute (missing langgraph projection, transient SDK issue). Broken runners
    must never block a publish. Only real conformance failures do.
    """
    rows = (await db.execute(
        select(InstalledSolution).where(InstalledSolution.tenant_id == agent.tenant_id)
    )).scalars().all()
    inst = next(
        (i for i in rows if (i.created or {}).get("supervisor") == agent.id),
        None,
    )
    if not inst:
        return None
    conf = (inst.created or {}).get("conformance")
    if not conf:
        return None
    # Aggregate-level error (build failed entirely) is also non-blocking.
    if conf.get("error"):
        return None

    cases = conf.get("cases", [])
    real_failures = [
        c for c in cases if not c.get("passed") and not c.get("error")
    ]
    errored = [c for c in cases if c.get("error")]

    if not real_failures:
        return None

    return {
        "solution": inst.solution_id,
        "passed": conf.get("passed", 0),
        "total": conf.get("total", 0),
        "failed": real_failures,
        "errored": errored,
    }

@router.post("/{agent_id}/publish")
async def publish_agent(
    agent_id: str,
    body: dict = Body(default={}),
    db: AsyncSession = Depends(get_db),
):
    agent = await db.get(AgentConfig, agent_id)
    if not agent:
        raise HTTPException(404, "Agent not found")

    note = str(body.get("note") or "")
    override_reason = str(body.get("override_reason") or "").strip()

    # Publish gate: refuse to publish a pack supervisor whose conformance suite fails.
    # An explicit override_reason is required and is audited separately below.
    block = await _conformance_block(db, agent)
    if block and not override_reason:
        raise HTTPException(
            409,
            detail={
                "error": "conformance_failed",
                "detail": block,
                "hint": "Pass override_reason to publish anyway; the override is audited.",
            },
        )

    # Compute next version number from the agent's existing versions.
    last = (await db.execute(
        select(AgentVersion)
        .where(AgentVersion.agent_id == agent_id)
        .order_by(AgentVersion.version.desc())
        .limit(1)
    )).scalars().first()
    next_version = (last.version + 1) if last else 1

    # Unpublish any currently published version so `effective_config` has exactly one.
    await db.execute(
        update(AgentVersion)
        .where(AgentVersion.agent_id == agent_id, AgentVersion.published == True)  # noqa: E712
        .values(published=False)
    )

    snapshot = snapshot_of(agent)
    row = AgentVersion(
        id=str(uuid.uuid4()),
        agent_id=agent_id,
        tenant_id=agent.tenant_id,
        version=next_version,
        snapshot=snapshot,
        note=note,
        published=True,
    )
    db.add(row)
    await db.commit()

    # Record the publish (and any override) in the audit chain.
    details: dict = {"version": next_version, "note": note}
    action = "agent.published"
    if block and override_reason:
        action = "agent.published_with_conformance_override"
        details["override_reason"] = override_reason
        details["failed_cases"] = [c["id"] for c in block["failed"]]
        details["conformance"] = {"passed": block["passed"], "total": block["total"]}
    await audit.record(
        db,
        tenant_id=agent.tenant_id,
        actor=body.get("actor") or "publisher",
        action=action,
        resource_type="agent",
        resource_id=agent_id,
        details=details,
    )

    return {
        "agent_id": agent_id,
        "version": next_version,
        "published": True,
        "conformance": (
            {"passed": block["passed"], "total": block["total"], "override": True}
            if block and override_reason
            else None
        ),
    }