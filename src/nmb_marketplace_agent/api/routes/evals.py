import json
import os
import re
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from nmb_marketplace_agent.api.deps import get_db
from nmb_marketplace_agent.api.routes.runs import final_text, invoke_agent
from nmb_marketplace_agent.config.models import (
    AgentConfig,
    EvalCase,
    EvalDataset,
    EvalRun,
)
from nmb_marketplace_agent.config.settings import settings
from nmb_marketplace_agent.config.versioning import published_version
from nmb_marketplace_agent.llm.registry import resolve_model

router = APIRouter()


class DatasetIn(BaseModel):
    name: str
    agent_id: str
    tenant_id: str = "default"


class CaseIn(BaseModel):
    input: str
    expected_contains: str | None = None
    criteria: str | None = None


class RunIn(BaseModel):
    target: str = "published"  # draft | published


async def _ds(db, ds_id, tenant_id):
    ds = await db.get(EvalDataset, ds_id)
    if not ds or ds.tenant_id != tenant_id:
        raise HTTPException(404, "Dataset not found")
    return ds


@router.post("/datasets")
async def create_dataset(body: DatasetIn, db: AsyncSession = Depends(get_db)):
    agent = await db.get(AgentConfig, body.agent_id)
    if not agent or agent.tenant_id != body.tenant_id:
        raise HTTPException(404, "Agent not found for this tenant")
    row = EvalDataset(id=str(uuid.uuid4()), **body.model_dump())
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


@router.get("/datasets")
async def list_datasets(tenant_id: str = "default", db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(EvalDataset).where(EvalDataset.tenant_id == tenant_id))).scalars().all()
    counts = dict((await db.execute(select(EvalCase.dataset_id, func.count(EvalCase.id)).group_by(EvalCase.dataset_id))).all())
    return [{**r.model_dump(), "cases": counts.get(r.id, 0)} for r in rows]


@router.delete("/datasets/{ds_id}")
async def delete_dataset(ds_id: str, tenant_id: str = "default", db: AsyncSession = Depends(get_db)):
    ds = await _ds(db, ds_id, tenant_id)
    for model in (EvalCase, EvalRun):
        for r in (await db.execute(select(model).where(model.dataset_id == ds_id))).scalars().all():
            await db.delete(r)
    await db.delete(ds)
    await db.commit()
    return {"ok": True}


@router.get("/datasets/{ds_id}/cases")
async def list_cases(ds_id: str, tenant_id: str = "default", db: AsyncSession = Depends(get_db)):
    await _ds(db, ds_id, tenant_id)
    return (await db.execute(select(EvalCase).where(EvalCase.dataset_id == ds_id))).scalars().all()


@router.post("/datasets/{ds_id}/cases")
async def add_case(ds_id: str, body: CaseIn, tenant_id: str = "default", db: AsyncSession = Depends(get_db)):
    await _ds(db, ds_id, tenant_id)
    row = EvalCase(id=str(uuid.uuid4()), dataset_id=ds_id, **body.model_dump())
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


@router.delete("/cases/{case_id}")
async def delete_case(case_id: str, tenant_id: str = "default", db: AsyncSession = Depends(get_db)):
    case = await db.get(EvalCase, case_id)
    if not case:
        raise HTTPException(404, "Case not found")
    await _ds(db, case.dataset_id, tenant_id)
    await db.delete(case)
    await db.commit()
    return {"ok": True}


@router.post("/datasets/{ds_id}/run")
async def start_run(ds_id: str, body: RunIn, bg: BackgroundTasks, tenant_id: str = "default",
                    db: AsyncSession = Depends(get_db)):
    ds = await _ds(db, ds_id, tenant_id)
    if body.target not in ("draft", "published"):
        raise HTTPException(400, "target must be draft or published")
    v = await published_version(ds.agent_id) if body.target == "published" else None
    run = EvalRun(id=str(uuid.uuid4()), dataset_id=ds_id, agent_id=ds.agent_id, tenant_id=ds.tenant_id,
                  target=body.target, agent_version=v.version if v else None)
    db.add(run)
    await db.commit()
    await db.refresh(run)
    bg.add_task(_execute, run.id)
    return run


