"""Resolve a model reference to a LangChain chat model.

`ref` is either a ModelConfig id (registry entry) or a legacy "provider:model"
string, which is passed through untouched.
"""
import os

from langchain.chat_models import init_chat_model

from nmb_marketplace_agent.config.database import async_session
from nmb_marketplace_agent.config.models import ModelConfig


def build_model(cfg: ModelConfig):
    kw = dict(cfg.params or {})
    if cfg.base_url:
        kw["base_url"] = cfg.base_url
    if cfg.api_key_env:
        key = os.environ.get(cfg.api_key_env)
        if not key:
            raise ValueError(f"Env var {cfg.api_key_env} is not set on the server")
        kw["api_key"] = key
    elif cfg.provider == "openai" and cfg.base_url:
        kw["api_key"] = "not-needed"  # local OpenAI-compatible servers
    return init_chat_model(cfg.model_name, model_provider=cfg.provider, **kw)


async def resolve_model(ref, tenant_id: str | None = None):
    if not ref:
        return ref
    async with async_session() as session:
        cfg = await session.get(ModelConfig, ref)
    if not cfg:
        return ref
    if tenant_id and cfg.tenant_id != tenant_id:
        raise ValueError(f"Model {ref} belongs to another tenant")
    return build_model(cfg)
