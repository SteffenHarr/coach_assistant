"""Pydantic schemas for the HTTP API.

All input is validated; sensitive fields (passwords, tokens) are excluded
from response models by construction.
"""

from __future__ import annotations

from datetime import date
from uuid import UUID

from fastapi_users import schemas as fa_schemas
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from coach_api.domain.entities import SessionType, TrainingCategory


# ---------- Auth ----------
#
# These inherit from fastapi-users' base schemas so the framework's helper
# methods (create_update_dict, etc.) are available. We override only what we
# need (longer minimum password, optional role field).


class UserRead(fa_schemas.BaseUser[UUID]):
    role: str = "player"


class UserCreate(fa_schemas.BaseUserCreate):
    password: str = Field(min_length=12, max_length=128)
    role: str = "player"


class UserUpdate(fa_schemas.BaseUserUpdate):
    password: str | None = Field(default=None, min_length=12, max_length=128)
    role: str | None = None


# ---------- Admin user management ----------


class AdminUserCreate(BaseModel):
    """Admin creates a user account on behalf of someone."""

    email: EmailStr
    password: str = Field(min_length=12, max_length=128)
    role: str = Field(default="player", pattern="^(admin|coach|player)$")


class AdminUserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    email: EmailStr
    role: str
    is_active: bool
    is_verified: bool
    is_superuser: bool


class AdminUserPatch(BaseModel):
    role: str | None = Field(default=None, pattern="^(admin|coach|player)$")
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=12, max_length=128)


# ---------- Coach ----------


class CoachConstraintsIn(BaseModel):
    min_block_slots: int = Field(0, ge=0, le=48)
    max_slots_per_day: int | None = Field(None, ge=0, le=48)
    max_slots_per_week: int | None = Field(None, ge=0, le=336)
    min_break_slots: int = Field(0, ge=0, le=48)
    # max. Pause zwischen zwei Blöcken am selben Tag (None = unbegrenzt,
    # 0 = keine Pause erlaubt -> Rückenwind-Sessions sollen aneinander
    # anschließen).
    max_break_slots: int | None = Field(None, ge=0, le=48)
    # New (stored alongside in the same JSON column — solver currently ignores
    # these, they are metadata for human matching).
    accepts_lk_min: int | None = Field(None, ge=1, le=25)
    accepts_lk_max: int | None = Field(None, ge=1, le=25)
    accepts_age_min: int | None = Field(None, ge=3, le=120)
    accepts_age_max: int | None = Field(None, ge=3, le=120)


class CoachIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    availability: list[int] = Field(default_factory=list)
    constraints: CoachConstraintsIn = Field(default_factory=CoachConstraintsIn)
    max_group_size: int = Field(4, ge=1, le=12)
    categories: list[TrainingCategory] = Field(default_factory=list)

    @field_validator("availability")
    @classmethod
    def _check_avail(cls, v: list[int]) -> list[int]:
        for s in v:
            if not 0 <= s < 7 * 48:
                raise ValueError("slot index out of range")
        return sorted(set(v))


class CoachOut(CoachIn):
    id: UUID


# ---------- Player ----------


class PlayerPreferencesIn(BaseModel):
    preferred_coach_ids: list[UUID] = Field(default_factory=list)
    preferred_partner_ids: list[UUID] = Field(default_factory=list)
    allowed_session_types: list[SessionType] = Field(
        default_factory=lambda: list(SessionType)
    )
    # New profile metadata (stored in the same JSON column — solver ignores).
    age: int | None = Field(None, ge=3, le=120)
    # Level on the German LK scale (1 = Profi, 25 = absolute Anfänger).
    # Only writable by coaches/admins (enforced in the route handler).
    level_lk: int | None = Field(None, ge=1, le=25)
    # Freitext-Bemerkung des Spielers (vom Spieler selbst pflegbar, von
    # Trainern lesbar). preferred_coach_ids / preferred_partner_ids sind
    # ausschließlich von Trainern/Admins pflegbar (siehe Router).
    notes: str = Field("", max_length=2000)


class PlayerIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    availability: list[int] = Field(default_factory=list)
    preferences: PlayerPreferencesIn = Field(default_factory=PlayerPreferencesIn)
    min_slots_per_week: int = Field(0, ge=0, le=48)
    max_slots_per_week: int = Field(4, ge=0, le=48)
    categories: list[TrainingCategory] = Field(default_factory=list)
    lessons: list["LessonIn"] = Field(default_factory=list)
    mates: list["PlayerMateIn"] = Field(default_factory=list)


class LessonIn(BaseModel):
    """Eine gewünschte Trainingseinheit pro Woche."""

    duration_slots: int = Field(ge=1, le=12)   # 1..12 Slots = 30..360 Min
    group_size: int = Field(ge=1, le=8)


class PlayerMateIn(BaseModel):
    """Ein Wunschpartner für diesen Spieler."""

    player_id: UUID
    mandatory: bool = False


class PlayerOut(PlayerIn):
    id: UUID


PlayerIn.model_rebuild()


# ---------- Court ----------


class CourtIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    availability: list[int] = Field(default_factory=list)
    indoor: bool = False


class CourtOut(CourtIn):
    id: UUID


# ---------- Season & Plan ----------


class SeasonIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    valid_from: date
    valid_to: date

    @field_validator("valid_to")
    @classmethod
    def _range(cls, v: date, info) -> date:  # type: ignore[no-untyped-def]
        if info.data.get("valid_from") and v <= info.data["valid_from"]:
            raise ValueError("valid_to must be after valid_from")
        return v


class SeasonOut(SeasonIn):
    id: UUID


class TrainingSessionOut(BaseModel):
    coach_id: UUID
    court_id: UUID
    player_ids: list[UUID]
    slot_indices: list[int]
    session_type: SessionType


class TrainingSessionIn(BaseModel):
    """Eine vom Nutzer im Editor angepasste Session.

    ``session_type`` wird beim Speichern aus ``len(player_ids)`` neu
    abgeleitet, deshalb optional."""

    coach_id: UUID
    court_id: UUID
    player_ids: list[UUID] = Field(default_factory=list)
    slot_indices: list[int] = Field(min_length=1)
    session_type: SessionType | None = None

    @field_validator("slot_indices")
    @classmethod
    def _check_slots(cls, v: list[int]) -> list[int]:
        if any(not 0 <= s < 7 * 48 for s in v):
            raise ValueError("slot index out of range")
        v = sorted(set(v))
        # must be consecutive within a single day
        for i in range(1, len(v)):
            if v[i] != v[i - 1] + 1:
                raise ValueError("slot_indices must be consecutive")
        return v


class PlanUpdateIn(BaseModel):
    sessions: list[TrainingSessionIn]


class PlanOut(BaseModel):
    id: UUID
    season_id: UUID
    score: float
    explanation: str
    sessions: list[TrainingSessionOut]


class GeneratePlanIn(BaseModel):
    season_id: UUID
    num_solutions: int = Field(3, ge=1, le=10)
    time_limit_seconds: float = Field(30.0, ge=1.0, le=300.0)


class WorkloadDeltaOut(BaseModel):
    coach_slots: dict[UUID, int] = Field(default_factory=dict)
    player_slots: dict[UUID, int] = Field(default_factory=dict)


class PlanDiffOut(BaseModel):
    added: list[TrainingSessionOut]
    removed: list[TrainingSessionOut]
    unchanged_count: int
    workload: WorkloadDeltaOut
    score_delta: float


# ---------- Agent / Chat ----------


class ChatMessage(BaseModel):
    role: str = Field(pattern=r"^(user|assistant)$")
    content: str = Field(min_length=1, max_length=8000)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=8000)
    history: list[ChatMessage] = Field(default_factory=list, max_length=40)


class ChatResponse(BaseModel):
    reply: str
