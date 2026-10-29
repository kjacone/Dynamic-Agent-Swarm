"""Prompt management (stored in Langfuse) and a multi-model prompt playground."""
import asyncio
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from nmb_marketplace_agent.integrations import langfuse as lf
from nmb_marketplace_agent.llm.playground import run_chat
from nmb_marketplace_agent.prompts.render import render_messages, variables_of

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


class PromptIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    type: Literal["text", "chat"] = "text"
    prompt: Any
    labels: list[str] = []
    config: dict = {}
    commit_message: str | None = None


class LabelsIn(BaseModel):
    labels: list[str]


class PromptTest(BaseModel):
    prompt: Any                       # str for text prompts, list of {role, content} for chat
    variables: dict[str, str] = {}
    user_input: str | None = None
    models: list[str] = Field(min_length=1, max_length=4)
    params: dict = {}
    trace: bool = False
    tenant_id: str = "default"


@router.get("")
async def list_prompts():
    return await _wrap(_lf().prompts())


@router.get("/{name:path}/versions/{version}")
async def get_version(name: str, version: int):
    p = await _wrap(_lf().prompt(name, version=version))
    return {**p, "variables": variables_of(p.get("prompt"))}


@router.get("/{name:path}")
async def get_prompt(name: str, label: str | None = None):
    p = await _wrap(_lf().prompt(name, label=label or "latest"))
    return {**p, "variables": variables_of(p.get("prompt"))}


@router.post("")
async def create_prompt(body: PromptIn):
    return await _wrap(_lf().create_prompt(body.name, body.type, body.prompt, body.labels, body.config, body.commit_message))


@router.patch("/{name:path}/versions/{version}/labels")
async def set_labels(name: str, version: int, body: LabelsIn):
    return await _wrap(_lf().set_labels(name, version, body.labels))


@router.post("/test")
async def test_prompt(body: PromptTest):
    messages = render_messages(body.prompt, body.variables, body.user_input)
    meta = {"source": "dashboard-playground", "langfuse_tags": ["playground"]} if body.trace else None

    async def one(ref: str) -> dict:
        try:
            return {"model": ref, "ok": True, **await asyncio.wait_for(
                run_chat(ref, messages, body.params, body.tenant_id, meta), timeout=120)}
        except Exception as e:
            return {"model": ref, "ok": False, "error": f"{type(e).__name__}: {e}"[:400]}

    return {"messages": messages, "results": await asyncio.gather(*[one(m) for m in body.models])}