"""Read-side bridge to Langfuse: traces, daily usage and deep links."""
from fastapi import APIRouter, HTTPException

from nmb_marketplace_agent import observability
from nmb_marketplace_agent.integrations import langfuse as lf

router = APIRouter()


def _lf() -> lf.LangfuseAPI:
    c = lf.client()
    if not c:
        raise HTTPException(503, "Langfuse is not connected. Add its URL and API keys under Settings.")
    return c


async def _wrap(coro):
    try:
        return await coro
    except lf.LangfuseError as e:
        raise HTTPException(502, str(e))


@router.get("/status")
async def status():
    return {"langfuse": observability.enabled()}


@router.get("/traces")
async def traces(limit: int = 25, page: int = 1, session_id: str | None = None, user_id: str | None = None,
                 tag: str | None = None, name: str | None = None):
    api = _lf()
    data = await _wrap(api.traces(limit=min(limit, 100), page=page, sessionId=session_id, userId=user_id,
                                  tags=tag, name=name))
    pid = await api.project_id()
    for t in data.get("data", []):
        t["consoleUrl"] = (f"{api.public_url}/project/{pid}/traces/{t['id']}" if pid else f"{api.public_url}/trace/{t['id']}")
    return data


@router.get("/traces/{trace_id}")
async def trace(trace_id: str):
    return await _wrap(_lf().trace(trace_id))


@router.get("/metrics/daily")
async def daily(days: int = 14):
    from datetime import datetime, timedelta, timezone

    start = (datetime.now(timezone.utc) - timedelta(days=min(days, 90))).strftime("%Y-%m-%dT00:00:00Z")
    data = await _wrap(_lf().daily_metrics(fromTimestamp=start, limit=90))
    return sorted(data.get("data", []), key=lambda d: d.get("date", ""))


@router.get("/link")
async def link(kind: str = "traces"):
    api = _lf()
    if kind not in ("traces", "prompts", "datasets", "sessions", "scores"):
        raise HTTPException(400, "Unknown section")
    return {"url": await api.console_url(kind)}