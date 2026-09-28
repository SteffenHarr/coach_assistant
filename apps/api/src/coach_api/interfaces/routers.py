"""HTTP routers."""

from __future__ import annotations

from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from coach_api.application.use_cases import GeneratePlanCommand, GeneratePlanUseCase
from coach_api.application.diff import diff_plans
from coach_api.domain.entities import (
    Coach,
    CoachConstraints,
    Court,
    Player,
    PlayerMate,
    PlayerPreferences,
    Season,
    SessionType,
    TrainingCategory,
    compute_age,
)
from coach_api.infrastructure.auth import current_active_user, require_role
from coach_api.infrastructure.db import get_db
from coach_api.infrastructure.models import AuditLogORM, CoachORM, PlayerORM, UserORM, UserRole
from coach_api.infrastructure.repositories import (
    SqlCoachRepository,
    SqlCourtRepository,
    SqlPlanRepository,
    SqlPlayerRepository,
    SqlSeasonRepository,
    _mirror_mates,
)
from coach_api.infrastructure.security import limiter
from coach_api.interfaces.schemas import (
    AdminUserCreate,
    AdminUserOut,
    AdminUserPatch,
    ChatRequest,
    ChatResponse,
    CoachIn,
    CoachOut,
    CourtIn,
    CourtOut,
    CreateAccountIn,
    GeneratePlanIn,
    LinkedRecordOut,
    PlanOut,
    PlanUpdateIn,
    PlayerIn,
    PlayerOut,
    SeasonIn,
    SeasonOut,
    TrainingSessionOut,
)
from coach_api.interfaces.schemas import PlanDiffOut

router = APIRouter()


def _is_privileged(user: UserORM) -> bool:
    """Admin, planner, and superusers can see and do everything."""
    return user.is_superuser or user.role in (UserRole.ADMIN, UserRole.PLANNER)


# Categories stored before the 2026-08 rework (kids/youth/competitive) no
# longer exist as TrainingCategory members. Reading them straight into a
# Pydantic model raises a ValidationError, so every read path normalizes
# through here first. This only affects *display* of legacy records — an
# admin/coach still needs to manually re-assign the correct new category
# (e.g. a specific U-group) for anyone who had "kids" or "youth" set, since
# only they know which age bracket that person actually belongs to.
_LEGACY_CATEGORY_MAP = {"competitive": "foerderkader"}
_LEGACY_CATEGORY_DROP = {"kids", "youth"}


def _name_variants_match(a: str, b: str) -> bool:
    """True if two names are the same, ignoring case and word order (so
    "Max Mustermann" matches "Mustermann Max")."""
    a_parts = sorted(a.strip().lower().split())
    b_parts = sorted(b.strip().lower().split())
    return bool(a_parts) and a_parts == b_parts


def _normalize_categories(raw: object) -> list[str]:
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for item in raw:
        v = _LEGACY_CATEGORY_MAP.get(str(item), str(item))
        if v in _LEGACY_CATEGORY_DROP:
            continue
        try:
            TrainingCategory(v)
        except ValueError:
            continue
        if v not in out:
            out.append(v)
    return out


def _session_to_out(s) -> TrainingSessionOut:  # type: ignore[no-untyped-def]
    return TrainingSessionOut(
        coach_id=s.coach_id,
        court_id=s.court_id,
        player_ids=list(s.player_ids),
        slot_indices=list(s.slot_indices),
        session_type=s.session_type,
        label=s.label,
        note=s.note,
        extra_coach_ids=list(s.extra_coach_ids),
        player_notes=dict(s.player_notes),
    )


def _plan_to_out(p, *, published: bool = False, created_at=None) -> PlanOut:  # type: ignore[no-untyped-def]
    return PlanOut(
        id=p.id,
        season_id=p.season_id,
        score=p.score,
        explanation=p.explanation,
        sessions=[_session_to_out(s) for s in p.sessions],
        published=published,
        created_at=created_at,
    )


async def _audit(
    db: AsyncSession, actor: UserORM | None, action: str, target_type: str, target_id: str, payload: dict
) -> None:
    db.add(
        AuditLogORM(
            actor_user_id=actor.id if actor else None,
            action=action,
            target_type=target_type,
            target_id=target_id,
            payload=payload,
        )
    )
    await db.commit()


# ---------- Coaches ----------


def _coach_orm_to_out(row: CoachORM) -> CoachOut:
    constraints = row.constraints or {}
    return CoachOut(
        id=row.id,
        name=row.name,
        availability=sorted(row.availability or []),
        constraints={
            "min_block_slots": constraints.get("min_block_slots", 0),
            "max_slots_per_day": constraints.get("max_slots_per_day"),
            "max_slots_per_week": constraints.get("max_slots_per_week"),
            "min_break_slots": constraints.get("min_break_slots", 0),
            "max_break_slots": constraints.get("max_break_slots"),
        },
        max_group_size=row.max_group_size or 4,
        categories=sorted(_normalize_categories(constraints.get("categories", []))),
        has_account=row.user_id is not None,
        active=bool(constraints.get("active", True)),
    )


@router.get("/coaches", response_model=list[CoachOut])
async def list_coaches(
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(current_active_user),
) -> list[CoachOut]:
    from sqlalchemy import select

    # Coaches see every coach too — a coach-only roster of "myself" isn't
    # useful (only admin/planner/coach ever reach this page anyway).
    if _is_privileged(user) or user.role == UserRole.COACH:
        rows = (await db.execute(select(CoachORM).order_by(CoachORM.name))).scalars().all()
    else:
        row = (await db.execute(select(CoachORM).where(CoachORM.user_id == user.id))).scalar_one_or_none()
        rows = [row] if row else []
    return [_coach_orm_to_out(r) for r in rows]


@router.post("/coaches", response_model=CoachOut, status_code=status.HTTP_201_CREATED)
async def create_coach(
    data: CoachIn,
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(require_role(UserRole.ADMIN, UserRole.PLANNER)),
) -> CoachOut:
    # Admin-only: coaches edit *their own* record via PUT /me/profile/coach.
    repo = SqlCoachRepository(db)
    coach = Coach(
        name=data.name,
        availability=frozenset(data.availability),
        constraints=CoachConstraints(**data.constraints.model_dump()),
        max_group_size=data.max_group_size,
        categories=frozenset(TrainingCategory(c) for c in data.categories),
    )
    saved = await repo.upsert(coach)
    await _audit(db, user, "create", "coach", str(saved.id), data.model_dump())
    return CoachOut(id=saved.id, **data.model_dump())


# ---------- Players ----------


@router.get("/players", response_model=list[PlayerOut])
async def list_players(
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(current_active_user),
) -> list[PlayerOut]:
    from sqlalchemy import select

    # Coaches see the full roster too (they manage mates/level for
    # players), just like admin/planner — only plain players are limited to
    # their own record(s) — a player role account may be linked to more
    # than one player (e.g. a parent managing several children).
    if _is_privileged(user) or user.role == UserRole.COACH:
        rows = (await db.execute(select(PlayerORM).order_by(PlayerORM.name))).scalars().all()
    else:
        rows = (
            await db.execute(select(PlayerORM).where(PlayerORM.user_id == user.id).order_by(PlayerORM.name))
        ).scalars().all()
    return [PlayerOut(**_player_orm_to_dict(r, include_preferences=_is_privileged(user) or user.role == UserRole.COACH)) for r in rows]


@router.post("/players", response_model=PlayerOut, status_code=status.HTTP_201_CREATED)
async def create_player(
    data: PlayerIn,
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(require_role(UserRole.ADMIN, UserRole.PLANNER)),
) -> PlayerOut:
    # Admin-only: players edit *their own* record via PUT /me/profile/player.
    # Coaches set player LK via PATCH /players/{id}/level.
    repo = SqlPlayerRepository(db)
    player = Player(
        name=data.name,
        availability=frozenset(data.availability),
        preferences=PlayerPreferences(
            preferred_coach_ids=tuple(data.preferences.preferred_coach_ids),
            preferred_partner_ids=tuple(data.preferences.preferred_partner_ids),
            allowed_session_types=frozenset(
                SessionType(s) for s in data.preferences.allowed_session_types
            ),
            notes=data.preferences.notes,
        ),
        min_slots_per_week=data.min_slots_per_week,
        max_slots_per_week=data.max_slots_per_week,
        age=data.preferences.age,
        level_lk=data.preferences.level_lk,
        categories=frozenset(TrainingCategory(c) for c in data.categories),
        mates=tuple(
            PlayerMate(player_id=m.player_id, mandatory=m.mandatory)
            for m in data.mates
        ),
    )
    saved = await repo.upsert(player)
    await _audit(db, user, "create", "player", str(saved.id), data.model_dump(mode="json"))
    return PlayerOut(id=saved.id, **data.model_dump())


# ---------- Courts ----------


@router.get("/courts", response_model=list[CourtOut])
async def list_courts(
    db: AsyncSession = Depends(get_db),
    _user: UserORM = Depends(current_active_user),
) -> list[CourtOut]:
    repo = SqlCourtRepository(db)
    return [
        CourtOut(id=c.id, name=c.name, availability=sorted(c.availability), indoor=c.indoor, priority=c.priority)
        for c in await repo.list_all()
    ]


@router.post("/courts", response_model=CourtOut, status_code=status.HTTP_201_CREATED)
async def create_court(
    data: CourtIn,
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(require_role(UserRole.ADMIN, UserRole.PLANNER)),
) -> CourtOut:
    repo = SqlCourtRepository(db)
    court = Court(name=data.name, availability=frozenset(data.availability), indoor=data.indoor, priority=data.priority)
    saved = await repo.upsert(court)
    await _audit(db, user, "create", "court", str(saved.id), data.model_dump())
    return CourtOut(id=saved.id, **data.model_dump())


@router.put("/courts/{court_id}", response_model=CourtOut)
async def update_court(
    court_id: UUID,
    data: CourtIn,
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(require_role(UserRole.ADMIN, UserRole.PLANNER)),
) -> CourtOut:
    """Admin: bestehenden Platz updaten (Name, Indoor, Verfügbarkeit)."""
    from coach_api.infrastructure.models import CourtORM

    existing = await db.get(CourtORM, court_id)
    if existing is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "court not found")
    repo = SqlCourtRepository(db)
    court = Court(
        id=court_id,
        name=data.name,
        availability=frozenset(data.availability),
        indoor=data.indoor,
        priority=data.priority,
    )
    saved = await repo.upsert(court)
    await _audit(db, user, "update", "court", str(court_id), data.model_dump())
    return CourtOut(id=saved.id, **data.model_dump())


