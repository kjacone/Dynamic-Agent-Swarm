import uuid

import pytest

from nmb_marketplace_agent.config.models import AgentConfig


async def test_inline_prompt_provenance_has_hash(db):
    from nmb_marketplace_agent.api.routes.agents import _capture_provenance

    agent = AgentConfig(
        id=str(uuid.uuid4()), name="a", tenant_id="t1",
        system_prompt="You are helpful.",
        model="ollama:llama3.1:8b",
    )
    prov = await _capture_provenance(agent)
    assert prov["prompt"]["kind"] == "inline"
    assert len(prov["prompt"]["hash"]) == 16
    assert prov["model"]["ref"] == "ollama:llama3.1:8b"


async def test_langfuse_prompt_provenance_records_version(db, monkeypatch):
    from nmb_marketplace_agent.api.routes.agents import _capture_provenance

    async def fake_resolve(value, fallback):
        return ("You are helpful.", {
            "kind": "langfuse", "name": "kyc-prompt", "version": 7, "labels": ["production"],
        })

    # agents.py does `from ... import resolve_with_provenance` at module load,
    # so we must patch the name *in that module*, not in prompts.resolver.
    monkeypatch.setattr(
        "nmb_marketplace_agent.api.routes.agents.resolve_with_provenance",
        fake_resolve,
    )

    agent = AgentConfig(
        id=str(uuid.uuid4()), name="a", tenant_id="t1",
        system_prompt="langfuse:kyc-prompt:production",
    )
    prov = await _capture_provenance(agent)
    assert prov["prompt"]["kind"] == "langfuse"
    assert prov["prompt"]["version"] == 7
    assert prov["prompt"]["name"] == "kyc-prompt"