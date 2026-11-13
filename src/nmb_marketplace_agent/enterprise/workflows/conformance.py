"""Conformance runner: assert that a supervisor delegates to exactly the declared specialists.

Two projections of astream_events matter here:

  • version="v3" exposes `stream.subagents` — one handle per `task` call, with nested
    handles available via handle.subagents. That's the tree we need.
  • version="v2" does not. If the installed langgraph does not support v3, conformance
    reports per-case errors and the publish gate treats them as non-blocking.

The publish gate MUST NOT block a publish on a broken runner — a downstream SDK
change should never fail closed on the customer's ability to ship.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path

log = logging.getLogger(__name__)


@dataclass
class ConformanceCase:
    id: str
    title: str
    input: str
    expect_delegations: list[str]
    must_not_call: list[str] = field(default_factory=list)
    expect_outcome: str | None = None


@dataclass
class DelegationNode:
    name: str
    path: tuple
    status: str
    children: list["DelegationNode"] = field(default_factory=list)


@dataclass
class ConformanceResult:
    case_id: str
    passed: bool
    expected: list[str]
    actual: list[str]
    tree: list[DelegationNode]
    notes: list[str] = field(default_factory=list)
    error: str | None = None  # set when the runner itself could not execute this case


class _ConformanceUnavailable(Exception):
    """Raised when the installed langgraph cannot provide stream.subagents."""


def load_cases(pack_dir: Path, solution_id: str) -> list[ConformanceCase]:
    p = pack_dir / "samples" / solution_id / "conformance.jsonl"
    if not p.exists():
        return []
    out: list[ConformanceCase] = []
    for i, line in enumerate(p.read_text().splitlines(), start=1):
        line = line.strip()
        if not line:
            continue
        try:
            d = json.loads(line)
        except ValueError as e:
            raise ValueError(f"conformance.jsonl line {i}: {e}") from e
        out.append(
            ConformanceCase(
                id=d.get("id") or f"case-{i}",
                title=d.get("title", ""),
                input=d["input"],
                expect_delegations=list(d.get("expect_delegations", [])),
                must_not_call=list(d.get("must_not_call", [])),
                expect_outcome=d.get("expect_outcome"),
            )
        )
    return out


async def _get_stream(graph, user_input: str):
    payload = {"messages": [{"role": "user", "content": user_input}]}
    try:
        stream = await graph.astream_events(payload, version="v3")
    except (TypeError, ValueError) as e:
        raise _ConformanceUnavailable(
            f"astream_events(version='v3') not supported by installed langgraph: {e}"
        ) from e
    if not hasattr(stream, "subagents"):
        raise _ConformanceUnavailable(
            "stream.subagents not exposed on this langgraph version"
        )
    return stream


async def _walk(handle) -> DelegationNode:
    """Recursively materialise a subagent handle and its nested handles.

    stream.subagents is projection-lazy: reading only .name does NOT execute the
    subagent. We await .output (or iterate .messages) to force execution.

    Real v3 handles expose ``.path`` and ``.subagents``; lightweight fakes used in
    tests may not. Treat both as optional so a broken SDK projection cannot crash
    the walker.
    """
    name = getattr(handle, "name", "?")
    node = DelegationNode(
        name=name,
        path=tuple(getattr(handle, "path", (name,))),
        status="started",
    )
    try:
        output = getattr(handle, "output", None)
        if output is not None:
            _ = await output
        node.status = "completed"
    except Exception as e:  # noqa: BLE001
        node.status = f"failed:{type(e).__name__}"

    subagents = getattr(handle, "subagents", None)
    if subagents is not None:
        async for child in subagents:
            node.children.append(await _walk(child))
    return node


def _collect_names(node: DelegationNode, out: list[str]) -> None:
    out.append(node.name)
    for c in node.children:
        _collect_names(c, out)


async def _run_one(graph, case: ConformanceCase) -> ConformanceResult:
    flat: list[str] = []
    tree: list[DelegationNode] = []
    try:
        stream = await _get_stream(graph, case.input)
    except _ConformanceUnavailable as e:
        return ConformanceResult(
            case_id=case.id,
            passed=False,
            expected=case.expect_delegations,
            actual=[],
            tree=[],
            notes=[str(e)],
            error=str(e),
        )

    try:
        async for handle in stream.subagents:
            node = await _walk(handle)
            tree.append(node)
            _collect_names(node, flat)
        output = getattr(stream, "output", None)
        if output is not None:
            _ = await output
    except Exception as e:  # noqa: BLE001
        return ConformanceResult(
            case_id=case.id,
            passed=False,
            expected=case.expect_delegations,
            actual=flat,
            tree=tree,
            notes=[f"graph raised {type(e).__name__}: {e}"],
            error=f"{type(e).__name__}: {e}",
        )

    problems: list[str] = []
    for want in case.expect_delegations:
        if want not in flat:
            problems.append(f"missing delegation: {want}")
    for forbidden in case.must_not_call:
        if forbidden in flat:
            problems.append(f"forbidden delegation: {forbidden}")
    declared = set(case.expect_delegations) | {"general-purpose"}
    for got in flat:
        base = got.split(":", 1)[0]
        if base not in declared:
            problems.append(f"undeclared delegation: {base}")

    return ConformanceResult(
        case_id=case.id,
        passed=not problems,
        expected=case.expect_delegations,
        actual=flat,
        tree=tree,
        notes=problems,
    )


async def run_conformance(graph, cases: list[ConformanceCase]) -> list[ConformanceResult]:
    return [await _run_one(graph, c) for c in cases]