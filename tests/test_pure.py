import ast

import pytest

from nmb_marketplace_agent.prompts.render import render, variables_of
from nmb_marketplace_agent.prompts.resolver import parse_ref
from nmb_marketplace_agent.tools.builtin.calculator import _ev
from nmb_marketplace_agent.training.store import JOB_ID, NAME


def test_variables_of_unique_order():
    assert variables_of("Hi {{a}} and {{ b }} and {{a}}") == ["a", "b"]


def test_render_leaves_unknown_untouched():
    assert render("Hi {{name}}, {{missing}}", {"name": "Sam"}) == "Hi Sam, {{missing}}"


def test_parse_ref_label_and_version():
    assert parse_ref("langfuse:greet:prod") == ("greet", "prod", None)
    assert parse_ref("langfuse:greet@3") == ("greet", None, 3)
    assert parse_ref("langfuse:greet") == ("greet", "production", None)


def test_calculator_ast():
    assert _ev(ast.parse("2+3*4", mode="eval")) == 14
    with pytest.raises(ValueError):
        _ev(ast.parse("__import__('os')", mode="eval"))


def test_job_id_and_name_regex():
    assert JOB_ID.match("1730246400-abc123")
    assert not JOB_ID.match("not-a-job")
    assert NAME.match("run-01")
    assert not NAME.match("../etc")