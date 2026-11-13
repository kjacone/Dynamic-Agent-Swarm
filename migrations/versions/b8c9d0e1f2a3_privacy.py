"""Add retention policies, legal holds, privacy requests and thread activity.

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-11-13 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b8c9d0e1f2a3"
down_revision: Union[str, Sequence[str], None] = "a7b8c9d0e1f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def _columns(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def _indexes(table: str) -> set[str]:
    return {i["name"] for i in sa.inspect(op.get_bind()).get_indexes(table)}


def upgrade() -> None:
    if _has_table("thread_owners") and "last_active_at" not in _columns("thread_owners"):
        op.add_column("thread_owners", sa.Column("last_active_at", sa.DateTime(), nullable=True))
        if "ix_thread_owners_last_active_at" not in _indexes("thread_owners"):
            op.create_index("ix_thread_owners_last_active_at", "thread_owners", ["last_active_at"])

    if not _has_table("retention_policies"):
        op.create_table(
            "retention_policies",
            sa.Column("tenant_id", sa.String(), primary_key=True),
            sa.Column("settings", sa.JSON(), nullable=False),
            sa.Column("updated_by", sa.String(), nullable=False),
            sa.Column("updated_at", sa.String(), nullable=False),
        )

    if not _has_table("legal_holds"):
        op.create_table(
            "legal_holds",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("tenant_id", sa.String(), nullable=False),
            sa.Column("scope", sa.String(), nullable=False),
            sa.Column("scope_id", sa.String(), nullable=False),
            sa.Column("reason", sa.Text(), nullable=False),
            sa.Column("active", sa.Boolean(), nullable=False),
            sa.Column("created_by", sa.String(), nullable=False),
            sa.Column("created_at", sa.String(), nullable=False),
            sa.Column("released_by", sa.String(), nullable=True),
            sa.Column("released_at", sa.String(), nullable=True),
        )
        op.create_index("ix_legal_holds_tenant_id", "legal_holds", ["tenant_id"])
        op.create_index("ix_legal_holds_scope", "legal_holds", ["scope"])
        op.create_index("ix_legal_holds_scope_id", "legal_holds", ["scope_id"])
        op.create_index("ix_legal_holds_active", "legal_holds", ["active"])

    if not _has_table("privacy_requests"):
        op.create_table(
            "privacy_requests",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("tenant_id", sa.String(), nullable=False),
            sa.Column("kind", sa.String(), nullable=False),
            sa.Column("subject_type", sa.String(), nullable=False),
            sa.Column("subject_id", sa.String(), nullable=False),
            sa.Column("thread_ids", sa.JSON(), nullable=False),
            sa.Column("reason", sa.Text(), nullable=False),
            sa.Column("status", sa.String(), nullable=False),
            sa.Column("result", sa.JSON(), nullable=False),
            sa.Column("requested_by", sa.String(), nullable=False),
            sa.Column("created_at", sa.String(), nullable=False),
            sa.Column("completed_at", sa.String(), nullable=True),
        )
        op.create_index("ix_privacy_requests_tenant_id", "privacy_requests", ["tenant_id"])
        op.create_index("ix_privacy_requests_kind", "privacy_requests", ["kind"])
        op.create_index("ix_privacy_requests_subject_id", "privacy_requests", ["subject_id"])
        op.create_index("ix_privacy_requests_status", "privacy_requests", ["status"])


def downgrade() -> None:
    if _has_table("privacy_requests"):
        op.drop_table("privacy_requests")
    if _has_table("legal_holds"):
        op.drop_table("legal_holds")
    if _has_table("retention_policies"):
        op.drop_table("retention_policies")
    if _has_table("thread_owners") and "last_active_at" in _columns("thread_owners"):
        if "ix_thread_owners_last_active_at" in _indexes("thread_owners"):
            op.drop_index("ix_thread_owners_last_active_at", table_name="thread_owners")
        with op.batch_alter_table("thread_owners") as batch:
            batch.drop_column("last_active_at")
