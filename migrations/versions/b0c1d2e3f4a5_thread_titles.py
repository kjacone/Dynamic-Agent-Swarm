"""Store a short title on chat thread ownership rows.

Revision ID: b0c1d2e3f4a5
Revises: f6a7b8c9d0e1
Create Date: 2026-11-14 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b0c1d2e3f4a5"
down_revision: Union[str, Sequence[str], None] = "c9d0e1f2a3b4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def _columns(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    if _has_table("thread_owners") and "title" not in _columns("thread_owners"):
        op.add_column("thread_owners", sa.Column("title", sa.String(length=160), nullable=True))


def downgrade() -> None:
    if _has_table("thread_owners") and "title" in _columns("thread_owners"):
        with op.batch_alter_table("thread_owners") as batch:
            batch.drop_column("title")
