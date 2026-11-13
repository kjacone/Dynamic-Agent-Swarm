"""Durable workflow engine with human approvals, retries, guardrails, audit and metering.

State lives in the database after every step, so runs survive restarts and can wait days
for a human. ``advance`` is idempotent: call it again after an approval or from a worker.
"""
from __future__ import annotations

import asyncio
import copy
import logging
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any, Awaitable, Callable

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from nmb_marketplace_agent.enterprise import audit
from nmb_marketplace_agent.enterprise.expr import ExprError, render, safe_eval
from nmb_marketplace_agent.enterprise.guardrails import PolicyEngine
from nmb_marketplace_agent.enterprise.metering import record_usage
from nmb_marketplace_agent.enterprise.models import (
    Approval,
    WorkflowDefinition,
    WorkflowRun,
    now_iso,
)
from nmb_marketplace_agent.enterprise.notifications import notify
from nmb_marketplace_agent.enterprise.rbac import Principal
from nmb_marketplace_agent.enterprise.workflows.spec import (
    Step,
    WorkflowSpec,
    validate_inputs,
    validate_spec,
)

log = logging.getLogger(__name__)

class WorkflowError(Exception):
    pass


class PolicyViolation(WorkflowError):
    pass


@dataclass
class Runtime:
    """Pluggable handlers. Tests inject fakes; production uses ``enterprise.runtime``."""
    agent_runner: Callable[[str, str, dict], Awaitable[Any]]
    tool_runner: Callable[[str, dict], Awaitable[Any]] | None = None
    connector_runner: Callable[[str, str, dict], Awaitable[Any]] | None = None
    policy: PolicyEngine = field(default_factory=PolicyEngine)
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep
    supervisor_runner: Callable[[str, str, dict, list], Awaitable[Any]] | None = None
    supervisor_ids: set[str] = field(default_factory=set)
    shadow: bool = False


def _due(hours: float | None) -> str | None:
    return (datetime.now(UTC) + timedelta(hours=hours)).strftime("%Y-%m-%dT%H:%M:%S.%fZ") if hours else None


