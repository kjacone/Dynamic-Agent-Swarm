"""Locale lab: speech, inference and training settings on locale profiles.

Revision ID: c0d1e2f3a4b5
Revises: f7b8c9d0e1f2
Create Date: 2026-11-19 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c0d1e2f3a4b5"
down_revision: Union[str, Sequence[str], None] = "f7b8c9d0e1f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def _columns(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    if not _has_table("locale_profiles"):
        return
    have = _columns("locale_profiles")
    with op.batch_alter_table("locale_profiles") as batch:
        for name in ("speech", "inference", "training"):
            if name not in have:
                batch.add_column(sa.Column(name, sa.JSON(), nullable=False,
                                           server_default=sa.text("'{}'")))


def downgrade() -> None:
    if not _has_table("locale_profiles"):
        return
    have = _columns("locale_profiles")
    with op.batch_alter_table("locale_profiles") as batch:
        for name in ("training", "inference", "speech"):
            if name in have:
                batch.drop_column(name)
