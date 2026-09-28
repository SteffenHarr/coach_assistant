"""Add courts.priority — solver tie-breaker for which court to prefer.

Revision ID: 0008_court_priority
Revises: 0007_drop_player_lessons
Create Date: 2026-09-04
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0008_court_priority"
down_revision = "0007_drop_player_lessons"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "courts",
        sa.Column("priority", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("courts", "priority")
