"""Langfuse tracing for agent runs (LangChain callback). Enabled whenever a key pair is configured."""
import logging

from nmb_marketplace_agent.integrations import connections

log = logging.getLogger(__name__)
_registered: set[tuple[str, str]] = set()


def credentials() -> dict | None:
    c = connections.get("langfuse")
    return c if c.get("public_key") and c.get("secret_key") else None


def enabled() -> bool:
    return credentials() is not None


def callback_config(metadata: dict | None = None) -> dict:
    """A LangChain `config` dict carrying the Langfuse callback, or {} when tracing is off."""
    creds = credentials()
    if not creds:
        return {}
    try:
        from langfuse import Langfuse
        from langfuse.langchain import CallbackHandler

        key = (creds["host"], creds["public_key"])
        if key not in _registered:
            Langfuse(public_key=creds["public_key"], secret_key=creds["secret_key"], host=creds["host"])
            _registered.add(key)
        meta = {k: v for k, v in (metadata or {}).items() if v is not None}
        return {"callbacks": [CallbackHandler(public_key=creds["public_key"])], "metadata": meta}
    except Exception:
        log.exception("Langfuse tracing could not be set up; continuing untraced.")
        return {}


def attach(graph, metadata: dict):
    """Bind the Langfuse callback + metadata to a compiled graph."""
    cfg = callback_config(metadata)
    return graph.with_config(cfg) if cfg else graph