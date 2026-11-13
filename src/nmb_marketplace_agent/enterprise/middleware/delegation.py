"""Delegation middleware: records every `task`/`start_async_task` call and enforces the budget.

Two responsibilities, one middleware, because both must run *inside* the supervisor graph:

  1. **Enforcement** (raising when `max_delegations` is exceeded). Raising aborts the turn —
     middleware exceptions propagate; LangChain's callback manager would swallow them.

  2. **Audit** (`agent.delegated` / `agent.delegated_async` rows on the tamper-evident chain).
     Best-effort: an audit failure must never fail a run.

Scope:
  - Fires on `task` (sync delegation) and `start_async_task` (async delegation start).
  - Ignores `check_async_task` / `update_async_task` — polling does not consume budget.
  - A single instance is passed to the supervisor AND every subagent so nested `task`
    calls at depth >= 3 share the same per-run counter.
"""
from __future__ import annotations

import logging
from typing import Any

from langchain.agents.middleware import AgentMiddleware

# NOTE: import the *module*, not `from ... import async_session`. Monkeypatching
# `database.async_session` in tests only works if the middleware resolves the name at
# call time from the module object.
from nmb_marketplace_agent.config import database
from nmb_marketplace_agent.enterprise import audit

log = logging.getLogger(__name__)

SYNC_DELEGATION_TOOLS = frozenset({"task"})
ASYNC_DELEGATION_TOOLS = frozenset({"start_async_task"})
DELEGATION_TOOLS = SYNC_DELEGATION_TOOLS | ASYNC_DELEGATION_TOOLS
POLLING_TOOLS = frozenset({"check_async_task", "update_async_task"})

# Default per-run budget. Override per-run via runtime.config.configurable.
DEFAULT_MAX_DELEGATIONS = 2


class DelegationBudgetExceeded(Exception):
    """Raised when a supervisor exceeds its declared delegation budget."""


class DelegationMiddleware(AgentMiddleware):
    """Per-run delegation counter + audit rows. Safe to reuse across concurrent threads."""

    def __init__(self) -> None:
        super().__init__()
        # run_key -> delegation count. run_key is run_id if present, else thread_id, else "anonymous".
        self._counts: dict[str, int] = {}

    # ── hooks ────────────────────────────────────────────────────────
    def wrap_tool_call(self, request, handler):
        # deepagents invokes async everywhere; sync wrapper kept for parity in tests.
        return handler(request)

    async def awrap_tool_call(self, request, handler):
        name = self._tool_name(request)
        if name is None or name in POLLING_TOOLS or name not in DELEGATION_TOOLS:
            return await handler(request)

        config = self._config(request)
        cfgurable = config.get("configurable") or {}
        run_key = self._run_key(config)
        max_delegations = int(cfgurable.get("max_delegations", DEFAULT_MAX_DELEGATIONS))

        used = self._counts.get(run_key, 0)
        if used >= max_delegations:
            raise DelegationBudgetExceeded(
                f"max_delegations={max_delegations} exceeded; escalate to a human."
            )
        self._counts[run_key] = used + 1

        args = self._args(request)
        if name == "task":
            delegate = args.get("subagent_type") or args.get("agent") or "?"
            action = "agent.delegated"
        else:  # start_async_task
            delegate = args.get("agent") or args.get("graph_id") or "?"
            action = "agent.delegated_async"
        description = (args.get("description") or "")[:500]

        tenant_id = cfgurable.get("tenant_id", "default")
        agent_id = cfgurable.get("agent_id", "unknown")
        run_id = cfgurable.get("run_id")

        try:
            # `database.async_session` is resolved at call time so tests that monkeypatch
            # `config.database.async_session` get their isolated session instead of prod.
            async with database.async_session() as s:
                await audit.record(
                    s,
                    tenant_id=tenant_id,
                    actor=agent_id,
                    actor_type="agent",
                    action=action,
                    resource_type="workflow_run" if run_id else "thread",
                    resource_id=run_id or run_key,
                    details={
                        "delegate": delegate,
                        "task": description,
                        "tool": name,
                        "delegation_n": used + 1,
                        "max_delegations": max_delegations,
                    },
                )
                await s.commit()
        except Exception:  # noqa: BLE001 — never fail a run because audit was down
            log.exception("%s audit write failed", action)

        return await handler(request)

    # ── request introspection ────────────────────────────────────────
    @staticmethod
    def _tool_name(request) -> str | None:
        tool = getattr(request, "tool", None)
        if tool is not None and getattr(tool, "name", None):
            return tool.name
        call = getattr(request, "tool_call", None) or {}
        return call.get("name") if isinstance(call, dict) else None

    @staticmethod
    def _args(request) -> dict[str, Any]:
        call = getattr(request, "tool_call", None) or {}
        return (call.get("args") or {}) if isinstance(call, dict) else {}

    @staticmethod
    def _config(request) -> dict:
        runtime = getattr(request, "runtime", None)
        if runtime is not None and getattr(runtime, "config", None):
            return runtime.config
        try:
            from langchain_core.runnables import get_config
            return dict(get_config() or {})
        except Exception:  # noqa: BLE001
            return {}

    @staticmethod
    def _run_key(config: dict) -> str:
        cfgurable = (config or {}).get("configurable") or {}
        return (
            cfgurable.get("run_id")
            or (config or {}).get("metadata", {}).get("thread_id")
            or "anonymous"
        )