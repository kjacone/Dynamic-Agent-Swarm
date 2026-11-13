"""Mask function for the Langfuse SDK client.

Applied at every write the SDK performs (LangChain callback, direct observations,
datasets). Reuses the platform's existing `scan_pii` + `redact` primitives so the
tokens you see in Langfuse match the tokens in the audit chain and in model inputs —
same HMAC, same REDACTION_KEY.

Two things this deliberately does NOT do:
  • Redact prompt-injection strings. Those are forensic signal, not PII. Traces
    that show "ignore previous instructions" are useful evidence, not a leak.
  • Rehydrate. The SDK-side token -> value map is intentionally discarded. Traces
    are permanent; the vault lives in-process only, next to the model call.

Kill switch: LANGFUSE_MASKING=off disables the mask entirely (returns data unchanged).
"""
from __future__ import annotations

import logging
import os
from typing import Any

log = logging.getLogger(__name__)

# Cap so a 10 MB document doesn't get scanned twice (once for the trace, once for
# the model). Above this, the string is replaced with a truncated marker.
_MAX_SCAN_CHARS = 32_000


def _enabled() -> bool:
    return os.environ.get("LANGFUSE_MASKING", "on").lower() != "off"


def langfuse_mask(data: Any, **_kwargs: Any) -> Any:
    """Mask PII in any value about to be exported to Langfuse.

    Signature is `(data, **kwargs)` per the Langfuse SDK contract. Must return
    JSON-serializable data. Never raises — a broken mask must not kill tracing.
    """
    if not _enabled():
        return data
    try:
        return _walk(data)
    except Exception:  # noqa: BLE001 — masking must never break tracing
        log.exception("langfuse mask failed; sending unmasked")
        return data


def _walk(value: Any) -> Any:
    if isinstance(value, str):
        if len(value) > _MAX_SCAN_CHARS:
            head = value[:_MAX_SCAN_CHARS]
            tail = f"…[truncated {len(value) - _MAX_SCAN_CHARS} chars from trace]"
            value = head + tail
        from nmb_marketplace_agent.enterprise.guardrails import redact
        return redact(value)
    if isinstance(value, dict):
        return {k: _walk(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_walk(v) for v in value]
    if isinstance(value, tuple):
        return [_walk(v) for v in value]
    return value