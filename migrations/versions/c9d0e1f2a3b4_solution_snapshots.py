"""Add solution snapshots for pack rollback.

Revision ID: c9d0e1f2a3b4
Revises: b8c9d0e1f2a3
Create Date: 2026-11-13 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c9d0e1f2a3b4"
down_revision: Union[str, Sequence[str], None] = "b8c9d0e1f2a3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if not _has_table("solution_snapshots"):
        op.create_table(
            "solution_snapshots",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("tenant_id", sa.String(), nullable=False),
            sa.Column("solution_id", sa.String(), nullable=False),
            sa.Column("version", sa.String(), nullable=False),
            sa.Column("parameters", sa.JSON(), nullable=False),
            sa.Column("pack", sa.JSON(), nullable=False),
            sa.Column("created_by", sa.String(), nullable=False),
            sa.Column("created_at", sa.String(), nullable=False),
        )
        op.create_index("ix_solution_snapshots_tenant_id", "solution_snapshots", ["tenant_id"])
        op.create_index("ix_solution_snapshots_solution_id", "solution_snapshots", ["solution_id"])


def downgrade() -> None:
    if _has_table("solution_snapshots"):
        op.drop_table("solution_snapshots")
