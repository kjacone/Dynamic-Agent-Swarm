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


class ConnectorConfig(SQLModel, table=True):
    """Connector settings. Secrets are *references* (``env:NAME``), never stored values."""
    __tablename__ = "connector_configs"
    id: str = Field(primary_key=True)
    tenant_id: str = Field(index=True)
    name: str = Field(index=True)
    type: str = Field(default="rest")
    config: dict = Field(default_factory=dict, sa_column=Column(JSON))
    enabled: bool = Field(default=True)
