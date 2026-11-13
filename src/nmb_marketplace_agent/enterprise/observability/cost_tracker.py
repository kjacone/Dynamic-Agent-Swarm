"""Per-invocation token accounting for an in-process supervisor run.

Attach as a LangChain callback on `graph.ainvoke`. `on_llm_end` fires once per chat-model
API call across the *whole callback tree* — supervisor and every subagent nested inside a
`task` tool. This is the only accounting path that survives deepagents#6555 (which discards
subagent `usage_metadata` at the `task` boundary) because it bypasses agent state entirely.

Buffers usage in memory and flushes once after the run.
"""
from __future__ import annotations

import logging
from collections import defaultdict
from typing import Any

from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.outputs import LLMResult

from nmb_marketplace_agent.enterprise.observability import pricing

log = logging.getLogger(__name__)


class CostTracker(BaseCallbackHandler):
    """Accumulate token usage and USD cost across an agent invocation."""

    def __init__(self, *, tenant_id: str, run_id: str, step_id: str) -> None:
        self.tenant_id = tenant_id
        self.run_id = run_id
        self.step_id = step_id
        self._totals: dict[str, dict[str, int]] = defaultdict(
            lambda: {"input": 0, "output": 0, "cache_read": 0, "cache_creation": 0, "calls": 0}
        )

    def on_llm_end(self, response: LLMResult, **kwargs: Any) -> None:
        try:
            gens = response.generations or []
            if not gens or not gens[0]:
                return
            gen = gens[0][0]
            msg = getattr(gen, "message", None)
            usage = getattr(msg, "usage_metadata", None) if msg else None
            if not usage:
                return
            meta = getattr(msg, "response_metadata", {}) or {}
            model = meta.get("model_name") or meta.get("model") or "unknown"
            bucket = self._totals[model]
            bucket["input"] += int(usage.get("input_tokens") or 0)
            bucket["output"] += int(usage.get("output_tokens") or 0)
            details = usage.get("input_token_details") or {}
            bucket["cache_read"] += int(details.get("cache_read") or 0)
            bucket["cache_creation"] += int(details.get("cache_creation") or 0)
            bucket["calls"] += 1
        except Exception:  # noqa: BLE001
            log.exception("cost tracker: on_llm_end failed")

    def usd(self) -> float:
        """Total USD spent across all model calls seen so far."""
        total = 0.0
        for model, t in self._totals.items():
            total += pricing.usd(
                model,
                input_tokens=t["input"],
                output_tokens=t["output"],
                cache_read=t["cache_read"],
                cache_creation=t["cache_creation"],
            )
        return total

    async def flush(self, db) -> None:
        """Write one `llm_tokens` metering row per model into the workflow engine's session."""
        from nmb_marketplace_agent.enterprise import metering

        for model, t in self._totals.items():
            if t["calls"] == 0:
                continue
            try:
                await metering.record_usage(
                    db,
                    self.tenant_id,
                    "llm_tokens",
                    model=model,
                    run_id=self.run_id,
                    step_id=self.step_id,
                    input_tokens=t["input"],
                    output_tokens=t["output"],
                    cache_read=t["cache_read"],
                    cache_creation=t["cache_creation"],
                    calls=t["calls"],
                    usd=pricing.usd(
                        model,
                        input_tokens=t["input"],
                        output_tokens=t["output"],
                        cache_read=t["cache_read"],
                        cache_creation=t["cache_creation"],
                    ),
                )
            except Exception:  # noqa: BLE001 — metering must not fail a completed step
                log.exception("cost tracker: flush failed for model %s", model)