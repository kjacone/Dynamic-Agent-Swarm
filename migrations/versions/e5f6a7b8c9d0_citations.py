"""Add the citations table (per-run RAG source capture).

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-11-13 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e5f6a7b8c9d0"
down_revision: Union[str, Sequence[str], None] = "d4e5f6a7b8c9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    # Core tables are normally created by SQLModel.metadata.create_all, so the
    # table may already exist in a fresh or create_all-managed database.
    if _has_table("citations"):
        return
    op.create_table(
        "citations",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("tenant_id", sa.String(), nullable=False),
        sa.Column("thread_id", sa.String(), nullable=False),
        sa.Column("run_ref", sa.String(), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("collection", sa.String(), nullable=False),
        sa.Column("dedupe_key", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("page", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.UniqueConstraint("run_ref", "seq", name="uq_citation_run_seq"),
        sa.UniqueConstraint("run_ref", "dedupe_key", name="uq_citation_run_source"),
    )
    op.create_index("ix_citations_tenant_id", "citations", ["tenant_id"])
    op.create_index("ix_citations_thread_id", "citations", ["thread_id"])
    op.create_index("ix_citations_run_ref", "citations", ["run_ref"])


def downgrade() -> None:
    if _has_table("citations"):
        op.drop_table("citations")
