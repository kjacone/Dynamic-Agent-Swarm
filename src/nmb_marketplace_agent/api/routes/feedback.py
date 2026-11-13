import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from nmb_marketplace_agent.api.deps import get_db
from nmb_marketplace_agent.config.models import EvalCase, EvalDataset, Feedback

router = APIRouter()  # admin, mounted at /feedback
_DB_DEPENDENCY = Depends(get_db)


@router.get("")
async def list_feedback(tenant_id: str = "default", rating: str | None = None,
                        customer_id: str | None = None, db: AsyncSession = _DB_DEPENDENCY):
    q = select(Feedback).where(Feedback.tenant_id == tenant_id)
    if rating:
        q = q.where(Feedback.rating == rating)
    if customer_id:
        q = q.where(Feedback.customer_id == customer_id)
    rows = (await db.execute(q)).scalars().all()
    return sorted(rows, key=lambda r: r.created_at, reverse=True)[:200]


class ToDataset(BaseModel):
    dataset_id: str


@router.post("/{fb_id}/to-dataset")
async def to_dataset(fb_id: str, body: ToDataset, tenant_id: str = "default", db: AsyncSession = _DB_DEPENDENCY):
    fb = await db.get(Feedback, fb_id)
    ds = await db.get(EvalDataset, body.dataset_id)
    if not fb or fb.tenant_id != tenant_id or not ds or ds.tenant_id != tenant_id:
        raise HTTPException(404, "Not found")
    if not fb.user_message:
        raise HTTPException(400, "This feedback has no user message to turn into a case")
    criteria = fb.comment or ("The answer is helpful, correct and complete." if fb.rating == "down"
                              else "Keep this behaviour: the answer is helpful and correct.")
    db.add(EvalCase(id=str(uuid.uuid4()), dataset_id=ds.id, input=fb.user_message, criteria=criteria))
    await db.commit()
    return {"ok": True}


@router.delete("/{fb_id}")
async def delete_feedback(fb_id: str, tenant_id: str = "default", db: AsyncSession = _DB_DEPENDENCY):
    fb = await db.get(Feedback, fb_id)
    if not fb or fb.tenant_id != tenant_id:
        raise HTTPException(404, "Not found")
    await db.delete(fb)
    await db.commit()
    return {"ok": True}
