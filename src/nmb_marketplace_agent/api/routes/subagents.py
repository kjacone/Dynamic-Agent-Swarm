import os
import uuid

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from nmb_marketplace_agent.api.deps import get_db
from nmb_marketplace_agent.config.models import (
    RAGCollection,
    SubAgentConfig,
    ToolConfig,
)
from nmb_marketplace_agent.config.settings import settings


async def _check_refs(db, tenant_id, *, tool_ids=None, rag_ids=None):
    for tid in tool_ids or []:
        t = await db.get(ToolConfig, tid)
        if not t or t.tenant_id != tenant_id:
            raise HTTPException(400, f"Tool {tid} not found for this tenant")
    for rid in rag_ids or []:
        r = await db.get(RAGCollection, rid)
        if not r or r.tenant_id != tenant_id:
            raise HTTPException(400, f"RAG collection {rid} not found for this tenant")
        

router = APIRouter()


class SubAgentCreate(BaseModel):
    name: str
    description: str = ""
    system_prompt: str = ""
    mode: str = "sync"
    tool_ids: list[str] = []
    rag_collection_ids: list[str] = []
    model: str | None = None
    graph_id: str | None = None
    url: str | None = None
    tenant_id: str = "default"


class SubAgentPatch(BaseModel):
    name: str | None = None
    description: str | None = None
    system_prompt: str | None = None
    mode: str | None = None
    tool_ids: list[str] | None = None
    rag_collection_ids: list[str] | None = None
    model: str | None = None
    graph_id: str | None = None
    url: str | None = None


class SubAgentTest(BaseModel):
    message: str
    tenant_id: str = "default"


@router.post("")
async def create_subagent(body: SubAgentCreate, db: AsyncSession = Depends(get_db)):
    if body.mode == "async" and not body.graph_id:
        raise HTTPException(400, "Async subagent requires graph_id")
    sub = SubAgentConfig(id=str(uuid.uuid4()), **body.model_dump())
    db.add(sub)
    await db.commit()
    await db.refresh(sub)
    return sub


@router.get("")
async def list_subagents(tenant_id: str = "default", db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(SubAgentConfig).where(SubAgentConfig.tenant_id == tenant_id))
    return res.scalars().all()


@router.patch("/{sub_id}")
async def patch_subagent(sub_id: str, body: SubAgentPatch, tenant_id: str = "default", db: AsyncSession = Depends(get_db)):
    sub = await db.get(SubAgentConfig, sub_id)
    if not sub or sub.tenant_id != tenant_id:  # tenant-scoped
        raise HTTPException(404, "Subagent not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(sub, k, v)
    if sub.mode == "async" and not sub.graph_id:
        raise HTTPException(400, "Async subagent requires graph_id")
    db.add(sub)
    await db.commit()
    await db.refresh(sub)
    return sub


# ── testing a subagent on its own ────────────────────────────────────────
def _text(c) -> str:
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        return "".join(b.get("text", "") if isinstance(b, dict) else str(b) for b in c)
    return str(c)


def _norm(m) -> dict:
    g = (lambda k, d=None: m.get(k, d)) if isinstance(m, dict) else (lambda k, d=None: getattr(m, k, d))
    return {
        "type": g("type"),
        "content": _text(g("content", "")),
        "tool_calls": [tc.get("name", "") for tc in (g("tool_calls") or [])],
    }


def _result(msgs) -> dict:
    trace = [_norm(m) for m in msgs]
    out = next((m["content"] for m in reversed(trace) if m["type"] == "ai" and m["content"]), "")
    return {"output": out, "trace": trace}


@router.post("/{sub_id}/test")
async def test_subagent(sub_id: str, body: SubAgentTest, tenant_id: str = "default", db: AsyncSession = Depends(get_db)):
    sub = await db.get(SubAgentConfig, sub_id)
    if not sub or sub.tenant_id != tenant_id:  # tenant-scoped
        raise HTTPException(404, "Subagent not found")
    payload = {"messages": [{"role": "user", "content": body.message}]}
    try:
        if sub.mode == "async":
            # Runs on the LangGraph server (graph_id must exist in langgraph.json)
            base = sub.url or os.environ.get("LANGGRAPH_URL", "http://127.0.0.1:2024")
            async with httpx.AsyncClient(timeout=300) as c:
                t = await c.post(f"{base}/threads", json={})
                t.raise_for_status()
                r = await c.post(
                    f"{base}/threads/{t.json()['thread_id']}/runs/wait",
                    json={"assistant_id": sub.graph_id, "input": payload},
                )
                r.raise_for_status()
            return _result(r.json().get("messages", []))

        # Sync: build the same agent the supervisor would delegate to, run it in-process
        from deepagents import create_deep_agent
        from nmb_marketplace_agent.llm.registry import resolve_model
        from nmb_marketplace_agent.subagents.registry import resolve_sub_tools

        agent = create_deep_agent(
            model=await resolve_model(sub.model or settings.main_model, sub.tenant_id),
            tools=await resolve_sub_tools(sub),
            system_prompt=sub.system_prompt or "You are a helpful assistant.",
        )
        res = await agent.ainvoke(payload)
        return _result(res["messages"])
    except Exception as e:
        raise HTTPException(502, f"{type(e).__name__}: {e}")


@router.delete("/{sub_id}")
async def delete_subagent(sub_id: str, tenant_id: str = "default", db: AsyncSession = Depends(get_db)):
    sub = await db.get(SubAgentConfig, sub_id)
    if not sub or sub.tenant_id != tenant_id:
        raise HTTPException(404, "Subagent not found")
    await db.delete(sub)
    await db.commit()
    return {"ok": True}
