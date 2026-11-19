"""Service health + connection settings for the dashboard."""
import asyncio
import time

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from nmb_marketplace_agent.api.deps import get_db
from nmb_marketplace_agent.config.models import (
    AgentConfig,
    EvalDataset,
    ModelConfig,
    RAGCollection,
    SubAgentConfig,
    ToolConfig,
)
from nmb_marketplace_agent.integrations import connections, provider_keys
from nmb_marketplace_agent.integrations import langfuse as lf
from nmb_marketplace_agent.training import store as training

router = APIRouter()


async def _http_check(sid: str, name: str, url: str | None, path: str, detail=None) -> dict:
    base = {"id": sid, "name": name, "url": url or "", "configured": bool(url), "ok": False, "detail": "", "latency_ms": None}
    if not url:
        base["detail"] = "Not configured"
        return base
    t0 = time.time()
    try:
        async with httpx.AsyncClient(timeout=4) as c:
            r = await c.get(url.rstrip("/") + path)
        base["latency_ms"] = int((time.time() - t0) * 1000)
        base["ok"] = r.status_code < 400
        base["detail"] = detail(r) if (detail and base["ok"]) else f"HTTP {r.status_code}"
    except httpx.HTTPError as e:
        base["detail"] = f"Unreachable ({type(e).__name__})"
    return base


async def _langfuse() -> dict:
    c = connections.get("langfuse")
    out = {"id": "langfuse", "name": "Langfuse", "url": c["host"] or "", "configured": bool(c.get("public_key") and c.get("secret_key")),
           "ok": False, "detail": "", "latency_ms": None}
    t0 = time.time()
    try:
        api = lf.LangfuseAPI(c["host"], c.get("public_key") or "", c.get("secret_key") or "")
        health = await api.health()
        out["latency_ms"] = int((time.time() - t0) * 1000)
        if not out["configured"]:
            out["detail"] = f"Reachable (v{health.get('version', '?')}) but no API keys saved"
            return out
        await api.check_auth()
        out["ok"] = True
        out["detail"] = f"Connected · v{health.get('version', '?')}"
    except lf.LangfuseError as e:
        out["detail"] = str(e)[:160]
    return out


def _trainer() -> dict:
    alive = training.runner_alive()
    return {"id": "trainer", "name": "Trainer", "url": "LLaMA-Factory", "configured": True, "ok": alive,
            "detail": "Runner online" if alive else "Runner offline (docker compose --profile training up)", "latency_ms": None}


async def check_all() -> list[dict]:
    g, o, v, l = (connections.get(n) for n in ("langgraph", "ollama", "vllm", "litellm"))
    results = await asyncio.gather(
        # Aegra serves /health (the LangGraph dev server's /ok does not exist here).
        _http_check("langgraph", "LangGraph", g["url"], "/health"),
        _langfuse(),
        _http_check("ollama", "Ollama", o["url"], "/api/tags", lambda r: f"{len(r.json().get('models', []))} models"),
        _http_check("vllm", "vLLM", v["url"], "/v1/models", lambda r: f"{len(r.json().get('data', []))} models"),
        _http_check("litellm", "LiteLLM", l["url"], "/health/liveliness"),
    )
    return [*results, _trainer()]


@router.get("/status")
async def status(tenant_id: str = "default", db: AsyncSession = Depends(get_db)):
    async def count(model) -> int:
        q = select(func.count()).select_from(model)
        if hasattr(model, "tenant_id"):
            q = q.where(model.tenant_id == tenant_id)
        return (await db.execute(q)).scalar_one()

    services = await check_all()
    counts = {
        "agents": await count(AgentConfig), "subagents": await count(SubAgentConfig),
        "tools": await count(ToolConfig), "rag": await count(RAGCollection),
        "models": await count(ModelConfig), "datasets": await count(EvalDataset),
    }
    return {"services": services, "counts": counts}


@router.get("/connections")
async def get_connections():
    return {name: connections.masked(name) for name in connections.SERVICES}


@router.put("/connections/{name}")
async def put_connection(name: str, body: dict):
    if name not in connections.SERVICES:
        raise HTTPException(404, "Unknown service")
    values = {k: v for k, v in body.items() if isinstance(v, str)}
    # the browser echoes masked secrets back; never store those
    for f in connections.SECRET_FIELDS:
        if f in values and values[f].startswith("••••"):
            values.pop(f)
    connections.save(name, values)
    checks = {c["id"]: c for c in await check_all()}
    return {"connection": connections.masked(name), "status": checks.get(name)}


@router.post("/connections/{name}/test")
async def test_connection(name: str):
    if name not in connections.SERVICES:
        raise HTTPException(404, "Unknown service")
    return {c["id"]: c for c in await check_all()}[name]


# ── BYOK: provider keys saved from the dashboard ────────────────────
@router.get("/provider-keys")
async def get_provider_keys():
    """Key metadata only — values are masked and never leave the server."""
    return {"keys": provider_keys.catalog_view(), "encrypted": provider_keys.encryption_enabled()}


@router.put("/provider-keys/{env}")
async def put_provider_key(env: str, body: dict):
    value = body.get("value")
    if not isinstance(value, str):
        raise HTTPException(400, "Send {\"value\": \"...\"}")
    try:
        saved = provider_keys.set_value(env, value)
    except KeyError:
        raise HTTPException(404, "Unknown key")
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"key": saved}


@router.delete("/provider-keys/{env}")
async def delete_provider_key(env: str):
    try:
        saved = provider_keys.clear_value(env)
    except KeyError:
        raise HTTPException(404, "Unknown key")
    return {"key": saved}
