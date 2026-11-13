"""Add customer scope to chat threads and feedback.

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-11-13 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d4e5f6a7b8c9"
down_revision: Union[str, Sequence[str], None] = "c3d4e5f6a7b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def _columns(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def _indexes(table: str) -> set[str]:
    return {i["name"] for i in sa.inspect(op.get_bind()).get_indexes(table)}


def upgrade() -> None:
    # Core tables are normally created by SQLModel.metadata.create_all, so they
    # may not exist in a DB migrated from an empty Alembic history. Only alter
    # tables that are actually present.
    if _has_table("thread_owners") and "customer_id" not in _columns("thread_owners"):
        op.add_column("thread_owners", sa.Column("customer_id", sa.String(), nullable=True))
        if "ix_thread_owners_customer_id" not in _indexes("thread_owners"):
            op.create_index("ix_thread_owners_customer_id", "thread_owners", ["customer_id"])
    if _has_table("feedback") and "customer_id" not in _columns("feedback"):
        op.add_column("feedback", sa.Column("customer_id", sa.String(), nullable=True))
        if "ix_feedback_customer_id" not in _indexes("feedback"):
            op.create_index("ix_feedback_customer_id", "feedback", ["customer_id"])


def downgrade() -> None:
    if _has_table("feedback"):
        if "ix_feedback_customer_id" in _indexes("feedback"):
            op.drop_index("ix_feedback_customer_id", table_name="feedback")
        if "customer_id" in _columns("feedback"):
            with op.batch_alter_table("feedback") as batch:
                batch.drop_column("customer_id")
    if _has_table("thread_owners"):
        if "ix_thread_owners_customer_id" in _indexes("thread_owners"):
            op.drop_index("ix_thread_owners_customer_id", table_name="thread_owners")
        if "customer_id" in _columns("thread_owners"):
            with op.batch_alter_table("thread_owners") as batch:
                batch.drop_column("customer_id")
