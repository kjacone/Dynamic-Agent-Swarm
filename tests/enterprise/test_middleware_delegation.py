import pytest

from nmb_marketplace_agent.enterprise.middleware.delegation import (
    ASYNC_DELEGATION_TOOLS,
    DELEGATION_TOOLS,
    POLLING_TOOLS,
    SYNC_DELEGATION_TOOLS,
    DelegationBudgetExceeded,
    DelegationMiddleware,
)


class _Req:
    def __init__(self, name, args, run_id="r1", max_delegations=2):
        self.tool = type("T", (), {"name": name})()
        self.tool_call = {"name": name, "args": args}
        self.runtime = type(
            "R",
            (),
            {
                "config": {
                    "configurable": {
                        "tenant_id": "t",
                        "agent_id": "sup",
                        "run_id": run_id,
                        "max_delegations": max_delegations,
                    }
                }
            },
        )()


async def _ok(_req):
    return "ok"


def test_tool_partition_is_disjoint():
    assert SYNC_DELEGATION_TOOLS == frozenset({"task"})
    assert ASYNC_DELEGATION_TOOLS == frozenset({"start_async_task"})
    assert not (DELEGATION_TOOLS & POLLING_TOOLS)
    assert DELEGATION_TOOLS == SYNC_DELEGATION_TOOLS | ASYNC_DELEGATION_TOOLS


async def test_sync_delegation_counts_toward_budget():
    mw = DelegationMiddleware()
    for _ in range(2):
        await mw.awrap_tool_call(_Req("task", {"subagent_type": "x"}), _ok)
    with pytest.raises(DelegationBudgetExceeded):
        await mw.awrap_tool_call(_Req("task", {"subagent_type": "x"}), _ok)


async def test_async_start_counts_toward_budget():
    mw = DelegationMiddleware()
    for _ in range(2):
        await mw.awrap_tool_call(_Req("start_async_task", {"agent": "r"}), _ok)
    with pytest.raises(DelegationBudgetExceeded):
        await mw.awrap_tool_call(_Req("start_async_task", {"agent": "r"}), _ok)


async def test_polling_does_not_count():
    mw = DelegationMiddleware()
    await mw.awrap_tool_call(_Req("start_async_task", {"agent": "r"}), _ok)
    for _ in range(10):
        await mw.awrap_tool_call(_Req("check_async_task", {}), _ok)
        await mw.awrap_tool_call(_Req("update_async_task", {}), _ok)
    await mw.awrap_tool_call(_Req("start_async_task", {"agent": "r"}), _ok)
    with pytest.raises(DelegationBudgetExceeded):
        await mw.awrap_tool_call(_Req("start_async_task", {"agent": "r"}), _ok)


async def test_sync_and_async_share_budget():
    mw = DelegationMiddleware()
    await mw.awrap_tool_call(_Req("task", {"subagent_type": "x"}), _ok)
    await mw.awrap_tool_call(_Req("start_async_task", {"agent": "y"}), _ok)
    with pytest.raises(DelegationBudgetExceeded):
        await mw.awrap_tool_call(_Req("task", {"subagent_type": "x"}), _ok)


async def test_non_delegation_tools_are_transparent():
    mw = DelegationMiddleware()
    for _ in range(10):
        await mw.awrap_tool_call(_Req("calculator", {"expr": "1+1"}), _ok)
    await mw.awrap_tool_call(_Req("task", {"subagent_type": "x"}), _ok)
    await mw.awrap_tool_call(_Req("task", {"subagent_type": "x"}), _ok)
    with pytest.raises(DelegationBudgetExceeded):
        await mw.awrap_tool_call(_Req("task", {"subagent_type": "x"}), _ok)


async def test_different_run_ids_have_independent_budgets():
    mw = DelegationMiddleware()
    for _ in range(2):
        await mw.awrap_tool_call(_Req("task", {"subagent_type": "x"}, run_id="r1"), _ok)
    with pytest.raises(DelegationBudgetExceeded):
        await mw.awrap_tool_call(_Req("task", {"subagent_type": "x"}, run_id="r1"), _ok)
    # r2 is fresh
    await mw.awrap_tool_call(_Req("task", {"subagent_type": "x"}, run_id="r2"), _ok)