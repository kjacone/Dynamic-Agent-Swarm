import pytest

from nmb_marketplace_agent.enterprise.workflows.conformance import (
    ConformanceCase,
    _ConformanceUnavailable,
    _walk,
    load_cases,
    run_conformance,
)


class _Async:
    def __init__(self, v):
        self.v = v

    def __await__(self):
        async def _w():
            return self.v

        return _w().__await__()


def _handle(name, children=(), output="ok", fail=False):
    async def gen():
        for c in children:
            yield c

    if fail:
        async def _boom():
            raise RuntimeError("boom")
        out = _boom()
    else:
        out = _Async(output)

    return type(
        "H",
        (),
        {
            "name": name,
            "path": (name,),
            "output": out,
            "subagents": gen(),
        },
    )()


class _Stream:
    def __init__(self, roots):
        self._roots = roots
        self.subagents = self._iter()

    async def _iter(self):
        for h in self._roots:
            yield h

    output = _Async(None)


class _Graph:
    def __init__(self, roots, *, unsupported=False, missing_subagents=False):
        self._roots = roots
        self._unsupported = unsupported
        self._missing_subagents = missing_subagents

    async def astream_events(self, *_a, **_k):
        if self._unsupported:
            raise ValueError("v3 not supported")
        stream = _Stream(self._roots)
        if self._missing_subagents:
            delattr(stream, "subagents")
            return type("S", (), {"output": _Async(None)})()
        return stream


async def test_flat_expected_matches():
    g = _Graph([_handle("a"), _handle("b")])
    case = ConformanceCase(
        id="t", title="", input="q", expect_delegations=["a", "b"], must_not_call=[]
    )
    r = (await run_conformance(g, [case]))[0]
    assert r.passed
    assert r.actual == ["a", "b"]


async def test_missing_delegate_fails():
    g = _Graph([_handle("a")])
    case = ConformanceCase(
        id="t", title="", input="q", expect_delegations=["a", "b"], must_not_call=[]
    )
    r = (await run_conformance(g, [case]))[0]
    assert not r.passed
    assert "missing delegation: b" in r.notes


async def test_forbidden_delegate_fails():
    g = _Graph([_handle("a"), _handle("general-purpose")])
    case = ConformanceCase(
        id="t", title="", input="q", expect_delegations=["a"],
        must_not_call=["general-purpose"],
    )
    r = (await run_conformance(g, [case]))[0]
    assert not r.passed
    assert any("forbidden delegation" in n for n in r.notes)


async def test_nested_tree_built():
    g = _Graph([_handle("a", [_handle("a1")]), _handle("b")])
    case = ConformanceCase(
        id="t", title="", input="q",
        expect_delegations=["a", "a1", "b"], must_not_call=[],
    )
    r = (await run_conformance(g, [case]))[0]
    assert r.passed
    assert r.tree[0].name == "a"
    assert r.tree[0].children[0].name == "a1"


async def test_undeclared_delegation_fails():
    g = _Graph([_handle("a"), _handle("rogue")])
    case = ConformanceCase(
        id="t", title="", input="q", expect_delegations=["a"], must_not_call=[]
    )
    r = (await run_conformance(g, [case]))[0]
    assert not r.passed
    assert any("undeclared delegation: rogue" in n for n in r.notes)


async def test_v3_unsupported_returns_error_not_failure():
    """Broken runner must not be treated as a real failure by the publish gate."""
    g = _Graph([], unsupported=True)
    case = ConformanceCase(
        id="t", title="", input="q", expect_delegations=["a"], must_not_call=[]
    )
    r = (await run_conformance(g, [case]))[0]
    assert not r.passed
    assert r.error and "v3" in r.error.lower()


async def test_missing_subagents_attribute_returns_error():
    g = _Graph([], missing_subagents=True)
    case = ConformanceCase(
        id="t", title="", input="q", expect_delegations=["a"], must_not_call=[]
    )
    r = (await run_conformance(g, [case]))[0]
    assert not r.passed
    assert r.error and "subagents" in r.error.lower()


def test_load_cases_from_missing_file_returns_empty(tmp_path):
    assert load_cases(tmp_path, "no-such-pack") == []


async def test_walk_captures_failed_child():
    h = _handle("a", [_handle("a1", fail=True)])
    node = await _walk(h)
    assert node.children[0].status.startswith("failed:")