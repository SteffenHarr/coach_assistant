"""Add users.is_protected (master-admin) flag.

Revision ID: 0004_user_protected_flag
Revises: 0003_planner_role_published
Create Date: 2026-08-20
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0004_user_protected_flag"
down_revision = "0003_planner_role_published"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "is_protected",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "is_protected")