@router.delete("/courts/{court_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_court(
    court_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(require_role(UserRole.ADMIN, UserRole.PLANNER)),
) -> None:
    """Admin: Platz löschen. Schlägt fehl, wenn er noch in Plänen verwendet wird."""
    from coach_api.infrastructure.models import CourtORM

    existing = await db.get(CourtORM, court_id)
    if existing is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "court not found")
    name = existing.name
    try:
        await db.delete(existing)
        await db.commit()
    except Exception as exc:  # FK-Verletzung etc.
        await db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Platz kann nicht gelöscht werden – wird vermutlich noch von "
            "einem Plan referenziert.",
        ) from exc
    await _audit(db, user, "delete", "court", str(court_id), {"name": name})


# ---------- Seasons ----------


@router.get("/seasons", response_model=list[SeasonOut])
async def list_seasons(
    db: AsyncSession = Depends(get_db),
    _user: UserORM = Depends(current_active_user),
) -> list[SeasonOut]:
    repo = SqlSeasonRepository(db)
    return [SeasonOut(id=s.id, name=s.name, valid_from=s.valid_from, valid_to=s.valid_to) for s in await repo.list_all()]


@router.post("/seasons", response_model=SeasonOut, status_code=status.HTTP_201_CREATED)
async def create_season(
    data: SeasonIn,
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(require_role(UserRole.ADMIN, UserRole.PLANNER)),
) -> SeasonOut:
    repo = SqlSeasonRepository(db)
    season = Season(name=data.name, valid_from=data.valid_from, valid_to=data.valid_to)
    saved = await repo.create(season)
    await _audit(db, user, "create", "season", str(saved.id), data.model_dump(mode="json"))
    return SeasonOut(id=saved.id, **data.model_dump())


