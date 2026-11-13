"""Database tables for the enterprise layer (share the platform's SQLModel metadata)."""
from datetime import UTC, datetime
from typing import Optional

from sqlalchemy import JSON, Column, Text, UniqueConstraint
from sqlmodel import Field, SQLModel


def now_iso() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


class AuditEvent(SQLModel, table=True):
    """Append-only, hash-chained event. ``ts`` is a string so hashes survive DB round-trips."""
    __tablename__ = "audit_events"
    __table_args__ = (UniqueConstraint("tenant_id", "seq", name="uq_audit_tenant_seq"),)
    id: str = Field(primary_key=True)
    tenant_id: str = Field(index=True)
    seq: int = Field(index=True)
    ts: str
    actor: str = Field(index=True)
    actor_type: str = Field(default="user")  # user | agent | system | api_key
    action: str = Field(index=True)
    resource_type: str = Field(default="")
    resource_id: str = Field(default="", index=True)
    outcome: str = Field(default="success")  # success | denied | error
    details: dict = Field(default_factory=dict, sa_column=Column(JSON))
    prev_hash: str
    hash: str


class WorkflowDefinition(SQLModel, table=True):
    __tablename__ = "workflow_definitions"
    __table_args__ = (UniqueConstraint("tenant_id", "key", "version", name="uq_wf_key_ver"),)
    id: str = Field(primary_key=True)
    tenant_id: str = Field(index=True)
    key: str = Field(index=True)
    version: int = Field(default=1)
    spec: dict = Field(default_factory=dict, sa_column=Column(JSON))
    status: str = Field(default="active")  # draft | active | retired
    created_by: str = Field(default="")
    created_at: str = Field(default_factory=now_iso)


class WorkflowRun(SQLModel, table=True):
    __tablename__ = "workflow_runs"
    id: str = Field(primary_key=True)
    tenant_id: str = Field(index=True)
    workflow_key: str = Field(index=True)
    workflow_version: int = Field(default=1)
    # running | waiting_approval | completed | failed | cancelled
    status: str = Field(default="running", index=True)
    initiator: str = Field(default="")
    state: dict = Field(default_factory=dict, sa_column=Column(JSON))  # ctx, cursor, history
    error: Optional[str] = Field(default=None, sa_column=Column(Text))
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


class Approval(SQLModel, table=True):
    __tablename__ = "approvals"
    id: str = Field(primary_key=True)
    tenant_id: str = Field(index=True)
    run_id: str = Field(index=True)
    step_id: str = Field(default="")
    title: str = Field(default="")
    summary: str = Field(default="", sa_column=Column(Text))
    payload: dict = Field(default_factory=dict, sa_column=Column(JSON))
    required_approvals: int = Field(default=1)
    allowed_roles: list = Field(default_factory=lambda: ["approver"], sa_column=Column(JSON))
    requester: str = Field(default="")
    status: str = Field(default="pending", index=True)  # pending|approved|rejected|expired
    decisions: list = Field(default_factory=list, sa_column=Column(JSON))
    due_at: Optional[str] = Field(default=None)
    escalated: bool = Field(default=False)
    created_at: str = Field(default_factory=now_iso)
    decided_at: Optional[str] = Field(default=None)


class NotificationRoute(SQLModel, table=True):
    """Where to send an approval notification.

    ``role`` is a directory role (``approver``, ``credit_officer``, ...) or an
    explicit ``user:<subject>`` so a decision can reach the requester.
    """
    __tablename__ = "notification_routes"
    __table_args__ = (UniqueConstraint("tenant_id", "role", "channel", "target",
                                       name="uq_notification_route"),)
    id: str = Field(primary_key=True)
    tenant_id: str = Field(index=True)
    role: str = Field(index=True)
    channel: str = Field(default="webhook")  # webhook | email
    target: str = Field(default="")
    enabled: bool = Field(default=True)
    created_at: str = Field(default_factory=now_iso)


class Notification(SQLModel, table=True):
    """Durable outbox row. Written with the approval, delivered by the dispatcher."""
    __tablename__ = "notifications"
    __table_args__ = (UniqueConstraint("tenant_id", "approval_id", "event", "channel", "target",
                                       name="uq_notification_target"),)
    id: str = Field(primary_key=True)
    tenant_id: str = Field(index=True)
    event: str = Field(index=True)  # approval.requested|escalated|expired|decided
    approval_id: str = Field(default="", index=True)
    channel: str = Field(default="webhook")
    target: str = Field(default="")
    subject: str = Field(default="")
    body: str = Field(default="", sa_column=Column(Text))
    status: str = Field(default="pending", index=True)  # pending|sent|dead
    attempts: int = Field(default=0)
    next_attempt_at: str = Field(default_factory=now_iso, index=True)
    last_error: Optional[str] = Field(default=None, sa_column=Column(Text))
    created_at: str = Field(default_factory=now_iso)
    sent_at: Optional[str] = Field(default=None)


class UsageEvent(SQLModel, table=True):
    __tablename__ = "usage_events"
    id: str = Field(primary_key=True)
    tenant_id: str = Field(index=True)
    metric: str = Field(index=True)
    quantity: float = Field(default=1.0)
    period: str = Field(index=True)  # YYYY-MM
    ts: str = Field(default_factory=now_iso)
    dims: dict = Field(default_factory=dict, sa_column=Column(JSON))


