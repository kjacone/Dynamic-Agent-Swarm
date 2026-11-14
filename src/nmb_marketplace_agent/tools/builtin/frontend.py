"""Browser-executed tools.

The tool is declared server-side so the model can select it, but it runs in the
host page (agent-kit `useAgentTool`). The graph pauses with the same headless
interrupt payload the kit understands; the gateway forwards it to the browser
and resumes the run with the handler's result.
"""
from __future__ import annotations

from typing import Annotated, Any

from langchain_core.tools import InjectedToolCallId, StructuredTool
from langgraph.types import interrupt
from pydantic import Field, create_model

_PY_TYPES = {
    "string": str,
    "integer": int,
    "number": float,
    "boolean": bool,
    "array": list,
    "object": dict,
}


def _args_model(name: str, parameters: dict | None):
    """Pydantic schema for the tool args plus the runtime-injected tool call id."""
    if not isinstance(parameters, dict):
        parameters = {}
    props = parameters.get("properties") or {}
    required = set(parameters.get("required") or [])
    fields: dict[str, Any] = {}
    for key, spec in props.items():
        spec = spec if isinstance(spec, dict) else {}
        typ = _PY_TYPES.get(str(spec.get("type", "")), Any)
        desc = str(spec.get("description") or "")
        # Models often spell an unset argument as an explicit null, so optional
        # properties must accept None as well as their declared type.
        fields[key] = ((typ, Field(..., description=desc)) if key in required
                       else (typ | None, Field(default=None, description=desc)))
    fields["tool_call_id"] = (Annotated[str, InjectedToolCallId],
                              Field(description="Injected by the runtime."))
    safe = "".join(ch if ch.isalnum() else "_" for ch in name) or "frontend"
    return create_model(f"{safe}_args", **fields)


def make_frontend_tool(name: str, description: str = "", parameters: dict | None = None) -> StructuredTool:
    """Build a tool that pauses the graph and asks the browser for the result."""

    async def call(tool_call_id: Annotated[str, InjectedToolCallId], **kwargs: Any):
        args = {k: v for k, v in kwargs.items() if v is not None}
        reply = interrupt({"type": "tool", "tool_call": {"id": tool_call_id, "name": name, "args": args}})
        # agent-kit resumes with {tool_call_id: result} (or the bare result when
        # it cannot know the id).
        if isinstance(reply, dict):
            return reply.get(tool_call_id, reply)
        return reply

    return StructuredTool(
        name=name,
        description=description or name,
        args_schema=_args_model(name, parameters),
        coroutine=call,
        metadata={"frontend": True, "policy_direction": "document"},
    )
