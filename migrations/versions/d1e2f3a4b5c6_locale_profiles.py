"""Locale profiles, reviewer corrections and the agent attachment column.

Revision ID: d1e2f3a4b5c6
Revises: b0c1d2e3f4a5
Create Date: 2026-11-14 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d1e2f3a4b5c6"
down_revision: Union[str, Sequence[str], None] = "b0c1d2e3f4a5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def _columns(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    if not _has_table("locale_profiles"):
        op.create_table(
            "locale_profiles",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("name", sa.String(), nullable=False),
            sa.Column("locale_code", sa.String(), nullable=False),
            sa.Column("languages", sa.JSON(), nullable=False),
            sa.Column("default_language", sa.String(), nullable=False),
            sa.Column("register_style", sa.String(), nullable=False),
            sa.Column("code_switch_policy", sa.String(), nullable=False),
            sa.Column("currency_code", sa.String(), nullable=False),
            sa.Column("currency_symbol", sa.String(), nullable=False),
            sa.Column("currency_position", sa.String(), nullable=False),
            sa.Column("decimal_sep", sa.String(), nullable=False),
            sa.Column("thousand_sep", sa.String(), nullable=False),
            sa.Column("date_format", sa.String(), nullable=False),
            sa.Column("glossary", sa.JSON(), nullable=False),
            sa.Column("replacements", sa.JSON(), nullable=False),
            sa.Column("required_phrases", sa.JSON(), nullable=False),
            sa.Column("banned_phrases", sa.JSON(), nullable=False),
            sa.Column("sample_cases", sa.JSON(), nullable=False),
            sa.Column("notes", sa.Text(), nullable=False),
            sa.Column("enabled", sa.Boolean(), nullable=False),
            sa.Column("tenant_id", sa.String(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_locale_profiles_name", "locale_profiles", ["name"])
        op.create_index("ix_locale_profiles_locale_code", "locale_profiles", ["locale_code"])
        op.create_index("ix_locale_profiles_tenant_id", "locale_profiles", ["tenant_id"])

    if not _has_table("locale_examples"):
        op.create_table(
            "locale_examples",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("profile_id", sa.String(), nullable=False),
            sa.Column("tenant_id", sa.String(), nullable=False),
            sa.Column("agent_id", sa.String(), nullable=True),
            sa.Column("input", sa.Text(), nullable=False),
            sa.Column("bad_output", sa.Text(), nullable=True),
            sa.Column("corrected_output", sa.Text(), nullable=False),
            sa.Column("note", sa.String(), nullable=False),
            sa.Column("source", sa.String(), nullable=False),
            sa.Column("feedback_id", sa.String(), nullable=True),
            sa.Column("enabled", sa.Boolean(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_locale_examples_profile_id", "locale_examples", ["profile_id"])
        op.create_index("ix_locale_examples_tenant_id", "locale_examples", ["tenant_id"])
        op.create_index("ix_locale_examples_agent_id", "locale_examples", ["agent_id"])

    if _has_table("agents") and "locale_profile_id" not in _columns("agents"):
        with op.batch_alter_table("agents") as batch:
            batch.add_column(sa.Column("locale_profile_id", sa.String(), nullable=True))


def downgrade() -> None:
    if _has_table("agents") and "locale_profile_id" in _columns("agents"):
        with op.batch_alter_table("agents") as batch:
            batch.drop_column("locale_profile_id")
    if _has_table("locale_examples"):
        op.drop_table("locale_examples")
    if _has_table("locale_profiles"):
        op.drop_table("locale_profiles")
