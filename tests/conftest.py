"""Shared test fixtures. Stub every env var that module import might touch."""
import os

os.environ.setdefault("OPENAI_API_KEY", "sk-test-openai")
os.environ.setdefault("ANTHROPIC_API_KEY", "sk-test-anthropic")
os.environ.setdefault("ADMIN_TOKEN", "test-admin-token")
os.environ.setdefault("ENV", "test")
os.environ.setdefault("NMB_JWT_SECRET", "test-session-secret-0123456789abcdef")

# A malformed proxy in the developer's shell breaks httpx clients at import time.
for _proxy in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
               "http_proxy", "https_proxy", "all_proxy", "no_proxy"):
    os.environ.pop(_proxy, None)

import pytest


@pytest.fixture(autouse=True)
def _isolate_connections(tmp_path, monkeypatch):
    # Never read the developer's data/connections.json during tests.
    monkeypatch.setenv("CONNECTIONS_FILE", str(tmp_path / "connections.json"))
    monkeypatch.setenv("PROVIDER_KEYS_FILE", str(tmp_path / "provider_keys.json"))
    yield