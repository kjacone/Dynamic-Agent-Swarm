import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from nmb_marketplace_agent.api.auth import require_api_key
from nmb_marketplace_agent.api.deps import get_db
from nmb_marketplace_agent.config.models import (
    ApiKey,
    EvalCase,
    EvalDataset,
    Feedback,
    ThreadOwner,
)

router = APIRouter()         # admin, mounted at /feedback
public_router = APIRouter()  # API-key, mounted at /v1
_API_KEY_DEPENDENCY = Depends(require_api_key)
_DB_DEPENDENCY = Depends(get_db)


class FeedbackIn(BaseModel):
    thread_id: str
    rating: str = Field(pattern="^(up|down)$")
    comment: str | None = Field(default=None, max_length=1000)
    user_message: str | None = Field(default=None, max_length=4000)
    reply: str | None = Field(default=None, max_length=8000)
    user_id: str | None = Field(default=None, max_length=128)


@public_router.post("/feedback")
async def submit(body: FeedbackIn, request: Request, bg: BackgroundTasks,
                 key: ApiKey = _API_KEY_DEPENDENCY,
                 db: AsyncSession = _DB_DEPENDENCY):
    user = request.headers.get("x-nmb-user") or body.user_id
    owner = await db.get(ThreadOwner, body.thread_id)
    if (not owner or owner.agent_id != key.agent_id or owner.tenant_id != key.tenant_id
            or (owner.user_id or "") != (user or "")):
        raise HTTPException(404, "Unknown thread")
    db.add(Feedback(id=str(uuid.uuid4()), tenant_id=key.tenant_id, agent_id=key.agent_id,
                    thread_id=body.thread_id, rating=body.rating, comment=body.comment,
                    user_message=body.user_message, reply=body.reply))
    await db.commit()
    from nmb_marketplace_agent.integrations.langfuse import push_feedback
    bg.add_task(push_feedback, body.thread_id, body.rating, body.comment)
    return {"ok": True}


@router.get("")
async def list_feedback(tenant_id: str = "default", rating: str | None = None, db: AsyncSession = _DB_DEPENDENCY):
    q = select(Feedback).where(Feedback.tenant_id == tenant_id)
    if rating:
        q = q.where(Feedback.rating == rating)
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
