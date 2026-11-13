"""Langfuse tracing for agent runs (LangChain callback). Enabled whenever a key pair is configured."""
import logging

from nmb_marketplace_agent.integrations import connections
from nmb_marketplace_agent.integrations.langfuse_mask import langfuse_mask

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
            # `mask=` is applied to every input/output/metadata the SDK exports,
            # including the LangChain callback's spans. Tokens produced by the mask
            # are the same as those produced by the platform's guardrails — same
            # HMAC, same REDACTION_KEY — so correlation across audit/Langfuse is
            # possible without rehydration.
            Langfuse(
                public_key=creds["public_key"],
                secret_key=creds["secret_key"],
                host=creds["host"],
                mask=langfuse_mask,
            )
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