@router.get("/runs")
async def list_runs(dataset_id: str, tenant_id: str = "default", db: AsyncSession = Depends(get_db)):
    await _ds(db, dataset_id, tenant_id)
    rows = (await db.execute(select(EvalRun).where(EvalRun.dataset_id == dataset_id))).scalars().all()
    return sorted(rows, key=lambda r: r.created_at, reverse=True)


async def _judge(question: str, answer: str, criteria: str, tenant_id: str) -> dict:
    from langchain.chat_models import init_chat_model

    m = await resolve_model(os.environ.get("EVAL_JUDGE_MODEL") or settings.main_model, tenant_id)
    if isinstance(m, str):
        m = init_chat_model(m)
    r = await m.ainvoke(
        "You are a strict evaluator. Grade the ANSWER to the QUESTION against the CRITERIA.\n"
        f"QUESTION: {question}\nANSWER: {answer}\nCRITERIA: {criteria}\n"
        'Reply with ONLY JSON: {"score": <number 0 to 1>, "reason": "<one sentence>"}'
    )
    c = r.content
    text = c if isinstance(c, str) else "".join(b.get("text", "") for b in c if isinstance(b, dict))
    d = json.loads(re.search(r"\{.*\}", text, re.S).group(0))
    return {"score": max(0.0, min(1.0, float(d["score"]))), "reason": str(d.get("reason", ""))[:300]}


async def _execute(run_id: str):
    from nmb_marketplace_agent.config.database import async_session

    async with async_session() as s:
        run = await s.get(EvalRun, run_id)
        cases = (await s.execute(select(EvalCase).where(EvalCase.dataset_id == run.dataset_id))).scalars().all()
        results: list = []
        for c in cases:
            r: dict = {"case_id": c.id, "input": c.input}
            try:
                out = await invoke_agent(run.agent_id, run.tenant_id, c.input,
                                         use_draft=run.target == "draft")
                r["thread_id"] = out.get("thread_id")
                reply = final_text(out["result"])
                r["reply"] = reply
                parts = []
                if c.expected_contains:
                    ok = c.expected_contains.lower() in reply.lower()
                    r["contains"] = ok
                    parts.append(1.0 if ok else 0.0)
                if c.criteria:
                    j = await _judge(c.input, reply, c.criteria, run.tenant_id)
                    r["judge_score"], r["judge_reason"] = j["score"], j["reason"]
                    parts.append(j["score"])
                r["score"] = sum(parts) / len(parts) if parts else None
            except Exception as e:
                r["error"] = f"{type(e).__name__}: {e}"[:300]
            results.append(r)
            run.results = list(results)
            s.add(run)
            await s.commit()

        scored = [x["score"] for x in results if x.get("score") is not None]
        run.summary = {
            "cases": len(results), "scored": len(scored),
            "avg": round(sum(scored) / len(scored), 3) if scored else None,
            "pass_rate": round(sum(1 for x in scored if x >= 0.7) / len(scored), 3) if scored else None,
            "errors": sum(1 for x in results if "error" in x),
        }
        run.status = "done"
        s.add(run)
        await s.commit()

        # Sync to Langfuse — never fail the eval run if this is down.
        try:
            from nmb_marketplace_agent.integrations.langfuse import push_eval_run
            ds = await s.get(EvalDataset, run.dataset_id)
            items = [
                {
                    "case_id": c.id,
                    "input": c.input,
                    "expected": c.expected_contains,
                    "thread_id": r.get("thread_id"),
                    "score": r.get("score"),
                    "reason": r.get("judge_reason") or r.get("error"),
                }
                for c, r in zip(cases, results)
            ]
            run.summary["langfuse"] = (
                await push_eval_run(ds.name, run.id, items) if ds else "dataset missing"
            )
        except Exception as e:
            run.summary["langfuse"] = f"sync failed: {e}"[:200]
        s.add(run)
        await s.commit()