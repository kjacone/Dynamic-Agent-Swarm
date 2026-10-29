"""Resolve an agent's system prompt. A value like "langfuse:support-bot:production" (or
"langfuse:support-bot@3") is fetched from the Langfuse prompt registry; anything else is used as-is."""
import logging
import time

from nmb_marketplace_agent.config.settings import settings
from nmb_marketplace_agent.integrations import langfuse as lf

log = logging.getLogger(__name__)
_cache: dict[str, tuple[float, str]] = {}


def is_ref(value: str | None) -> bool:
    return isinstance(value, str) and value.startswith("langfuse:")


def parse_ref(value: str) -> tuple[str, str | None, int | None]:
    rest = value.removeprefix("langfuse:").strip()
    if "@" in rest:
        name, v = rest.split("@", 1)
        return name, None, int(v)
    if ":" in rest:
        name, label = rest.split(":", 1)
        return name, label or None, None
    return rest, "production", None


def prompt_text(p: dict) -> str:
    body = p.get("prompt")
    if isinstance(body, str):
        return body
    msgs = body or []
    system = [m.get("content", "") for m in msgs if m.get("role") == "system"]
    return "\n\n".join(system or [m.get("content", "") for m in msgs])


async def resolve_system_prompt(value: str | None, fallback: str) -> str:
    if not value:
        return fallback
    if not is_ref(value):
        return value
    now = time.time()
    hit = _cache.get(value)
    if hit and now - hit[0] < settings.prompt_cache_ttl:
        return hit[1]
    try:
        client = lf.client()
        if not client:
            raise lf.LangfuseError("Langfuse is not connected")
        name, label, version = parse_ref(value)
        text = prompt_text(await client.prompt(name, label=label, version=version))
        _cache[value] = (now, text)
        return text
    except Exception as e:
        log.warning("Could not load %s from Langfuse (%s); using %s", value, e,
                    "cached copy" if hit else "fallback prompt")
        return hit[1] if hit else fallback