"""HTTP routers."""

from __future__ import annotations

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
    PlayerPreferences,
    Season,
    SessionType,
)
from coach_api.infrastructure.auth import current_active_user, require_role
from coach_api.infrastructure.db import get_db
from coach_api.infrastructure.models import AuditLogORM, UserORM, UserRole
from coach_api.infrastructure.repositories import (
    SqlCoachRepository,
    SqlCourtRepository,
    SqlPlanRepository,
    SqlPlayerRepository,
    SqlSeasonRepository,
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
    GeneratePlanIn,
    PlanOut,
    PlayerIn,
    PlayerOut,
    SeasonIn,
    SeasonOut,
    TrainingSessionOut,
)
from coach_api.interfaces.schemas import PlanDiffOut

router = APIRouter()


def _session_to_out(s) -> TrainingSessionOut:  # type: ignore[no-untyped-def]
    return TrainingSessionOut(
        coach_id=s.coach_id,
        court_id=s.court_id,
        player_ids=list(s.player_ids),
        slot_indices=list(s.slot_indices),
        session_type=s.session_type,
    )


def _plan_to_out(p) -> PlanOut:  # type: ignore[no-untyped-def]
    return PlanOut(
        id=p.id,
        season_id=p.season_id,
        score=p.score,
        explanation=p.explanation,
        sessions=[_session_to_out(s) for s in p.sessions],
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


@router.get("/coaches", response_model=list[CoachOut])
async def list_coaches(
    db: AsyncSession = Depends(get_db),
    _user: UserORM = Depends(current_active_user),
) -> list[CoachOut]:
    repo = SqlCoachRepository(db)
    return [
        CoachOut(
            id=c.id,
            name=c.name,
            availability=sorted(c.availability),
            constraints={
                "min_block_slots": c.constraints.min_block_slots,
                "max_slots_per_day": c.constraints.max_slots_per_day,
                "max_slots_per_week": c.constraints.max_slots_per_week,
                "min_break_slots": c.constraints.min_break_slots,
            },
            max_group_size=c.max_group_size,
        )
        for c in await repo.list_all()
    ]


@router.post("/coaches", response_model=CoachOut, status_code=status.HTTP_201_CREATED)
async def create_coach(
    data: CoachIn,
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(require_role(UserRole.ADMIN)),
) -> CoachOut:
    # Admin-only: coaches edit *their own* record via PUT /me/profile/coach.
    repo = SqlCoachRepository(db)
    coach = Coach(
        name=data.name,
        availability=frozenset(data.availability),
        constraints=CoachConstraints(**data.constraints.model_dump()),
        max_group_size=data.max_group_size,
    )
    saved = await repo.upsert(coach)
    await _audit(db, user, "create", "coach", str(saved.id), data.model_dump())
    return CoachOut(id=saved.id, **data.model_dump())


# ---------- Players ----------


@router.get("/players", response_model=list[PlayerOut])
async def list_players(
    db: AsyncSession = Depends(get_db),
    _user: UserORM = Depends(current_active_user),
) -> list[PlayerOut]:
    repo = SqlPlayerRepository(db)
    out: list[PlayerOut] = []
    for p in await repo.list_all():
        out.append(
            PlayerOut(
                id=p.id,
                name=p.name,
                availability=sorted(p.availability),
                preferences={
                    "preferred_coach_ids": list(p.preferences.preferred_coach_ids),
                    "preferred_partner_ids": list(p.preferences.preferred_partner_ids),
                    "allowed_session_types": list(p.preferences.allowed_session_types),
                },
                min_slots_per_week=p.min_slots_per_week,
                max_slots_per_week=p.max_slots_per_week,
            )
        )
    return out


@router.post("/players", response_model=PlayerOut, status_code=status.HTTP_201_CREATED)
async def create_player(
    data: PlayerIn,
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(require_role(UserRole.ADMIN)),
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
        ),
        min_slots_per_week=data.min_slots_per_week,
        max_slots_per_week=data.max_slots_per_week,
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
        CourtOut(id=c.id, name=c.name, availability=sorted(c.availability), indoor=c.indoor)
        for c in await repo.list_all()
    ]


