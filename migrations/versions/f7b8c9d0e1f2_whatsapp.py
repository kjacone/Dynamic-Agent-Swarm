"""Add WhatsApp channel accounts, contacts and transcripts.

Revision ID: f7b8c9d0e1f2
Revises: e2f3a4b5c6d7
Create Date: 2026-11-14 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f7b8c9d0e1f2"
down_revision: Union[str, Sequence[str], None] = "e2f3a4b5c6d7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if not _has_table("whatsapp_accounts"):
        op.create_table(
            "whatsapp_accounts",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("tenant_id", sa.String(), nullable=False),
            sa.Column("agent_id", sa.String(), nullable=False),
            sa.Column("phone_number_id", sa.String(), nullable=False),
            sa.Column("display_phone", sa.String(), nullable=False),
            sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.String(), nullable=False),
            sa.UniqueConstraint("phone_number_id", name="uq_whatsapp_phone_number"),
        )
        op.create_index("ix_whatsapp_accounts_tenant_id", "whatsapp_accounts", ["tenant_id"])
        op.create_index("ix_whatsapp_accounts_phone_number_id", "whatsapp_accounts", ["phone_number_id"])

    if not _has_table("whatsapp_contacts"):
        op.create_table(
            "whatsapp_contacts",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("tenant_id", sa.String(), nullable=False),
            sa.Column("account_id", sa.String(), nullable=False),
            sa.Column("wa_id", sa.String(), nullable=False),
            sa.Column("user_id", sa.String(), nullable=False),
            sa.Column("thread_id", sa.String(), nullable=False),
            sa.Column("display_name", sa.String(), nullable=False),
            sa.Column("created_at", sa.String(), nullable=False),
            sa.Column("last_seen_at", sa.String(), nullable=False),
            sa.UniqueConstraint("tenant_id", "wa_id", name="uq_whatsapp_contact"),
        )
        op.create_index("ix_whatsapp_contacts_tenant_id", "whatsapp_contacts", ["tenant_id"])
        op.create_index("ix_whatsapp_contacts_wa_id", "whatsapp_contacts", ["wa_id"])
        op.create_index("ix_whatsapp_contacts_user_id", "whatsapp_contacts", ["user_id"])

    if not _has_table("whatsapp_messages"):
        op.create_table(
            "whatsapp_messages",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("tenant_id", sa.String(), nullable=False),
            sa.Column("contact_id", sa.String(), nullable=False),
            sa.Column("wa_id", sa.String(), nullable=False),
            sa.Column("direction", sa.String(), nullable=False),
            sa.Column("kind", sa.String(), nullable=False),
            sa.Column("provider_id", sa.String(), nullable=False),
            sa.Column("status", sa.String(), nullable=False),
            sa.Column("body", sa.Text(), nullable=False),
            sa.Column("created_at", sa.String(), nullable=False),
            sa.Column("error", sa.Text(), nullable=True),
            sa.UniqueConstraint("provider_id", name="uq_whatsapp_provider_message"),
        )
        op.create_index("ix_whatsapp_messages_tenant_id", "whatsapp_messages", ["tenant_id"])
        op.create_index("ix_whatsapp_messages_contact_id", "whatsapp_messages", ["contact_id"])
        op.create_index("ix_whatsapp_messages_wa_id", "whatsapp_messages", ["wa_id"])
        op.create_index("ix_whatsapp_messages_status", "whatsapp_messages", ["status"])


def downgrade() -> None:
    if _has_table("whatsapp_messages"):
        op.drop_table("whatsapp_messages")
    if _has_table("whatsapp_contacts"):
        op.drop_table("whatsapp_contacts")
    if _has_table("whatsapp_accounts"):
        op.drop_table("whatsapp_accounts")
