"""SQLAlchemy-based implementations of the application ports."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from coach_api.domain.entities import (
    Coach,
    CoachConstraints,
    Court,
    Player,
    PlayerPreferences,
    Season,
    SessionType,
    TrainingSession,
    WeeklyPlan,
)
from coach_api.infrastructure.models import (
    CoachORM,
    CourtORM,
    PlanORM,
    PlayerORM,
    SeasonORM,
)


def _coach_from_orm(o: CoachORM) -> Coach:
    c = o.constraints or {}
    return Coach(
        id=o.id,
        name=o.name,
        availability=frozenset(o.availability or []),
        constraints=CoachConstraints(
            min_block_slots=c.get("min_block_slots", 0),
            max_slots_per_day=c.get("max_slots_per_day"),
            max_slots_per_week=c.get("max_slots_per_week"),
            min_break_slots=c.get("min_break_slots", 0),
        ),
        max_group_size=o.max_group_size,
    )


def _player_from_orm(o: PlayerORM) -> Player:
    pref = o.preferences or {}
    return Player(
        id=o.id,
        name=o.name,
        availability=frozenset(o.availability or []),
        preferences=PlayerPreferences(
            preferred_coach_ids=tuple(UUID(x) for x in pref.get("preferred_coach_ids", [])),
            preferred_partner_ids=tuple(UUID(x) for x in pref.get("preferred_partner_ids", [])),
            allowed_session_types=frozenset(
                SessionType(s) for s in pref.get("allowed_session_types", [s.value for s in SessionType])
            ),
        ),
        min_slots_per_week=o.min_slots_per_week,
        max_slots_per_week=o.max_slots_per_week,
    )


def _court_from_orm(o: CourtORM) -> Court:
    return Court(
        id=o.id,
        name=o.name,
        availability=frozenset(o.availability or []),
        indoor=o.indoor,
    )


def _season_from_orm(o: SeasonORM) -> Season:
    return Season(id=o.id, name=o.name, valid_from=o.valid_from, valid_to=o.valid_to)  # type: ignore[arg-type]


def _plan_to_orm(p: WeeklyPlan) -> PlanORM:
    return PlanORM(
        id=p.id,
        season_id=p.season_id,
        score=p.score,
        explanation=p.explanation,
        sessions=[
            {
                "coach_id": str(s.coach_id),
                "court_id": str(s.court_id),
                "player_ids": [str(pid) for pid in s.player_ids],
                "slot_indices": list(s.slot_indices),
                "session_type": s.session_type.value,
            }
            for s in p.sessions
        ],
    )


def _plan_from_orm(o: PlanORM) -> WeeklyPlan:
    return WeeklyPlan(
        id=o.id,
        season_id=o.season_id,
        score=o.score,
        explanation=o.explanation,
        sessions=tuple(
            TrainingSession(
                coach_id=UUID(s["coach_id"]),
                court_id=UUID(s["court_id"]),
                player_ids=tuple(UUID(pid) for pid in s["player_ids"]),
                slot_indices=tuple(s["slot_indices"]),
                session_type=SessionType(s["session_type"]),
            )
            for s in (o.sessions or [])
        ),
    )


class SqlCoachRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def list_all(self) -> list[Coach]:
        rows = (await self._s.execute(select(CoachORM))).scalars().all()
        return [_coach_from_orm(r) for r in rows]

    async def get(self, coach_id: UUID) -> Coach | None:
        row = await self._s.get(CoachORM, coach_id)
        return _coach_from_orm(row) if row else None

    async def upsert(self, coach: Coach) -> Coach:
        existing = await self._s.get(CoachORM, coach.id)
        constraints_dict = {
            "min_block_slots": coach.constraints.min_block_slots,
            "max_slots_per_day": coach.constraints.max_slots_per_day,
            "max_slots_per_week": coach.constraints.max_slots_per_week,
            "min_break_slots": coach.constraints.min_break_slots,
        }
        if existing is None:
            existing = CoachORM(id=coach.id)
            self._s.add(existing)
        existing.name = coach.name
        existing.availability = sorted(coach.availability)
        existing.constraints = constraints_dict
        existing.max_group_size = coach.max_group_size
        await self._s.commit()
        return coach


class SqlPlayerRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def list_all(self) -> list[Player]:
        rows = (await self._s.execute(select(PlayerORM))).scalars().all()
        return [_player_from_orm(r) for r in rows]

    async def get(self, player_id: UUID) -> Player | None:
        row = await self._s.get(PlayerORM, player_id)
        return _player_from_orm(row) if row else None

    async def upsert(self, player: Player) -> Player:
        existing = await self._s.get(PlayerORM, player.id)
        pref = {
            "preferred_coach_ids": [str(x) for x in player.preferences.preferred_coach_ids],
            "preferred_partner_ids": [str(x) for x in player.preferences.preferred_partner_ids],
            "allowed_session_types": [s.value for s in player.preferences.allowed_session_types],
        }
        if existing is None:
            existing = PlayerORM(id=player.id)
            self._s.add(existing)
        existing.name = player.name
        existing.availability = sorted(player.availability)
        existing.preferences = pref
        existing.min_slots_per_week = player.min_slots_per_week
        existing.max_slots_per_week = player.max_slots_per_week
        await self._s.commit()
        return player


class SqlCourtRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def list_all(self) -> list[Court]:
        rows = (await self._s.execute(select(CourtORM))).scalars().all()
        return [_court_from_orm(r) for r in rows]

    async def upsert(self, court: Court) -> Court:
        existing = await self._s.get(CourtORM, court.id)
        if existing is None:
            existing = CourtORM(id=court.id)
            self._s.add(existing)
        existing.name = court.name
        existing.availability = sorted(court.availability)
        existing.indoor = court.indoor
        await self._s.commit()
        return court


class SqlSeasonRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def list_all(self) -> list[Season]:
        rows = (await self._s.execute(select(SeasonORM))).scalars().all()
        return [_season_from_orm(r) for r in rows]

    async def get(self, season_id: UUID) -> Season | None:
        row = await self._s.get(SeasonORM, season_id)
        return _season_from_orm(row) if row else None

    async def create(self, season: Season) -> Season:
        orm = SeasonORM(
            id=season.id, name=season.name, valid_from=season.valid_from, valid_to=season.valid_to
        )
        self._s.add(orm)
        await self._s.commit()
        return season


class SqlPlanRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def list_for_season(self, season_id: UUID) -> list[WeeklyPlan]:
        rows = (
            await self._s.execute(select(PlanORM).where(PlanORM.season_id == season_id))
        ).scalars().all()
        return [_plan_from_orm(r) for r in rows]

    async def get(self, plan_id: UUID) -> WeeklyPlan | None:
        row = await self._s.get(PlanORM, plan_id)
        return _plan_from_orm(row) if row else None

    async def save_many(self, plans: list[WeeklyPlan]) -> list[WeeklyPlan]:
        for p in plans:
            self._s.add(_plan_to_orm(p))
        await self._s.commit()
        return plans
