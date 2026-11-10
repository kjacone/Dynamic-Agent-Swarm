"""enterprise layer: audit, workflows, approvals, usage, policies, solutions, connectors

Revision ID: 0001_enterprise
Revises:
"""
import sqlalchemy as sa
from alembic import op

revision = "0001_enterprise"
down_revision = None  # point this at your baseline revision once you create one (see notes)
branch_labels = None
depends_on = None


def _cols(*extra):
    return list(extra)


TABLES = {
    "audit_events": (
        [sa.Column("id", sa.String, primary_key=True), sa.Column("tenant_id", sa.String, nullable=False),
         sa.Column("seq", sa.Integer, nullable=False), sa.Column("ts", sa.String, nullable=False),
         sa.Column("actor", sa.String, nullable=False), sa.Column("actor_type", sa.String, nullable=False, server_default="user"),
         sa.Column("action", sa.String, nullable=False), sa.Column("resource_type", sa.String, nullable=False, server_default=""),
         sa.Column("resource_id", sa.String, nullable=False, server_default=""),
         sa.Column("outcome", sa.String, nullable=False, server_default="success"),
         sa.Column("details", sa.JSON), sa.Column("prev_hash", sa.String, nullable=False), sa.Column("hash", sa.String, nullable=False),
         sa.UniqueConstraint("tenant_id", "seq", name="uq_audit_tenant_seq")],
        ["tenant_id", "seq", "actor", "action", "resource_id"]),
    "workflow_definitions": (
        [sa.Column("id", sa.String, primary_key=True), sa.Column("tenant_id", sa.String, nullable=False),
         sa.Column("key", sa.String, nullable=False), sa.Column("version", sa.Integer, nullable=False, server_default="1"),
         sa.Column("spec", sa.JSON), sa.Column("status", sa.String, nullable=False, server_default="active"),
         sa.Column("created_by", sa.String, nullable=False, server_default=""), sa.Column("created_at", sa.String, nullable=False),
         sa.UniqueConstraint("tenant_id", "key", "version", name="uq_wf_key_ver")],
        ["tenant_id", "key"]),
    "workflow_runs": (
        [sa.Column("id", sa.String, primary_key=True), sa.Column("tenant_id", sa.String, nullable=False),
         sa.Column("workflow_key", sa.String, nullable=False), sa.Column("workflow_version", sa.Integer, nullable=False, server_default="1"),
         sa.Column("status", sa.String, nullable=False, server_default="running"),
         sa.Column("initiator", sa.String, nullable=False, server_default=""), sa.Column("state", sa.JSON),
         sa.Column("error", sa.Text), sa.Column("created_at", sa.String, nullable=False), sa.Column("updated_at", sa.String, nullable=False)],
        ["tenant_id", "workflow_key", "status"]),
    "approvals": (
        [sa.Column("id", sa.String, primary_key=True), sa.Column("tenant_id", sa.String, nullable=False),
         sa.Column("run_id", sa.String, nullable=False), sa.Column("step_id", sa.String, nullable=False, server_default=""),
         sa.Column("title", sa.String, nullable=False, server_default=""), sa.Column("summary", sa.Text, nullable=False, server_default=""),
         sa.Column("payload", sa.JSON), sa.Column("required_approvals", sa.Integer, nullable=False, server_default="1"),
         sa.Column("allowed_roles", sa.JSON), sa.Column("requester", sa.String, nullable=False, server_default=""),
         sa.Column("status", sa.String, nullable=False, server_default="pending"), sa.Column("decisions", sa.JSON),
         sa.Column("due_at", sa.String), sa.Column("escalated", sa.Boolean, nullable=False, server_default=sa.false()),
         sa.Column("created_at", sa.String, nullable=False), sa.Column("decided_at", sa.String)],
        ["tenant_id", "run_id", "status"]),
    "usage_events": (
        [sa.Column("id", sa.String, primary_key=True), sa.Column("tenant_id", sa.String, nullable=False),
         sa.Column("metric", sa.String, nullable=False), sa.Column("quantity", sa.Float, nullable=False, server_default="1"),
         sa.Column("period", sa.String, nullable=False), sa.Column("ts", sa.String, nullable=False), sa.Column("dims", sa.JSON)],
        ["tenant_id", "metric", "period"]),
    "policy_sets": (
        [sa.Column("id", sa.String, primary_key=True), sa.Column("tenant_id", sa.String, nullable=False),
         sa.Column("name", sa.String, nullable=False, server_default="default"), sa.Column("spec", sa.JSON),
         sa.Column("version", sa.Integer, nullable=False, server_default="1"), sa.Column("active", sa.Boolean, nullable=False, server_default=sa.true()),
         sa.Column("updated_at", sa.String, nullable=False)],
        ["tenant_id"]),
    "installed_solutions": (
        [sa.Column("id", sa.String, primary_key=True), sa.Column("tenant_id", sa.String, nullable=False),
         sa.Column("solution_id", sa.String, nullable=False), sa.Column("version", sa.String, nullable=False, server_default="1.0.0"),
         sa.Column("parameters", sa.JSON), sa.Column("created", sa.JSON), sa.Column("installed_by", sa.String, nullable=False, server_default=""),
         sa.Column("installed_at", sa.String, nullable=False)],
        ["tenant_id", "solution_id"]),
    "connector_configs": (
        [sa.Column("id", sa.String, primary_key=True), sa.Column("tenant_id", sa.String, nullable=False),
         sa.Column("name", sa.String, nullable=False), sa.Column("type", sa.String, nullable=False, server_default="rest"),
         sa.Column("config", sa.JSON), sa.Column("enabled", sa.Boolean, nullable=False, server_default=sa.true())],
        ["tenant_id", "name"]),
}


def upgrade() -> None:
    bind = op.get_bind()
    existing = set(sa.inspect(bind).get_table_names())
    for table, (columns, indexed) in TABLES.items():
        if table in existing:  # databases that already got these via init_db()/create_all
            continue
        op.create_table(table, *columns)
        for col in indexed:
            op.create_index(op.f(f"ix_{table}_{col}"), table, [col])

    if bind.dialect.name == "postgresql":
        # Defence in depth: the app never updates or deletes audit rows, so make the database refuse too.
        # (Retention jobs must run as a separate role that disables this trigger deliberately.)
        op.execute("""
            CREATE OR REPLACE FUNCTION audit_events_immutable() RETURNS trigger AS $$
            BEGIN RAISE EXCEPTION 'audit_events is append-only'; END;
            $$ LANGUAGE plpgsql;
            DROP TRIGGER IF EXISTS trg_audit_events_immutable ON audit_events;
            CREATE TRIGGER trg_audit_events_immutable BEFORE UPDATE OR DELETE ON audit_events
              FOR EACH ROW EXECUTE FUNCTION audit_events_immutable();
        """)


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("DROP TRIGGER IF EXISTS trg_audit_events_immutable ON audit_events; DROP FUNCTION IF EXISTS audit_events_immutable();")
    for table in reversed(list(TABLES)):
        op.drop_table(table)