@router.delete("/seasons/{season_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_season(
    season_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(require_role(UserRole.ADMIN, UserRole.PLANNER)),
) -> None:
    """Admin/Planner: Saison inkl. aller ihrer Pläne löschen (z.B. um eine
    versehentliche Doppelanlage zu bereinigen). Plans hängen per
    ON DELETE CASCADE an der Saison, werden also automatisch mitgelöscht."""
    from coach_api.infrastructure.models import SeasonORM

    row = await db.get(SeasonORM, season_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Saison nicht gefunden")
    await db.delete(row)
    await db.commit()
    await _audit(db, user, "delete", "season", str(season_id), {})


# ---------- Plans ----------


@router.post("/plans/generate", response_model=list[PlanOut])
async def generate_plans(
    data: GeneratePlanIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(require_role(UserRole.ADMIN, UserRole.PLANNER)),
) -> list[PlanOut]:
    # Manual rate limit (slowapi limiter is registered globally as app.state.limiter)
    use_case = GeneratePlanUseCase(
        coaches=SqlCoachRepository(db),
        players=SqlPlayerRepository(db),
        courts=SqlCourtRepository(db),
        seasons=SqlSeasonRepository(db),
        plans=SqlPlanRepository(db),
    )
    try:
        plans = await use_case.execute(
            GeneratePlanCommand(
                season_id=data.season_id,
                num_solutions=data.num_solutions,
                time_limit_seconds=data.time_limit_seconds,
                court_filter=data.court_filter,
            )
        )
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    await _audit(
        db, user, "generate", "plan_batch", str(data.season_id),
        {
            "num_solutions": data.num_solutions,
            "produced": len(plans),
            "court_filter": data.court_filter,
        },
    )
    return [_plan_to_out(p) for p in plans]


@router.post("/plans/generate-async")
async def generate_plans_async(
    data: GeneratePlanIn,
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(require_role(UserRole.ADMIN, UserRole.PLANNER)),
) -> dict:
    """Wie ``POST /plans/generate``, läuft aber im Hintergrund-Worker statt
    in dieser Anfrage — kein HTTP-Timeout-Risiko mehr bei vielen Varianten
    bzw. hohem Zeitlimit. Liefert sofort eine ``job_id``; Fortschritt und
    Ergebnis über ``GET /jobs/{job_id}`` abfragen."""
    from coach_api.infrastructure.queue import job_queue

    job = job_queue.enqueue(
        "coach_api.jobs.plan_generation.run_plan_generation",
        str(data.season_id),
        data.num_solutions,
        data.time_limit_seconds,
        data.court_filter,
        job_timeout="20m",
        result_ttl=3600,
    )
    await _audit(
        db, user, "generate_async", "plan_batch", str(data.season_id),
        {"num_solutions": data.num_solutions, "court_filter": data.court_filter, "job_id": job.id},
    )
    return {"job_id": job.id}


@router.get("/jobs/{job_id}")
async def get_job_status(
    job_id: str,
    user: UserORM = Depends(require_role(UserRole.ADMIN, UserRole.PLANNER)),
) -> dict:
    """Status/Ergebnis eines mit ``POST /plans/generate-async`` gestarteten
    Hintergrund-Jobs. ``status``: queued | started | finished | failed.
    Reiner Lesezugriff (Polling) — kein Audit-Log hier, das passiert schon
    beim Enqueuen."""
    from rq.job import Job
    from coach_api.infrastructure.queue import job_queue

    try:
        job = Job.fetch(job_id, connection=job_queue.connection)
    except Exception:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Job nicht gefunden")

    out: dict = {
        "status": job.get_status(),
        "status_text": job.meta.get("status_text"),
    }
    if job.is_finished:
        result = job.return_value() or {}
        if result.get("error"):
            out["status"] = "failed"
            out["error"] = result["error"]
        else:
            out["plans"] = result.get("plans", [])
    elif job.is_failed:
        out["status"] = "failed"
        out["error"] = "Die Berechnung ist unerwartet fehlgeschlagen. Bitte nochmal versuchen."
    return out


@router.get("/seasons/{season_id}/plans", response_model=list[PlanOut])
async def list_plans_for_season(
    season_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(current_active_user),
) -> list[PlanOut]:
    from sqlalchemy import select
    from coach_api.infrastructure.models import PlanORM as PlanRow
    from coach_api.infrastructure.repositories import _plan_from_orm

    q = select(PlanRow).where(PlanRow.season_id == season_id).order_by(PlanRow.score.desc())
    if not _is_privileged(user):
        if user.role == UserRole.COACH:
            q = q.where(PlanRow.published.is_(True))
        else:
            return []
    rows = (await db.execute(q)).scalars().all()
    return [_plan_to_out(_plan_from_orm(r), published=r.published, created_at=r.created_at) for r in rows]


@router.get("/seasons/{season_id}/best-plan", response_model=PlanOut | None)
async def best_plan_for_season(
    season_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(current_active_user),
) -> PlanOut | None:
    from sqlalchemy import select
    from coach_api.infrastructure.models import PlanORM as PlanRow
    from coach_api.infrastructure.repositories import _plan_from_orm

    q = select(PlanRow).where(PlanRow.season_id == season_id)
    if not _is_privileged(user):
        if user.role == UserRole.COACH:
            q = q.where(PlanRow.published.is_(True))
        else:
            return None
    rows = (await db.execute(q)).scalars().all()
    if not rows:
        return None
    best = max(rows, key=lambda r: r.score)
    return _plan_to_out(_plan_from_orm(best), published=best.published, created_at=best.created_at)


@router.get("/plans/{plan_id}", response_model=PlanOut)
async def get_plan(
    plan_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(current_active_user),
) -> PlanOut:
    from coach_api.infrastructure.models import PlanORM as PlanRow
    from coach_api.infrastructure.repositories import _plan_from_orm

    row = await db.get(PlanRow, plan_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Plan nicht gefunden")
    if not _is_privileged(user):
        if user.role == UserRole.COACH:
            if not row.published:
                raise HTTPException(status.HTTP_403_FORBIDDEN, "Plan wurde noch nicht freigegeben.")
        else:
            raise HTTPException(status.HTTP_403_FORBIDDEN)
    return _plan_to_out(_plan_from_orm(row), published=row.published, created_at=row.created_at)


@router.put("/plans/{plan_id}/publish", response_model=PlanOut)
async def publish_plan(
    plan_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(require_role(UserRole.ADMIN, UserRole.PLANNER)),
) -> PlanOut:
    """Admin/Planner: Plan für alle Coaches sichtbar machen."""
    from coach_api.infrastructure.models import PlanORM as PlanRow
    from coach_api.infrastructure.repositories import _plan_from_orm

    row = await db.get(PlanRow, plan_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Plan nicht gefunden")
    row.published = True
    await db.commit()
    await db.refresh(row)
    await _audit(db, user, "publish", "plan", str(plan_id), {})
    return _plan_to_out(_plan_from_orm(row), published=True, created_at=row.created_at)


@router.put("/plans/{plan_id}/unpublish", response_model=PlanOut)
async def unpublish_plan(
    plan_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(require_role(UserRole.ADMIN, UserRole.PLANNER)),
) -> PlanOut:
    """Admin/Planner: Freigabe zurücknehmen (Plan wieder auf Entwurf setzen,
    z.B. um eine versehentliche Freigabe zu korrigieren)."""
    from coach_api.infrastructure.models import PlanORM as PlanRow
    from coach_api.infrastructure.repositories import _plan_from_orm

    row = await db.get(PlanRow, plan_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Plan nicht gefunden")
    row.published = False
    await db.commit()
    await db.refresh(row)
    await _audit(db, user, "unpublish", "plan", str(plan_id), {})
    return _plan_to_out(_plan_from_orm(row), published=False, created_at=row.created_at)


def _merge_adjacent_sessions(sessions: list[dict]) -> list[dict]:
    """Merges sessions that share the same coach, court and exact player
    set into one block when their slots directly connect (e.g. two
    manually-created/moved 30-minute blocks that together form one
    continuous 60-minute session)."""
    from coach_api.domain.time_grid import TimeGrid

    spd = TimeGrid().slots_per_day
    # note/extra_coach_ids gehören in den Schlüssel: zwei benachbarte Blöcke
    # mit unterschiedlicher Kurzbeschreibung oder Trainer-Besetzung sind
    # NICHT dieselbe Einheit und dürfen nicht verschmolzen werden (sonst
    # würde eine der beiden Angaben stillschweigend verschwinden).
    Key = tuple[
        str, str, tuple[str, ...], str | None, str | None,
        tuple[str, ...], tuple[tuple[str, str], ...],
    ]
    groups: dict[Key, dict] = {}
    order: list[Key] = []
    for s in sessions:
        key: Key = (
            str(s["coach_id"]), str(s["court_id"]),
            tuple(sorted(str(p) for p in s["player_ids"])), s.get("label"),
            s.get("note"),
            tuple(sorted(str(c) for c in (s.get("extra_coach_ids") or []))),
            tuple(sorted((str(k), v) for k, v in (s.get("player_notes") or {}).items())),
        )
        if key not in groups:
            groups[key] = {"session_type": s["session_type"], "slots": set()}
            order.append(key)
        groups[key]["slots"].update(s["slot_indices"])

    merged: list[dict] = []
    for key in order:
        coach_id, court_id, player_ids, label, note, extra_coaches, pnotes = key
        slots = sorted(groups[key]["slots"])
        run: list[int] = []
        for t in slots:
            if run and t == run[-1] + 1 and t // spd == run[-1] // spd:
                run.append(t)
            else:
                if run:
                    merged.append({
                        "coach_id": coach_id, "court_id": court_id,
                        "player_ids": list(player_ids), "slot_indices": run,
                        "session_type": groups[key]["session_type"], "label": label,
                        "note": note, "extra_coach_ids": list(extra_coaches),
                        "player_notes": dict(pnotes),
                    })
                run = [t]
        if run:
            merged.append({
                "coach_id": coach_id, "court_id": court_id,
                "player_ids": list(player_ids), "slot_indices": run,
                "session_type": groups[key]["session_type"], "label": label,
                "note": note, "extra_coach_ids": list(extra_coaches),
                "player_notes": dict(pnotes),
            })
    return merged


@router.put("/plans/{plan_id}", response_model=PlanOut)
async def update_plan_sessions(
    plan_id: UUID,
    data: PlanUpdateIn,
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(require_role(UserRole.ADMIN, UserRole.PLANNER)),
) -> PlanOut:
    """Manuelle Bearbeitung eines bestehenden Plans (Editor im Frontend).

    Erlaubt freies Verschieben, Hinzufügen, Löschen und Umbesetzen von
    Sessions. Strukturelle Invarianten werden geprüft (kein Trainer auf
    zwei Plätzen gleichzeitig, kein Spieler in zwei Sessions gleichzeitig).
    Soft-Constraints (Wunschtrainer, Mindeststunden) werden NICHT
    erzwungen - das Editor-UI ist absichtlich frei. Eine Plan-Erklärung
    mit Warnungen wird angehängt.
    """
    from coach_api.infrastructure.models import PlanORM

    row = await db.get(PlanORM, plan_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Plan nicht gefunden")

    # ---- Strukturelle Konflikt-Erkennung (informativ, nicht blockierend) ----
    warnings: list[str] = []
    coach_at_slot: dict[tuple[str, int], int] = {}
    court_at_slot: dict[tuple[str, int], int] = {}
    player_at_slot: dict[tuple[str, int], int] = {}
    for idx, s in enumerate(data.sessions):
        for t in s.slot_indices:
            rk = (str(s.court_id), t)
            # Haupt- und Zusatztrainer gleich behandeln: niemand kann zur
            # selben Zeit in zwei Einheiten stehen.
            for coach_id in (s.coach_id, *s.extra_coach_ids):
                ck = (str(coach_id), t)
                if ck in coach_at_slot and coach_at_slot[ck] != idx:
                    warnings.append(
                        f"Trainer ist in Slot {t} mehrfach eingeteilt."
                    )
                else:
                    coach_at_slot[ck] = idx
            if rk in court_at_slot and court_at_slot[rk] != idx:
                warnings.append(
                    f"Platz ist in Slot {t} mehrfach belegt."
                )
            else:
                court_at_slot[rk] = idx
            for pid in s.player_ids:
                pk = (str(pid), t)
                if pk in player_at_slot and player_at_slot[pk] != idx:
                    warnings.append(
                        f"Spieler ist in Slot {t} doppelt eingeteilt."
                    )
                else:
                    player_at_slot[pk] = idx

    # ---- Persistieren ----
    sessions_json: list[dict] = []
    for s in data.sessions:
        n = len(s.player_ids)
        if s.session_type is not None:
            stype = s.session_type.value
        elif n <= 1:
            stype = "single"
        elif n == 2:
            stype = "double"
        else:
            stype = "group"
        sessions_json.append(
            {
                "coach_id": str(s.coach_id),
                "court_id": str(s.court_id),
                "player_ids": [str(pid) for pid in s.player_ids],
                "slot_indices": list(s.slot_indices),
                "session_type": stype,
                "label": s.label,
                "note": s.note,
                "extra_coach_ids": [str(cid) for cid in s.extra_coach_ids],
                # Nur Notizen von Spielern behalten, die noch in der Einheit
                # sind — sonst bleiben Karteileichen zurück, wenn jemand
                # entfernt wurde.
                "player_notes": {
                    str(pid): txt
                    for pid, txt in s.player_notes.items()
                    if pid in s.player_ids and txt
                },
            }
        )
    # Zwei manuell erzeugte/verschobene Blöcke mit demselben Trainer, Platz
    # und derselben Spielerbesetzung, die direkt aneinander anschließen
    # (z.B. zwei 30-Min-Blöcke statt einem 60-Min-Block), zu einem Block
    # zusammenfassen — sonst zeigt der Kalender sie fälschlich als zwei
    # separate Einheiten statt einer durchgehenden Stunde.
    sessions_json = _merge_adjacent_sessions(sessions_json)
    row.sessions = sessions_json
    # Einfacher Score: Anzahl Spieler-Slot-Belegungen (analog zum
    # Demand-Reward) minus Strafen für Konflikte.
    total_player_slots = sum(
        len(s.player_ids) * len(s.slot_indices) for s in data.sessions
    )
    row.score = float(total_player_slots * 10 - len(warnings) * 50)

    # Erklärung anhängen / ersetzen
    note_lines = ["## ✏️ Plan wurde manuell bearbeitet", ""]
    if warnings:
        # dedupe in Reihenfolge
        seen: set[str] = set()
        deduped: list[str] = []
        for w_ in warnings:
            if w_ not in seen:
                seen.add(w_)
                deduped.append(w_)
        note_lines.append("**Warnungen** (Plan ist trotzdem gespeichert):")
        for w_ in deduped:
            note_lines.append(f"- ⚠️ {w_}")
    else:
        note_lines.append("✅ Keine strukturellen Konflikte erkannt.")
    note_lines.append("")
    note_lines.append(
        f"_{len(data.sessions)} Sessions, {total_player_slots} Spieler-Slot-Belegungen._"
    )
    row.explanation = "\n".join(note_lines)

    await db.commit()
    await db.refresh(row)
    await _audit(
        db,
        user,
        "edit",
        "plan",
        str(plan_id),
        {"sessions": len(data.sessions), "warnings": len(warnings)},
    )

    from coach_api.infrastructure.repositories import _plan_from_orm

    return _plan_to_out(_plan_from_orm(row), published=row.published, created_at=row.created_at)


@router.delete("/plans/{plan_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_plan(
    plan_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(require_role(UserRole.ADMIN, UserRole.PLANNER)),
) -> None:
    """Admin/Planner: eine einzelne Plan-Variante endgültig löschen."""
    from coach_api.infrastructure.models import PlanORM

    row = await db.get(PlanORM, plan_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Plan nicht gefunden")
    await db.delete(row)
    await db.commit()
    await _audit(db, user, "delete", "plan", str(plan_id), {})


async def _plan_export_context(db: AsyncSession, plan_id: UUID):
    """Shared lookup for the export endpoints: plan row, id->name maps, and
    an ordered court id list (indoor first, then name) so the timetable
    columns come out in the same order as the in-app calendar."""
    from sqlalchemy import select
    from coach_api.infrastructure.models import CoachORM, CourtORM, PlanORM, PlayerORM

    row = await db.get(PlanORM, plan_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Plan nicht gefunden")
    coach_names = {str(c.id): c.name for c in (await db.execute(select(CoachORM))).scalars().all()}
    court_rows = (
        await db.execute(select(CourtORM).order_by(CourtORM.indoor.desc(), CourtORM.name))
    ).scalars().all()
    court_ids = [str(c.id) for c in court_rows]
    court_names = {str(c.id): c.name for c in court_rows}
    player_names = {str(p.id): p.name for p in (await db.execute(select(PlayerORM))).scalars().all()}
    return row, coach_names, court_ids, court_names, player_names


@router.get("/plans/{plan_id}/export.xlsx")
async def export_plan_xlsx(
    plan_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user: UserORM = Depends(require_role(UserRole.ADMIN, UserRole.PLANNER, UserRole.COACH)),
):
    from fastapi.responses import Response
    from coach_api.interfaces.exports import build_plan_xlsx

    row, coach_names, court_ids, court_names, player_names = await _plan_export_context(db, plan_id)
    content = build_plan_xlsx(
        f"Trainingsplan (Score {row.score:.1f})", row.sessions, coach_names, court_ids, court_names, player_names
    )
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="trainingsplan-{str(plan_id)[:8]}.xlsx"'},
    )


@router.get("/plans/{plan_id}/export-players.xlsx")
async def export_plan_player_schedule_xlsx(
    plan_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user: UserORM = Depends(require_role(UserRole.ADMIN, UserRole.PLANNER, UserRole.COACH)),
):
    """Spieler-Sicht auf den Plan (eine Zeile je Spieler, Wochentage als
    Spalten) — zum Weitergeben an Eltern/Spieler, die darin nur ihren
    eigenen Namen suchen wollen."""
    from fastapi.responses import Response
    from coach_api.interfaces.exports import build_player_schedule_xlsx

    row, coach_names, _court_ids, court_names, player_names = await _plan_export_context(db, plan_id)
    content = build_player_schedule_xlsx(
        "Trainingszeiten je Spieler", row.sessions, coach_names, court_names, player_names
    )
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="spieler-zeiten-{str(plan_id)[:8]}.xlsx"'},
    )


@router.get("/plans/{plan_id}/export.pdf")
async def export_plan_pdf(
    plan_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user: UserORM = Depends(require_role(UserRole.ADMIN, UserRole.PLANNER, UserRole.COACH)),
):
    from fastapi.responses import Response
    from coach_api.interfaces.exports import build_plan_pdf

    row, coach_names, court_ids, court_names, player_names = await _plan_export_context(db, plan_id)
    content = build_plan_pdf(
        f"Trainingsplan (Score {row.score:.1f})", row.sessions, coach_names, court_ids, court_names, player_names
    )
    return Response(
        content=content,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="trainingsplan-{str(plan_id)[:8]}.pdf"'},
    )


@router.get("/export/players.xlsx")
async def export_players_xlsx(
    db: AsyncSession = Depends(get_db),
    _user: UserORM = Depends(require_role(UserRole.ADMIN, UserRole.PLANNER)),
):
    from sqlalchemy import select
    from fastapi.responses import Response
    from coach_api.interfaces.exports import build_players_xlsx

    rows = (await db.execute(select(PlayerORM).order_by(PlayerORM.name))).scalars().all()
    players = [_player_orm_to_dict(p) for p in rows]
    content = build_players_xlsx(players)
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="spieler.xlsx"'},
    )


@router.get("/export/coaches.xlsx")
async def export_coaches_xlsx(
    db: AsyncSession = Depends(get_db),
    _user: UserORM = Depends(require_role(UserRole.ADMIN, UserRole.PLANNER)),
):
    from sqlalchemy import select
    from fastapi.responses import Response
    from coach_api.interfaces.exports import build_coaches_xlsx

    rows = (await db.execute(select(CoachORM).order_by(CoachORM.name))).scalars().all()
    coaches = [_coach_orm_to_out(c).model_dump(mode="json") for c in rows]
    content = build_coaches_xlsx(coaches)
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="trainer.xlsx"'},
    )


@router.get("/export/people.xlsx")
async def export_people_xlsx(
    db: AsyncSession = Depends(get_db),
    _user: UserORM = Depends(require_role(UserRole.ADMIN, UserRole.PLANNER)),
):
    from sqlalchemy import select
    from fastapi.responses import Response
    from coach_api.interfaces.exports import build_people_xlsx

    player_rows = (await db.execute(select(PlayerORM).order_by(PlayerORM.name))).scalars().all()
    coach_rows = (await db.execute(select(CoachORM).order_by(CoachORM.name))).scalars().all()
    players = [_player_orm_to_dict(p) for p in player_rows]
    coaches = [_coach_orm_to_out(c).model_dump(mode="json") for c in coach_rows]
    content = build_people_xlsx(players, coaches)
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="personen.xlsx"'},
    )


@router.get("/plans/{old_id}/diff/{new_id}", response_model=PlanDiffOut)
async def diff_two_plans(
    old_id: UUID,
    new_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(current_active_user),
) -> PlanDiffOut:
    from coach_api.infrastructure.models import PlanORM as PlanRow
    from coach_api.infrastructure.repositories import _plan_from_orm

    old_row = await db.get(PlanRow, old_id)
    new_row = await db.get(PlanRow, new_id)
    if old_row is None or new_row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "plan not found")
    # Same visibility rule as GET /plans/{id}: non-privileged coaches only
    # ever see published plans, everyone else (players) sees none at all.
    if not _is_privileged(user):
        if user.role == UserRole.COACH:
            if not (old_row.published and new_row.published):
                raise HTTPException(status.HTTP_403_FORBIDDEN, "Plan wurde noch nicht freigegeben.")
        else:
            raise HTTPException(status.HTTP_403_FORBIDDEN)
    old_p = _plan_from_orm(old_row)
    new_p = _plan_from_orm(new_row)
    d = diff_plans(old_p, new_p)
    return PlanDiffOut(
        added=[_session_to_out(s) for s in d.added],
        removed=[_session_to_out(s) for s in d.removed],
        unchanged_count=len(d.unchanged),
        workload={
            "coach_slots": d.workload.coach_slots,
            "player_slots": d.workload.player_slots,
        },
        score_delta=d.score_delta,
    )


# ---------- Chat ----------


@router.post("/chat", response_model=ChatResponse)
async def chat(
    data: ChatRequest,
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(current_active_user),
) -> ChatResponse:
    """Deterministic, rule-based chat assistant — no LLM.

    Answers from a static knowledge base and live DB queries via keyword
    matching. Sub-10ms response time, no GPU/CPU spike.
    """
    import logging
    import traceback

    from coach_api.infrastructure.bot import answer

    try:
        reply = await answer(data.message, db)
    except Exception as exc:  # noqa: BLE001
        logging.getLogger("coach_api.chat").exception("Chat bot failed")
        reply = (
            "Interner Fehler im Chat-Bot:\n```\n"
            + "".join(traceback.format_exception_only(type(exc), exc)).strip()
            + "\n```"
        )
    return ChatResponse(reply=reply)


@router.post("/chat/stream")
async def chat_stream_endpoint(
    data: ChatRequest,
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(current_active_user),
):
    """Streaming variant of the chat endpoint. The bot computes the full
    answer instantly; we still stream so the frontend can use a single
    code path for both the legacy LLM agent and the new bot."""
    import logging
    import traceback

    from fastapi.responses import StreamingResponse

    from coach_api.infrastructure.bot import answer

    try:
        reply = await answer(data.message, db)
    except Exception as exc:  # noqa: BLE001
        logging.getLogger("coach_api.chat").exception("Chat bot failed")
        reply = (
            "Interner Fehler im Chat-Bot:\n```\n"
            + "".join(traceback.format_exception_only(type(exc), exc)).strip()
            + "\n```"
        )

    async def gen():
        # Yield the reply in small chunks for a slight typewriter effect —
        # purely cosmetic, total wall-time is still sub-10ms.
        chunk_size = 80
        for i in range(0, len(reply), chunk_size):
            yield reply[i : i + chunk_size]

    return StreamingResponse(
        gen(),
        media_type="text/plain; charset=utf-8",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )


# ---------- GDPR endpoints ----------


@router.get("/me/export", summary="DSGVO Art. 15 – Datenexport")
async def export_my_data(
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(current_active_user),
) -> dict:
    """Returns all personal data we hold about the calling user."""
    return {
        "user": {
            "id": str(user.id),
            "email": user.email,
            "role": user.role,
            "is_active": user.is_active,
            "is_verified": user.is_verified,
            "created_at": user.created_at.isoformat() if user.created_at else None,
        },
    }


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT, summary="DSGVO Art. 17 – Löschung")
async def delete_my_account(
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(current_active_user),
) -> None:
    await _audit(db, user, "delete", "user", str(user.id), {})
    await db.delete(user)
    await db.commit()


