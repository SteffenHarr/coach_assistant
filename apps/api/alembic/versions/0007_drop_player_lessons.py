"""Drop players.lessons — replaced by allowed_session_types checkboxes.

The old "Trainingseinheiten hinzufuegen" feature (fixed duration + explicit
min/max group size per desired weekly unit) is replaced by three simple
checkboxes (Einzel/Zweier/Gruppentraining) stored in
``players.preferences.allowed_session_types``. Per product decision, old
lesson data is discarded rather than migrated.

Revision ID: 0007_drop_player_lessons
Revises: 0006_privacy_consent
Create Date: 2026-09-02
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0007_drop_player_lessons"
down_revision = "0006_privacy_consent"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("players", "lessons")


def downgrade() -> None:
    op.add_column(
        "players",
        sa.Column(
            "lessons",
            JSONB,
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
