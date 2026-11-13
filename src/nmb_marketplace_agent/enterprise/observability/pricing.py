"""Model pricing table for cost tracking and budget enforcement.

Prices are USD per 1,000,000 tokens. Cloud providers' published rates as of Jan 2026.
Local models (ollama, vllm, litellm with local backends) are $0 to the customer.

To override or add models: set ``NMB_PRICING_FILE`` to a JSON file with the same
structure as ``PRICES`` — its entries are merged over the defaults.
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path

log = logging.getLogger(__name__)


# USD per 1M tokens. Keep in sync with the customer's actual invoice — this table is
# what governance shows to compliance, so it must not silently drift from reality.
PRICES: dict[str, dict[str, float]] = {
    # OpenAI
    "gpt-4o": {"input": 2.50, "output": 10.00, "cache_read": 1.25},
    "gpt-4o-mini": {"input": 0.15, "output": 0.60, "cache_read": 0.075},
    "gpt-4.1": {"input": 2.00, "output": 8.00},
    "gpt-4.1-mini": {"input": 0.40, "output": 1.60},
    "gpt-4.1-nano": {"input": 0.10, "output": 0.40},
    "o1": {"input": 15.00, "output": 60.00, "cache_read": 7.50},
    "o1-mini": {"input": 1.10, "output": 4.40},
    "o3-mini": {"input": 1.10, "output": 4.40},
    # Anthropic
    "claude-3-5-sonnet": {"input": 3.00, "output": 15.00, "cache_read": 0.30, "cache_creation": 3.75},
    "claude-3-5-haiku": {"input": 0.80, "output": 4.00, "cache_read": 0.08, "cache_creation": 1.00},
    "claude-3-7-sonnet": {"input": 3.00, "output": 15.00, "cache_read": 0.30, "cache_creation": 3.75},
    "claude-opus-4": {"input": 15.00, "output": 75.00, "cache_read": 1.50, "cache_creation": 18.75},
    "claude-sonnet-4": {"input": 3.00, "output": 15.00, "cache_read": 0.30, "cache_creation": 3.75},
    # Google
    "gemini-1.5-pro": {"input": 1.25, "output": 5.00},
    "gemini-1.5-flash": {"input": 0.075, "output": 0.30},
    "gemini-2.0-flash": {"input": 0.10, "output": 0.40},
    "gemini-2.5-pro": {"input": 1.25, "output": 10.00},
    "gemini-2.5-flash": {"input": 0.30, "output": 2.50},
    # Local / self-hosted — cost to the customer is 0 (they pay for the hardware)
    "llama3.1": {"input": 0.0, "output": 0.0},
    "llama3.2": {"input": 0.0, "output": 0.0},
    "qwen2.5": {"input": 0.0, "output": 0.0},
}

_FALLBACK: dict[str, float] = {"input": 0.0, "output": 0.0}


def _load_overrides() -> dict[str, dict[str, float]]:
    path = os.environ.get("NMB_PRICING_FILE", "")
    if not path:
        return {}
    p = Path(path)
    if not p.exists():
        log.warning("NMB_PRICING_FILE points to missing file: %s", path)
        return {}
    try:
        data = json.loads(p.read_text())
        if not isinstance(data, dict):
            log.warning("NMB_PRICING_FILE must contain a JSON object")
            return {}
        return {k: v for k, v in data.items() if isinstance(v, dict)}
    except (ValueError, OSError) as e:
        log.warning("Could not load NMB_PRICING_FILE: %s", e)
        return {}


_OVERRIDES = _load_overrides()


def _strip_provider(model: str) -> str:
    """`openai:gpt-4o-mini` → `gpt-4o-mini`. `ollama:llama3.1:8b` → `llama3.1`."""
    if ":" not in model:
        return model
    provider, _, rest = model.partition(":")
    if provider in {"openai", "anthropic", "google_genai", "google", "azure_openai", "ollama", "vllm", "litellm"}:
        # ollama:llama3.1:8b → keep the middle, drop the tag
        if provider == "ollama" and ":" in rest:
            return rest.split(":", 1)[0]
        return rest
    return model


def price_for(model: str) -> dict[str, float]:
    """Return the per-1M-token price card for a model. Missing entries cost $0.

    Lookup order: exact model → exact stripped model → prefix match on stripped name.
    """
    for table in (_OVERRIDES, PRICES):
        if model in table:
            return table[model]
        stripped = _strip_provider(model)
        if stripped in table:
            return table[stripped]
        # Prefix match: "gpt-4o-2024-08-06" → "gpt-4o"
        for key, card in table.items():
            if stripped.startswith(key) or key.startswith(stripped):
                return card
    return _FALLBACK


def usd(
    model: str,
    input_tokens: int = 0,
    output_tokens: int = 0,
    cache_read: int = 0,
    cache_creation: int = 0,
) -> float:
    """Cost of one model call in USD, given the token breakdown."""
    p = price_for(model)
    return (
        input_tokens * p.get("input", 0.0) / 1_000_000
        + output_tokens * p.get("output", 0.0) / 1_000_000
        + cache_read * p.get("cache_read", 0.0) / 1_000_000
        + cache_creation * p.get("cache_creation", 0.0) / 1_000_000
    )