# ---------- Admin: user management ----------
#
# Self-registration is disabled. Only admins can create users.


require_admin = require_role(UserRole.ADMIN)


@router.get("/admin/users", response_model=list[AdminUserOut])
async def admin_list_users(
    db: AsyncSession = Depends(get_db),
    _: UserORM = Depends(require_admin),
) -> list[AdminUserOut]:
    from sqlalchemy import select

    rows = (await db.execute(select(UserORM).order_by(UserORM.email))).scalars().all()
    user_ids = [r.id for r in rows]
    players = (
        await db.execute(select(PlayerORM).where(PlayerORM.user_id.in_(user_ids)))
    ).scalars().all() if user_ids else []
    coaches = (
        await db.execute(select(CoachORM).where(CoachORM.user_id.in_(user_ids)))
    ).scalars().all() if user_ids else []
    players_by_user: dict[UUID, list[PlayerORM]] = {}
    for p in players:
        players_by_user.setdefault(p.user_id, []).append(p)
    coach_by_user = {c.user_id: c for c in coaches}

    out = []
    for r in rows:
        ps = players_by_user.get(r.id, [])
        c = coach_by_user.get(r.id)
        item = AdminUserOut.model_validate(r)
        item.linked_players = [LinkedRecordOut(id=p.id, name=p.name) for p in ps]
        item.linked_coach_id = c.id if c else None
        item.linked_coach_name = c.name if c else None
        out.append(item)
    return out


@router.post("/admin/users", response_model=AdminUserOut, status_code=status.HTTP_201_CREATED)
async def admin_create_user(
    data: AdminUserCreate,
    db: AsyncSession = Depends(get_db),
    actor: UserORM = Depends(require_admin),
) -> AdminUserOut:
    from sqlalchemy import select

    from coach_api.infrastructure.auth import Argon2PasswordHelper

    existing = (
        await db.execute(select(UserORM).where(UserORM.email == data.email))
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "user already exists")

    helper = Argon2PasswordHelper()
    role = UserRole(data.role.lower())
    user = UserORM(
        email=data.email,
        hashed_password=helper.hash(data.password),
        role=role,
        is_active=True,
        is_verified=True,
        is_superuser=(role == UserRole.ADMIN),
    )
    db.add(user)
    await db.flush()  # get user.id

    # No auto-created Coach/Player domain record here on purpose — a user
    # account existing doesn't imply a real player/coach with that name
    # exists. Admins create the domain record separately (Spieler/Trainer
    # "quick create") and link an account to it from there, or the person
    # gets the "kein Datensatz für diesen Benutzer" message on first login
    # until an admin creates and links one.

    await db.commit()
    await db.refresh(user)
    await _audit(db, actor, "create", "user", str(user.id), {"email": data.email, "role": data.role})
    return AdminUserOut.model_validate(user)


@router.patch("/admin/users/{user_id}", response_model=AdminUserOut)
async def admin_update_user(
    user_id: UUID,
    data: AdminUserPatch,
    db: AsyncSession = Depends(get_db),
    actor: UserORM = Depends(require_admin),
) -> AdminUserOut:
    user = await db.get(UserORM, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")
    if user.is_protected and user.id != actor.id:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Dieser Account ist geschützt und kann nur vom Inhaber selbst geändert werden.",
        )
    if data.email is not None and data.email != user.email:
        from sqlalchemy import select

        existing = (
            await db.execute(select(UserORM).where(UserORM.email == data.email))
        ).scalar_one_or_none()
        if existing is not None:
            raise HTTPException(status.HTTP_409_CONFLICT, "E-Mail-Adresse bereits vergeben")
        user.email = data.email
    if data.role is not None:
        new_role = UserRole(data.role.lower())
        user.role = new_role
        user.is_superuser = new_role == UserRole.ADMIN
        # No auto-created Coach/Player domain record here — see comment in
        # admin_create_user for why.
    if data.is_active is not None:
        user.is_active = data.is_active
    if data.password is not None:
        from coach_api.infrastructure.auth import Argon2PasswordHelper

        user.hashed_password = Argon2PasswordHelper().hash(data.password)
    await db.commit()
    await db.refresh(user)
    await _audit(db, actor, "update", "user", str(user.id), data.model_dump(exclude_none=True, exclude={"password"}))
    return AdminUserOut.model_validate(user)


@router.delete("/admin/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def admin_delete_user(
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    actor: UserORM = Depends(require_admin),
) -> None:
    user = await db.get(UserORM, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")
    if user.id == actor.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "cannot delete yourself")
    if user.is_protected:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Dieser Account ist geschützt und kann nicht gelöscht werden.",
        )
    await db.delete(user)
    await _audit(db, actor, "delete", "user", str(user_id), {})
    await db.commit()


# ---------- Profile (self-service) ----------
#
# These endpoints operate directly on the ORM rows so they can read/write the
# extended profile fields that live inside the existing JSON columns
# (PlayerORM.preferences, CoachORM.constraints) without a DB migration.

