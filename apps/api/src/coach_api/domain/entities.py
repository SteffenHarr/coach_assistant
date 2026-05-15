"""Domain entities — pure Python, no ORM, no framework."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from enum import StrEnum
from uuid import UUID, uuid4


class SessionType(StrEnum):
    SINGLE = "single"      # 1 player
    DOUBLE = "double"      # 2 players
    GROUP = "group"        # >=3 players


@dataclass(frozen=True, slots=True)
class CoachConstraints:
    """Hard scheduling constraints for a coach.

    All times are expressed in *slots* of the active TimeGrid.
    """

    min_block_slots: int = 0          # mind. zusammenhängender Block (0 = aus)
    max_slots_per_day: int | None = None
    max_slots_per_week: int | None = None
    min_break_slots: int = 0          # mind. Pause zwischen zwei Blöcken am selben Tag


@dataclass(slots=True)
class Coach:
    name: str
    id: UUID = field(default_factory=uuid4)
    availability: frozenset[int] = field(default_factory=frozenset)
    constraints: CoachConstraints = field(default_factory=CoachConstraints)
    max_group_size: int = 4


@dataclass(frozen=True, slots=True)
class PlayerPreferences:
    preferred_coach_ids: tuple[UUID, ...] = ()
    preferred_partner_ids: tuple[UUID, ...] = ()
    allowed_session_types: frozenset[SessionType] = frozenset(
        {SessionType.SINGLE, SessionType.DOUBLE, SessionType.GROUP}
    )


@dataclass(slots=True)
class Player:
    name: str
    id: UUID = field(default_factory=uuid4)
    availability: frozenset[int] = field(default_factory=frozenset)
    preferences: PlayerPreferences = field(default_factory=PlayerPreferences)
    min_slots_per_week: int = 0
    max_slots_per_week: int = 4


@dataclass(slots=True)
class Court:
    name: str
    id: UUID = field(default_factory=uuid4)
    availability: frozenset[int] = field(default_factory=frozenset)
    indoor: bool = False


@dataclass(frozen=True, slots=True)
class TrainingSession:
    """One scheduled training unit on the weekly grid."""

    coach_id: UUID
    court_id: UUID
    player_ids: tuple[UUID, ...]
    slot_indices: tuple[int, ...]   # consecutive
    session_type: SessionType


@dataclass(slots=True)
class Season:
    name: str                       # z. B. "Sommer 2026"
    valid_from: date
    valid_to: date
    id: UUID = field(default_factory=uuid4)


@dataclass(slots=True)
class WeeklyPlan:
    season_id: UUID
    sessions: tuple[TrainingSession, ...]
    score: float = 0.0
    id: UUID = field(default_factory=uuid4)
    explanation: str = ""
