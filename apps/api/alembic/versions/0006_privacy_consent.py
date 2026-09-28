"""Add users.privacy_accepted_at (first-login Datenschutz consent).

Revision ID: 0006_privacy_consent
Revises: 0005_unique_user_domain_link
Create Date: 2026-08-24
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0006_privacy_consent"
down_revision = "0005_unique_user_domain_link"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("privacy_accepted_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "privacy_accepted_at")
