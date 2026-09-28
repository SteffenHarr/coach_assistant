"""ORM models — minimal, persistence-focused.

Domain entities live in ``coach_api.domain.entities`` and are mapped to/from
these ORM models in the repositories. We deliberately keep the two layers
separate so that domain logic stays framework-free.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    func,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from coach_api.infrastructure.db import Base


class UserRole(StrEnum):
    ADMIN = "admin"
    PLANNER = "planner"   # creates/edits plans, sees all data; cannot manage users
    COACH = "coach"
    PLAYER = "player"


class UserORM(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(1024), nullable=False)
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), default=UserRole.PLAYER, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_superuser: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Master-admin flag. Deliberately NOT exposed through any PATCH schema —
    # it can only be set directly in the database (see docs/SETUP.md). Once
    # set, admin_update_user/admin_delete_user refuse to modify or delete
    # this account unless the actor *is* this account, so no other admin
    # (including other admins) can demote, deactivate, or delete it.
    is_protected: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Set once the user has actively confirmed the Datenschutzerklärung
    # (first-login consent gate, see PrivacyConsentGate.tsx). NULL = not
    # yet confirmed.
    privacy_accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CoachORM(Base):
    __tablename__ = "coaches"

    id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # unique: a user account may be linked to at most one coach record (NULL
    # is exempt from the uniqueness check, so many coaches can stay unlinked).
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, unique=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    availability: Mapped[list[int]] = mapped_column(JSON, default=list, nullable=False)
    constraints: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    max_group_size: Mapped[int] = mapped_column(Integer, default=4, nullable=False)


class PlayerORM(Base):
    __tablename__ = "players"

    id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # NOT unique (deliberately, unlike coaches.user_id): one user account may
    # be linked to *several* player records — e.g. a parent managing more
    # than one of their children under a single login ("family account").
    # NULL means unlinked.
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    availability: Mapped[list[int]] = mapped_column(JSON, default=list, nullable=False)
    preferences: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    min_slots_per_week: Mapped[int] = mapped_column(Integer, default=2, nullable=False)
    max_slots_per_week: Mapped[int] = mapped_column(Integer, default=2, nullable=False)
    # Liste {player_id, mandatory} - vom Trainer kuratierte Wunschpartner.
    # Symmetrie wird im Repository erzwungen.
    mates: Mapped[list[dict]] = mapped_column(JSON, default=list, nullable=False)


class CourtORM(Base):
    __tablename__ = "courts"

    id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    availability: Mapped[list[int]] = mapped_column(JSON, default=list, nullable=False)
    indoor: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    priority: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class SeasonORM(Base):
    __tablename__ = "seasons"

    id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    valid_from: Mapped[Date] = mapped_column(Date, nullable=False)
    valid_to: Mapped[Date] = mapped_column(Date, nullable=False)


class PlanORM(Base):
    __tablename__ = "plans"

    id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    season_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("seasons.id", ondelete="CASCADE"), nullable=False
    )
    score: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    explanation: Mapped[str] = mapped_column(String, default="", nullable=False)
    sessions: Mapped[list[dict]] = mapped_column(JSON, default=list, nullable=False)
    published: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AuditLogORM(Base):
    __tablename__ = "audit_log"

    id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    target_type: Mapped[str] = mapped_column(String(80), nullable=False)
    target_id: Mapped[str] = mapped_column(String(80), nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
