"""Pydantic schemas for the HTTP API.

All input is validated; sensitive fields (passwords, tokens) are excluded
from response models by construction.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from fastapi_users import schemas as fa_schemas
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

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
    # No ``role`` field here on purpose: this schema backs fastapi-users'
    # generic ``PATCH /users/me`` (self-service) and ``PATCH /users/{id}``
    # routes. fastapi-users' safe-mode update only strips its own hardcoded
    # fields (is_superuser/is_active/is_verified) from self-service updates,
    # not custom ones — a ``role`` field here would let any authenticated
    # user PATCH their own role. Role changes go exclusively through
    # ``PATCH /admin/users/{user_id}`` (admin-only, see routers.py).
    password: str | None = Field(default=None, min_length=12, max_length=128)


# ---------- Admin user management ----------


class AdminUserCreate(BaseModel):
    """Admin creates a user account on behalf of someone."""

    email: EmailStr
    password: str = Field(min_length=12, max_length=128)
    role: str = Field(default="player", pattern="^(admin|planner|coach|player)$")


class LinkedRecordOut(BaseModel):
    id: UUID
    name: str


class AdminUserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    email: EmailStr
    role: str
    is_active: bool
    is_verified: bool
    is_superuser: bool
    is_protected: bool = False
    privacy_accepted_at: datetime | None = None
    # Ein Konto darf mehrere Spieler verknüpft haben ("Familien-Account",
    # z.B. eine Mutter, die mehrere Kinder verwaltet) — Trainer bleiben
    # bewusst 1:1, siehe ``linked_coach_id``.
    linked_players: list[LinkedRecordOut] = Field(default_factory=list)
    linked_coach_id: UUID | None = None
    linked_coach_name: str | None = None


class AdminUserPatch(BaseModel):
    # No ``is_protected`` field here on purpose — it must never be settable
    # through the API (see UserORM.is_protected), only directly in the
    # database, so no admin can un-protect a protected account.
    email: EmailStr | None = None
    role: str | None = Field(default=None, pattern="^(admin|planner|coach|player)$")
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

    @model_validator(mode="after")
    def _check_ranges(self) -> "CoachConstraintsIn":
        if self.max_slots_per_day is not None and self.min_block_slots > self.max_slots_per_day:
            raise ValueError("Mindest-Block darf nicht größer als Max Std/Tag sein")
        if self.max_break_slots is not None and self.min_break_slots > self.max_break_slots:
            raise ValueError("Mindest-Pause darf nicht größer als Max-Pause sein")
        if (
            self.accepts_lk_min is not None
            and self.accepts_lk_max is not None
            and self.accepts_lk_min > self.accepts_lk_max
        ):
            raise ValueError("LK-Minimum darf nicht größer als LK-Maximum sein")
        if (
            self.accepts_age_min is not None
            and self.accepts_age_max is not None
            and self.accepts_age_min > self.accepts_age_max
        ):
            raise ValueError("Alter-Minimum darf nicht größer als Alter-Maximum sein")
        return self


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
    has_account: bool = False
    # Pausiert-Schalter (liegt in constraints JSON) — wird mit ausgeliefert,
    # damit Listen/Filter im Frontend danach filtern können.
    active: bool = True


# ---------- Player ----------


class PlayerPreferencesIn(BaseModel):
    preferred_coach_ids: list[UUID] = Field(default_factory=list)
    preferred_partner_ids: list[UUID] = Field(default_factory=list)
    allowed_session_types: list[SessionType] = Field(
        default_factory=lambda: list(SessionType)
    )
    # New profile metadata (stored in the same JSON column — solver ignores).
    # ``age`` is only a fallback for players without a ``birth_date`` (e.g.
    # admin-managed players without their own login). Once ``birth_date`` is
    # set, the server recomputes ``age`` from it on every read and this
    # field is ignored on write.
    age: int | None = Field(None, ge=3, le=120)
    birth_date: date | None = None
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
    min_slots_per_week: int = Field(2, ge=0, le=48)  # = 1 Std
    max_slots_per_week: int = Field(2, ge=0, le=48)  # = 1 Std
    categories: list[TrainingCategory] = Field(default_factory=list)
    mates: list["PlayerMateIn"] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check_min_max(self) -> "PlayerIn":
        if self.min_slots_per_week > self.max_slots_per_week:
            raise ValueError("Min Std/Woche darf nicht größer als Max Std/Woche sein")
        return self


class PlayerMateIn(BaseModel):
    """Ein Wunschpartner für diesen Spieler."""

    player_id: UUID
    mandatory: bool = False


class PlayerOut(PlayerIn):
    id: UUID
    has_account: bool = False
    # Pausiert-Schalter (liegt in preferences JSON) — siehe CoachOut.active.
    active: bool = True


PlayerIn.model_rebuild()


# ---------- Court ----------


class CourtIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    availability: list[int] = Field(default_factory=list)
    indoor: bool = False
    # Solver-Präferenz innerhalb Halle/Draußen: 0 = am liebsten. Nur ein
    # weicher Tie-Breaker, siehe domain.entities.Court.
    priority: int = Field(0, ge=0, le=99)


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
    # Freitext statt Spielerliste (z.B. "Damen 30") — nur manuell im Editor
    # gesetzt, nie vom Solver.
    label: str | None = None
    # Kurzbeschreibung neben dem Trainer (z.B. "U15") — ergänzt die
    # Spielerliste, ersetzt sie nicht.
    note: str | None = None
    # Weitere Trainer derselben Einheit (z.B. zwei Trainer bei einer großen
    # Zwerge-Gruppe). Nur manuell, der Solver lässt das leer.
    extra_coach_ids: list[UUID] = Field(default_factory=list)
    # Kurznotiz hinter einzelnen Spielernamen (z.B. "gerade Wochen"),
    # je Spieler und nur für diese Einheit.
    player_notes: dict[UUID, str] = Field(default_factory=dict)


class TrainingSessionIn(BaseModel):
    """Eine vom Nutzer im Editor angepasste Session.

    ``session_type`` wird beim Speichern aus ``len(player_ids)`` neu
    abgeleitet, deshalb optional."""

    coach_id: UUID
    court_id: UUID
    player_ids: list[UUID] = Field(default_factory=list)
    slot_indices: list[int] = Field(min_length=1)
    session_type: SessionType | None = None
    label: str | None = Field(None, max_length=100)
    note: str | None = Field(None, max_length=60)
    extra_coach_ids: list[UUID] = Field(default_factory=list)
    player_notes: dict[UUID, str] = Field(default_factory=dict)

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
    published: bool = False
    created_at: datetime | None = None


class GeneratePlanIn(BaseModel):
    season_id: UUID
    num_solutions: int = Field(3, ge=1, le=10)
    # War 30s: bei der echten Datenmenge des Vereins reichte das oft nicht,
    # um über FEASIBLE hinaus eine bewiesen gute Lösung zu finden — Trainer
    # blieben ungenutzt und Wunschmitspieler wurden verworfen, obwohl es
    # zeitlich gepasst hätte. Plan-Generierung läuft asynchron im Worker,
    # eine längere Wartezeit kostet also keine blockierte UI.
    time_limit_seconds: float = Field(300.0, ge=1.0, le=1800.0)
    # "both" (Default) = alle Plätze. "indoor" = nur Hallenplätze.
    # "outdoor" = nur Außenplätze. So kann der Coach z.B. für den
    # Winterplan die Outdoor-Plätze ausblenden.
    court_filter: Literal["both", "indoor", "outdoor"] = "both"


class WorkloadDeltaOut(BaseModel):
    coach_slots: dict[UUID, int] = Field(default_factory=dict)
    player_slots: dict[UUID, int] = Field(default_factory=dict)


class PlanDiffOut(BaseModel):
    added: list[TrainingSessionOut]
    removed: list[TrainingSessionOut]
    unchanged_count: int
    workload: WorkloadDeltaOut
    score_delta: float


# ---------- Account creation for existing domain records ----------


class CreateAccountIn(BaseModel):
    """Create a login account for an existing player or coach record."""

    email: EmailStr
    password: str = Field(min_length=12, max_length=128)


# ---------- Agent / Chat ----------


class ChatMessage(BaseModel):
    role: str = Field(pattern=r"^(user|assistant)$")
    content: str = Field(min_length=1, max_length=8000)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=8000)
    history: list[ChatMessage] = Field(default_factory=list, max_length=40)


class ChatResponse(BaseModel):
    reply: str
