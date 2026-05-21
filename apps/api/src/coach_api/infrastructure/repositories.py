"""SQLAlchemy-based implementations of the application ports."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from coach_api.domain.entities import (
    Coach,
    CoachConstraints,
    Court,
    Lesson,
    Player,
    PlayerMate,
    PlayerPreferences,
    Season,
    SessionType,
    TrainingCategory,
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


def _safe_category(value: object) -> TrainingCategory | None:
    try:
        return TrainingCategory(str(value))
    except (ValueError, TypeError):
        return None


def _parse_categories(raw: object) -> frozenset[TrainingCategory]:
    """Parst eine Liste (oder einen Einzelwert aus Legacy-Daten) zu einem
    Set von Kategorien. Unbekannte Werte werden übersprungen.

    Legacy-Kompatibilität:
    - ``"open"`` oder leere Liste / None -> leere Menge (= Wildcard).
    - Einzel-String aus alten Daten wird zu einer 1-elementigen Menge.
    """
    if raw is None:
        return frozenset()
    if isinstance(raw, str):
        raw = [raw]
    out: set[TrainingCategory] = set()
    for x in raw:
        c = _safe_category(x)
        if c is None or c == TrainingCategory.OPEN:
            continue
        out.add(c)
    return frozenset(out)


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
            max_break_slots=c.get("max_break_slots"),
            accepts_lk_min=c.get("accepts_lk_min"),
            accepts_lk_max=c.get("accepts_lk_max"),
            accepts_age_min=c.get("accepts_age_min"),
            accepts_age_max=c.get("accepts_age_max"),
        ),
        max_group_size=o.max_group_size,
        categories=_parse_categories(c.get("categories")),
    )


def _player_from_orm(o: PlayerORM) -> Player:
    pref = o.preferences or {}
    lessons_raw = o.lessons or []
    mates_raw = o.mates or []
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
            notes=pref.get("notes", "") or "",
        ),
        min_slots_per_week=o.min_slots_per_week,
        max_slots_per_week=o.max_slots_per_week,
        age=pref.get("age"),
        level_lk=pref.get("level_lk"),
        categories=_parse_categories(
            pref.get("categories") if "categories" in pref else pref.get("category")
        ),
        lessons=tuple(
            Lesson(
                duration_slots=int(l.get("duration_slots", 2)),
                group_size=int(l.get("group_size", 1)),
            )
            for l in lessons_raw
            if int(l.get("duration_slots", 0)) > 0
        ),
        mates=tuple(
            PlayerMate(
                player_id=UUID(m["player_id"]),
                mandatory=bool(m.get("mandatory", False)),
            )
            for m in mates_raw
            if m.get("player_id")
        ),
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
        # Bestehende constraints-Felder erhalten, die nicht im Domain-Modell
        # liegen (z.B. accepts_lk_min/age etc. werden separat per Endpoint
        # gepflegt).
        old_constraints = (existing.constraints if existing else {}) or {}
        constraints_dict = dict(old_constraints)
        constraints_dict.update(
            {
                "min_block_slots": coach.constraints.min_block_slots,
                "max_slots_per_day": coach.constraints.max_slots_per_day,
                "max_slots_per_week": coach.constraints.max_slots_per_week,
                "min_break_slots": coach.constraints.min_break_slots,
                "categories": sorted(c.value for c in coach.categories),
            }
        )
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
        # Preferences-Bytes (level_lk, age, notes werden hier durchgereicht,
        # damit bestehende Felder erhalten bleiben).
        old_pref = (existing.preferences if existing else {}) or {}
        pref = {
            "preferred_coach_ids": [str(x) for x in player.preferences.preferred_coach_ids],
            "preferred_partner_ids": [str(x) for x in player.preferences.preferred_partner_ids],
            "allowed_session_types": [s.value for s in player.preferences.allowed_session_types],
            "notes": player.preferences.notes,
            "age": player.age if player.age is not None else old_pref.get("age"),
            "level_lk": player.level_lk if player.level_lk is not None else old_pref.get("level_lk"),
            "categories": sorted(c.value for c in player.categories),
        }
        # Legacy-Single-Value-Feld konsequent entfernen, damit Loader nicht
        # versehentlich auf den alten Wert zur\u00fcckf\u00e4llt.
        old_pref.pop("category", None)
        # Lessons: aus Domain ableiten und min_slots_per_week konsistent setzen.
        lessons_json = [
            {"duration_slots": l.duration_slots, "group_size": l.group_size}
            for l in player.lessons
        ]
        derived_min = sum(l.duration_slots for l in player.lessons)
        # Wenn der Spieler Lessons hat, leiten wir min_slots davon ab.
        # Andernfalls behalten wir den vorhandenen Wert (Bestandsdaten).
        effective_min = derived_min if player.lessons else player.min_slots_per_week

        if existing is None:
            existing = PlayerORM(id=player.id)
            self._s.add(existing)
        existing.name = player.name
        existing.availability = sorted(player.availability)
        existing.preferences = pref
        existing.min_slots_per_week = effective_min
        existing.max_slots_per_week = player.max_slots_per_week
        existing.lessons = lessons_json
        existing.mates = [
            {"player_id": str(m.player_id), "mandatory": m.mandatory}
            for m in player.mates
        ]
        await self._s.flush()
        # Symmetrie der Mate-Beziehung herstellen: für jeden Mate B von A
        # sicherstellen, dass A auch in B's Mates ist (mit dem selben
        # mandatory-Flag - mandatory "gewinnt", falls Konflikt).
        await _mirror_mates(self._s, player.id, player.mates)
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


async def _mirror_mates(
    session: AsyncSession,
    player_id: UUID,
    mates: tuple[PlayerMate, ...],
) -> None:
    """Spiegelt Mate-Beziehungen symmetrisch in der DB.

    Wenn A {B mandatory} hat, sorgt diese Funktion dafür, dass B's mates
    ebenfalls A enthält (mit demselben mandatory-Flag). mandatory
    "gewinnt" bei Konflikt. Bestehende Einträge in B's Liste, die A nicht
    referenzieren, bleiben unangetastet (wir greifen nicht weiter ins
    fremde Profil ein).
    """
    wanted: dict[UUID, bool] = {m.player_id: m.mandatory for m in mates}
    if not wanted:
        return
    rows = (
        await session.execute(
            select(PlayerORM).where(PlayerORM.id.in_(list(wanted.keys())))
        )
    ).scalars().all()
    for partner in rows:
        existing_list = list(partner.mates or [])
        idx = next(
            (i for i, e in enumerate(existing_list)
             if e.get("player_id") == str(player_id)),
            None,
        )
        new_entry = {"player_id": str(player_id), "mandatory": wanted[partner.id]}
        if idx is None:
            existing_list.append(new_entry)
        else:
            # mandatory gewinnt: nur upgraden, nie downgraden.
            if wanted[partner.id]:
                existing_list[idx] = new_entry
        partner.mates = existing_list
