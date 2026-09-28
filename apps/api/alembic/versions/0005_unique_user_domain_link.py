"""Unique constraint on coaches.user_id / players.user_id.

A user account may be linked to at most one coach and one player record
(NULL stays exempt, so unlinked domain records are unaffected).

Revision ID: 0005_unique_user_domain_link
Revises: 0004_user_protected_flag
Create Date: 2026-08-21
"""
from __future__ import annotations

from alembic import op

revision = "0005_unique_user_domain_link"
down_revision = "0004_user_protected_flag"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_unique_constraint("uq_coaches_user_id", "coaches", ["user_id"])
    op.create_unique_constraint("uq_players_user_id", "players", ["user_id"])


def downgrade() -> None:
    op.drop_constraint("uq_players_user_id", "players", type_="unique")
    op.drop_constraint("uq_coaches_user_id", "coaches", type_="unique")