# CoachORM and PlayerORM already imported at the top of this module.


def _coach_orm_to_dict(c: CoachORM) -> dict:
    constraints = c.constraints or {}
    return {
        "id": str(c.id),
        "name": c.name,
        "availability": sorted(c.availability or []),
        "max_group_size": c.max_group_size,
        "constraints": constraints,
        "categories": _normalize_categories(constraints.get("categories")),
        "has_account": c.user_id is not None,
        "active": bool(constraints.get("active", True)),
    }


def _player_orm_to_dict(
    p: PlayerORM,
    *,
    include_level: bool = True,
    include_preferences: bool = True,
) -> dict:
    """Serialize a PlayerORM row.

    ``include_preferences=False`` strips ``preferred_coach_ids`` and
    ``preferred_partner_ids`` from the output — used for player-facing
    responses, since Wunschtrainer/Wunsch-Mitspieler are managed by
    coaches/admins only and not visible to the player themselves.
    Notes (free text) are *always* included.
    """
    prefs = dict(p.preferences or {})
    if not include_level:
        prefs.pop("level_lk", None)
    if not include_preferences:
        prefs.pop("preferred_coach_ids", None)
        prefs.pop("preferred_partner_ids", None)
    # Recompute age from birth_date on every read (players don't drift out
    # of date). Falls back to a directly-set age for players without one.
    birth_date_raw = prefs.get("birth_date")
    if birth_date_raw:
        try:
            prefs["age"] = compute_age(date.fromisoformat(birth_date_raw))
        except (ValueError, TypeError):
            pass
    return {
        "id": str(p.id),
        "name": p.name,
        "availability": sorted(p.availability or []),
        "min_slots_per_week": p.min_slots_per_week,
        "max_slots_per_week": p.max_slots_per_week,
        "preferences": prefs,
        "categories": _normalize_categories(
            prefs.get("categories")
            or ([prefs["category"]] if prefs.get("category") and prefs["category"] != "open" else [])
        ),
        "mates": list(p.mates or []) if include_preferences else [],
        "has_account": p.user_id is not None,
        "active": bool((p.preferences or {}).get("active", True)),
    }


@router.get("/me/profile")
async def get_my_profile(
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(current_active_user),
) -> dict:
    """Return the authenticated user's coach record and *all* linked player
    records.

    A coach account is still 1:1. A player account may be linked to
    *several* players (family account, e.g. a parent managing more than one
    of their children under one login) — ``players`` is therefore always a
    list, possibly empty, possibly with more than one entry.
    """
    from sqlalchemy import select

    coach_row = (
        await db.execute(select(CoachORM).where(CoachORM.user_id == user.id))
    ).scalar_one_or_none()
    player_rows = (
        await db.execute(select(PlayerORM).where(PlayerORM.user_id == user.id).order_by(PlayerORM.name))
    ).scalars().all()
    # Players do not see their own Wunschtrainer / Wunsch-Mitspieler — those
    # are pflegbar only by coaches/admins (see /players/{id}/preferences).
    hide_prefs = (
        len(player_rows) > 0
        and str(getattr(user.role, "value", user.role)) == UserRole.PLAYER.value
    )
    return {
        "user": {"id": str(user.id), "email": user.email, "role": user.role},
        "coach": _coach_orm_to_dict(coach_row) if coach_row else None,
        "players": [
            _player_orm_to_dict(p, include_preferences=not hide_prefs) for p in player_rows
        ],
    }


@router.put("/me/profile/coach")
async def upsert_my_coach_profile(
    data: CoachIn,
    resolve: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(require_role(UserRole.COACH, UserRole.PLANNER, UserRole.ADMIN)),
) -> dict:
    """Coaches/Admins can self-provision their *own* coach record — exactly
    once (enforced by a DB-unique constraint on ``coaches.user_id`` too).

    If an unlinked coach record already exists with a matching name (e.g. an
    admin quick-created "Max Mustermann" before this account existed), we
    don't silently create a duplicate. Instead we 409 with the candidate so
    the frontend can ask "ist das dein bestehender Datensatz?" — the caller
    then resubmits with ``resolve=take_over`` (link the existing one) or
    ``resolve=replace`` (delete the old one, create fresh).
    """
    from sqlalchemy import select

    row = (
        await db.execute(select(CoachORM).where(CoachORM.user_id == user.id))
    ).scalar_one_or_none()
    if row is None:
        candidates = (
            await db.execute(select(CoachORM).where(CoachORM.user_id.is_(None)))
        ).scalars().all()
        match = next((c for c in candidates if _name_variants_match(c.name, data.name)), None)

        if match is not None and resolve == "take_over":
            row = match
            row.user_id = user.id
        elif match is not None and resolve == "replace":
            await db.delete(match)
            await db.flush()
            await _audit(db, user, "delete", "coach", str(match.id), {"reason": "replaced during self-service profile creation"})
            row = CoachORM(user_id=user.id, name=data.name)
            db.add(row)
        elif match is not None:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                {
                    "message": f"Es gibt bereits einen nicht verknüpften Trainer-Datensatz namens „{match.name}“.",
                    "existing_id": str(match.id),
                    "existing_name": match.name,
                },
            )
        else:
            row = CoachORM(user_id=user.id, name=data.name)
            db.add(row)
    existing_constraints = dict(row.constraints or {})
    new_constraints = data.constraints.model_dump(exclude_none=False)
    # Kategorien (U8/U12/Ballschule/...) sind ausschließlich von
    # Trainern/Admins über die Verwaltung pflegbar, nicht über dieses
    # Selbst-Service-Formular -> CoachConstraintsIn kennt das Feld nicht,
    # würde also sonst beim Selbst-Speichern stillschweigend gelöscht
    # (row.constraints wird unten komplett ersetzt).
    new_constraints["categories"] = existing_constraints.get("categories", [])

    row.name = data.name
    row.availability = list(sorted(set(data.availability)))
    row.constraints = new_constraints
    row.max_group_size = data.max_group_size
    await db.commit()
    await db.refresh(row)
    await _audit(db, user, "update", "coach_profile", str(row.id), {})
    return _coach_orm_to_dict(row)


@router.put("/me/profile/player")
async def upsert_my_player_profile(
    data: PlayerIn,
    resolve: str | None = None,
    player_id: UUID | None = None,
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(require_role(UserRole.PLAYER, UserRole.COACH, UserRole.ADMIN)),
) -> dict:
    """Players/Coaches/Admins can self-provision/edit *their own* player
    record(s). The ``level_lk`` field is intentionally **stripped** here —
    only coaches/admins may set it via ``PATCH /players/{id}/level``.

    A player account may be linked to more than one player (family
    account, e.g. a parent managing several children) — pass ``player_id``
    to say which one you're editing. It's optional as long as there's no
    ambiguity: with exactly one linked player it's inferred, with zero the
    self-provisioning/name-matching flow below kicks in (same as before —
    see ``/me/profile/coach`` docstring for the ``resolve`` query param).
    With two or more linked players, ``player_id`` is required.
    """
    from sqlalchemy import select

    existing_rows = (
        await db.execute(select(PlayerORM).where(PlayerORM.user_id == user.id))
    ).scalars().all()

    if player_id is not None:
        row = next((r for r in existing_rows if r.id == player_id), None)
        if row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "player_id gehört nicht zu diesem Konto")
    elif len(existing_rows) == 1:
        row = existing_rows[0]
    elif len(existing_rows) > 1:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Dieses Konto ist mit mehreren Spielern verknüpft — player_id erforderlich.",
        )
    else:
        row = None
        candidates = (
            await db.execute(select(PlayerORM).where(PlayerORM.user_id.is_(None)))
        ).scalars().all()
        match = next((c for c in candidates if _name_variants_match(c.name, data.name)), None)

        if match is not None and resolve == "take_over":
            row = match
            row.user_id = user.id
        elif match is not None and resolve == "replace":
            await db.delete(match)
            await db.flush()
            await _audit(db, user, "delete", "player", str(match.id), {"reason": "replaced during self-service profile creation"})
            row = PlayerORM(user_id=user.id, name=data.name)
            db.add(row)
        elif match is not None:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                {
                    "message": f"Es gibt bereits einen nicht verknüpften Spieler-Datensatz namens „{match.name}“.",
                    "existing_id": str(match.id),
                    "existing_name": match.name,
                },
            )
        else:
            row = PlayerORM(user_id=user.id, name=data.name)
            db.add(row)
    incoming_prefs = data.preferences.model_dump(mode="json", exclude_none=False)
    existing_prefs = dict(row.preferences or {})
    # Preserve any existing level_lk set by a coach.
    incoming_prefs["level_lk"] = existing_prefs.get("level_lk")
    # Wunschtrainer / Wunsch-Mitspieler sind ausschließlich von Trainern/Admins
    # pflegbar -> bestehende Werte beibehalten, eingehende Werte verwerfen.
    incoming_prefs["preferred_coach_ids"] = existing_prefs.get(
        "preferred_coach_ids", []
    )
    incoming_prefs["preferred_partner_ids"] = existing_prefs.get(
        "preferred_partner_ids", []
    )
    # Kategorien (U8/U12/Ballschule/...) sind ausschließlich von
    # Trainern/Admins pflegbar (siehe update_player) und tauchen im
    # Self-Service-Formular gar nicht auf -> PlayerPreferencesIn kennt das
    # Feld nicht, würde also sonst beim Selbst-Speichern stillschweigend
    # gelöscht.
    incoming_prefs["categories"] = existing_prefs.get("categories", [])

    row.name = data.name
    row.availability = list(sorted(set(data.availability)))
    row.preferences = incoming_prefs
    row.min_slots_per_week = data.min_slots_per_week
    row.max_slots_per_week = data.max_slots_per_week
    await db.commit()
    await db.refresh(row)
    await _audit(db, user, "update", "player_profile", str(row.id), {})
    hide_prefs = str(getattr(user.role, "value", user.role)) == UserRole.PLAYER.value
    return _player_orm_to_dict(row, include_preferences=not hide_prefs)


@router.patch("/players/{player_id}/level")
async def set_player_level(
    player_id: UUID,
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(require_role(UserRole.COACH, UserRole.PLANNER, UserRole.ADMIN)),
) -> dict:
    """Coach/Planner/Admin endpoint: set a player's LK level (1–25)."""
    level = body.get("level_lk")
    if level is not None and not (isinstance(level, int) and 1 <= level <= 25):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "level_lk must be 1..25 or null")
    row = await db.get(PlayerORM, player_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "player not found")
    prefs = dict(row.preferences or {})
    prefs["level_lk"] = level
    row.preferences = prefs
    await db.commit()
    await _audit(db, user, "update", "player_level", str(player_id), {"level_lk": level})
    return {"id": str(row.id), "level_lk": level}


