"""Resolve a model reference to a LangChain chat model.

A ref is, in order of precedence: a registered ModelConfig id, a ModelConfig
display name in the caller's tenant, a ``provider:model`` string, or
``sample:label``. Providers live in the table below, so adding a hosted API or
a self-hosted OpenAI-compatible gateway is configuration, not code.
"""
import os
from dataclasses import dataclass

from langchain.chat_models import init_chat_model
from sqlmodel import select

from nmb_marketplace_agent.config.database import async_session
from nmb_marketplace_agent.config.models import ModelConfig
from nmb_marketplace_agent.llm.sample import SampleChatModel


@dataclass(frozen=True)
class Provider:
    client: str                      # provider name understood by init_chat_model
    label: str
    base_url: str | None = None      # default endpoint; ModelConfig.base_url wins
    api_key_envs: tuple[str, ...] = ()
    local: bool = False              # no key required, "not-needed" is sent
    hint: str = ""                   # example model name for the dashboard form


# Everything that speaks the OpenAI wire format reuses the openai client with
# its own base_url: Groq, OpenRouter, LiteLLM, vLLM and bank LLM gateways.
PROVIDERS: dict[str, Provider] = {
    "openai": Provider("openai", "OpenAI", api_key_envs=("OPENAI_API_KEY",), hint="gpt-4o-mini"),
    "groq": Provider("openai", "Groq", "https://api.groq.com/openai/v1",
                     ("GROQ_API_KEY",), hint="openai/gpt-oss-120b"),
    "openrouter": Provider("openai", "OpenRouter", "https://openrouter.ai/api/v1",
                           ("OPENROUTER_API_KEY",), hint="openai/gpt-oss-120b"),
    "litellm": Provider("openai", "LiteLLM gateway", None,
                        ("LITELLM_API_KEY", "LITELLM_MASTER_KEY"), local=True,
                        hint="groq/openai/gpt-oss-120b"),
    "openai_compatible": Provider("openai", "OpenAI-compatible server", None, (), local=True,
                                  hint="model name as served"),
    "vllm": Provider("openai", "vLLM", None, (), local=True),
    "ollama": Provider("ollama", "Ollama", None, (), local=True, hint="llama3.1:8b"),
    "anthropic": Provider("anthropic", "Anthropic", api_key_envs=("ANTHROPIC_API_KEY",),
                          hint="claude-3-5-sonnet-latest"),
    "google_genai": Provider("google_genai", "Google Gemini",
                             api_key_envs=("GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"),
                             hint="gemini-2.0-flash"),
    "sample": Provider("sample", "Sample (canned demo responses)", None, (), local=True, hint="demo"),
}

_ALIASES = {
    "openai-compatible": "openai_compatible",
    "openai_compatible": "openai_compatible",
    "open_router": "openrouter",
    "open-router": "openrouter",
    "google": "google_genai",
    "gemini": "google_genai",
    "lite_llm": "litellm",
}

SUPPORTED_PROVIDERS = tuple(PROVIDERS)


def normalise_provider(provider: str | None) -> str:
    p = (provider or "openai").strip().lower().replace("-", "_")
    p = _ALIASES.get(p, p)
    if p not in PROVIDERS:
        raise ValueError(
            f"Unknown provider {provider!r}; use one of: {', '.join(PROVIDERS)}"
        )
    return p


def _connection_url(name: str) -> str:
    try:
        from nmb_marketplace_agent.integrations import connections

        return (connections.get(name) or {}).get("url") or ""
    except Exception:  # noqa: BLE001 - connections are optional
        return ""


def _base_url(cfg: ModelConfig, spec: Provider, provider: str) -> str | None:
    url = (cfg.base_url or spec.base_url or "").strip()
    if not url and provider in ("litellm", "vllm"):
        url = _connection_url(provider)
    # Users often paste the full endpoint; the OpenAI client appends the path.
    if url.endswith("/chat/completions"):
        url = url[: -len("/chat/completions")]
    # A bare LiteLLM/vLLM host serves both /v1 and root; keep the /v1 shape the
    # rest of the platform (and the runtime catalog) uses.
    if provider in ("litellm", "vllm") and url and url.rstrip("/").count("/") == 2:
        url = url.rstrip("/") + "/v1"
    return url.rstrip("/") or None


