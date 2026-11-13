import pytest

from nmb_marketplace_agent.enterprise.middleware.delegation import (
    CostBudgetExceeded,
    DelegationMiddleware,
)


class _ModelResponse:
    def __init__(self, model, inp, out):
        msg = type("M", (), {
            "usage_metadata": {"input_tokens": inp, "output_tokens": out},
            "response_metadata": {"model_name": model},
        })()
        self.result = [msg]


class _ModelRequest:
    def __init__(self, run_id="r1", max_cost_usd=0.01):
        self.runtime = type("R", (), {"config": {"configurable": {
            "tenant_id": "t", "agent_id": "sup", "run_id": run_id,
            "max_delegations": 10, "max_cost_usd": max_cost_usd,
        }}})()


class _ToolRequest:
    def __init__(self, name, run_id="r1", max_cost_usd=0.01, max_delegations=10):
        self.tool = type("T", (), {"name": name})()
        self.tool_call = {"name": name, "args": {"subagent_type": "x"}}
        self.runtime = type("R", (), {"config": {"configurable": {
            "tenant_id": "t", "agent_id": "sup", "run_id": run_id,
            "max_delegations": max_delegations, "max_cost_usd": max_cost_usd,
        }}})()


async def _ok(_req):
    return "ok"


async def test_cost_enforcement_blocks_next_delegation(monkeypatch):
    mw = DelegationMiddleware()

    # Simulate a model call that costs $0.02 (over the $0.01 budget)
    async def _handler(_req):
        return _ModelResponse("gpt-4o", inp=10_000, out=0)  # 10000*2.50/1M = $0.025

    await mw.awrap_model_call(_ModelRequest(max_cost_usd=0.01), _handler)

    with pytest.raises(CostBudgetExceeded):
        await mw.awrap_tool_call(_ToolRequest("task", max_cost_usd=0.01), _ok)


async def test_cost_budget_not_enforced_when_unset():
    mw = DelegationMiddleware()

    async def _handler(_req):
        return _ModelResponse("gpt-4o", inp=10_000, out=0)

    await mw.awrap_model_call(_ModelRequest(max_cost_usd=None), _handler)

    # No max_cost_usd key → no raise
    await mw.awrap_tool_call(_ToolRequest("task", max_cost_usd=None), _ok)


async def test_cost_and_delegation_share_run_key():
    """Two budgets, one counter. Both checked before the same delegation."""
    mw = DelegationMiddleware()

    async def _handler(_req):
        return _ModelResponse("gpt-4o", inp=10_000, out=0)

    await mw.awrap_model_call(_ModelRequest(max_cost_usd=1.0), _handler)
    # Under both limits — passes
    await mw.awrap_tool_call(_ToolRequest("task", max_cost_usd=1.0, max_delegations=10), _ok)