"""Declarative workflow definition (YAML/JSON) + static validation.

A workflow is a graph of typed steps. Business teams configure these; engineers only add
new step *handlers* (agents, tools, connectors). That is what lets one platform serve
banks, insurers and ministries without code forks.
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

StepType = Literal["agent", "tool", "connector", "approval", "condition", "parallel", "set", "end"]


class Step(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    id: str
    type: StepType
    name: str = ""
    next: str | None = None
    output: str | None = None  # ctx key for the result (default: step id)
    retries: int = 0
    backoff_s: float = 1.0
    on_error: Literal["fail", "continue", "goto"] = "fail"
    error_goto: str | None = None
    # agent
    agent: str | None = None
    prompt: str | None = None
    # tool / connector
    tool: str | None = None
    connector: str | None = None
    operation: str | None = None
    input: dict[str, Any] = Field(default_factory=dict)
    # approval (maker-checker)
    title: str | None = None
    summary: str | None = None
    required_approvals: int = 1
    roles: list[str] = Field(default_factory=lambda: ["approver"])
    due_hours: float | None = None
    escalate_roles: list[str] = Field(default_factory=list)
    on_reject: str | None = None
    allow_self_approval: bool = False
    # condition
    if_: str | None = Field(default=None, alias="if")
    then: str | None = None
    else_: str | None = Field(default=None, alias="else")
    # parallel / set
    branches: list["Step"] = Field(default_factory=list)
    values: dict[str, Any] = Field(default_factory=dict)
    # end
    outcome: str | None = None


class InputSpec(BaseModel):
    required: bool = False
    type: Literal["string", "number", "boolean", "object", "array", "any"] = "any"
    description: str = ""


class WorkflowSpec(BaseModel):
    key: str
    name: str = ""
    version: int = 1
    description: str = ""
    inputs: dict[str, InputSpec] = Field(default_factory=dict)
    steps: list[Step]
    start: str | None = None
    sla_hours: float | None = None
    max_steps: int = 200
    tags: list[str] = Field(default_factory=list)

    def by_id(self) -> dict[str, Step]:
        return {s.id: s for s in self.steps}

    def next_of(self, step: Step) -> str | None:
        if step.next:
            return step.next
        ids = [s.id for s in self.steps]
        i = ids.index(step.id)
        return ids[i + 1] if i + 1 < len(ids) else None


_PY = {"string": str, "number": (int, float), "boolean": bool, "object": dict, "array": list}


def validate_inputs(spec: WorkflowSpec, inputs: dict) -> list[str]:
    errs = []
    for k, s in spec.inputs.items():
        if k not in inputs or inputs[k] is None:
            if s.required:
                errs.append(f"Missing required input '{k}'")
        elif s.type != "any" and not isinstance(inputs[k], _PY[s.type]):
            errs.append(f"Input '{k}' must be {s.type}")
    return errs


def validate_spec(spec: WorkflowSpec) -> list[str]:
    """Return a list of design-time problems (empty = valid)."""
    errs: list[str] = []
    ids = [s.id for s in spec.steps]
    if not ids:
        return ["Workflow has no steps"]
    if len(ids) != len(set(ids)):
        errs.append("Duplicate step ids")
    known = set(ids)

    def ref(step: Step, field: str, target: str | None):
        if target and target not in known:
            errs.append(f"Step '{step.id}': {field} -> unknown step '{target}'")

    for s in spec.steps:
        for f in ("next", "error_goto", "on_reject", "then", "else_"):
            ref(s, f, getattr(s, f))
        need = {"agent": s.agent, "tool": s.tool, "connector": s.connector, "condition": s.if_}.get(s.type)
        if s.type in ("agent", "tool", "connector", "condition") and not need:
            errs.append(f"Step '{s.id}' ({s.type}) is missing its target/expression")
        if s.type == "connector" and not s.operation:
            errs.append(f"Step '{s.id}': connector steps need an operation")
        if s.type == "approval" and s.required_approvals < 1:
            errs.append(f"Step '{s.id}': required_approvals must be >= 1")
        if s.type == "approval" and s.required_approvals < 2 and s.allow_self_approval:
            errs.append(f"Step '{s.id}': self-approval defeats maker-checker")
        if s.type == "parallel":
            for b in s.branches:
                if b.type not in ("agent", "tool", "connector", "set"):
                    errs.append(f"Step '{s.id}': parallel branch '{b.id}' has unsupported type {b.type}")
    if spec.start and spec.start not in known:
        errs.append(f"start -> unknown step '{spec.start}'")
    # reachability
    by = spec.by_id()
    seen, stack = set(), [spec.start or ids[0]]
    while stack:
        cur = stack.pop()
        if cur in seen or cur not in by:
            continue
        seen.add(cur)
        st = by[cur]
        stack += [x for x in (spec.next_of(st) if st.type not in ("end", "condition") else None,
                              st.then, st.else_, st.error_goto, st.on_reject) if x]
        if st.type == "condition" and not (st.then and st.else_):
            nxt = spec.next_of(st)
            stack += [nxt] if nxt else []
    for orphan in known - seen:
        errs.append(f"Step '{orphan}' is unreachable")
    return errs
