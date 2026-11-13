"""Delegation middleware: records every delegation and enforces delegation + cost budgets."""
from __future__ import annotations

import logging
from typing import Any

from langchain.agents.middleware import AgentMiddleware

from nmb_marketplace_agent.enterprise import audit
from nmb_marketplace_agent.enterprise.observability import pricing

log = logging.getLogger(__name__)

SYNC_DELEGATION_TOOLS = frozenset({"task"})
ASYNC_DELEGATION_TOOLS = frozenset({"start_async_task"})
DELEGATION_TOOLS = SYNC_DELEGATION_TOOLS | ASYNC_DELEGATION_TOOLS
POLLING_TOOLS = frozenset({"check_async_task", "update_async_task"})

DEFAULT_MAX_DELEGATIONS = 8


class DelegationBudgetExceeded(Exception):
    """Raised when a supervisor exceeds its declared delegation budget."""


class CostBudgetExceeded(Exception):
    """Raised when a supervisor exceeds its declared cost budget (USD)."""


class DelegationMiddleware(AgentMiddleware):
    """Per-run delegation counter, cost accumulator, and audit emitter."""

    def __init__(self) -> None:
        super().__init__()
        self._counts: dict[str, int] = {}
        self._cost_usd: dict[str, float] = {}

    # ── model-call accounting ────────────────────────────────────────
    def wrap_model_call(self, request, handler):
        response = handler(request)
        self._account_usage(request, response)
        return response

    async def awrap_model_call(self, request, handler):
        response = await handler(request)
        self._account_usage(request, response)
        return response

    def _account_usage(self, request, response) -> None:
        try:
            run_key = self._run_key(self._config(request))
            cost = self._cost_from_response(response)
            if cost > 0:
                self._cost_usd[run_key] = self._cost_usd.get(run_key, 0.0) + cost
        except Exception:  # noqa: BLE001
            log.exception("cost accounting failed")

    @staticmethod
    def _cost_from_response(response) -> float:
        messages = (
            getattr(response, "result", None)
            or getattr(response, "messages", None)
            or []
        )
        total = 0.0
        for m in messages:
            usage = getattr(m, "usage_metadata", None)
            if not usage:
                continue
            meta = getattr(m, "response_metadata", {}) or {}
            model = meta.get("model_name") or meta.get("model") or "unknown"
            details = usage.get("input_token_details") or {}
            total += pricing.usd(
                model,
                input_tokens=int(usage.get("input_tokens") or 0),
                output_tokens=int(usage.get("output_tokens") or 0),
                cache_read=int(details.get("cache_read") or 0),
                cache_creation=int(details.get("cache_creation") or 0),
            )
        return total

    # ── tool-call enforcement ────────────────────────────────────────
    def wrap_tool_call(self, request, handler):
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

        max_cost = cfgurable.get("max_cost_usd")
        if max_cost is not None:
            spent = self._cost_usd.get(run_key, 0.0)
            if spent > float(max_cost):
                raise CostBudgetExceeded(
                    f"max_cost_usd={max_cost} exceeded (spent ${spent:.4f}); "
                    f"escalate to a human."
                )

        self._counts[run_key] = used + 1

        args = self._args(request)
        if name == "task":
            delegate = args.get("subagent_type") or args.get("agent") or "?"
            action = "agent.delegated"
        else:
            delegate = args.get("agent") or args.get("graph_id") or "?"
            action = "agent.delegated_async"
        description = (args.get("description") or "")[:500]

        tenant_id = cfgurable.get("tenant_id", "default")
        agent_id = cfgurable.get("agent_id", "unknown")
        run_id = cfgurable.get("run_id")

        # Lazy import so the test fixture's monkeypatch on database.async_session
        # is picked up. A module-level `from ... import async_session` binds the
        # reference at import time and bypasses the patch.
        try:
            from nmb_marketplace_agent.config.database import async_session
            async with async_session() as s:
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
                        "usd_so_far": round(self._cost_usd.get(run_key, 0.0), 6),
                    },
                )
        except Exception:  # noqa: BLE001
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