@router.post("/courts", response_model=CourtOut, status_code=status.HTTP_201_CREATED)
async def create_court(
    data: CourtIn,
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(require_role(UserRole.ADMIN)),
) -> CourtOut:
    repo = SqlCourtRepository(db)
    court = Court(name=data.name, availability=frozenset(data.availability), indoor=data.indoor)
    saved = await repo.upsert(court)
    await _audit(db, user, "create", "court", str(saved.id), data.model_dump())
    return CourtOut(id=saved.id, **data.model_dump())


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
    user: UserORM = Depends(require_role(UserRole.ADMIN)),
) -> SeasonOut:
    repo = SqlSeasonRepository(db)
    season = Season(name=data.name, valid_from=data.valid_from, valid_to=data.valid_to)
    saved = await repo.create(season)
    await _audit(db, user, "create", "season", str(saved.id), data.model_dump(mode="json"))
    return SeasonOut(id=saved.id, **data.model_dump())


# ---------- Plans ----------


@router.post("/plans/generate", response_model=list[PlanOut])
async def generate_plans(
    data: GeneratePlanIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(require_role(UserRole.ADMIN, UserRole.COACH)),
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
            )
        )
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    await _audit(
        db, user, "generate", "plan_batch", str(data.season_id),
        {"num_solutions": data.num_solutions, "produced": len(plans)},
    )
    return [_plan_to_out(p) for p in plans]


@router.get("/seasons/{season_id}/plans", response_model=list[PlanOut])
async def list_plans_for_season(
    season_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user: UserORM = Depends(current_active_user),
) -> list[PlanOut]:
    repo = SqlPlanRepository(db)
    return [_plan_to_out(p) for p in await repo.list_for_season(season_id)]


@router.get("/seasons/{season_id}/best-plan", response_model=PlanOut | None)
async def best_plan_for_season(
    season_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user: UserORM = Depends(current_active_user),
) -> PlanOut | None:
    repo = SqlPlanRepository(db)
    plans = await repo.list_for_season(season_id)
    if not plans:
        return None
    best = max(plans, key=lambda p: p.score)
    return _plan_to_out(best)


@router.get("/plans/{plan_id}", response_model=PlanOut)
async def get_plan(
    plan_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user: UserORM = Depends(current_active_user),
) -> PlanOut:
    repo = SqlPlanRepository(db)
    p = await repo.get(plan_id)
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return _plan_to_out(p)


@router.get("/plans/{old_id}/diff/{new_id}", response_model=PlanDiffOut)
async def diff_two_plans(
    old_id: UUID,
    new_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user: UserORM = Depends(current_active_user),
) -> PlanDiffOut:
    repo = SqlPlanRepository(db)
    old_p = await repo.get(old_id)
    new_p = await repo.get(new_id)
    if old_p is None or new_p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "plan not found")
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
    request: Request,
    user: UserORM = Depends(current_active_user),
) -> ChatResponse:
    # Lazy import — avoids loading heavy LLM client unless used.
    from coach_api.infrastructure.agent import build_agent, chat_once

    bearer = request.headers.get("authorization", "").removeprefix("Bearer ").strip() or None
    api_base = str(request.base_url).rstrip("/")
    agent = build_agent(api_base=api_base, bearer=bearer)
    history = [m.model_dump() for m in data.history]
    reply = chat_once(agent, data.message, history)
    return ChatResponse(reply=reply)


