"""Allow one user account to link to multiple players (family accounts).

A parent may want to manage several of their children under a single
login. Coaches stay one-account-per-coach (unchanged) — this only affects
players.

Revision ID: 0009_multi_player_accounts
Revises: 0008_court_priority
Create Date: 2026-09-06
"""
from __future__ import annotations

from alembic import op

revision = "0009_multi_player_accounts"
down_revision = "0008_court_priority"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("uq_players_user_id", "players", type_="unique")
    # Lookups by user_id now commonly return >1 row instead of being a
    # unique-key lookup — a plain index keeps that fast.
    op.create_index("ix_players_user_id", "players", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_players_user_id", table_name="players")
    op.create_unique_constraint("uq_players_user_id", "players", ["user_id"])
