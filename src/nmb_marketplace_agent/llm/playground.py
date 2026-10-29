
"""Run one chat completion against any registered model or "provider:model" string."""
import time
from typing import Any

from nmb_marketplace_agent.llm.registry import resolve_model
from nmb_marketplace_agent.observability import callback_config

ALLOWED_PARAMS = ("temperature", "max_tokens", "top_p")


def content_text(c: Any) -> str:
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        return "".join(b.get("text", "") if isinstance(b, dict) else str(b) for b in c)
    return str(c)


async def run_chat(ref: str, messages: list[dict], params: dict | None, tenant_id: str,
                   trace_meta: dict | None = None) -> dict:
    from langchain.chat_models import init_chat_model

    model = await resolve_model(ref, tenant_id)
    if isinstance(model, str):
        model = init_chat_model(model)
    chosen = {k: v for k, v in (params or {}).items() if k in ALLOWED_PARAMS and v not in (None, "")}
    if chosen:
        model = model.bind(**chosen)
    cfg = callback_config(trace_meta) if trace_meta is not None else {}
    t0 = time.time()
    r = await model.ainvoke([(m["role"], m["content"]) for m in messages], config=cfg or None)
    return {
        "output": content_text(r.content),
        "latency_ms": int((time.time() - t0) * 1000),
        "usage": dict(getattr(r, "usage_metadata", None) or {}),
    }