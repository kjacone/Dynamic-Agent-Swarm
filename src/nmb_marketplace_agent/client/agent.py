"""Python client for NMB Marketplace Agent.

Two transports:
  - mode="gateway" -> FastAPI gateway /v1/chat (API key)
  - mode="direct"  -> LangGraph SDK (JWT token)
"""
from __future__ import annotations

import json
import uuid
from collections.abc import AsyncIterator
from typing import Any, Literal

import httpx

from nmb_marketplace_agent.client.events import AgentEvent


class NmbAgent:
    def __init__(
        self,
        agent_id: str,
        *,
        mode: Literal["gateway", "direct"] = "gateway",
        base_url: str = "http://127.0.0.1:8000",
        api_key: str | None = None,
        langgraph_url: str | None = None,
        token_vendor: Any = None,
        tenant_id: str = "default",
    ) -> None:
        self.agent_id = agent_id
        self.tenant_id = tenant_id
        self.mode = mode
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.langgraph_url = (langgraph_url or "").rstrip("/")
        self.token_vendor = token_vendor
        self._thread_id: str | None = None

    async def manifest(self) -> dict[str, Any]:
        # The manifest endpoint only exists on the FastAPI gateway — LangGraph
        # doesn't expose it. Direct mode still uses the gateway for manifest.
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.get(
                f"{self.base_url}/agents/{self.agent_id}/manifest",
                params={"tenant_id": self.tenant_id},
                headers={"x-api-key": self.api_key or ""},
            )
            r.raise_for_status()
            return r.json()
        

    async def can(self, name: str) -> bool:
        m = await self.manifest()
        return any(x["name"] == name for x in m["tools"] + m["subagents"])

    async def run(
        self, message: str, *, thread_id: str | None = None
    ) -> AsyncIterator[AgentEvent]:
        if self.mode == "gateway":
            async for ev in self._run_gateway(message, thread_id):
                yield ev
        else:
            async for ev in self._run_direct(message, thread_id):
                yield ev
    async def _run_gateway(
        self, message: str, thread_id: str | None
    ) -> AsyncIterator[AgentEvent]:
        tid = thread_id or self._thread_id or str(uuid.uuid4())
        self._thread_id = tid
        # Emit early so callers have an id even if the request fails before
        # the server sends its own first frame.
        yield AgentEvent("thread", {"threadId": tid})

        body = {
            "agent_id": self.agent_id,
            "tenant_id": self.tenant_id,
            "thread_id": tid,
            "message": message,
        }
        async with httpx.AsyncClient(timeout=None) as c:
            async with c.stream(
                "POST",
                f"{self.base_url}/v1/chat",
                json=body,
                headers={
                    "x-api-key": self.api_key or "",
                    "accept": "text/event-stream",
                },
            ) as r:
                r.raise_for_status()
                buf = ""
                async for chunk in r.aiter_text():
                    buf += chunk
                    while "\n\n" in buf:
                        block, buf = buf.split("\n\n", 1)
                        for line in block.split("\n"):
                            if not line.startswith("data:"):
                                continue
                            raw = line[5:].strip()
                            if not raw or raw == "[DONE]":
                                continue
                            try:
                                payload = json.loads(raw)
                            except Exception:
                                yield AgentEvent("error", {"error": raw[:200]})
                                continue
                            if payload.get("type") == "thread":
                                # Server is authoritative — adopt its id and
                                # suppress the duplicate frame.
                                server_tid = payload.get("threadId")
                                if server_tid:
                                    self._thread_id = server_tid
                                continue
                            yield AgentEvent(payload["type"], payload)


    async def _run_direct(
        self, message: str, thread_id: str | None
    ) -> AsyncIterator[AgentEvent]:
        from langgraph_sdk import get_client

        token = await self._vendor_token()
        client = get_client(
            url=self.langgraph_url,
            api_key=token,
            headers={"x-tenant": self.tenant_id},
        )

        tid = thread_id or self._thread_id
        if tid is None:
            t = await client.threads.create(metadata={"agent_id": self.agent_id})
            tid = t["thread_id"]
        self._thread_id = tid
        yield AgentEvent("thread", {"threadId": tid})

        try:
            async for chunk in client.runs.stream(
                thread_id=tid,
                assistant_id="supervisor",
                input={"messages": [{"role": "user", "content": message}]},
                config={"configurable": {
                    "agent_id": self.agent_id,
                    "tenant_id": self.tenant_id,
                }},
                stream_mode="messages",
            ):
                event = getattr(chunk, "event", "")
                data = getattr(chunk, "data", None)
                if event == "messages" and isinstance(data, (list, tuple)) and data:
                    msg = data[0]
                    content = getattr(msg, "content", "")
                    if isinstance(content, str):
                        text = content
                    elif isinstance(content, list):
                        text = "".join(p.get("text", "") for p in content if isinstance(p, dict))
                    else:
                        text = ""
                    if text:
                        yield AgentEvent("token", {"messageId": "", "text": text})
            yield AgentEvent("done", {"output": ""})
        except Exception as e:
            yield AgentEvent("error", {"error": str(e)})

    async def _vendor_token(self) -> str:
        if self.token_vendor is None:
            raise RuntimeError("direct mode requires token_vendor")
        result = self.token_vendor()
        if hasattr(result, "__await__"):
            result = await result
        return str(result)
