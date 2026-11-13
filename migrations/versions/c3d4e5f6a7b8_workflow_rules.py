"""Add workflow_rules for approval-as-code (tenant-scoped rules layered on workflows).

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-01-25 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c3d4e5f6a7b8"
down_revision: Union[str, Sequence[str], None] = "b2c3d4e5f6a7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "workflow_rules",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("tenant_id", sa.String(), nullable=False, index=True),
        sa.Column("workflow_key", sa.String(), nullable=False, index=True),
        sa.Column("name", sa.String(), nullable=False, server_default=""),
        sa.Column("when_expr", sa.Text(), nullable=False),
        sa.Column("action", sa.String(), nullable=False, server_default="route_to"),
        sa.Column("target_step", sa.String(), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_by", sa.String(), nullable=False, server_default=""),
        sa.Column("created_from_approval_id", sa.String(), nullable=True),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("fired_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_fired_at", sa.String(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("workflow_rules")