def _api_key(cfg: ModelConfig, spec: Provider, base_url: str | None) -> str:
    if cfg.api_key_env:
        env = cfg.api_key_env.strip()
        val = os.environ.get(env)
        if not val:
            raise ValueError(f"Env var {env} is not set on the server (model {cfg.name!r})")
        return val
    for env in spec.api_key_envs:
        val = os.environ.get(env)
        if val:
            return val
    if base_url or spec.local:
        return "not-needed"
    raise ValueError(
        f"Model {cfg.name!r} ({cfg.provider}) needs "
        f"{' or '.join(spec.api_key_envs) or 'an API key'} in the server environment"
    )


def build_model(cfg: ModelConfig):
    provider = normalise_provider(cfg.provider)
    spec = PROVIDERS[provider]
    if spec.client == "sample":
        return SampleChatModel(label=cfg.model_name or cfg.name)

    model_name = (cfg.model_name or "").strip()
    if not model_name:
        raise ValueError(f"Model {cfg.name!r} has no model_name")

    kw = dict(cfg.params or {})
    base_url = _base_url(cfg, spec, provider)
    if provider in ("litellm", "vllm", "openai_compatible") and not base_url:
        raise ValueError(
            f"{spec.label} needs a base URL: set it on the model"
            + (" or in LITELLM_URL / VLLM_URL." if provider != "openai_compatible" else ".")
        )
    if base_url:
        kw["base_url"] = base_url

    if spec.client == "openai":
        kw["api_key"] = _api_key(cfg, spec, base_url)
        kw.setdefault("timeout", 180)
        if base_url and "openrouter.ai" in base_url:
            headers = dict(kw.get("default_headers") or {})
            headers.setdefault("HTTP-Referer", os.environ.get("OPENROUTER_SITE_URL", "https://nmb.local"))
            headers.setdefault("X-Title", os.environ.get("OPENROUTER_APP_NAME", "NMB Marketplace Agent"))
            kw["default_headers"] = headers

    try:
        return init_chat_model(model_name, model_provider=spec.client, **kw)
    except Exception as e:  # noqa: BLE001 - surface the provider's own message
        raise ValueError(
            f"Cannot build model {cfg.name!r} ({provider}:{model_name}): {e}"
        ) from e


async def _lookup(ref: str, tenant_id: str | None) -> ModelConfig | None:
    async with async_session() as session:
        cfg = await session.get(ModelConfig, ref)
        if cfg is None:
            # Agents store the model's display name, not its id.
            stmt = select(ModelConfig).where(ModelConfig.name == ref)
            if tenant_id:
                stmt = stmt.where(ModelConfig.tenant_id == tenant_id)
            cfg = (await session.execute(stmt)).scalars().first()
    return cfg


async def resolve_model(ref, tenant_id: str | None = None):
    if not ref:
        return ref
    ref = str(ref).strip()
    cfg = await _lookup(ref, tenant_id)
    if cfg is None and tenant_id:
        other = await _lookup(ref, None)
        if other and other.tenant_id != tenant_id:
            raise ValueError(f"Model {ref} belongs to another tenant")
    if cfg:
        if tenant_id and cfg.tenant_id != tenant_id:
            raise ValueError(f"Model {ref} belongs to another tenant")
        return build_model(cfg)

    head, sep, model = ref.partition(":")
    if sep and model:
        try:
            normalise_provider(head)
        except ValueError:
            # Unknown prefixes stay a LangChain-native "provider:model" string.
            return ref
        return build_model(ModelConfig(
            id="", name=ref, provider=head, model_name=model,
            tenant_id=tenant_id or "default", params={},
        ))
    raise ValueError(
        f"Unknown model {ref!r}. Register it on the Models page or use a provider:model string "
        f"such as groq:openai/gpt-oss-120b."
    )


def provider_catalog() -> list[dict]:
    """Provider presets for the dashboard form (env var names only, never values)."""
    out = []
    for pid, spec in PROVIDERS.items():
        base = spec.base_url
        if not base and pid in ("litellm", "vllm"):
            base = _connection_url(pid) or None
        out.append({
            "id": pid,
            "label": spec.label,
            "base_url": base,
            "api_key_env": spec.api_key_envs[0] if spec.api_key_envs else None,
            "local": spec.local,
            "hint": spec.hint,
        })
    return out