@router.post("/chat/stream")
async def chat_stream_endpoint(
    data: ChatRequest,
    request: Request,
    user: UserORM = Depends(current_active_user),
):
    """Streaming chat endpoint — yields plain text chunks as the LLM
    produces them. The frontend reads the response body as a stream and
    appends each chunk to the current assistant bubble for near-zero
    perceived latency."""
    from fastapi.responses import StreamingResponse

    from coach_api.infrastructure.agent import build_agent, chat_stream

    bearer = request.headers.get("authorization", "").removeprefix("Bearer ").strip() or None
    api_base = str(request.base_url).rstrip("/")
    agent = build_agent(api_base=api_base, bearer=bearer)
    history = [m.model_dump() for m in data.history]

    async def gen():
        async for token in chat_stream(agent, data.message, history):
            yield token

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
    return [AdminUserOut.model_validate(r) for r in rows]


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
    await db.flush()  # get user.id before linking related rows

    # Auto-create the matching domain record so the user can
    # immediately start filling in their profile. Role assignment is
    # exclusively the admin's responsibility — users cannot promote
    # themselves to coach/player.
    from coach_api.infrastructure.models import CoachORM, PlayerORM

    label = data.email.split("@")[0]
    if role == UserRole.COACH:
        db.add(CoachORM(user_id=user.id, name=label, availability=[], constraints={}))
    elif role == UserRole.PLAYER:
        db.add(PlayerORM(user_id=user.id, name=label, availability=[], preferences={}))

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
    if data.role is not None:
        new_role = UserRole(data.role.lower())
        user.role = new_role
        user.is_superuser = new_role == UserRole.ADMIN
        # Provision the matching domain record if the new role implies one.
        from sqlalchemy import select

        from coach_api.infrastructure.models import CoachORM, PlayerORM

        if new_role == UserRole.COACH:
            existing = (
                await db.execute(select(CoachORM).where(CoachORM.user_id == user.id))
            ).scalar_one_or_none()
            if existing is None:
                db.add(
                    CoachORM(
                        user_id=user.id,
                        name=user.email.split("@")[0],
                        availability=[],
                        constraints={},
                    )
                )
        elif new_role == UserRole.PLAYER:
            existing = (
                await db.execute(select(PlayerORM).where(PlayerORM.user_id == user.id))
            ).scalar_one_or_none()
            if existing is None:
                db.add(
                    PlayerORM(
                        user_id=user.id,
                        name=user.email.split("@")[0],
                        availability=[],
                        preferences={},
                    )
                )
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
    await db.delete(user)
    await _audit(db, actor, "delete", "user", str(user_id), {})
    await db.commit()


# ---------- Profile (self-service) ----------
#
# These endpoints operate directly on the ORM rows so they can read/write the
# extended profile fields that live inside the existing JSON columns
# (PlayerORM.preferences, CoachORM.constraints) without a DB migration.

from coach_api.infrastructure.models import CoachORM, PlayerORM  # noqa: E402


def _coach_orm_to_dict(c: CoachORM) -> dict:
    return {
        "id": str(c.id),
        "name": c.name,
        "availability": sorted(c.availability or []),
        "max_group_size": c.max_group_size,
        "constraints": c.constraints or {},
    }


def _player_orm_to_dict(p: PlayerORM, *, include_level: bool = True) -> dict:
    prefs = dict(p.preferences or {})
    if not include_level:
        prefs.pop("level_lk", None)
    return {
        "id": str(p.id),
        "name": p.name,
        "availability": sorted(p.availability or []),
        "min_slots_per_week": p.min_slots_per_week,
        "max_slots_per_week": p.max_slots_per_week,
        "preferences": prefs,
    }


@router.get("/me/profile")
async def get_my_profile(
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(current_active_user),
) -> dict:
    """Return the authenticated user's coach- and/or player record.

    A single user can have either, both, or neither linked via ``user_id``.
    """
    from sqlalchemy import select

    coach_row = (
        await db.execute(select(CoachORM).where(CoachORM.user_id == user.id))
    ).scalar_one_or_none()
    player_row = (
        await db.execute(select(PlayerORM).where(PlayerORM.user_id == user.id))
    ).scalar_one_or_none()
    return {
        "user": {"id": str(user.id), "email": user.email, "role": user.role},
        "coach": _coach_orm_to_dict(coach_row) if coach_row else None,
        "player": _player_orm_to_dict(player_row) if player_row else None,
    }


