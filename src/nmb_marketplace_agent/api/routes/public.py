import json
import os

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from nmb_marketplace_agent.api.auth import require_api_key
from nmb_marketplace_agent.api.deps import get_db
from nmb_marketplace_agent.config.models import ApiKey, ThreadOwner

router = APIRouter()


class ChatRequest(BaseModel):
    message: str
    thread_id: str | None = None
    user_id: str | None = None
    # Optional — if omitted, the API key's agent/tenant are used.
    # The embed widget omits both; the SDK passes both. Both work.
    agent_id: str | None = None
    tenant_id: str | None = None


@router.post("/chat")
async def chat(
    body: ChatRequest,
    request: Request,
    key: ApiKey = Depends(require_api_key),
    db: AsyncSession = Depends(get_db),
):
    # The key is the source of truth. Body may confirm but never override.
    agent_id = body.agent_id or key.agent_id
    tenant_id = body.tenant_id or key.tenant_id
    if agent_id != key.agent_id:
        raise HTTPException(403, "API key not authorized for this agent")
    if tenant_id != key.tenant_id:
        raise HTTPException(403, "API key not authorized for this tenant")

    from nmb_marketplace_agent.enterprise.hooks import enforce_chat

    # Enterprise controls: guardrails (PII redaction / injection block), hash-only audit, usage metering.
    body.message = await enforce_chat(db, tenant_id=tenant_id, agent_id=agent_id,
                                      actor=f"key:{key.prefix or key.id}", message=body.message)

    from langgraph_sdk import get_client

    lg_url = os.environ.get("LANGGRAPH_URL", "http://127.0.0.1:2024")
    client = get_client(url=lg_url)

    user_id = body.user_id or None
    thread_id = (body.thread_id or "").strip() or None

    if thread_id:
        owner = await db.get(ThreadOwner, thread_id)
        if (
            not owner
            or owner.agent_id != agent_id
            or owner.tenant_id != tenant_id
            or (owner.user_id or "") != (user_id or "")
        ):
            thread_id = None  # unknown / foreign / foreign-user thread
    if not thread_id:
        t = await client.threads.create(metadata={"agent_id": agent_id})
        thread_id = t["thread_id"]
        db.add(ThreadOwner(
            thread_id=thread_id,
            tenant_id=tenant_id,
            agent_id=agent_id,
            user_id=user_id,
        ))
        await db.commit()

    lg_in = {"messages": [{"role": "user", "content": body.message}]}
    lg_cfg = {"configurable": {
        "agent_id": agent_id,
        "tenant_id": tenant_id,
        **({"user_id": user_id} if user_id else {}),
    }}

    accept = request.headers.get("accept", "").lower()

    # ── Streaming (SDK / demo / any client that sets Accept) ─────────
    if "text/event-stream" in accept:
        async def event_stream():
            yield _sse({"type": "thread", "threadId": thread_id})
            try:
                async for chunk in client.runs.stream(
                    thread_id=thread_id,
                    assistant_id="supervisor",
                    input=lg_in,
                    config=lg_cfg,
                    stream_mode="messages",
                ):
                    event = getattr(chunk, "event", "")
                    data = getattr(chunk, "data", None)
                    if event == "messages" and isinstance(data, (list, tuple)) and data:
                        text = _extract_text(data[0])
                        if text:
                            yield _sse({"type": "token", "messageId": "", "text": text})
            except Exception as e:
                yield _sse({"type": "error", "error": str(e)})
            yield "data: [DONE]\n\n"
        return StreamingResponse(event_stream(), media_type="text/event-stream")

    # ── Non-streaming JSON (embed.js) ────────────────────────────────
    try:
        state = await client.runs.wait(
            thread_id=thread_id,
            assistant_id="supervisor",
            input=lg_in,
            config=lg_cfg,
        )
    except Exception as e:
        raise HTTPException(502, f"{type(e).__name__}: {e}"[:400])
    return {"thread_id": thread_id, "reply": _final_reply(state)}


def _sse(obj: dict) -> str:
    return f"data: {json.dumps(obj)}\n\n"


def _extract_text(msg) -> str:
    content = getattr(msg, "content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(p.get("text", "") for p in content if isinstance(p, dict))
    return ""


def _final_reply(state: dict | None) -> str:
    for m in reversed((state or {}).get("messages", [])):
        t = m.get("type") if isinstance(m, dict) else getattr(m, "type", "")
        if t != "ai":
            continue
        c = m.get("content") if isinstance(m, dict) else getattr(m, "content", "")
        if isinstance(c, str) and c:
            return c
        if isinstance(c, list):
            text = "".join(p.get("text", "") for p in c if isinstance(p, dict))
            if text:
                return text
    return ""