from nmb_marketplace_agent.tools.builtin.calculator import calculator
from nmb_marketplace_agent.tools.registry import _BUILTINS


def test_calculator():
    assert "4" in calculator.invoke("2+2")


def test_builtins_registered():
    assert "tavily_search" in _BUILTINS
    assert "calculator" in _BUILTINS