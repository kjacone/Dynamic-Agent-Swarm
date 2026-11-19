"""Bring-your-own API keys set from the dashboard.

Keys saved here take precedence over the server's environment, so a bank can
run the console with its own provider accounts without editing .env or
restarting. Values are encrypted at rest with the field keyring when
``NMB_ENCRYPTION_KEY`` is configured; otherwise they are stored as-is in a
0600 file (development default, same as connections.json).

The file is read on every lookup, so saving a key takes effect immediately for
the API process and for agents served from the same working directory.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from nmb_marketplace_agent import crypto

log = logging.getLogger(__name__)

FILE_ENV = "PROVIDER_KEYS_FILE"

# Everything the console can ask for. Only these names may be written; the
# runtime still resolves any env name (ModelConfig.api_key_env is free-form).
CATALOG: tuple[dict[str, Any], ...] = (
    {
        "env": "OPENAI_API_KEY", "label": "OpenAI", "secret": True,
        "what": "GPT chat models, openai:* embedding models and gpt-image generation.",
        "docs": "https://platform.openai.com/api-keys",
        "pages": ["models", "training", "knowledge"],
    },
    {
        "env": "ANTHROPIC_API_KEY", "label": "Anthropic", "secret": True,
        "what": "Claude models (native provider).",
        "docs": "https://console.anthropic.com/settings/keys",
        "pages": ["models"],
    },
    {
        "env": "GOOGLE_API_KEY", "label": "Google Gemini", "secret": True,
        "what": "Gemini models, including the free AI Studio tier.",
        "docs": "https://aistudio.google.com/apikey",
        "pages": ["models"],
    },
    {
        "env": "GROQ_API_KEY", "label": "Groq", "secret": True,
        "what": "Very fast inference on open-weights models.",
        "docs": "https://console.groq.com/keys",
        "pages": ["models"],
    },
    {
        "env": "OPENROUTER_API_KEY", "label": "OpenRouter", "secret": True,
        "what": "One API across many hosted and free models.",
        "docs": "https://openrouter.ai/keys",
        "pages": ["models"],
    },
    {
        "env": "LITELLM_API_KEY", "label": "LiteLLM gateway", "secret": True,
        "what": "Key for a bank-run LiteLLM gateway (URL is set in Connections).",
        "docs": "https://docs.litellm.ai/docs/proxy/virtual_keys",
        "pages": ["models"],
    },
    {
        "env": "EMBEDDINGS_API_KEY", "label": "Embedding server", "secret": True,
        "what": "Key for a private OpenAI-compatible embedding server (used when EMBEDDINGS_BASE_URL is set).",
        "docs": None,
        "pages": ["knowledge"],
    },
    {
        "env": "CEREBRAS_API_KEY", "label": "Cerebras", "secret": True,
        "what": "Fast hosted inference, and the provider check in Training.",
        "docs": "https://cloud.cerebras.ai/",
        "pages": ["models", "training"],
    },
    {
        "env": "HF_TOKEN", "label": "Hugging Face", "secret": True,
        "what": "Gated datasets, base models and FLUX / LTX inference.",
        "docs": "https://huggingface.co/settings/tokens",
        "pages": ["training"],
    },
    {
        "env": "KAGGLE_USERNAME", "label": "Kaggle username", "secret": False,
        "what": "Together with the key, enables Kaggle API searches and downloads.",
        "docs": "https://www.kaggle.com/settings/account",
        "pages": ["training"],
    },
    {
        "env": "KAGGLE_KEY", "label": "Kaggle API key", "secret": True,
        "what": "Kaggle API token paired with the username.",
        "docs": "https://www.kaggle.com/settings/account",
        "pages": ["training"],
    },
    {
        "env": "ELEVENLABS_API_KEY", "label": "ElevenLabs", "secret": True,
        "what": "Voices for the Localisation lab, the Voice line and the agent-kit phone component.",
        "docs": "https://elevenlabs.io/app/settings/api-keys",
        "pages": ["locale", "voice"],
    },
    {
        "env": "ROBOFLOW_API_KEY", "label": "Roboflow", "secret": True,
        "what": "Search Roboflow Universe vision datasets.",
        "docs": "https://app.roboflow.com/settings/api",
        "pages": ["training"],
    },
)

_BY_ENV = {item["env"]: item for item in CATALOG}


def _path() -> Path:
    return Path(os.environ.get(FILE_ENV, "data/provider_keys.json"))


def _read() -> dict[str, Any]:
    try:
        data = json.loads(_path().read_text())
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _write(data: dict[str, Any]) -> None:
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, sort_keys=True))
    os.replace(tmp, path)
    try:
        path.chmod(0o600)  # may hold secrets
    except OSError:
        pass


def _aad(env: str) -> str:
    return f"provider_keys.{env}"


def _stored(env: str, entry: Any) -> str | None:
    if not isinstance(entry, dict):
        return None
    raw = entry.get("value")
    if not isinstance(raw, str) or not raw:
        return None
    try:
        return crypto.decrypt(raw, aad=_aad(env))
    except (crypto.EncryptionKeyMissing, crypto.DecryptionError) as e:
        log.warning("Provider key %s is stored but unreadable: %s", env, e)
        return None


def get(env: str, default: str | None = None) -> str | None:
    """Dashboard value first, then the process environment."""
    name = (env or "").strip()
    if not name:
        return default
    value = _stored(name, _read().get(name))
    if value:
        return value
    return os.environ.get(name, "").strip() or default


def source(env: str) -> str | None:
    if _stored(env, _read().get(env)):
        return "dashboard"
    return "environment" if os.environ.get(env, "").strip() else None


def set_value(env: str, value: str) -> dict[str, Any]:
    name = (env or "").strip()
    if name not in _BY_ENV:
        raise KeyError(name)
    text = (value or "").strip()
    if not text:
        raise ValueError("Paste the key value first.")
    if len(text) > 512 or any(c.isspace() for c in text):
        raise ValueError("That does not look like an API key (no spaces, under 512 characters).")
    data = _read()
    data[name] = {
        "value": crypto.encrypt(text, aad=_aad(name)),
        "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    _write(data)
    return view(name)


def clear_value(env: str) -> dict[str, Any]:
    name = (env or "").strip()
    if name not in _BY_ENV:
        raise KeyError(name)
    data = _read()
    if data.pop(name, None) is not None:
        _write(data)
    return view(name)


def encryption_enabled() -> bool:
    return crypto.keyring().primary is not None


def view(env: str) -> dict[str, Any]:
    item = _BY_ENV[env]
    entry = _read().get(env)
    stored = _stored(env, entry)
    env_value = os.environ.get(env, "").strip()
    value = stored or env_value
    masked = ""
    if value:
        masked = f"••••{value[-4:]}" if item["secret"] else value
    return {
        **{k: item[k] for k in ("env", "label", "secret", "what", "docs", "pages")},
        "source": "dashboard" if stored else ("environment" if env_value else None),
        "masked": masked,
        "updated_at": entry.get("updated_at") if stored and isinstance(entry, dict) else None,
    }


def catalog_view() -> list[dict[str, Any]]:
    return [view(item["env"]) for item in CATALOG]