@router.patch("/players/{player_id}/preferences")
async def set_player_preferences(
    player_id: UUID,
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(require_role(UserRole.COACH, UserRole.PLANNER, UserRole.ADMIN)),
) -> dict:
    """Coach/Planner/Admin endpoint: set a player's Wunschtrainer / Wunsch-Mitspieler.

    Body: ``{"preferred_coach_ids": [uuid, ...], "preferred_partner_ids": [uuid, ...]}``.
    Beide Felder sind optional; nicht gesendete Felder bleiben unverändert.
    Spieler selbst dürfen das nicht."""
    coach_ids = body.get("preferred_coach_ids")
    partner_ids = body.get("preferred_partner_ids")

    def _coerce(value: object, label: str) -> list[str]:
        if not isinstance(value, list):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{label} must be a list")
        out: list[str] = []
        for item in value:
            try:
                out.append(str(UUID(str(item))))
            except (ValueError, TypeError) as exc:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST, f"{label} contains invalid UUID"
                ) from exc
        return out

    row = await db.get(PlayerORM, player_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "player not found")
    prefs = dict(row.preferences or {})
    if coach_ids is not None:
        prefs["preferred_coach_ids"] = _coerce(coach_ids, "preferred_coach_ids")
    if partner_ids is not None:
        prefs["preferred_partner_ids"] = _coerce(partner_ids, "preferred_partner_ids")
    row.preferences = prefs
    await db.commit()
    await _audit(
        db,
        user,
        "update",
        "player_preferences",
        str(player_id),
        {
            "preferred_coach_ids": prefs.get("preferred_coach_ids", []),
            "preferred_partner_ids": prefs.get("preferred_partner_ids", []),
        },
    )
    return {
        "id": str(row.id),
        "preferred_coach_ids": prefs.get("preferred_coach_ids", []),
        "preferred_partner_ids": prefs.get("preferred_partner_ids", []),
    }


@router.patch("/players/{player_id}/session-types")
async def set_player_session_types(
    player_id: UUID,
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(require_role(UserRole.PLAYER, UserRole.COACH, UserRole.PLANNER, UserRole.ADMIN)),
) -> dict:
    """Welche Trainingsformen (Einzel/Zweier/Gruppentraining) möchte dieser
    Spieler? Fließt als weiche Präferenz in den Solver ein (siehe
    ``allowed_session_types`` in ``scoring``/``model.py``) — ersetzt das
    frühere "Trainingseinheiten hinzufügen" mit fester Dauer/Gruppengröße.

    Body: ``{"allowed_session_types": ["single", "double", "group"]}``.
    Spieler dürfen das für sich selbst setzen (im Unterschied zu
    Wunschtrainer/-partner); Trainer/Planner/Admin dürfen es für jeden setzen.
    """
    from sqlalchemy import select

    raw = body.get("allowed_session_types")
    if not isinstance(raw, list):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "allowed_session_types must be a list")
    types: list[str] = []
    for item in raw:
        try:
            types.append(SessionType(str(item)).value)
        except (ValueError, TypeError) as exc:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "allowed_session_types must be from single/double/group"
            ) from exc
    types = sorted(set(types))

    row = await db.get(PlayerORM, player_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "player not found")
    if user.role == UserRole.PLAYER:
        own_ids = (
            await db.execute(select(PlayerORM.id).where(PlayerORM.user_id == user.id))
        ).scalars().all()
        if row.id not in own_ids:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "nur das eigene Profil")
    prefs = dict(row.preferences or {})
    prefs["allowed_session_types"] = types
    row.preferences = prefs
    await db.commit()
    await _audit(db, user, "update", "player_session_types", str(player_id), {"allowed_session_types": types})
    return {"id": str(row.id), "allowed_session_types": types}


@router.put("/players/{player_id}/mates")
async def set_player_mates(
    player_id: UUID,
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(require_role(UserRole.COACH, UserRole.PLANNER, UserRole.ADMIN)),
) -> dict:
    """Coach/Admin: setzt die Wunschpartner eines Spielers.

    Body: ``{"mates": [{"player_id": uuid, "mandatory": bool}, ...]}``.
    Mate-Beziehungen werden symmetrisch gespiegelt (mandatory gewinnt).
    """
    raw = body.get("mates")
    if not isinstance(raw, list):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "mates must be a list")
    mates: list[dict] = []
    seen: set[str] = set()
    for i, item in enumerate(raw):
        if not isinstance(item, dict):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"mates[{i}] not an object")
        try:
            pid = str(UUID(str(item.get("player_id"))))
        except (ValueError, TypeError) as exc:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, f"mates[{i}].player_id invalid"
            ) from exc
        if pid == str(player_id):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, f"mates[{i}]: cannot be self"
            )
        if pid in seen:
            continue
        seen.add(pid)
        mates.append({"player_id": pid, "mandatory": bool(item.get("mandatory", False))})

    row = await db.get(PlayerORM, player_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "player not found")

    old_mate_ids = {m.get("player_id") for m in (row.mates or [])}
    new_mate_ids = {m["player_id"] for m in mates}
    removed_mate_ids = old_mate_ids - new_mate_ids

    row.mates = mates
    await db.flush()
    # Symmetrische Spiegelung in die Profile der Partner (fügt neue/geänderte
    # Mates hinzu UND entfernt entfernte Mates auch auf der Gegenseite
    # wieder — sonst bleibt eine einseitige "Geister"-Verbindung stehen).
    await _mirror_mates(
        db,
        player_id,
        tuple(PlayerMate(player_id=UUID(m["player_id"]), mandatory=m["mandatory"]) for m in mates),
        removed_mate_ids,
    )
    await db.commit()
    await _audit(db, user, "update", "player_mates", str(player_id), {"count": len(mates)})
    return {"id": str(row.id), "mates": mates}


@router.patch("/players/{player_id}/categories")
async def set_player_categories(
    player_id: UUID,
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(require_role(UserRole.COACH, UserRole.PLANNER, UserRole.ADMIN)),
) -> dict:
    """Trainer/Admin: Trainings-Kategorien eines Spielers setzen.

    Body: ``{"categories": ["u10", "ballschule", ...]}``. Leere Liste oder
    ``["open"]`` = nicht zugewiesen (Wildcard). Spieler kann mehrere
    Kategorien gleichzeitig haben (z.B. U10 + Förderkader).
    """
    raw = body.get("categories")
    if not isinstance(raw, list):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "categories must be a list")
    seen: list[str] = []
    for item in raw:
        try:
            c = TrainingCategory(str(item))
        except (ValueError, TypeError) as exc:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "categories must be from adults/team/foerderkader/ballschule/u8/u9/u10/u12/u15/u18/open",
            ) from exc
        if c == TrainingCategory.OPEN:
            continue
        if c.value not in seen:
            seen.append(c.value)
    seen.sort()
    row = await db.get(PlayerORM, player_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "player not found")
    prefs = dict(row.preferences or {})
    prefs["categories"] = seen
    prefs.pop("category", None)  # Legacy-Single-Value entfernen
    row.preferences = prefs
    await db.commit()
    await _audit(
        db, user, "update", "player_categories", str(player_id),
        {"categories": seen},
    )
    return {"id": str(row.id), "categories": seen}


@router.patch("/players/{player_id}/active")
async def set_player_active(
    player_id: UUID,
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(require_role(UserRole.COACH, UserRole.PLANNER, UserRole.ADMIN)),
) -> dict:
    """Trainer/Admin: Spieler als aktiv/inaktiv markieren.

    Body: ``{"active": true|false}``. Inaktive Spieler bleiben mit allen
    Daten erhalten, werden aber von der Plan-Erstellung ignoriert — gedacht
    für Spieler, die pausieren oder die Saison beenden, ohne dass man ihre
    Historie löschen muss.
    """
    active = body.get("active")
    if not isinstance(active, bool):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "active must be a bool")
    row = await db.get(PlayerORM, player_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "player not found")
    prefs = dict(row.preferences or {})
    prefs["active"] = active
    row.preferences = prefs
    await db.commit()
    await _audit(db, user, "update", "player_active", str(player_id), {"active": active})
    return {"id": str(row.id), "active": active}


@router.post("/coaches/quick", status_code=status.HTTP_201_CREATED)
async def create_coach_quick(
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(require_role(UserRole.ADMIN, UserRole.PLANNER)),
) -> dict:
    """Trainer mit nur einem Namen anlegen — ohne Benutzerkonto."""
    name = str(body.get("name", "")).strip()
    if not name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Name erforderlich")
    row = CoachORM(user_id=None, name=name, availability=[], constraints={})
    db.add(row)
    await db.commit()
    await db.refresh(row)
    await _audit(db, user, "create", "coach", str(row.id), {"name": name})
    return _coach_orm_to_dict(row)


@router.post("/coaches/{coach_id}/account", response_model=AdminUserOut, status_code=status.HTTP_201_CREATED)
async def create_coach_account(
    coach_id: UUID,
    data: CreateAccountIn,
    db: AsyncSession = Depends(get_db),
    actor: UserORM = Depends(require_role(UserRole.ADMIN, UserRole.PLANNER)),
) -> AdminUserOut:
    """Benutzerkonto für einen bestehenden Trainer anlegen und verknüpfen."""
    from sqlalchemy import select
    from coach_api.infrastructure.auth import Argon2PasswordHelper

    row = await db.get(CoachORM, coach_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Trainer nicht gefunden")
    if row.user_id is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Trainer hat bereits ein Benutzerkonto")
    existing = (await db.execute(select(UserORM).where(UserORM.email == data.email))).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "E-Mail-Adresse bereits vergeben")
    user = UserORM(
        email=data.email,
        hashed_password=Argon2PasswordHelper().hash(data.password),
        role=UserRole.COACH,
        is_active=True,
        is_verified=True,
        is_superuser=False,
    )
    db.add(user)
    await db.flush()
    row.user_id = user.id
    await db.commit()
    await db.refresh(user)
    await _audit(db, actor, "create_account", "user", str(user.id), {"coach_id": str(coach_id)})
    return AdminUserOut.model_validate(user)


