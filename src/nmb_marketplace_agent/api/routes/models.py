import time
import uuid

from fastapi import APIRouter, Depends, HTTPException
from langchain_core.tools import tool
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from nmb_marketplace_agent.api.deps import get_db
from nmb_marketplace_agent.config.models import ModelConfig
from nmb_marketplace_agent.llm.registry import build_model, provider_catalog

router = APIRouter()


class ModelCreate(BaseModel):
    name: str
    provider: str = "openai"
    model_name: str
    base_url: str | None = None
    api_key_env: str | None = None
    params: dict = {}
    tenant_id: str = "default"


@router.post("")
async def create_model(body: ModelCreate, db: AsyncSession = Depends(get_db)):
    row = ModelConfig(id=str(uuid.uuid4()), **body.model_dump())
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


@router.get("")
async def list_models(tenant_id: str = "default", db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(ModelConfig).where(ModelConfig.tenant_id == tenant_id))
    return res.scalars().all()


@router.get("/providers")
async def providers():
    """Presets that fill the dashboard form; API keys are referenced by env var name only."""
    return provider_catalog()


@router.delete("/{model_id}")
async def delete_model(model_id: str, tenant_id: str = "default", db: AsyncSession = Depends(get_db)):
    row = await db.get(ModelConfig, model_id)
    if not row or row.tenant_id != tenant_id:  # tenant-scoped
        raise HTTPException(404, "Model not found")
    await db.delete(row)
    await db.commit()
    return {"ok": True}


@tool
def echo(text: str) -> str:
    """Echo the given text back unchanged."""
    return text


def _text(msg) -> str:
    content = getattr(msg, "content", msg)
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(b.get("text", "") for b in content if isinstance(b, dict))
    return str(content)


async def _probe_tool_calls(model) -> dict:
    """Ask the model to call a trivial tool. This is what deepagents needs to work."""
    t0 = time.time()
    prompt = "Call the echo tool exactly once with the text 'ping'. Do not answer in prose."
    msgs = []
    try:
        msgs.append(await model.bind_tools([echo]).ainvoke(prompt))
        if not (getattr(msgs[-1], "tool_calls", None) or []):
            # Some models only comply when the tool is required.
            msgs.append(await model.bind_tools([echo], tool_choice="required").ainvoke(prompt))
    except NotImplementedError:
        return {"ok": False, "error": "This provider does not support tool calling",
                "latency_ms": int((time.time() - t0) * 1000)}
    except Exception as e:  # noqa: BLE001 - report, don't fail the whole test
        return {"ok": False, "error": f"{type(e).__name__}: {e}"[:300],
                "latency_ms": int((time.time() - t0) * 1000)}

    for msg in reversed(msgs):
        calls = getattr(msg, "tool_calls", None) or []
        if calls:
            call = calls[0]
            return {
                "ok": call.get("name") == "echo",
                "name": call.get("name"),
                "args": call.get("args"),
                "latency_ms": int((time.time() - t0) * 1000),
            }
    return {
        "ok": False,
        "error": "The model replied without calling the tool",
        "reply": _text(msgs[-1])[:160],
        "latency_ms": int((time.time() - t0) * 1000),
    }


@router.post("/{model_id}/test")
async def test_model(model_id: str, probe_tools: bool = True,
                     db: AsyncSession = Depends(get_db)):
    cfg = await db.get(ModelConfig, model_id)
    if not cfg:
        raise HTTPException(404, "Model not found")
    try:
        model = build_model(cfg)
    except Exception as e:
        raise HTTPException(502, f"{type(e).__name__}: {e}")
    try:
        t0 = time.time()
        r = await model.ainvoke("Reply with the single word: OK")
        latency = int((time.time() - t0) * 1000)
    except Exception as e:
        raise HTTPException(502, f"{type(e).__name__}: {e}")
    out = {"ok": True, "latency_ms": latency, "reply": _text(r)[:200]}
    if probe_tools:
        if cfg.provider.strip().lower() == "sample":
            out["tool_calls"] = {"ok": True, "skipped": "canned demo model"}
        else:
            out["tool_calls"] = await _probe_tool_calls(model)
    return out


class ModelPatch(BaseModel):
    name: str | None = None
    provider: str | None = None
    model_name: str | None = None
    base_url: str | None = None
    api_key_env: str | None = None
    params: dict | None = None


@router.patch("/{model_id}")
async def patch_model(
    model_id: str,
    body: ModelPatch,
    tenant_id: str = "default",
    db: AsyncSession = Depends(get_db),
):
    row = await db.get(ModelConfig, model_id)
    if not row or row.tenant_id != tenant_id:
        raise HTTPException(404, "Model not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(row, k, v)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row
