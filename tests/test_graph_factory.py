import asyncio

from nmb_marketplace_agent.graph_factory import make_graph


def test_fallback_graph_when_no_agent_id():
    g = asyncio.run(make_graph({"configurable": {}}))
    assert g is not None