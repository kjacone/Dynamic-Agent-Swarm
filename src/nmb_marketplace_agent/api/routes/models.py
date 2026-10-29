import time
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from nmb_marketplace_agent.api.deps import get_db
from nmb_marketplace_agent.config.models import ModelConfig
from nmb_marketplace_agent.llm.registry import build_model

router = APIRouter()


class ModelCreate(BaseModel):
    name: str
    provider: str = "openai"
    model_name: str
    base_url: str | None = None
    api_key_env: str | None = None
    params: dict = {}
    tenant_id: str = "default"


@router.post("")
async def create_model(body: ModelCreate, db: AsyncSession = Depends(get_db)):
    row = ModelConfig(id=str(uuid.uuid4()), **body.model_dump())
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


@router.get("")
async def list_models(tenant_id: str = "default", db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(ModelConfig).where(ModelConfig.tenant_id == tenant_id))
    return res.scalars().all()


@router.delete("/{model_id}")
async def delete_model(model_id: str, tenant_id: str = "default", db: AsyncSession = Depends(get_db)):
    row = await db.get(ModelConfig, model_id)
    if not row or row.tenant_id != tenant_id:  # tenant-scoped
        raise HTTPException(404, "Model not found")
    await db.delete(row)
    await db.commit()
    return {"ok": True}


@router.post("/{model_id}/test")
async def test_model(model_id: str, db: AsyncSession = Depends(get_db)):
    cfg = await db.get(ModelConfig, model_id)
    if not cfg:
        raise HTTPException(404, "Model not found")
    try:
        t0 = time.time()
        r = await build_model(cfg).ainvoke("Reply with the single word: OK")
        c = r.content
        text = c if isinstance(c, str) else "".join(b.get("text", "") for b in c if isinstance(b, dict))
        return {"ok": True, "latency_ms": int((time.time() - t0) * 1000), "reply": text[:200]}
    except Exception as e:
        raise HTTPException(502, f"{type(e).__name__}: {e}")

class ModelPatch(BaseModel):
    name: str | None = None
    provider: str | None = None
    model_name: str | None = None
    base_url: str | None = None
    api_key_env: str | None = None
    params: dict | None = None


@router.patch("/{model_id}")
async def patch_model(
    model_id: str,
    body: ModelPatch,
    tenant_id: str = "default",
    db: AsyncSession = Depends(get_db),
):
    row = await db.get(ModelConfig, model_id)
    if not row or row.tenant_id != tenant_id:
        raise HTTPException(404, "Model not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(row, k, v)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row