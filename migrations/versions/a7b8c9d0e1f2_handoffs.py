"""Add human handoff queue and messages.

Revision ID: a7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-11-13 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a7b8c9d0e1f2"
down_revision: Union[str, Sequence[str], None] = "f6a7b8c9d0e1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if not _has_table("handoffs"):
        op.create_table(
            "handoffs",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("tenant_id", sa.String(), nullable=False),
            sa.Column("agent_id", sa.String(), nullable=False),
            sa.Column("thread_id", sa.String(), nullable=False),
            sa.Column("status", sa.String(), nullable=False),
            sa.Column("reason", sa.Text(), nullable=False),
            sa.Column("requested_by", sa.String(), nullable=False),
            sa.Column("user_id", sa.String(), nullable=True),
            sa.Column("customer_id", sa.String(), nullable=True),
            sa.Column("assigned_to", sa.String(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.Column("resolved_at", sa.DateTime(), nullable=True),
        )
        op.create_index("ix_handoffs_tenant_id", "handoffs", ["tenant_id"])
        op.create_index("ix_handoffs_agent_id", "handoffs", ["agent_id"])
        op.create_index("ix_handoffs_thread_id", "handoffs", ["thread_id"])
        op.create_index("ix_handoffs_status", "handoffs", ["status"])
        op.create_index("ix_handoffs_user_id", "handoffs", ["user_id"])
        op.create_index("ix_handoffs_customer_id", "handoffs", ["customer_id"])
        op.create_index("ix_handoffs_assigned_to", "handoffs", ["assigned_to"])

    if not _has_table("handoff_messages"):
        op.create_table(
            "handoff_messages",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("tenant_id", sa.String(), nullable=False),
            sa.Column("thread_id", sa.String(), nullable=False),
            sa.Column("handoff_id", sa.String(), nullable=False),
            sa.Column("role", sa.String(), nullable=False),
            sa.Column("author", sa.String(), nullable=False),
            sa.Column("text", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_handoff_messages_tenant_id", "handoff_messages", ["tenant_id"])
        op.create_index("ix_handoff_messages_thread_id", "handoff_messages", ["thread_id"])
        op.create_index("ix_handoff_messages_handoff_id", "handoff_messages", ["handoff_id"])


def downgrade() -> None:
    if _has_table("handoff_messages"):
        op.drop_table("handoff_messages")
    if _has_table("handoffs"):
        op.drop_table("handoffs")
