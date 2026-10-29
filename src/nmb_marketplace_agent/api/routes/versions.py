import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from nmb_marketplace_agent.api.deps import get_db
from nmb_marketplace_agent.config.models import AgentConfig, AgentVersion
from nmb_marketplace_agent.config.versioning import FIELDS, snapshot_of

router = APIRouter()


class PublishIn(BaseModel):
    note: str = ""


async def _agent(db, agent_id, tenant_id):
    a = await db.get(AgentConfig, agent_id)
    if not a or a.tenant_id != tenant_id:
        raise HTTPException(404, "Agent not found")
    return a


async def _all(db, agent_id):
    res = await db.execute(select(AgentVersion).where(AgentVersion.agent_id == agent_id))
    return res.scalars().all()


@router.get("/{agent_id}/versions")
async def list_versions(agent_id: str, tenant_id: str = "default", db: AsyncSession = Depends(get_db)):
    await _agent(db, agent_id, tenant_id)
    return sorted(await _all(db, agent_id), key=lambda v: -v.version)


@router.post("/{agent_id}/publish")
async def publish(agent_id: str, body: PublishIn, tenant_id: str = "default", db: AsyncSession = Depends(get_db)):
    agent = await _agent(db, agent_id, tenant_id)
    existing = await _all(db, agent_id)
    for v in existing:
        v.published = False
        db.add(v)
    ver = AgentVersion(
        id=str(uuid.uuid4()), agent_id=agent_id, tenant_id=tenant_id,
        version=max([v.version for v in existing], default=0) + 1,
        snapshot=snapshot_of(agent), note=body.note, published=True,
    )
    db.add(ver)
    await db.commit()
    await db.refresh(ver)
    return ver


@router.post("/{agent_id}/versions/{version}/rollback")
async def make_live(agent_id: str, version: int, restore_draft: bool = False,
                    tenant_id: str = "default", db: AsyncSession = Depends(get_db)):
    agent = await _agent(db, agent_id, tenant_id)
    existing = await _all(db, agent_id)
    target = next((v for v in existing if v.version == version), None)
    if not target:
        raise HTTPException(404, "Version not found")
    for v in existing:
        v.published = v.version == version
        db.add(v)
    if restore_draft:
        for f in FIELDS:
            setattr(agent, f, target.snapshot.get(f))
        db.add(agent)
    await db.commit()
    return {"ok": True, "live_version": version}
