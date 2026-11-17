import pytest
from sqlmodel import select

import nmb_marketplace_agent.enterprise.connectors as connectors
from nmb_marketplace_agent.config.models import ToolConfig
from nmb_marketplace_agent.enterprise.models import ConnectorConfig
from nmb_marketplace_agent.tools.builtin.connector_tool import make_connector_tool
from nmb_marketplace_agent.tools.registry import _materialize


async def _connector(db, *, enabled=True):
    db.add(ConnectorConfig(
        id="t1:posts", tenant_id="t1", name="posts", type="rest", enabled=enabled,
        config={"base_url": "https://jsonplaceholder.typicode.com",
                "operations": {"list_posts": {"method": "GET", "path": "/posts"}}},
    ))
    await db.commit()


def test_materialize_connector_tool_requires_its_config():
    with pytest.raises(ValueError, match="config.connector"):
        _materialize(ToolConfig(id="t1:posts_list", tenant_id="t1", name="posts_list",
                                type="connector", config={}))

    tool = _materialize(ToolConfig(id="t1:posts_list", tenant_id="t1", name="posts_list",
                                   type="connector", description="List posts",
                                   config={"connector": "posts", "operation": "list_posts"}))
    assert tool.name == "posts_list" and tool.description == "List posts"


async def test_connector_tool_calls_the_enabled_operation(db, monkeypatch):
    await _connector(db)
    seen: dict = {}

    class Stub:
        async def call(self, operation, params):
            seen["operation"], seen["params"] = operation, params
            return [{"id": 1, "title": "hello"}]

    monkeypatch.setattr(connectors, "build_connector", lambda *a, **k: Stub())

    tool = make_connector_tool("posts_list", "t1", "posts", "list_posts")
    out = await tool.ainvoke({"params": {"limit": 1}})
    assert "hello" in out
    assert seen == {"operation": "list_posts", "params": {"limit": 1}}


async def test_connector_tool_reports_disabled_missing_and_unknown_operation(db, monkeypatch):
    await _connector(db, enabled=False)
    tool = make_connector_tool("posts_list", "t1", "posts", "list_posts")
    assert "is disabled" in await tool.ainvoke({"params": {}})

    missing = make_connector_tool("nope", "t1", "nope", "list_posts")
    assert "not configured" in await missing.ainvoke({"params": {}})

    row = (await db.execute(select(ConnectorConfig).where(ConnectorConfig.name == "posts"))).scalars().first()
    row.enabled = True
    db.add(row)
    await db.commit()
    unknown = make_connector_tool("posts_x", "t1", "posts", "delete_posts")
    assert "is not exposed" in await unknown.ainvoke({"params": {}})
