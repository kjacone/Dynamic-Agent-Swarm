"""Connection settings for the services the platform talks to.

Values come from, in order: data/connections.json (edited in the dashboard) -> environment -> default.
The file is also read by the LangGraph server process, so a Langfuse connection saved in the
dashboard takes effect for agent tracing without restarting anything.
"""
import json
import os
from pathlib import Path
from typing import Any

# field -> (ENV_NAME, default)
SERVICES: dict[str, dict[str, tuple[str, str | None]]] = {
    "langfuse": {
        "host": ("LANGFUSE_HOST", "http://localhost:3000"),
        "public_url": ("LANGFUSE_PUBLIC_URL", None),  # browser-facing URL if different from host
        "public_key": ("LANGFUSE_PUBLIC_KEY", None),
        "secret_key": ("LANGFUSE_SECRET_KEY", None),
    },
    "ollama": {"url": ("OLLAMA_URL", "http://127.0.0.1:11434")},
    "vllm": {"url": ("VLLM_URL", None)},
    "litellm": {"url": ("LITELLM_URL", None), "api_key": ("LITELLM_API_KEY", None)},
    "langgraph": {"url": ("LANGGRAPH_URL", "http://127.0.0.1:2024")},
}
SECRET_FIELDS = {"secret_key", "api_key"}


def _path() -> Path:
    return Path(os.environ.get("CONNECTIONS_FILE", "data/connections.json"))


def _read() -> dict[str, dict[str, str]]:
    try:
        return json.loads(_path().read_text())
    except (OSError, ValueError):
        return {}


def get(name: str) -> dict[str, Any]:
    if name not in SERVICES:
        raise KeyError(name)
    saved = _read().get(name, {})
    out: dict[str, Any] = {}
    for field, (env, default) in SERVICES[name].items():
        out[field] = saved.get(field) or os.environ.get(env) or default
    return out


def save(name: str, values: dict[str, Any]) -> None:
    """Merge values into the saved file. An empty string removes the override."""
    if name not in SERVICES:
        raise KeyError(name)
    data = _read()
    cur = data.setdefault(name, {})
    for field, val in values.items():
        if field not in SERVICES[name] or val is None:
            continue
        if isinstance(val, str) and not val.strip():
            cur.pop(field, None)
        else:
            cur[field] = str(val).strip()
    p = _path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, indent=2))
    try:
        p.chmod(0o600)  # may hold secrets
    except OSError:
        pass


def masked(name: str) -> dict[str, Any]:
    """Values safe to show in the browser: secrets become a flag plus the last 4 characters."""
    out: dict[str, Any] = {}
    for field, val in get(name).items():
        if field in SECRET_FIELDS:
            out[f"{field}_set"] = bool(val)
            out[field] = f"••••{val[-4:]}" if val else ""
        else:
            out[field] = val or ""
    return out