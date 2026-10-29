"""Invoke agents on the LangGraph server (admin proxy + helper for /v1 and evals)."""
import os

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()


def _url() -> str:
    return os.environ.get("LANGGRAPH_URL", "http://127.0.0.1:2024")


def final_text(result: dict) -> str:
    for m in reversed(result.get("messages", [])):
        if m.get("type") == "ai":
            c = m.get("content")
            t = c if isinstance(c, str) else "".join(b.get("text", "") for b in (c or []) if isinstance(b, dict))
            if t:
                return t
    return ""

async def invoke_agent(agent_id, tenant_id, message, thread_id=None, user_id=None, use_draft=False) -> dict:
    cfg = {"agent_id": agent_id, "tenant_id": tenant_id}
    if user_id:
        cfg["user_id"] = user_id
    if use_draft:
        cfg["use_draft"] = True
    async with httpx.AsyncClient(timeout=300) as client:
        created = False
        if not thread_id:
            t = await client.post(f"{_url()}/threads", json={})
            if t.status_code >= 400:
                raise HTTPException(t.status_code, t.text)
            thread_id = t.json()["thread_id"]
            created = True
        payload = {
            "assistant_id": "supervisor",
            "input": {"messages": [{"role": "user", "content": message}]},
            "config": {"configurable": cfg},
        }
        r = await client.post(f"{_url()}/threads/{thread_id}/runs/wait", json=payload)
        if r.status_code >= 400:
            raise HTTPException(r.status_code, r.text)
        data = r.json()

    # If we created this thread, record its ownership so /v1/feedback and the
    # lg_proxy don't 404 on it later. Failure here must not fail the invoke.
    if created:
        try:
            from nmb_marketplace_agent.config.database import async_session
            from nmb_marketplace_agent.config.models import ThreadOwner
            async with async_session() as s:
                s.add(ThreadOwner(
                    thread_id=thread_id, tenant_id=tenant_id,
                    agent_id=agent_id, user_id=user_id,
                ))
                await s.commit()
        except Exception:
            pass

    return {"thread_id": thread_id, "result": data}

class RunRequest(BaseModel):
    agent_id: str
    tenant_id: str = "default"
    message: str
    thread_id: str | None = None
    use_draft: bool = False


@router.post("/invoke")
async def invoke(body: RunRequest):
    return await invoke_agent(body.agent_id, body.tenant_id, body.message, body.thread_id, None, body.use_draft)
