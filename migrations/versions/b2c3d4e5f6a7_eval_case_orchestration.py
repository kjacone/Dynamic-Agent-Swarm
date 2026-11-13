"""Add EvalCase.expect_delegations for two-level (orchestration) eval scoring.

Revision ID: b2c3d4e5f6a7
Revises: a1f2b3c4d5e6
Create Date: 2026-01-20 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b2c3d4e5f6a7"
down_revision: Union[str, Sequence[str], None] = "a1f2b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("eval_cases", sa.Column("expect_delegations", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("eval_cases", "expect_delegations")