class PolicySet(SQLModel, table=True):
    __tablename__ = "policy_sets"
    id: str = Field(primary_key=True)  # f"{tenant_id}:{name}"
    tenant_id: str = Field(index=True)
    name: str = Field(default="default")
    spec: dict = Field(default_factory=dict, sa_column=Column(JSON))
    version: int = Field(default=1)
    active: bool = Field(default=True)
    updated_at: str = Field(default_factory=now_iso)


class InstalledSolution(SQLModel, table=True):
    __tablename__ = "installed_solutions"
    id: str = Field(primary_key=True)
    tenant_id: str = Field(index=True)
    solution_id: str = Field(index=True)
    version: str = Field(default="1.0.0")
    parameters: dict = Field(default_factory=dict, sa_column=Column(JSON))
    created: dict = Field(default_factory=dict, sa_column=Column(JSON))
    installed_by: str = Field(default="")
    installed_at: str = Field(default_factory=now_iso)


class SolutionSnapshot(SQLModel, table=True):
    """Last applied pack content per version, so a pilot can roll back."""
    __tablename__ = "solution_snapshots"
    id: str = Field(primary_key=True)  # tenant:solution:version
    tenant_id: str = Field(index=True)
    solution_id: str = Field(index=True)
    version: str
    parameters: dict = Field(default_factory=dict, sa_column=Column(JSON))
    pack: dict = Field(default_factory=dict, sa_column=Column(JSON))
    created_by: str = Field(default="")
    created_at: str = Field(default_factory=now_iso)


class ConnectorConfig(SQLModel, table=True):
    """Connector settings. Secrets are *references* (``env:NAME``), never stored values."""
    __tablename__ = "connector_configs"
    id: str = Field(primary_key=True)
    tenant_id: str = Field(index=True)
    name: str = Field(index=True)
    type: str = Field(default="rest")
    config: dict = Field(default_factory=dict, sa_column=Column(JSON))
    enabled: bool = Field(default=True)


class RetentionPolicy(SQLModel, table=True):
    """Per-tenant retention windows, in days. A missing key keeps data forever;
    an explicit ``null`` disables the store's default window."""
    __tablename__ = "retention_policies"
    tenant_id: str = Field(primary_key=True)
    settings: dict = Field(default_factory=dict, sa_column=Column(JSON))
    updated_by: str = Field(default="")
    updated_at: str = Field(default_factory=now_iso)


class LegalHold(SQLModel, table=True):
    """Blocks erasure and retention deletion for a tenant, subject or thread."""
    __tablename__ = "legal_holds"
    id: str = Field(primary_key=True)
    tenant_id: str = Field(index=True)
    scope: str = Field(default="tenant", index=True)  # tenant | customer | user | thread
    scope_id: str = Field(default="", index=True)
    reason: str = Field(default="", sa_column=Column(Text))
    active: bool = Field(default=True, index=True)
    created_by: str = Field(default="")
    created_at: str = Field(default_factory=now_iso)
    released_by: Optional[str] = Field(default=None)
    released_at: Optional[str] = Field(default=None)


class PrivacyRequest(SQLModel, table=True):
    """Durable record of an erasure run and its per-store outcome."""
    __tablename__ = "privacy_requests"
    id: str = Field(primary_key=True)
    tenant_id: str = Field(index=True)
    kind: str = Field(default="erasure", index=True)
    subject_type: str = Field(default="customer")  # customer | user | thread
    subject_id: str = Field(default="", index=True)
    thread_ids: list = Field(default_factory=list, sa_column=Column(JSON))
    reason: str = Field(default="", sa_column=Column(Text))
    status: str = Field(default="running", index=True)  # running|completed|partial|blocked|failed
    result: dict = Field(default_factory=dict, sa_column=Column(JSON))
    requested_by: str = Field(default="")
    created_at: str = Field(default_factory=now_iso)
    completed_at: Optional[str] = Field(default=None)


class WorkflowRule(SQLModel, table=True):
    """Tenant-scoped rule layered on top of a workflow.

    Evaluated after each successful step; the first enabled rule whose `when_expr`
    matches the run context fires (and is remembered for the run so it can't loop).
    Rules are keyed on `workflow_key`, not `workflow_version` — the semantic intent
    ("high-risk goes to EDD") should survive a typo fix in a later workflow version.
    """
    __tablename__ = "workflow_rules"
    id: str = Field(primary_key=True)
    tenant_id: str = Field(index=True)
    workflow_key: str = Field(index=True)
    name: str = Field(default="")
    when_expr: str = Field(sa_column=Column(Text))
    # `route_to` — cursor is overridden to `target_step`.
    # `block`    — run fails with a message; `target_step` is ignored.
    action: str = Field(default="route_to")
    target_step: Optional[str] = Field(default=None)
    enabled: bool = Field(default=True)
    created_by: str = Field(default="")
    created_from_approval_id: Optional[str] = Field(default=None)
    created_at: str = Field(default_factory=now_iso)
    fired_count: int = Field(default=0)
    last_fired_at: Optional[str] = Field(default=None)