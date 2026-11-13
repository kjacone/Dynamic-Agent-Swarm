"""Add AgentConfig.limits JSON column for supervisor budget + tool allowlists.

Revision ID: a1f2b3c4d5e6
Revises: 87596537fecd
Create Date: 2026-01-15 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a1f2b3c4d5e6"
down_revision: Union[str, Sequence[str], None] = "87596537fecd"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # JSON on Postgres, TEXT on SQLite — both handled by sa.JSON().
    # Nullable so existing agents don't need a backfill; graph_factory reads
    # `(agent.limits or {})` and supervisor packs set it on install.
    op.add_column("agents", sa.Column("limits", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("agents", "limits")