class WorkflowEngine:
    def __init__(self, db: AsyncSession, runtime: Runtime, tenant_id: str):
        self.db, self.rt, self.tenant = db, runtime, tenant_id

    # ── shadow-mode-aware audit / metering ───────────────────────────
    async def _audit(self, *, actor: str, action: str, resource_type: str, resource_id: str,
                     actor_type: str = "system", outcome: str = "success",
                     details: dict | None = None) -> None:
        if self.rt.shadow:
            return
        await audit.record(
            self.db, tenant_id=self.tenant, actor=actor, actor_type=actor_type,
            action=action, resource_type=resource_type, resource_id=resource_id,
            outcome=outcome, details=details or {},
        )

    async def _meter(self, metric: str, **dims: Any) -> None:
        if self.rt.shadow:
            return
        await record_usage(self.db, self.tenant, metric, **dims)

    # ── definitions ───────────────────────────────────────────────────
    async def save_definition(self, spec: WorkflowSpec | dict, actor: str) -> WorkflowDefinition:
        spec = WorkflowSpec.model_validate(spec) if isinstance(spec, dict) else spec
        if problems := validate_spec(spec):
            raise WorkflowError("Invalid workflow: " + "; ".join(problems))
        last = (await self.db.execute(select(WorkflowDefinition).where(
            WorkflowDefinition.tenant_id == self.tenant, WorkflowDefinition.key == spec.key)
            .order_by(WorkflowDefinition.version.desc()).limit(1))).scalars().first()
        spec.version = (last.version + 1) if last else 1
        d = WorkflowDefinition(id=str(uuid.uuid4()), tenant_id=self.tenant, key=spec.key, version=spec.version,
                               spec=spec.model_dump(by_alias=True), created_by=actor)
        self.db.add(d)
        await self.db.commit()
        await self._audit(actor=actor, action="workflow.definition.saved",
                          resource_type="workflow", resource_id=spec.key, actor_type="user",
                          details={"version": spec.version})
        return d

    async def get_spec(self, key: str, version: int | None = None) -> WorkflowSpec:
        q = select(WorkflowDefinition).where(WorkflowDefinition.tenant_id == self.tenant,
                                             WorkflowDefinition.key == key, WorkflowDefinition.status == "active")
        if version:
            q = q.where(WorkflowDefinition.version == version)
        d = (await self.db.execute(q.order_by(WorkflowDefinition.version.desc()).limit(1))).scalars().first()
        if not d:
            raise WorkflowError(f"Workflow '{key}' not found")
        return WorkflowSpec.model_validate(d.spec)

    # ── runs ──────────────────────────────────────────────────────────
    async def start(self, key: str, inputs: dict, initiator: str, run_now: bool = True) -> WorkflowRun:
        spec = await self.get_spec(key)
        if errs := validate_inputs(spec, inputs):
            raise WorkflowError("; ".join(errs))
        run = WorkflowRun(id=str(uuid.uuid4()), tenant_id=self.tenant, workflow_key=key, workflow_version=spec.version,
                          initiator=initiator, state={"ctx": {"input": inputs, **inputs}, "cursor": spec.start or spec.steps[0].id,
                                                      "history": [], "n": 0, "approved_steps": []})
        self.db.add(run)
        await self.db.commit()
        await self._audit(actor=initiator, action="workflow.run.started", resource_type="workflow_run",
                          resource_id=run.id, actor_type="user",
                          details={"workflow": key, "version": spec.version, "inputs": inputs})
        await self._meter("workflow_runs", workflow=key)
        return await self.advance(run.id) if run_now else run

    async def _save(self, run: WorkflowRun, state: dict, status: str | None = None, error: str | None = None):
        run.state = copy.deepcopy(state)
        run.updated_at = now_iso()
        if status:
            run.status = status
        if error is not None:
            run.error = error
        self.db.add(run)
        await self.db.commit()

    async def advance(self, run_id: str) -> WorkflowRun:
        run = await self.db.get(WorkflowRun, run_id)
        if not run or run.tenant_id != self.tenant:
            raise WorkflowError("Run not found")
        if run.status != "running":
            return run
        spec = await self.get_spec(run.workflow_key, run.workflow_version)
        by, st = spec.by_id(), copy.deepcopy(run.state)

        while st["cursor"]:
            if st["n"] >= spec.max_steps:
                await self._save(run, st, "failed", "max_steps exceeded (possible loop)")
                break
            step = by[st["cursor"]]
            st["n"] += 1
            try:
                outcome = await self._exec(run, spec, step, st)
            except Exception as e:  # noqa: BLE001
                await self._log(run, step, "error", {"error": str(e)[:500]})
                st["history"].append({"step": step.id, "status": "error", "error": str(e)[:300], "ts": now_iso()})
                if step.on_error == "continue":
                    st["cursor"] = spec.next_of(step)
                    continue
                if step.on_error == "goto" and step.error_goto:
                    st["ctx"]["error"] = str(e)[:500]
                    st["cursor"] = step.error_goto
                    continue
                await self._save(run, st, "failed", str(e)[:1000])
                await self._audit(actor="workflow-engine", action="workflow.run.failed",
                                  resource_type="workflow_run", resource_id=run.id,
                                  outcome="error", details={"step": step.id, "error": str(e)[:300]})
                return run
            if outcome == "WAIT":
                await self._save(run, st, "waiting_approval")
                return run
            st["history"].append({"step": step.id, "status": "ok", "ts": now_iso()})
            await self._meter("workflow_steps", workflow=run.workflow_key, step_type=step.type)

            # Rules layer on top of natural routing. `route_to` overrides the next
            # step; `block` fails the run. Rules fire at most once per run per rule
            # (tracked in `_fired_rules`), so a rule that routes to X cannot loop by
            # firing again after X executes.
            override = await self._apply_rules(run, st)
            if override:
                action, target = override
                if action == "block":
                    await self._save(run, st, "failed",
                                     f"Workflow rule blocked after '{step.id}'")
                    return run
                if action == "route_to" and target and target in by:
                    st["cursor"] = target
                    await self._save(run, st)
                    continue
                if action == "route_to" and target and target not in by:
                    # The rule references a step that was removed in a later workflow
                    # version. Fall through to natural routing; the audit trail has
                    # the `workflow.rule.fired` event that points at the misconfig.
                    pass

            if step.type == "end":
                st["ctx"]["_outcome"] = step.outcome or "completed"
                st["cursor"] = None
            else:
                st["cursor"] = outcome
            await self._save(run, st)

        if run.status == "running":
            await self._save(run, st, "completed")
            await self._audit(actor="workflow-engine", action="workflow.run.completed",
                              resource_type="workflow_run", resource_id=run.id,
                              details={"outcome": st["ctx"].get("_outcome", "completed")})
        return run

    async def _log(self, run, step, outcome, details=None):
        await self._audit(actor="workflow-engine", action=f"workflow.step.{step.type}",
                          resource_type="workflow_run", resource_id=run.id,
                          outcome="success" if outcome == "ok" else outcome,
                          details={"step": step.id, **(details or {})})

    async def _apply_rules(self, run: WorkflowRun, st: dict) -> tuple[str, str | None] | None:
        """Return (action, target_step) for the first enabled rule whose expr matches.

        Fires at most once per (run, rule). Updates the rule's counters and writes
        `workflow.rule.fired` / `workflow.rule.blocked` audit events (both suppressed
        in shadow mode via `_audit`, but fired_count is skipped explicitly to avoid
        inflating the operator-visible counter with replay traffic).
        """
        from sqlalchemy import select as _select
        from nmb_marketplace_agent.enterprise.models import WorkflowRule

        fired = set(st.get("_fired_rules", []))
        rules = (await self.db.execute(
            _select(WorkflowRule).where(
                WorkflowRule.tenant_id == self.tenant,
                WorkflowRule.workflow_key == run.workflow_key,
                WorkflowRule.enabled == True,  # noqa: E712
            ).order_by(WorkflowRule.created_at)
        )).scalars().all()
        if not rules:
            return None

        for r in rules:
            if r.id in fired:
                continue
            try:
                if not safe_eval(r.when_expr, st["ctx"]):
                    continue
            except ExprError as e:
                log.warning("Rule %s has invalid expression %r: %s", r.id, r.when_expr, e)
                continue

            if not self.rt.shadow:
                r.fired_count = (r.fired_count or 0) + 1
                r.last_fired_at = now_iso()
                self.db.add(r)
                await self.db.commit()

            st.setdefault("_fired_rules", []).append(r.id)
            await self._audit(
                actor="rules-engine", action="workflow.rule.fired",
                resource_type="workflow_run", resource_id=run.id,
                details={"rule_id": r.id, "name": r.name, "when": r.when_expr,
                         "action": r.action, "target": r.target_step},
            )
            if r.action == "block":
                await self._audit(
                    actor="rules-engine", action="workflow.rule.blocked",
                    resource_type="workflow_run", resource_id=run.id,
                    outcome="denied",
                    details={"rule_id": r.id, "name": r.name},
                )
            return (r.action, r.target_step)
        return None                          

    # ── step execution ────────────────────────────────────────────────
    async def _exec(self, run: WorkflowRun, spec: WorkflowSpec, step: Step, st: dict) -> str | None:
        ctx = st["ctx"]
        key = step.output or step.id
        nxt = spec.next_of(step)

        if step.type == "end":
            return None
        if step.type == "set":
            ctx.update(render(step.values, ctx))
            return nxt
        if step.type == "condition":
            try:
                ok = bool(safe_eval(step.if_ or "false", ctx))
            except ExprError as e:
                raise WorkflowError(str(e)) from e
            await self._log(run, step, "ok", {"result": ok})
            return (step.then if ok else step.else_) or nxt
        if step.type == "approval":
            return await self._approval(run, step, st, nxt)
        if step.type == "parallel":
            prepared = [(b, *(await self._prepare(run, b, ctx, False))) for b in step.branches]
            raws = await asyncio.gather(*[self._retry(b, thunk) for b, thunk, _ in prepared])
            for (b, _t, fin), raw in zip(prepared, raws):
                ctx[b.output or b.id] = await fin(raw) if fin else raw
            await self._log(run, step, "ok", {"branches": [b.id for b in step.branches]})
            return nxt

        try:
            ctx[key] = await self._run_step(run, step, ctx, approved=step.id in st["approved_steps"])
        except _NeedsApproval as na:
            await self._open_approval(run, step, st, f"Policy review required: {step.id}", "; ".join(na.reasons))
            return "WAIT"
        await self._log(run, step, "ok")
        return nxt

    async def _run_step(self, run, step: Step, ctx: dict, approved: bool = False):
        thunk, finish = await self._prepare(run, step, ctx, approved)
        raw = await self._retry(step, thunk)
        return await finish(raw) if finish else raw

    async def _retry(self, step: Step, thunk):
        last: Exception | None = None
        for attempt in range(step.retries + 1):
            try:
                return await thunk()
            except Exception as e:  # noqa: BLE001
                last = e
                if attempt < step.retries:
                    await self.rt.sleep(step.backoff_s * (2 ** attempt))
        raise last  # type: ignore[misc]

    async def _deny(self, run, step: Step, dec, target: str | None = None):
        await self._audit(actor="guardrails", action="policy.blocked", resource_type="workflow_run",
                          resource_id=run.id, outcome="denied",
                          details={"step": step.id, **({"target": target} if target else {}), **dec.as_dict()})
        await self._meter("policy_blocks")
        raise PolicyViolation("; ".join(dec.reasons))

    async def _prepare(self, run, step: Step, ctx: dict, approved: bool):
        """Do every DB-touching, policy-related part of a step; return (thunk, finish)."""
        if step.type == "set":
            val = render(step.values, ctx)

            async def _set():
                return val
            return _set, None

        ctx["_run_id"] = run.id
        ctx["_step_id"] = step.id

        args = render(step.input, ctx)
        if step.type in ("tool", "connector"):
            runner = self.rt.tool_runner if step.type == "tool" else self.rt.connector_runner
            if not runner:
                raise WorkflowError(f"No {step.type} runner configured")
            name = step.tool if step.type == "tool" else f"{step.connector}.{step.operation}"
            dec = self.rt.policy.check_tool_call(name or "", args)
            if dec.blocked:
                await self._deny(run, step, dec, name)
            if dec.action == "require_approval" and not approved:
                raise _NeedsApproval(dec.reasons)
            if step.type == "tool":
                await self._meter("tool_calls", tool=step.tool)
                return (lambda: runner(step.tool or "", args)), None
            await self._meter("connector_calls", connector=step.connector)
            return (lambda: runner(step.connector or "", step.operation or "", args)), None

        # agent
        prompt = render(step.prompt or "", ctx)
        prompt = prompt if isinstance(prompt, str) else str(prompt)
        dec = self.rt.policy.check_text(prompt, "input", {})
        if dec.blocked:
            await self._deny(run, step, dec)
        if dec.action == "require_approval" and not approved:
            raise _NeedsApproval(dec.reasons)
        prompt = dec.text or prompt
        await self._meter("agent_runs", agent=step.agent)

        async def finish(out):
            if isinstance(out, str):
                od = self.rt.policy.check_text(out, "output")
                if od.blocked:
                    await self._meter("policy_blocks")
                    raise PolicyViolation("Model output blocked: " + "; ".join(od.reasons))
                return od.text if od.text is not None else out
            return out

        if step.agent in self.rt.supervisor_ids and self.rt.supervisor_runner:
            from nmb_marketplace_agent.enterprise.observability.cost_tracker import CostTracker

            tracker = CostTracker(tenant_id=self.tenant, run_id=run.id, step_id=step.id)

            async def _supervisor_call():
                try:
                    return await self.rt.supervisor_runner(
                        step.agent or "", prompt, ctx, [tracker],
                    )
                finally:
                    await tracker.flush(self.db)
            return _supervisor_call, finish

        return (lambda: self.rt.agent_runner(step.agent or "", prompt, ctx)), finish

    # ── approvals ─────────────────────────────────────────────────────
    async def _approval(self, run, step: Step, st: dict, nxt: str | None) -> str | None:
        ctx = st["ctx"]
        res = ctx.get(step.output or step.id)
        if isinstance(res, dict) and res.get("decision"):
            if res["decision"] == "rejected":
                if step.on_reject:
                    return step.on_reject
                st["ctx"]["_outcome"] = "rejected"
                run.status = "rejected"
                return None
            return nxt
        await self._open_approval(run, step, st, render(step.title or step.name or step.id, ctx),
                                  render(step.summary or "", ctx))
        return "WAIT"

    async def _open_approval(self, run, step: Step, st: dict, title: str, summary: str, payload: dict | None = None):
        a = Approval(id=str(uuid.uuid4()), tenant_id=self.tenant, run_id=run.id, step_id=step.id, title=str(title),
                     summary=str(summary), requester=run.initiator, required_approvals=step.required_approvals,
                     allowed_roles=step.roles, due_at=_due(step.due_hours),
                     payload={"context": _public(st["ctx"]), "_escalate_roles": step.escalate_roles,
                              "_self_ok": step.allow_self_approval, "_due_hours": step.due_hours, **(payload or {})})
        self.db.add(a)
        await self.db.commit()
        await self._audit(actor="workflow-engine", action="approval.requested",
                          resource_type="approval", resource_id=a.id,
                          details={"run": run.id, "step": step.id, "title": a.title,
                                   "roles": step.roles, "required": step.required_approvals})
        await self._meter("approvals")
        await notify(self.db, a, "approval.requested", step.roles)
        return a

    async def decide(self, approval_id: str, principal: Principal, decision: str, comment: str = "") -> Approval:
        import os
        a = await self.db.get(Approval, approval_id)
        if not a or a.tenant_id != self.tenant:
            raise WorkflowError("Approval not found")
        if a.status != "pending":
            raise WorkflowError(f"Approval already {a.status}")
        if decision not in ("approve", "reject"):
            raise WorkflowError("decision must be 'approve' or 'reject'")

        def deny(why: str):
            raise WorkflowError(why)

        if principal.auth == "admin_token" and os.environ.get("ALLOW_ADMIN_TOKEN_APPROVALS", "false") != "true":
            deny("Shared admin credentials cannot approve; sign in as a named approver.")
        if not (set(a.allowed_roles) & principal.roles):
            deny("You do not hold a role permitted to decide this request.")
        if principal.sub == a.requester and not a.payload.get("_self_ok"):
            await self._audit(actor=principal.sub, action="approval.denied_self",
                              resource_type="approval", resource_id=a.id,
                              actor_type="user", outcome="denied")
            deny("Maker-checker: the requester cannot approve their own request.")
        if any(d["by"] == principal.sub for d in a.decisions):
            deny("You have already decided on this request.")

        decisions = [*a.decisions, {"by": principal.sub, "decision": decision, "comment": comment, "ts": now_iso()}]
        a.decisions = decisions
        approved = sum(1 for d in decisions if d["decision"] == "approve")
        if decision == "reject":
            a.status, a.decided_at = "rejected", now_iso()
        elif approved >= a.required_approvals:
            a.status, a.decided_at = "approved", now_iso()
        self.db.add(a)
        await self.db.commit()
        await self._audit(actor=principal.sub, action=f"approval.{decision}",
                          resource_type="approval", resource_id=a.id, actor_type="user",
                          details={"run": a.run_id, "comment": comment, "status": a.status})
        if a.status != "pending":
            await notify(self.db, a, "approval.decided", [f"user:{a.requester}"])
            await self._resume(a)
        return a

    async def _resume(self, a: Approval):
        run = await self.db.get(WorkflowRun, a.run_id)
        if not run or run.status != "waiting_approval":
            return
        st = copy.deepcopy(run.state)
        spec = await self.get_spec(run.workflow_key, run.workflow_version)
        step = spec.by_id()[a.step_id]
        step_key = step.output or step.id
        verdict = "approved" if a.status == "approved" else "rejected"
        if step.type == "approval":
            st["ctx"][step_key] = {"decision": verdict, "approvers": [d["by"] for d in a.decisions],
                                   "decisions": a.decisions}
        else:
            if verdict == "approved":
                st["approved_steps"].append(step.id)
            else:
                await self._save(run, st, "rejected", f"Rejected at '{step.id}'")
                return
        st["cursor"] = step.id
        st["n"] = max(0, st["n"] - 1)
        await self._save(run, st, "running")
        await self.advance(run.id)

    async def sweep_overdue(self, now: datetime | None = None) -> dict[str, int]:
        now_s = (now or datetime.now(UTC)).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
        rows = (await self.db.execute(select(Approval).where(
            Approval.tenant_id == self.tenant, Approval.status == "pending", Approval.due_at != None,  # noqa: E711
            Approval.due_at < now_s))).scalars().all()
        out = {"escalated": 0, "expired": 0}
        for a in rows:
            esc = a.payload.get("_escalate_roles") or []
            if esc and not a.escalated:
                a.allowed_roles = sorted(set(a.allowed_roles) | set(esc))
                a.escalated = True
                a.due_at = _due(a.payload.get("_due_hours") or 24)
                self.db.add(a)
                await self.db.commit()
                await self._audit(actor="sla-sweeper", action="approval.escalated",
                                  resource_type="approval", resource_id=a.id,
                                  details={"to": esc})
                await notify(self.db, a, "approval.escalated", esc)
                out["escalated"] += 1
            else:
                a.status, a.decided_at = "expired", now_iso()
                self.db.add(a)
                await self.db.commit()
                await self._audit(actor="sla-sweeper", action="approval.expired",
                                  resource_type="approval", resource_id=a.id)
                await notify(self.db, a, "approval.expired", [f"user:{a.requester}"])
                a.status = "rejected"
                await self._resume(a)
                out["expired"] += 1
        return out

    async def cancel(self, run_id: str, actor: str, reason: str = "") -> WorkflowRun:
        run = await self.db.get(WorkflowRun, run_id)
        if not run or run.tenant_id != self.tenant:
            raise WorkflowError("Run not found")
        if run.status in ("completed", "failed", "cancelled", "rejected"):
            return run
        await self._save(run, run.state, "cancelled", reason)
        for a in (await self.db.execute(select(Approval).where(Approval.run_id == run_id, Approval.status == "pending"))).scalars():
            a.status = "expired"
            self.db.add(a)
        await self.db.commit()
        await self._audit(actor=actor, action="workflow.run.cancelled",
                          resource_type="workflow_run", resource_id=run.id, actor_type="user",
                          details={"reason": reason})
        return run


class _NeedsApproval(Exception):
    def __init__(self, reasons):
        super().__init__("; ".join(reasons))
        self.reasons = reasons


def _public(ctx: dict) -> dict:
    """Context shown to approvers: drop internals and bound the size."""
    return {k: v for k, v in ctx.items() if not k.startswith("_") and k != "input"}