"""Model inference: the local Ollama runtime, a catalog of what is being served, and a chat playground."""
import json
import re

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from nmb_marketplace_agent.integrations import connections
from nmb_marketplace_agent.llm.playground import run_chat

router = APIRouter()
OLLAMA_NAME = re.compile(r"^[\w.\-:/]{1,200}$")


def _ollama() -> str:
    return connections.get("ollama")["url"].rstrip("/")


async def _json(method: str, url: str, **kw):
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.request(method, url, **kw)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Cannot reach {url}: {type(e).__name__}")
    if r.status_code >= 400:
        raise HTTPException(502, f"{url} returned {r.status_code}: {r.text[:200]}")
    return r.json() if r.content else {}


@router.get("/ollama/models")
async def ollama_models():
    data = await _json("GET", f"{_ollama()}/api/tags")
    return [{"name": m["name"], "size": m.get("size", 0), "modified_at": m.get("modified_at"),
             "family": (m.get("details") or {}).get("family"), "params": (m.get("details") or {}).get("parameter_size"),
             "quant": (m.get("details") or {}).get("quantization_level")} for m in data.get("models", [])]


class PullIn(BaseModel):
    name: str


@router.post("/ollama/pull")
async def ollama_pull(body: PullIn):
    """Server-sent events of Ollama's pull progress."""
    if not OLLAMA_NAME.match(body.name):
        raise HTTPException(400, "Invalid model name")

    async def gen():
        try:
            async with httpx.AsyncClient(timeout=None) as c:
                async with c.stream("POST", f"{_ollama()}/api/pull", json={"model": body.name, "stream": True}) as r:
                    if r.status_code >= 400:
                        yield f"data: {json.dumps({'error': f'Ollama returned {r.status_code}'})}\n\n"
                        return
                    async for line in r.aiter_lines():
                        if line.strip():
                            yield f"data: {line}\n\n"
        except httpx.HTTPError as e:
            yield f"data: {json.dumps({'error': f'Cannot reach Ollama ({type(e).__name__})'})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"x-accel-buffering": "no"})


@router.delete("/ollama/models/{name:path}")
async def ollama_delete(name: str):
    if not OLLAMA_NAME.match(name):
        raise HTTPException(400, "Invalid model name")
    await _json("DELETE", f"{_ollama()}/api/delete", json={"model": name})
    return {"ok": True}


@router.get("/catalog")
async def catalog():
    """Models currently served by each configured local runtime, ready to register."""
    out: list[dict] = []
    try:
        for m in await ollama_models():
            out.append({"runtime": "ollama", "model_name": m["name"], "provider": "ollama", "base_url": _ollama()})
    except HTTPException:
        pass
    for rt in ("vllm", "litellm"):
        c = connections.get(rt)
        if not c.get("url"):
            continue
        try:
            headers = {"Authorization": f"Bearer {c['api_key']}"} if c.get("api_key") else {}
            data = await _json("GET", c["url"].rstrip("/") + "/v1/models", headers=headers)
            for m in data.get("data", []):
                out.append({"runtime": rt, "model_name": m["id"], "provider": "openai",
                            "base_url": c["url"].rstrip("/") + "/v1"})
        except HTTPException:
            continue
    return out


class ChatIn(BaseModel):
    model: str
    messages: list[dict] = Field(min_length=1)
    params: dict = {}
    trace: bool = False
    tenant_id: str = "default"


@router.post("/chat")
async def chat(body: ChatIn):
    for m in body.messages:
        if m.get("role") not in ("system", "user", "assistant") or not isinstance(m.get("content"), str):
            raise HTTPException(400, "Messages need a role (system/user/assistant) and string content")
    try:
        return await run_chat(body.model, body.messages, body.params, body.tenant_id,
                              {"source": "dashboard-inference"} if body.trace else None)
    except Exception as e:
        raise HTTPException(502, f"{type(e).__name__}: {e}"[:500])