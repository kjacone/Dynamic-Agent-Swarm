"""Shared test fixtures. Stub every env var that module import might touch."""
import os

os.environ.setdefault("OPENAI_API_KEY", "sk-test-openai")
os.environ.setdefault("ANTHROPIC_API_KEY", "sk-test-anthropic")
os.environ.setdefault("ADMIN_TOKEN", "test-admin-token")
os.environ.setdefault("ENV", "test")

import pytest


@pytest.fixture(autouse=True)
def _isolate_connections(tmp_path, monkeypatch):
    # Never read the developer's data/connections.json during tests.
    monkeypatch.setenv("CONNECTIONS_FILE", str(tmp_path / "connections.json"))
    yield