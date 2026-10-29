import secrets
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from nmb_marketplace_agent.api.auth import hash_key
from nmb_marketplace_agent.api.deps import get_db
from nmb_marketplace_agent.config.models import AgentConfig, ApiKey

router = APIRouter()


class KeyCreate(BaseModel):
    name: str
    agent_id: str
    tenant_id: str = "default"
    kind: str = "publishable"
    allowed_origins: list[str] = ["*"] 
    rate_limit_per_min: int = 60


@router.post("")
async def create_key(body: KeyCreate, db: AsyncSession = Depends(get_db)):
    if body.kind not in ("publishable", "secret"):
        raise HTTPException(400, "kind must be publishable or secret")
    agent = await db.get(AgentConfig, body.agent_id)
    if not agent or agent.tenant_id != body.tenant_id:
        raise HTTPException(404, "Agent not found for this tenant")
    # An omitted/empty allow-list for a browser key means "not yet restricted".
    # Normalize to wildcard so the widget works out of the box; users who want
    # strict checking must set explicit origins (and are told so in the UI).
    if body.kind == "publishable" and not body.allowed_origins:
        body.allowed_origins = ["*"]
    raw = ("pk_" if body.kind == "publishable" else "sk_") + secrets.token_urlsafe(24)
    row = ApiKey(id=str(uuid.uuid4()), prefix=raw[:10], key_hash=hash_key(raw), **body.model_dump())
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return {**row.model_dump(exclude={"key_hash"}), "key": raw}


@router.get("")
async def list_keys(tenant_id: str = "default", db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(ApiKey).where(ApiKey.tenant_id == tenant_id))
    return [r.model_dump(exclude={"key_hash"}) for r in res.scalars().all()]


@router.delete("/{key_id}")
async def revoke_key(key_id: str, tenant_id: str = "default", db: AsyncSession = Depends(get_db)):
    row = await db.get(ApiKey, key_id)
    if not row or row.tenant_id != tenant_id:  # tenant-scoped
        raise HTTPException(404, "Key not found")
    row.revoked = True
    db.add(row)
    await db.commit()
    return {"ok": True}
