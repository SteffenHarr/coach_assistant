"""Add planner role and plan.published column.

Revision ID: 0003_planner_role_published
Revises: 0002_player_lessons_mates
Create Date: 2026-06-03
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0003_planner_role_published"
down_revision = "0002_player_lessons_mates"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # role column is VARCHAR(20) — no schema change needed, 'planner' is just a new valid string.
    # plans: add published flag (default False — existing plans start unpublished)
    op.add_column(
        "plans",
        sa.Column(
            "published",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("plans", "published")
