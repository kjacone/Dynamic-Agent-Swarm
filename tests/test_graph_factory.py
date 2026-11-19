import asyncio

from nmb_marketplace_agent.graph_factory import make_graph


async def _async(v):
    return v


def test_fallback_graph_when_no_agent_id():
    g = asyncio.run(make_graph({"configurable": {}}))
    assert g is not None


async def test_make_graph_forwards_tenant_and_middleware_to_build_subagents(monkeypatch):
    from nmb_marketplace_agent import graph_factory
    from nmb_marketplace_agent.config.models import AgentConfig

    agent = AgentConfig(id="a1", name="t", tenant_id="t1", subagent_ids=["s1"])
    seen: dict = {}

    async def fake_load(_):
        return agent

    async def fake_effective(_a, _d):
        return (
            {
                "name": "t",
                "system_prompt": "",
                "tool_ids": [],
                "rag_collection_ids": [],
                "subagent_ids": ["s1"],
                "model": "ollama:llama3.1:8b",
                "limits": {},
            },
            1,
        )

    async def fake_build_subagents(ids, tenant_id="default", *, middleware=None):
        seen["ids"] = ids
        seen["tenant_id"] = tenant_id
        seen["middleware"] = middleware
        return []

    async def fake_empty(*_a, **_kw):
        return []

    monkeypatch.setattr(graph_factory, "_load_agent", fake_load)
    monkeypatch.setattr(graph_factory, "effective_config", fake_effective)
    monkeypatch.setattr(graph_factory, "build_subagents", fake_build_subagents)
    monkeypatch.setattr(graph_factory, "resolve_tools", fake_empty)
    monkeypatch.setattr(graph_factory, "resolve_model", lambda m, _t: _async(m))
    monkeypatch.setattr(graph_factory, "resolve_system_prompt", lambda p, d: _async(p or d))

    await graph_factory.make_graph(
        {"configurable": {"agent_id": "a1", "tenant_id": "t1"}}
    )

    assert seen["ids"] == ["s1"]
    assert seen["tenant_id"] == "t1"
    # B2.2: one shared DelegationMiddleware must be forwarded to every subagent so
    # nested `task` calls at depth >= 3 share the supervisor's per-run budget.
    assert seen["middleware"] is not None and len(seen["middleware"]) == 1
    from nmb_marketplace_agent.enterprise.middleware.delegation import (
        DelegationMiddleware,
    )

    assert isinstance(seen["middleware"][0], DelegationMiddleware)


async def test_build_sync_subagent_never_inherits_tools():
    """Lock down: `build_sync_subagent` MUST pass 'tools' explicitly.

    deepagents SubAgent inherits the main agent's tools when the 'tools' key is
    omitted. registry.py always passes it, but this test catches a refactor that
    drops it (which would silently grant every specialist the supervisor's tools).
    """
    from nmb_marketplace_agent.config.models import SubAgentConfig
    from nmb_marketplace_agent.subagents.registry import build_sync_subagent

    cfg = SubAgentConfig(
        id="s", name="x", tenant_id="t", tool_ids=[], rag_collection_ids=[]
    )
    out = await build_sync_subagent(cfg)
    assert "tools" in out, (
        "omitting 'tools' lets the subagent inherit the supervisor's tools — "
        "least-privilege boundary bypassed"
    )
    assert out["tools"] == []