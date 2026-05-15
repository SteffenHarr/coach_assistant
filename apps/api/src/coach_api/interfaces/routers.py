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
    user: UserORM = Depends(require_role(UserRole.ADMIN, UserRole.COACH)),
) -> CoachOut:
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
    user: UserORM = Depends(require_role(UserRole.ADMIN, UserRole.COACH)),
) -> PlayerOut:
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
