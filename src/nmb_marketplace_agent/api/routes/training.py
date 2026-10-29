"""Model training. Datasets are built here; jobs run in the LLaMA-Factory trainer container."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from nmb_marketplace_agent.api.deps import get_db
from nmb_marketplace_agent.config.models import Feedback
from nmb_marketplace_agent.training import store

router = APIRouter()


def _guard(fn, *a, **kw):
    try:
        return fn(*a, **kw)
    except store.TrainingError as e:
        raise HTTPException(400, str(e))


class DatasetIn(BaseModel):
    name: str
    source: str = "rows"          # rows | feedback
    rows: list[dict] = []
    agent_id: str | None = None   # feedback only
    tenant_id: str = "default"


@router.get("/datasets")
async def datasets():
    return store.list_datasets()


@router.post("/datasets")
async def create_dataset(body: DatasetIn, db: AsyncSession = Depends(get_db)):
    rows = body.rows
    if body.source == "feedback":
        q = select(Feedback).where(Feedback.tenant_id == body.tenant_id, Feedback.rating == "up")
        if body.agent_id:
            q = q.where(Feedback.agent_id == body.agent_id)
        fb = (await db.execute(q)).scalars().all()
        rows = [{"instruction": f.user_message, "output": f.reply} for f in fb if f.user_message and f.reply]
    elif body.source != "rows":
        raise HTTPException(400, "source must be rows or feedback")
    return _guard(store.write_dataset, body.name, rows)


@router.get("/jobs")
async def jobs():
    return {"runner_online": store.runner_alive(), "jobs": store.list_jobs()}


@router.post("/jobs")
async def create_job(body: dict):
    return _guard(store.create_job, body)


@router.get("/jobs/{job_id}")
async def job(job_id: str):
    return _guard(store.job_detail, job_id)


@router.get("/jobs/{job_id}/log")
async def job_log(job_id: str, lines: int = 200):
    return {"log": _guard(store.log_tail, job_id, min(lines, 2000))}


@router.post("/jobs/{job_id}/cancel")
async def cancel(job_id: str):
    _guard(store.cancel, job_id)
    return {"ok": True}