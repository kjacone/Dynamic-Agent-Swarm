"""Injection shield, licence plans and upgrade requests.

Revision ID: e2f3a4b5c6d7
Revises: d1e2f3a4b5c6
Create Date: 2026-11-14 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e2f3a4b5c6d7"
down_revision: Union[str, Sequence[str], None] = "d1e2f3a4b5c6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if not _has_table("guardrail_instructions"):
        op.create_table(
            "guardrail_instructions",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("tenant_id", sa.String(), nullable=False),
            sa.Column("title", sa.String(), nullable=False),
            sa.Column("instruction", sa.Text(), nullable=False),
            sa.Column("watch_phrases", sa.JSON(), nullable=False),
            sa.Column("action", sa.String(), nullable=False),
            sa.Column("enabled", sa.Boolean(), nullable=False),
            sa.Column("created_by", sa.String(), nullable=False),
            sa.Column("created_at", sa.String(), nullable=False),
            sa.Column("updated_at", sa.String(), nullable=False),
        )
        op.create_index("ix_guardrail_instructions_tenant_id", "guardrail_instructions", ["tenant_id"])

    if not _has_table("licence_plans"):
        op.create_table(
            "licence_plans",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("tenant_id", sa.String(), nullable=False),
            sa.Column("customer", sa.String(), nullable=False),
            sa.Column("edition", sa.String(), nullable=False),
            sa.Column("features", sa.JSON(), nullable=False),
            sa.Column("seats", sa.Integer(), nullable=False),
            sa.Column("expires_on", sa.String(), nullable=True),
            sa.Column("note", sa.Text(), nullable=False),
            sa.Column("updated_by", sa.String(), nullable=False),
            sa.Column("updated_at", sa.String(), nullable=False),
        )
        op.create_index("ix_licence_plans_tenant_id", "licence_plans", ["tenant_id"])

    if not _has_table("licence_upgrade_requests"):
        op.create_table(
            "licence_upgrade_requests",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("tenant_id", sa.String(), nullable=False),
            sa.Column("current_edition", sa.String(), nullable=False),
            sa.Column("target_edition", sa.String(), nullable=False),
            sa.Column("add_features", sa.JSON(), nullable=False),
            sa.Column("message", sa.Text(), nullable=False),
            sa.Column("status", sa.String(), nullable=False),
            sa.Column("requested_by", sa.String(), nullable=False),
            sa.Column("created_at", sa.String(), nullable=False),
        )
        op.create_index("ix_licence_upgrade_requests_tenant_id", "licence_upgrade_requests", ["tenant_id"])
        op.create_index("ix_licence_upgrade_requests_status", "licence_upgrade_requests", ["status"])


def downgrade() -> None:
    if _has_table("licence_upgrade_requests"):
        op.drop_table("licence_upgrade_requests")
    if _has_table("licence_plans"):
        op.drop_table("licence_plans")
    if _has_table("guardrail_instructions"):
        op.drop_table("guardrail_instructions")
