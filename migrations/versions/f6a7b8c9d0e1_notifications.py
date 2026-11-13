"""Add approval notification routes and outbox.

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-11-13 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f6a7b8c9d0e1"
down_revision: Union[str, Sequence[str], None] = "e5f6a7b8c9d0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if not _has_table("notification_routes"):
        op.create_table(
            "notification_routes",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("tenant_id", sa.String(), nullable=False),
            sa.Column("role", sa.String(), nullable=False),
            sa.Column("channel", sa.String(), nullable=False),
            sa.Column("target", sa.String(), nullable=False),
            sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.String(), nullable=False),
            sa.UniqueConstraint("tenant_id", "role", "channel", "target",
                                name="uq_notification_route"),
        )
        op.create_index("ix_notification_routes_tenant_id", "notification_routes", ["tenant_id"])
        op.create_index("ix_notification_routes_role", "notification_routes", ["role"])

    if not _has_table("notifications"):
        op.create_table(
            "notifications",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("tenant_id", sa.String(), nullable=False),
            sa.Column("event", sa.String(), nullable=False),
            sa.Column("approval_id", sa.String(), nullable=False),
            sa.Column("channel", sa.String(), nullable=False),
            sa.Column("target", sa.String(), nullable=False),
            sa.Column("subject", sa.String(), nullable=False),
            sa.Column("body", sa.Text(), nullable=False),
            sa.Column("status", sa.String(), nullable=False),
            sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("next_attempt_at", sa.String(), nullable=False),
            sa.Column("last_error", sa.Text(), nullable=True),
            sa.Column("created_at", sa.String(), nullable=False),
            sa.Column("sent_at", sa.String(), nullable=True),
            sa.UniqueConstraint("tenant_id", "approval_id", "event", "channel", "target",
                                name="uq_notification_target"),
        )
        op.create_index("ix_notifications_tenant_id", "notifications", ["tenant_id"])
        op.create_index("ix_notifications_event", "notifications", ["event"])
        op.create_index("ix_notifications_approval_id", "notifications", ["approval_id"])
        op.create_index("ix_notifications_status", "notifications", ["status"])
        op.create_index("ix_notifications_next_attempt_at", "notifications", ["next_attempt_at"])


def downgrade() -> None:
    if _has_table("notifications"):
        op.drop_table("notifications")
    if _has_table("notification_routes"):
        op.drop_table("notification_routes")
