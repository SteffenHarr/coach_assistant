"""Use case: generate weekly plan candidates for a given season."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from coach_api.application.ports import (
    CoachRepository,
    CourtRepository,
    PlanRepository,
    PlayerRepository,
    SeasonRepository,
)
from coach_api.domain.entities import WeeklyPlan
from coach_api.domain.time_grid import TimeGrid
from coach_api.solver import ObjectiveWeights, SolverInput, solve


@dataclass(slots=True)
class GeneratePlanCommand:
    season_id: UUID
    num_solutions: int = 3
    time_limit_seconds: float = 30.0
    weights: ObjectiveWeights | None = None


class GeneratePlanUseCase:
    def __init__(
        self,
        coaches: CoachRepository,
        players: PlayerRepository,
        courts: CourtRepository,
        seasons: SeasonRepository,
        plans: PlanRepository,
    ) -> None:
        self._coaches = coaches
        self._players = players
        self._courts = courts
        self._seasons = seasons
        self._plans = plans

    async def execute(self, cmd: GeneratePlanCommand) -> list[WeeklyPlan]:
        season = await self._seasons.get(cmd.season_id)
        if season is None:
            raise ValueError(f"Season {cmd.season_id} not found")

        coaches = await self._coaches.list_all()
        players = await self._players.list_all()
        courts = await self._courts.list_all()

        result = solve(
            SolverInput(
                grid=TimeGrid(),
                coaches=coaches,
                players=players,
                courts=courts,
                weights=cmd.weights or ObjectiveWeights(),
                num_solutions=cmd.num_solutions,
                time_limit_seconds=cmd.time_limit_seconds,
            ),
            season_id=season.id,
        )
        if not result.plans:
            return []
        return await self._plans.save_many(result.plans)
