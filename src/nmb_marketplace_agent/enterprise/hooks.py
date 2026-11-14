"""Glue between the existing platform and the enterprise layer (all calls are fail-safe)."""
from __future__ import annotations

import asyncio
import hashlib
import logging
import os

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from nmb_marketplace_agent.enterprise import audit
from nmb_marketplace_agent.enterprise.guardrails import PolicyEngine, guard_tools
from nmb_marketplace_agent.enterprise.licensing import current_license
from nmb_marketplace_agent.enterprise.metering import quota_status, record_usage
from nmb_marketplace_agent.enterprise.runtime import load_guards, load_policy

log = logging.getLogger(__name__)
_tasks: set[asyncio.Task] = set()


OUTPUT_BLOCK_MESSAGE = (
    "I can't share that response because it conflicts with this deployment's "
    "data-protection policy. Please rephrase your request or contact support."
)


async def enforce_chat(db: AsyncSession, *, tenant_id: str, agent_id: str, actor: str, message: str,
                       actor_type: str = "api_key", meter: bool = True) -> str:
    """Policy-check an inbound chat message, audit it (hash only, never content), meter it.
    Returns the (possibly redacted) message or raises HTTP 400/429.

    ``meter=False`` screens the text (host-app context attached to the same turn)
    without counting it as another agent run.
    """
    engine = PolicyEngine(await load_policy(db, tenant_id), await load_guards(db, tenant_id))
    dec = engine.check_text(message, "input")
    digest = hashlib.sha256(message.encode()).hexdigest()[:16]
    if dec.blocked:
        await audit.record(db, tenant_id=tenant_id, actor=actor, actor_type=actor_type, action="chat.blocked",
                           resource_type="agent", resource_id=agent_id, outcome="denied",
                           details={"sha256_16": digest, **dec.as_dict()})
        await record_usage(db, tenant_id, "policy_blocks")
        raise HTTPException(400, "Message blocked by policy: " + "; ".join(dec.reasons))
    q = await quota_status(db, tenant_id)
    if q.get("agent_runs", {}).get("exceeded") and os.environ.get("QUOTA_HARD_STOP", "false") == "true":
        raise HTTPException(429, "Monthly agent-run quota exceeded")
    if meter:
        await audit.record(db, tenant_id=tenant_id, actor=actor, actor_type=actor_type, action="chat.request",
                           resource_type="agent", resource_id=agent_id,
                           details={"sha256_16": digest, "chars": len(message), "pii_kinds": sorted({f.kind for f in dec.findings})})
        await record_usage(db, tenant_id, "agent_runs", agent=agent_id)
    return dec.text if dec.text is not None else message


def _output_details(text: str, dec) -> dict:
    return {"sha256_16": hashlib.sha256(text.encode()).hexdigest()[:16],
            "rule_ids": dec.rule_ids, "kinds": sorted({f.kind for f in dec.findings})}


async def _write_output_event(db: AsyncSession, *, tenant_id: str, agent_id: str, actor: str,
                              actor_type: str, action: str, text: str, dec) -> None:
    await audit.record(db, tenant_id=tenant_id, actor=actor, actor_type=actor_type, action=action,
                       resource_type="agent", resource_id=agent_id,
                       outcome="denied" if action.endswith("blocked") else "success",
                       details=_output_details(text, dec))
    if action.endswith("blocked"):
        await record_usage(db, tenant_id, "policy_blocks")


async def audit_output(*, tenant_id: str, agent_id: str, actor: str, actor_type: str,
                       action: str, text: str, dec) -> None:
    """Record an output-side decision on a fresh session (safe inside an SSE generator)."""
    from nmb_marketplace_agent.config.database import async_session
    async with async_session() as db:
        await _write_output_event(db, tenant_id=tenant_id, agent_id=agent_id, actor=actor,
                                  actor_type=actor_type, action=action, text=text, dec=dec)


async def enforce_output(db: AsyncSession, *, tenant_id: str, agent_id: str, actor: str,
                         actor_type: str = "api_key", text: str) -> tuple[str, bool]:
    """Screen a completed reply. Returns ``(safe_text, blocked)``.

    A block is replaced with a fixed refusal (the reasons are not echoed back to
    the end user); redactions are audited with hashes and kinds only.
    """
    engine = PolicyEngine(await load_policy(db, tenant_id))
    dec = engine.check_text(text, "output")
    if dec.blocked:
        await _write_output_event(db, tenant_id=tenant_id, agent_id=agent_id, actor=actor,
                                  actor_type=actor_type, action="chat.output_blocked", text=text, dec=dec)
        return OUTPUT_BLOCK_MESSAGE, True
    out = dec.text if dec.text is not None else text
    if out != text:
        await _write_output_event(db, tenant_id=tenant_id, agent_id=agent_id, actor=actor,
                                  actor_type=actor_type, action="chat.output_redacted", text=text, dec=dec)
    return out, False


async def guard_agent_tools(tools: list, tenant_id: str, agent_id: str) -> list:
    """Called from graph_factory: wrap every tool with policy checks + audit. Fail closed."""
    if os.environ.get("ENTERPRISE_GUARDRAILS", "on").lower() == "off" or not current_license().has_module("guardrails"):
        return tools
    from nmb_marketplace_agent.config.database import async_session
    async with async_session() as db:
        engine = PolicyEngine(await load_policy(db, tenant_id), await load_guards(db, tenant_id))

    def emit(kind: str, payload: dict):
        async def _w():
            try:
                async with async_session() as s:
                    await audit.record(s, tenant_id=tenant_id, actor=agent_id or "agent", actor_type="agent", action=kind,
                                       resource_type="tool", resource_id=str(payload.get("tool", "")),
                                       outcome="denied" if "blocked" in kind or "rejected" in kind else "success",
                                       details={k: v for k, v in payload.items() if k not in ("tenant_id",)})
                    if kind == "tool.call":
                        await record_usage(s, tenant_id, "tool_calls", tool=payload.get("tool"))
            except Exception:  # noqa: BLE001
                log.exception("audit emit failed")
        try:
            t = asyncio.get_running_loop().create_task(_w())
            _tasks.add(t)
            t.add_done_callback(_tasks.discard)
        except RuntimeError:
            pass

    return guard_tools(tools, engine, tenant_id=tenant_id, agent_id=agent_id, on_event=emit)