@router.put("/me/profile/coach")
async def upsert_my_coach_profile(
    data: CoachIn,
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(require_role(UserRole.COACH, UserRole.ADMIN)),
) -> dict:
    from sqlalchemy import select

    row = (
        await db.execute(select(CoachORM).where(CoachORM.user_id == user.id))
    ).scalar_one_or_none()
    if row is None:
        # Self-promotion to coach is not allowed for regular users. Admins,
        # however, may auto-provision their own coach record on the fly so
        # they can act as both administrator and trainer.
        if user.role != UserRole.ADMIN:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Kein Trainer-Datensatz für diesen Benutzer. Bitte den Admin bitten, dich als Trainer anzulegen.",
            )
        row = CoachORM(user_id=user.id, name=data.name or user.email.split("@")[0])
        db.add(row)
    row.name = data.name
    row.availability = list(sorted(set(data.availability)))
    row.constraints = data.constraints.model_dump(exclude_none=False)
    row.max_group_size = data.max_group_size
    await db.commit()
    await db.refresh(row)
    await _audit(db, user, "update", "coach_profile", str(row.id), {})
    return _coach_orm_to_dict(row)


@router.put("/me/profile/player")
async def upsert_my_player_profile(
    data: PlayerIn,
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(require_role(UserRole.PLAYER, UserRole.COACH, UserRole.ADMIN)),
) -> dict:
    """Players can edit their own availability, preferences, age and weekly
    target slots. The ``level_lk`` field is intentionally **stripped** here —
    only coaches/admins may set it via ``PATCH /players/{id}/level``.

    The user's player record must already exist; admins create it when they
    provision the user. Admins themselves may auto-provision."""
    from sqlalchemy import select

    row = (
        await db.execute(select(PlayerORM).where(PlayerORM.user_id == user.id))
    ).scalar_one_or_none()
    if row is None:
        if user.role != UserRole.ADMIN:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Kein Spieler-Datensatz für diesen Benutzer. Bitte den Admin bitten, dich als Spieler anzulegen.",
            )
        row = PlayerORM(user_id=user.id, name=data.name or user.email.split("@")[0])
        db.add(row)
    incoming_prefs = data.preferences.model_dump(mode="json", exclude_none=False)
    # Preserve any existing level_lk set by a coach.
    existing_level = (row.preferences or {}).get("level_lk")
    incoming_prefs["level_lk"] = existing_level

    row.name = data.name
    row.availability = list(sorted(set(data.availability)))
    row.preferences = incoming_prefs
    row.min_slots_per_week = data.min_slots_per_week
    row.max_slots_per_week = data.max_slots_per_week
    await db.commit()
    await db.refresh(row)
    await _audit(db, user, "update", "player_profile", str(row.id), {})
    return _player_orm_to_dict(row)


@router.patch("/players/{player_id}/level")
async def set_player_level(
    player_id: UUID,
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: UserORM = Depends(require_role(UserRole.COACH, UserRole.ADMIN)),
) -> dict:
    """Coach/Admin endpoint: set a player's LK level (1–25)."""
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


@router.get("/players/full")
async def list_players_full(
    db: AsyncSession = Depends(get_db),
    _user: UserORM = Depends(current_active_user),
) -> list[dict]:
    """Like ``GET /players`` but includes the extended JSON metadata fields
    (age, level_lk, ...). Used by the Spieler tab."""
    from sqlalchemy import select

    rows = (await db.execute(select(PlayerORM).order_by(PlayerORM.name))).scalars().all()
    return [_player_orm_to_dict(p) for p in rows]


@router.get("/coaches/full")
async def list_coaches_full(
    db: AsyncSession = Depends(get_db),
    _user: UserORM = Depends(current_active_user),
) -> list[dict]:
    from sqlalchemy import select

    rows = (await db.execute(select(CoachORM).order_by(CoachORM.name))).scalars().all()
    return [_coach_orm_to_dict(c) for c in rows]


@router.get("/me", response_model=AdminUserOut)
async def get_me(user: UserORM = Depends(current_active_user)) -> AdminUserOut:
    """Return the currently authenticated user (used by the frontend to
    decide whether to show admin features)."""
    return AdminUserOut.model_validate(user)
