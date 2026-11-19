"""BYOK: provider keys saved in the dashboard override the environment."""
import json
import os

import pytest

from nmb_marketplace_agent import crypto
from nmb_marketplace_agent.config.models import ModelConfig
from nmb_marketplace_agent.integrations import provider_keys
from nmb_marketplace_agent.llm import registry
from nmb_marketplace_agent.training import sources


def test_save_masks_and_clear():
    provider_keys.set_value("GROQ_API_KEY", "gsk-dashboard-1234")
    view = provider_keys.view("GROQ_API_KEY")
    assert view["source"] == "dashboard"
    assert view["masked"] == "••••1234"
    assert "gsk-dashboard" not in json.dumps(view)
    assert provider_keys.get("GROQ_API_KEY") == "gsk-dashboard-1234"

    cleared = provider_keys.clear_value("GROQ_API_KEY")
    assert cleared["source"] is None
    assert provider_keys.get("GROQ_API_KEY") is None


def test_dashboard_key_wins_over_environment(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "or-env")
    assert provider_keys.get("OPENROUTER_API_KEY") == "or-env"

    provider_keys.set_value("OPENROUTER_API_KEY", "or-dashboard")
    assert provider_keys.get("OPENROUTER_API_KEY") == "or-dashboard"
    assert provider_keys.source("OPENROUTER_API_KEY") == "dashboard"


def test_file_is_private_and_writes_reject_junk():
    provider_keys.set_value("HF_TOKEN", "hf_test")
    path = os.environ["PROVIDER_KEYS_FILE"]
    assert oct(os.stat(path).st_mode & 0o777) == "0o600"

    with pytest.raises(ValueError):
        provider_keys.set_value("HF_TOKEN", "has spaces")
    with pytest.raises(KeyError):
        provider_keys.set_value("NOT_A_KEY", "x")
    with pytest.raises(KeyError):
        provider_keys.clear_value("NOT_A_KEY")


def test_values_are_encrypted_when_keyring_is_configured(monkeypatch):
    monkeypatch.setenv("NMB_ENCRYPTION_KEY", crypto.generate_key())
    crypto.reset_keyring()
    try:
        provider_keys.set_value("ANTHROPIC_API_KEY", "sk-ant-secret")
        raw = open(os.environ["PROVIDER_KEYS_FILE"], encoding="utf-8").read()
        assert "sk-ant-secret" not in raw
        assert "enc:v1:" in raw
        assert provider_keys.get("ANTHROPIC_API_KEY") == "sk-ant-secret"
    finally:
        crypto.reset_keyring()


def test_model_resolution_uses_saved_key():
    provider_keys.set_value("GROQ_API_KEY", "gsk-saved")
    cfg = ModelConfig(id="", name="fast", provider="groq", model_name="llama",
                      tenant_id="default", params={})
    assert registry._api_key(cfg, registry.PROVIDERS["groq"], None) == "gsk-saved"


def test_training_source_unlocks_with_saved_key(monkeypatch):
    monkeypatch.delenv("ROBOFLOW_API_KEY", raising=False)
    before = {s["id"]: s for s in sources.catalog()["sources"]}["roboflow"]
    assert before["connection"]["state"] == "needs_key"

    provider_keys.set_value("ROBOFLOW_API_KEY", "rf_saved")
    after = {s["id"]: s for s in sources.catalog()["sources"]}["roboflow"]
    assert after["connection"]["state"] == "connected"


def test_embeddings_use_key_saved_on_the_knowledge_page(monkeypatch):
    import langchain_openai

    from nmb_marketplace_agent.rag import embeddings as rag_embeddings

    captured: dict = {}

    class FakeEmbeddings:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    monkeypatch.setattr(langchain_openai, "OpenAIEmbeddings", FakeEmbeddings)
    monkeypatch.delenv("EMBEDDINGS_BASE_URL", raising=False)

    provider_keys.set_value("OPENAI_API_KEY", "sk-dashboard")
    rag_embeddings.get_embeddings("openai:text-embedding-3-small")
    assert captured == {"model": "text-embedding-3-small", "api_key": "sk-dashboard"}


def test_embeddings_use_private_server_key(monkeypatch):
    import langchain_openai

    from nmb_marketplace_agent.rag import embeddings as rag_embeddings

    captured: dict = {}

    class FakeEmbeddings:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    monkeypatch.setattr(langchain_openai, "OpenAIEmbeddings", FakeEmbeddings)
    monkeypatch.setenv("EMBEDDINGS_BASE_URL", "https://embeddings.bank.internal/v1")

    provider_keys.set_value("EMBEDDINGS_API_KEY", "bank-embed-key")
    rag_embeddings.get_embeddings("openai-compatible:bge-m3")
    assert captured == {
        "model": "bge-m3",
        "base_url": "https://embeddings.bank.internal/v1",
        "api_key": "bank-embed-key",
    }
