"""Authenticated, allow-listed reverse proxy to the LangGraph Agent Server.

Browsers/SDKs (e.g. @langchain/react `useStream`) talk to /v1/lg exactly as they
would to LangGraph, but: the API key picks the agent (via a per-agent assistant),
client-supplied `configurable`/`assistant_id` are overwritten, only an allow-list
of paths is reachable, and every thread is bound to the key's agent/tenant/user.
"""
import json
import os
import re
import uuid

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from nmb_marketplace_agent.api.auth import check_rate, require_api_key_nocount
from nmb_marketplace_agent.api.deps import get_db
from nmb_marketplace_agent.config.models import ApiKey, ThreadOwner

router = APIRouter()         # mounted at /v1/lg
config_router = APIRouter()  # mounted at /v1

_THREAD = re.compile(r"^threads/([^/]+)(/.*)?$")
_RATE = re.compile(r"/(commands|runs)(/|$)")
_ensured: set[str] = set()


def _base() -> str:
    return os.environ.get("LANGGRAPH_URL", "http://127.0.0.1:2024")


def assistant_id_for(key: ApiKey) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"nmb:{key.tenant_id}:{key.agent_id}"))


async def ensure_assistant(key: ApiKey, force: bool = False) -> str:
    """One assistant per agent: its default config pins agent_id/tenant_id."""
    aid = assistant_id_for(key)
    if aid in _ensured and not force:
        return aid
    body = {
        "assistant_id": aid,
        "graph_id": "supervisor",
        "name": f"{key.tenant_id}:{key.agent_id}",
        "if_exists": "do_nothing",
        "config": {"configurable": {"agent_id": key.agent_id, "tenant_id": key.tenant_id}},
    }
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(f"{_base()}/assistants", json=body)
    if r.status_code >= 400:
        raise HTTPException(502, f"Could not provision assistant: {r.text[:200]}")
    _ensured.add(aid)
    return aid


def _scrub(o, aid: str, user: str | None):
    """Overwrite anything a client could use to pick a different agent/config."""
    if isinstance(o, dict):
        for k, v in list(o.items()):
            if k == "configurable":
                o[k] = {"user_id": user} if user else {}
            elif k == "assistant_id":
                o[k] = aid
            else:
                _scrub(v, aid, user)
    elif isinstance(o, list):
        for i in o:
            _scrub(i, aid, user)


@config_router.get("/config")
async def public_config(request: Request, key: ApiKey = Depends(require_api_key_nocount)):
    aid = await ensure_assistant(key, force=True)
    base = os.environ.get("PUBLIC_BASE_URL") or str(request.base_url).rstrip("/")
    return {"assistantId": aid, "apiUrl": f"{base}/v1/lg"}


@router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"], include_in_schema=False)
async def proxy(
    path: str,
    request: Request,
    key: ApiKey = Depends(require_api_key_nocount),
    db: AsyncSession = Depends(get_db),
):
    path = path.strip("/")
    aid = await ensure_assistant(key)
    user = request.headers.get("x-nmb-user") or None
    method = request.method
    is_create = method == "POST" and path == "threads"

    m = _THREAD.match(path)
    if m:
        owner = await db.get(ThreadOwner, m.group(1))
        if (
            not owner
            or owner.agent_id != key.agent_id
            or owner.tenant_id != key.tenant_id
            or (owner.user_id or "") != (user or "")
        ):
            raise HTTPException(403, "Thread not accessible")
        if method == "DELETE" and not m.group(2):
            raise HTTPException(403, "Deleting threads is not allowed")
        if method == "POST" and _RATE.search("/" + path):
            check_rate(key)
    elif is_create:
        pass
    elif method == "GET" and (
        path == "info" or re.fullmatch(rf"assistants/{aid}(/(schemas|graph|subgraphs))?", path)
    ):
        pass
    else:
        raise HTTPException(403, "Path not allowed")

    body = await request.body()
    if body and "json" in request.headers.get("content-type", ""):
        try:
            data = json.loads(body)
        except ValueError:
            raise HTTPException(400, "Invalid JSON")
        _scrub(data, aid, user)
        if is_create and isinstance(data, dict):
            data["if_exists"] = "raise"  # never adopt someone else's thread id
        body = json.dumps(data).encode()

    fwd = {k: v for k, v in request.headers.items() if k.lower() in ("content-type", "accept", "last-event-id")}
    fwd["accept-encoding"] = "identity"
    url = f"{_base()}/{path}"
    params = dict(request.query_params)
    keep = ("content-type", "content-location", "location", "cache-control")

    if is_create:
        async with httpx.AsyncClient(timeout=60) as c:
            r = await c.request(method, url, params=params, content=body, headers=fwd)
        if r.status_code < 400:
            tid = r.json().get("thread_id")
            if tid:
                if await db.get(ThreadOwner, tid):
                    raise HTTPException(409, "Thread already exists")
                db.add(ThreadOwner(thread_id=tid, tenant_id=key.tenant_id, agent_id=key.agent_id, user_id=user))
                await db.commit()
        return Response(r.content, status_code=r.status_code, media_type=r.headers.get("content-type"))

    client = httpx.AsyncClient(timeout=httpx.Timeout(None, connect=10))
    try:
        upstream = await client.send(
            client.build_request(method, url, params=params, content=body or None, headers=fwd), stream=True
        )
    except Exception as e:
        await client.aclose()
        raise HTTPException(502, f"Upstream error: {type(e).__name__}")

    async def gen():
        try:
            async for chunk in upstream.aiter_bytes():
                yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    headers = {k: v for k, v in upstream.headers.items() if k.lower() in keep and k.lower() != "content-type"}
    headers["x-accel-buffering"] = "no"
    return StreamingResponse(
        gen(), status_code=upstream.status_code, media_type=upstream.headers.get("content-type"), headers=headers
    )