@router.patch("/coaches/{coach_id}/link-account")
async def link_coach_account(
    coach_id: UUID,
    body: dict,
    db: AsyncSession = Depends(get_db),
    actor: UserORM = Depends(require_role(UserRole.ADMIN, UserRole.PLANNER)),
) -> dict:
    """Admin/Planner: ein bereits bestehendes Benutzerkonto mit einem
    bestehenden Trainer-Datensatz verknüpfen — für Fälle, in denen der
    Account schon existiert (z.B. über „Neuen Benutzer anlegen"), aber noch
    keinem Trainer zugeordnet wurde.

    Ein Konto darf gleichzeitig mit einem Trainer- UND einem Spieler-
    Datensatz verknüpft sein (z.B. jemand, der sowohl spielt als auch
    trainiert) — das ist bewusst nicht gegenseitig ausgeschlossen.
    """
    from sqlalchemy import select

    email = str(body.get("email", "")).strip()
    if not email:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "email erforderlich")

    row = await db.get(CoachORM, coach_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Trainer nicht gefunden")

    target = (await db.execute(select(UserORM).where(UserORM.email == email))).scalar_one_or_none()
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kein Benutzerkonto mit dieser E-Mail gefunden")

    already = (
        await db.execute(select(CoachORM).where(CoachORM.user_id == target.id))
    ).scalar_one_or_none()
    if already is not None and already.id != row.id:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Dieses Konto ist bereits mit Trainer „{already.name}“ verknüpft.",
        )

    row.user_id = target.id
    await db.commit()
    await _audit(db, actor, "link_account", "coach", str(coach_id), {"user_id": str(target.id), "email": email})
    return {"id": str(row.id), "user_id": str(target.id)}


@router.put("/coaches/{coach_id}")
async def update_coach(
    coach_id: UUID,
    data: CoachIn,
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(require_role(UserRole.ADMIN, UserRole.PLANNER)),
) -> dict:
    """Admin/Planner: vollständiges Trainer-Profil aktualisieren."""
    row = await db.get(CoachORM, coach_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Trainer nicht gefunden")
    # Merge constraints: preserve extended fields (e.g. accepts_lk_min) already stored.
    merged = dict(row.constraints or {})
    merged.update(data.constraints.model_dump(exclude_none=False))
    merged["categories"] = [c.value if hasattr(c, "value") else c for c in data.categories]
    row.name = data.name
    row.availability = list(sorted(set(data.availability)))
    row.constraints = merged
    row.max_group_size = data.max_group_size
    await db.commit()
    await db.refresh(row)
    await _audit(db, user, "update", "coach", str(coach_id), {})
    return _coach_orm_to_dict(row)


@router.delete("/coaches/{coach_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_coach(
    coach_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(require_role(UserRole.ADMIN, UserRole.PLANNER)),
) -> None:
    row = await db.get(CoachORM, coach_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "coach not found")
    await db.delete(row)
    await db.commit()
    await _audit(db, user, "delete", "coach", str(coach_id), {"name": row.name})


@router.post("/players/quick", status_code=status.HTTP_201_CREATED)
async def create_player_quick(
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(require_role(UserRole.ADMIN, UserRole.PLANNER)),
) -> dict:
    """Spieler mit nur einem Namen anlegen — ohne Benutzerkonto."""
    name = str(body.get("name", "")).strip()
    if not name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Name erforderlich")
    row = PlayerORM(user_id=None, name=name, availability=[], preferences={})
    db.add(row)
    await db.commit()
    await db.refresh(row)
    await _audit(db, user, "create", "player", str(row.id), {"name": name})
    return _player_orm_to_dict(row)


@router.post("/players/{player_id}/account", response_model=AdminUserOut, status_code=status.HTTP_201_CREATED)
async def create_player_account(
    player_id: UUID,
    data: CreateAccountIn,
    db: AsyncSession = Depends(get_db),
    actor: UserORM = Depends(require_role(UserRole.ADMIN, UserRole.PLANNER)),
) -> AdminUserOut:
    """Benutzerkonto für einen bestehenden Spieler anlegen und verknüpfen."""
    from sqlalchemy import select
    from coach_api.infrastructure.auth import Argon2PasswordHelper

    row = await db.get(PlayerORM, player_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Spieler nicht gefunden")
    if row.user_id is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Spieler hat bereits ein Benutzerkonto")
    existing = (await db.execute(select(UserORM).where(UserORM.email == data.email))).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "E-Mail-Adresse bereits vergeben")
    user = UserORM(
        email=data.email,
        hashed_password=Argon2PasswordHelper().hash(data.password),
        role=UserRole.PLAYER,
        is_active=True,
        is_verified=True,
        is_superuser=False,
    )
    db.add(user)
    await db.flush()
    row.user_id = user.id
    await db.commit()
    await db.refresh(user)
    await _audit(db, actor, "create_account", "user", str(user.id), {"player_id": str(player_id)})
    return AdminUserOut.model_validate(user)


@router.patch("/players/{player_id}/link-account")
async def link_player_account(
    player_id: UUID,
    body: dict,
    db: AsyncSession = Depends(get_db),
    actor: UserORM = Depends(require_role(UserRole.ADMIN, UserRole.PLANNER)),
) -> dict:
    """Admin/Planner: ein bereits bestehendes Benutzerkonto mit einem
    bestehenden Spieler-Datensatz verknüpfen.

    Ein Konto darf mit **mehreren** Spielern gleichzeitig verknüpft sein
    ("Familien-Account", z.B. eine Mutter, die mehrere Kinder verwaltet) —
    das hier fügt einfach eine weitere Verknüpfung hinzu, ohne bestehende
    zu berühren. War der Spieler schon mit einem (anderen) Konto verknüpft,
    wird die Verknüpfung stillschweigend auf das neue Konto umgeschrieben
    (z.B. wenn ein Kind später einen eigenen Account statt des
    Eltern-Accounts bekommen soll). Siehe ``link_coach_account`` für das
    Trainer-Pendant — Trainer bleiben bewusst 1:1."""
    from sqlalchemy import select

    email = str(body.get("email", "")).strip()
    if not email:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "email erforderlich")

    row = await db.get(PlayerORM, player_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Spieler nicht gefunden")

    target = (await db.execute(select(UserORM).where(UserORM.email == email))).scalar_one_or_none()
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kein Benutzerkonto mit dieser E-Mail gefunden")

    row.user_id = target.id
    await db.commit()
    await _audit(db, actor, "link_account", "player", str(player_id), {"user_id": str(target.id), "email": email})
    return {"id": str(row.id), "user_id": str(target.id)}


@router.put("/players/{player_id}")
async def update_player(
    player_id: UUID,
    data: "PlayerIn",
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(require_role(UserRole.ADMIN, UserRole.PLANNER)),
) -> dict:
    """Admin/Planner: vollständiges Spieler-Profil aktualisieren.

    Im Unterschied zu PUT /me/profile/player darf Admin/Planner auch
    level_lk und preferred_coach_ids / preferred_partner_ids setzen.

    Speichert Profilfelder und Spielpartner (mates) atomar in einem
    Request — das Frontend hält alle Änderungen als lokalen Entwurf und
    schickt sie erst beim Klick auf "Speichern" zusammen ab.
    """
    row = await db.get(PlayerORM, player_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Spieler nicht gefunden")

    incoming = data.preferences.model_dump(mode="json", exclude_none=False)
    existing_prefs = dict(row.preferences or {})
    merged_prefs = {**existing_prefs, **incoming}
    # categories live in preferences JSON — store from top-level field
    if data.categories is not None:
        merged_prefs["categories"] = [c.value if hasattr(c, "value") else str(c) for c in data.categories]

    old_mate_ids = {m.get("player_id") for m in (row.mates or [])}
    new_mate_ids = {str(m.player_id) for m in data.mates}
    removed_mate_ids = old_mate_ids - new_mate_ids

    row.name = data.name
    row.availability = list(sorted(set(data.availability)))
    row.preferences = merged_prefs
    row.min_slots_per_week = data.min_slots_per_week
    row.max_slots_per_week = data.max_slots_per_week
    row.mates = [{"player_id": str(m.player_id), "mandatory": m.mandatory} for m in data.mates]
    await db.flush()
    await _mirror_mates(
        db,
        player_id,
        tuple(PlayerMate(player_id=m.player_id, mandatory=m.mandatory) for m in data.mates),
        removed_mate_ids,
    )
    await db.commit()
    await db.refresh(row)
    await _audit(db, user, "update", "player", str(player_id), {})
    return _player_orm_to_dict(row, include_preferences=True)


@router.patch("/coaches/{coach_id}/categories")
async def set_coach_categories(
    coach_id: UUID,
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(require_role(UserRole.ADMIN, UserRole.COACH)),
) -> dict:
    """Admin/Trainer: welche Kategorien deckt dieser Trainer ab?

    Body: ``{"categories": ["u10", "ballschule", ...]}``. Leere Liste oder
    ``["open"]`` => keine Einschränkung. Wird als hartes Filterkriterium
    im Solver verwendet (zusammen mit der Spieler-Kategorie).
    """
    raw = body.get("categories")
    if not isinstance(raw, list):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "categories must be a list")
    cats: list[str] = []
    for i, item in enumerate(raw):
        try:
            cats.append(TrainingCategory(str(item)).value)
        except (ValueError, TypeError) as exc:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, f"categories[{i}] invalid"
            ) from exc
    cats = sorted(set(cats))
    row = await db.get(CoachORM, coach_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "coach not found")
    constraints = dict(row.constraints or {})
    constraints["categories"] = cats
    row.constraints = constraints
    await db.commit()
    await _audit(db, user, "update", "coach_categories", str(coach_id), {"categories": cats})
    return {"id": str(row.id), "categories": cats}


@router.patch("/coaches/{coach_id}/active")
async def set_coach_active(
    coach_id: UUID,
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(require_role(UserRole.COACH, UserRole.PLANNER, UserRole.ADMIN)),
) -> dict:
    """Trainer/Admin/Planner: Trainer als aktiv/inaktiv markieren.

    Body: ``{"active": true|false}``. Inaktive Trainer bleiben mit allen
    Daten erhalten, werden aber von der Plan-Erstellung ignoriert — gedacht
    für Trainer, die pausieren oder ausscheiden, ohne dass man ihre
    Historie löschen muss.
    """
    active = body.get("active")
    if not isinstance(active, bool):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "active must be a bool")
    row = await db.get(CoachORM, coach_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "coach not found")
    constraints = dict(row.constraints or {})
    constraints["active"] = active
    row.constraints = constraints
    await db.commit()
    await _audit(db, user, "update", "coach_active", str(coach_id), {"active": active})
    return {"id": str(row.id), "active": active}


@router.delete("/players/{player_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_player(
    player_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(require_role(UserRole.ADMIN, UserRole.PLANNER)),
) -> None:
    from sqlalchemy import select

    row = await db.get(PlayerORM, player_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "player not found")
    await db.delete(row)
    await db.commit()
    await _audit(db, user, "delete", "player", str(player_id), {"name": row.name})


