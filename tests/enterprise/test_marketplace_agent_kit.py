import json

import httpx
import pytest
from sqlmodel import select

from nmb_marketplace_agent.config.models import AgentConfig, SubAgentConfig, ToolConfig
from nmb_marketplace_agent.enterprise.solutions import loader

PACK = "nmb-marketplace"
TOOLS = {
    "marketplace_search_products",
    "marketplace_product_details",
    "marketplace_faqs",
    "marketplace_policies",
    "marketplace_order_status",
}
BUILTIN_TOOLS = {"fx_convert"}
FRONTEND_TOOLS = {"set_filter", "show_products", "navigate", "show_order", "add_to_cart"}


@pytest.fixture(autouse=True)
def _offline_install(tmp_path, monkeypatch):
    monkeypatch.setattr(loader, "build_index", lambda *a, **k: 1)
    monkeypatch.setattr(loader, "DOCS_ROOT", tmp_path / "docs")

    async def _no_conformance(*_a, **_k):
        return []

    monkeypatch.setattr(loader.conformance, "run_conformance", _no_conformance)


def test_pack_declares_graphql_tools():
    pack = loader.load_pack(PACK)
    assert pack["delivery"] == "agent_kit"
    assert pack["widget"]["title"]
    loader._validate_tools(pack)
    loader._validate_supervisor(pack)
    declared = {t["name"]: t for t in pack["tools"]}
    assert set(declared) == TOOLS | FRONTEND_TOOLS
    for name in TOOLS:
        assert declared[name]["type"] == "python"
        dotted = declared[name]["config"]["dotted_path"]
        assert dotted.startswith("nmb_marketplace_agent.custom_tools.marketplace_graphql.")
    for name in FRONTEND_TOOLS:
        assert declared[name]["type"] == "frontend"
    assert declared["set_filter"]["config"]["parameters"]["type"] == "object"


async def test_install_materializes_tools_and_subagents(db):
    inst = await loader.install_solution(db, "acme", PACK, "admin")
    sup = await db.get(AgentConfig, inst.created["supervisor"])
    assert sup is not None and len(sup.subagent_ids) == 3
    assert sup.limits["allowed_tools"]["orders"] == ["marketplace_order_status"]

    subs = {s.name: s for s in [await db.get(SubAgentConfig, i) for i in sup.subagent_ids]}
    assert set(subs) == {"catalog", "orders", "policies"}

    tools = {t.name: t for t in (await db.execute(select(ToolConfig))).scalars()}
    assert set(tools) == TOOLS | BUILTIN_TOOLS | FRONTEND_TOOLS
    assert all(tools[n].type == "python" and tools[n].config.get("dotted_path") for n in TOOLS)
    assert tools["fx_convert"].type == "builtin"
    assert all(tools[n].type == "frontend" for n in FRONTEND_TOOLS)
    assert sup.tool_ids == [tools[n].id for n in ["set_filter", "show_products", "navigate", "show_order", "add_to_cart"]]

    assert set(subs["catalog"].tool_ids) == {
        tools["marketplace_search_products"].id, tools["marketplace_product_details"].id, tools["fx_convert"].id,
    }
    assert subs["orders"].tool_ids == [tools["marketplace_order_status"].id]

    from nmb_marketplace_agent.tools.registry import resolve_tools

    resolved = await resolve_tools(subs["orders"].tool_ids)
    assert [t.name for t in resolved] == ["marketplace_order_status"]


async def test_undeclared_tool_reference_is_rejected(db):
    pack = json.loads(json.dumps(loader.load_pack(PACK)))
    pack["agents"][0]["tools"] = [*pack["agents"][0]["tools"], "not_declared"]
    with pytest.raises(loader.PackError, match="not_declared"):
        await loader.install_solution(db, "t", PACK, "admin", pack_override=pack)
    assert (await db.execute(select(ToolConfig).where(ToolConfig.tenant_id == "t"))).scalars().all() == []


class _Resp:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


def test_tools_call_the_live_graphql_endpoint(monkeypatch):
    from nmb_marketplace_agent.custom_tools import marketplace_graphql as g

    seen = {}

    def fake_post(url, **kwargs):
        seen["url"] = url
        seen["body"] = kwargs["json"]
        return _Resp({"data": {"getProduct": {
            "success": True, "narration": "",
            "data": [{"productId": "344", "name": "Iphone 18 Duo", "price": 200000, "currency": "TZS"}],
        }}})

    monkeypatch.delenv("MARKETPLACE_GRAPHQL_LIVE", raising=False)
    monkeypatch.setattr(g.httpx, "post", fake_post)

    out = json.loads(g.marketplace_search_products.invoke({"search_term": "Iphone", "size": 3}))
    assert out["source"] == "live" and out["products"][0]["name"] == "Iphone 18 Duo"
    assert seen["url"] == g.DEFAULT_URL
    criteria = seen["body"]["variables"]["input"]["searchCriteria"]
    assert criteria["searchTerm"] == "Iphone" and criteria["searchFields"] == "name"


def test_tools_fall_back_to_sample_data(monkeypatch):
    from nmb_marketplace_agent.custom_tools import marketplace_graphql as g

    def boom(*_a, **_k):
        raise httpx.ConnectError("no route")

    monkeypatch.delenv("MARKETPLACE_GRAPHQL_LIVE", raising=False)
    monkeypatch.setattr(g.httpx, "post", boom)

    out = json.loads(g.marketplace_search_products.invoke({"search_term": "Iphone"}))
    assert out["source"] == "sample"
    assert out["products"] and out["note"]


def test_order_lookup_without_token_uses_sample_data(monkeypatch):
    from nmb_marketplace_agent.custom_tools import marketplace_graphql as g

    monkeypatch.delenv("MARKETPLACE_GRAPHQL_TOKEN", raising=False)

    def no_network(*_a, **_k):
        raise AssertionError("must not call the BFF without a token")

    monkeypatch.setattr(g.httpx, "post", no_network)
    out = json.loads(g.marketplace_order_status.invoke({"order_id": "ORD-100245"}))
    assert out["source"] == "sample"
    assert [o["orderId"] for o in out["orders"]] == ["ORD-100245"]