# ---------- Availability quick-update (used by the Verfügbarkeiten page) ----------
#
# The Verfügbarkeiten page edits *only* the availability grid. Using the full
# PUT endpoints there would round-trip (and potentially wipe) unrelated JSON
# metadata, so we expose narrow PATCH endpoints that touch nothing but the
# availability column.


def _validate_slots(raw: object) -> list[int]:
    if not isinstance(raw, list):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "availability must be a list")
    out: set[int] = set()
    for s in raw:
        # bool is a subclass of int — reject it explicitly.
        if not isinstance(s, int) or isinstance(s, bool) or not 0 <= s < 7 * 48:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "slot index out of range")
        out.add(s)
    return sorted(out)


@router.patch("/players/{player_id}/availability")
async def set_player_availability(
    player_id: UUID,
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(require_role(UserRole.ADMIN, UserRole.PLANNER)),
) -> dict:
    """Admin/Planner: nur die Verfügbarkeit eines Spielers setzen."""
    slots = _validate_slots(body.get("availability"))
    row = await db.get(PlayerORM, player_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "player not found")
    row.availability = slots
    await db.commit()
    await _audit(db, user, "update", "player_availability", str(player_id), {"slots": len(slots)})
    return {"id": str(row.id), "availability": slots}


_BULK_CLEAR_FIELDS = {"availability", "mates", "notes", "hours"}


@router.post("/players/bulk/clear")
async def bulk_clear_players(
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(require_role(UserRole.ADMIN)),
) -> dict:
    """Admin only: ausgewählte Datenfelder mehrerer Spieler auf einmal
    zurücksetzen — gedacht für den Saisonwechsel.

    Body: ``{"player_ids": [...], "fields": [...]}``. ``fields`` ist eine
    Teilmenge von ``{"availability", "mates", "notes", "hours"}``:

    - ``availability``: Verfügbarkeits-Slots löschen.
    - ``mates``: Wunschpartner löschen (inkl. symmetrischer Rückverweise
      bei anderen Spielern, die diesen Spieler als Partner eingetragen
      hatten).
    - ``notes``: Freitext-Kommentar löschen.
    - ``hours``: Min/Max Std/Woche auf die Standardwerte (je 1 Std, 2 Slots) zurücksetzen.

    Alle nicht genannten Felder (LK, Kategorien, Wunschtrainer,
    Trainingsform-Checkboxen, ...) bleiben unangetastet.
    """
    from sqlalchemy import select

    raw_ids = body.get("player_ids")
    if not isinstance(raw_ids, list) or not raw_ids:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "player_ids must be a non-empty list")
    try:
        ids = [UUID(str(x)) for x in raw_ids]
    except (ValueError, TypeError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "player_ids must be UUIDs") from exc

    raw_fields = body.get("fields")
    if not isinstance(raw_fields, list) or not raw_fields:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "fields must be a non-empty list")
    fields = set(raw_fields)
    if not fields <= _BULK_CLEAR_FIELDS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"fields must be a subset of {sorted(_BULK_CLEAR_FIELDS)}",
        )

    rows = (await db.execute(select(PlayerORM).where(PlayerORM.id.in_(ids)))).scalars().all()
    for row in rows:
        if "availability" in fields:
            row.availability = []
        if "notes" in fields:
            prefs = dict(row.preferences or {})
            prefs["notes"] = ""
            row.preferences = prefs
        if "hours" in fields:
            row.min_slots_per_week = 2
            row.max_slots_per_week = 2
        if "mates" in fields:
            removed_ids = {m.get("player_id") for m in (row.mates or []) if m.get("player_id")}
            if removed_ids:
                await _mirror_mates(db, row.id, (), removed_ids)
            row.mates = []
    await db.commit()
    await _audit(
        db, user, "update", "player_bulk_clear", "-",
        {"player_ids": [str(r.id) for r in rows], "count": len(rows), "fields": sorted(fields)},
    )
    return {"cleared": len(rows), "fields": sorted(fields)}


_COACH_BULK_CLEAR_FIELDS = {"availability", "categories", "constraints", "max_group_size"}
_COACH_DEFAULT_CONSTRAINTS = {
    "accepts_lk_max": None,
    "accepts_lk_min": None,
    "accepts_age_max": None,
    "accepts_age_min": None,
    "max_break_slots": None,
    "min_block_slots": 0,
    "min_break_slots": 0,
    "max_slots_per_day": None,
    "max_slots_per_week": None,
}


@router.post("/coaches/bulk/clear")
async def bulk_clear_coaches(
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(require_role(UserRole.ADMIN)),
) -> dict:
    """Admin only: ausgewählte Datenfelder mehrerer Trainer auf einmal auf
    Standard zurücksetzen — z.B. für Trainer, die ihr Profil noch nie selbst
    bearbeitet haben.

    Body: ``{"coach_ids": [...], "fields": [...]}``. ``fields`` ist eine
    Teilmenge von ``{"availability", "categories", "constraints", "max_group_size"}``:

    - ``availability``: Verfügbarkeits-Slots löschen.
    - ``categories``: Trainings-Kategorien löschen (= "nicht zugewiesen" / Wildcard).
    - ``constraints``: Mindest-Block, Pausen, Max Std/Tag/Woche, LK-/Alters-
      Wunschbereich auf Standard (aus/unbegrenzt) zurücksetzen.
    - ``max_group_size``: auf den Standardwert (4) zurücksetzen.

    Der Aktiv/Inaktiv-Status (siehe ``PATCH /coaches/{id}/active``) bleibt
    davon immer unberührt.
    """
    from sqlalchemy import select

    raw_ids = body.get("coach_ids")
    if not isinstance(raw_ids, list) or not raw_ids:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "coach_ids must be a non-empty list")
    try:
        ids = [UUID(str(x)) for x in raw_ids]
    except (ValueError, TypeError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "coach_ids must be UUIDs") from exc

    raw_fields = body.get("fields")
    if not isinstance(raw_fields, list) or not raw_fields:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "fields must be a non-empty list")
    fields = set(raw_fields)
    if not fields <= _COACH_BULK_CLEAR_FIELDS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"fields must be a subset of {sorted(_COACH_BULK_CLEAR_FIELDS)}",
        )

    rows = (await db.execute(select(CoachORM).where(CoachORM.id.in_(ids)))).scalars().all()
    for row in rows:
        if "availability" in fields:
            row.availability = []
        if "max_group_size" in fields:
            row.max_group_size = 4
        if "categories" in fields or "constraints" in fields:
            old = dict(row.constraints or {})
            if "constraints" in fields:
                # Alles außer "active" und "categories" auf Standard; die
                # beiden werden nur zurückgesetzt, wenn explizit angefragt.
                new = dict(_COACH_DEFAULT_CONSTRAINTS)
                if "active" in old:
                    new["active"] = old["active"]
                new["categories"] = [] if "categories" in fields else old.get("categories", [])
            else:
                # Nur Kategorien zurücksetzen, alles andere unangetastet.
                new = dict(old)
                new["categories"] = []
            row.constraints = new
    await db.commit()
    await _audit(
        db, user, "update", "coach_bulk_clear", "-",
        {"coach_ids": [str(r.id) for r in rows], "count": len(rows), "fields": sorted(fields)},
    )
    return {"cleared": len(rows), "fields": sorted(fields)}


@router.patch("/coaches/{coach_id}/availability")
async def set_coach_availability(
    coach_id: UUID,
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(require_role(UserRole.ADMIN, UserRole.PLANNER)),
) -> dict:
    """Admin/Planner: nur die Verfügbarkeit eines Trainers setzen."""
    slots = _validate_slots(body.get("availability"))
    row = await db.get(CoachORM, coach_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "coach not found")
    row.availability = slots
    await db.commit()
    await _audit(db, user, "update", "coach_availability", str(coach_id), {"slots": len(slots)})
    return {"id": str(row.id), "availability": slots}


@router.patch("/courts/{court_id}/availability")
async def set_court_availability(
    court_id: UUID,
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(require_role(UserRole.ADMIN, UserRole.PLANNER)),
) -> dict:
    """Admin/Planner: nur die Verfügbarkeit eines Platzes setzen."""
    from coach_api.infrastructure.models import CourtORM

    slots = _validate_slots(body.get("availability"))
    row = await db.get(CourtORM, court_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "court not found")
    row.availability = slots
    await db.commit()
    await _audit(db, user, "update", "court_availability", str(court_id), {"slots": len(slots)})
    return {"id": str(row.id), "availability": slots}


@router.get("/players/full")
async def list_players_full(
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(current_active_user),
) -> list[dict]:
    """Like ``GET /players`` but includes the extended JSON metadata fields
    (age, level_lk, ...). Used by the Spieler tab."""
    from sqlalchemy import select

    if _is_privileged(user) or user.role == UserRole.COACH:
        rows = (await db.execute(select(PlayerORM).order_by(PlayerORM.name))).scalars().all()
        return [_player_orm_to_dict(p, include_preferences=user.role == UserRole.COACH or _is_privileged(user)) for p in rows]
    else:
        rows = (
            await db.execute(select(PlayerORM).where(PlayerORM.user_id == user.id).order_by(PlayerORM.name))
        ).scalars().all()
        return [_player_orm_to_dict(p, include_preferences=user.role == UserRole.COACH) for p in rows]


@router.get("/coaches/full")
async def list_coaches_full(
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(current_active_user),
) -> list[dict]:
    from sqlalchemy import select

    if _is_privileged(user) or user.role == UserRole.COACH:
        rows = (await db.execute(select(CoachORM).order_by(CoachORM.name))).scalars().all()
    else:
        row = (await db.execute(select(CoachORM).where(CoachORM.user_id == user.id))).scalar_one_or_none()
        rows = [row] if row else []
    return [_coach_orm_to_dict(c) for c in rows]


@router.get("/me", response_model=AdminUserOut)
async def get_me(user: UserORM = Depends(current_active_user)) -> AdminUserOut:
    """Return the currently authenticated user (used by the frontend to
    decide whether to show admin features)."""
    return AdminUserOut.model_validate(user)


@router.post("/me/accept-privacy", response_model=AdminUserOut)
async def accept_privacy(
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(current_active_user),
) -> AdminUserOut:
    """First-login consent gate: records that this user has actively
    confirmed the Datenschutzerklärung. Idempotent — calling it again just
    keeps the original timestamp."""
    from datetime import datetime, timezone

    if user.privacy_accepted_at is None:
        user.privacy_accepted_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(user)
    return AdminUserOut.model_validate(user)
