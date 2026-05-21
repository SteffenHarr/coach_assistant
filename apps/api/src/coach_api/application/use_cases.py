"""Use case: generate weekly plan candidates for a given season."""

from __future__ import annotations

import dataclasses
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
from coach_api.solver.diagnostics import FALLBACK_TIERS, preflight


@dataclass(slots=True)
class GeneratePlanCommand:
    season_id: UUID
    num_solutions: int = 3
    time_limit_seconds: float = 30.0
    weights: ObjectiveWeights | None = None
    # "both" = alle Plätze, "indoor" = nur Hallenplätze, "outdoor" = nur
    # Außenplätze. Filter wird **vor** dem Solver angewendet.
    court_filter: str = "both"


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

        # Indoor/Outdoor-Filter anwenden, bevor der Solver läuft.
        if cmd.court_filter == "indoor":
            courts = [c for c in courts if c.indoor]
        elif cmd.court_filter == "outdoor":
            courts = [c for c in courts if not c.indoor]
        if not courts:
            raise ValueError(
                f"Keine Plätze nach Filter '{cmd.court_filter}' übrig - "
                "bitte Filter ändern oder passende Plätze anlegen."
            )

        grid = TimeGrid()
        diag = preflight(coaches, players, courts, grid.total_slots)
        weights = cmd.weights or ObjectiveWeights()

        # Solver in mehreren Tiers versuchen: zuerst strikt, dann
        # progressiv lockerer. Sobald wir Pläne haben, brechen wir ab und
        # dokumentieren in der Erklärung, welche Constraints geopfert wurden.
        last_status = "EMPTY_INPUT"
        for tier_idx, rcfg in enumerate(FALLBACK_TIERS):
            result = solve(
                SolverInput(
                    grid=grid,
                    coaches=coaches,
                    players=players,
                    courts=courts,
                    weights=weights,
                    num_solutions=cmd.num_solutions,
                    time_limit_seconds=cmd.time_limit_seconds,
                ),
                season_id=season.id,
                relax=rcfg,
            )
            last_status = result.status
            if result.plans:
                explanation = _build_explanation(
                    diag, rcfg, tier_idx, last_status, result.wall_time_seconds
                )
                annotated = [
                    dataclasses.replace(p, explanation=explanation)
                    for p in result.plans
                ]
                return await self._plans.save_many(annotated)

        # Auch der lockerste Tier hat nichts geliefert.
        # Wir geben einen Pseudo-Plan mit nur einer Erklärung zurück, damit
        # der User auf der UI nachvollziehen kann, was schief gelaufen ist.
        explanation = _build_explanation(diag, None, -1, last_status, 0.0)
        empty_plan = WeeklyPlan(season_id=season.id, sessions=(), score=0.0, explanation=explanation)
        return await self._plans.save_many([empty_plan])


def _build_explanation(
    diag,
    rcfg,
    tier_idx: int,
    status: str,
    wall_time: float,
) -> str:
    """Markdown-Erklärung für die Plan-Detailansicht aufbauen."""
    parts: list[str] = []

    if rcfg is None or tier_idx < 0:
        parts.append(
            "## ❌ Es konnte kein Plan erstellt werden\n\n"
            "Auch nach Lockerung aller weichen Constraints fand der Solver keine "
            "gültige Lösung. Bitte die folgenden Hinweise prüfen und dann erneut "
            "versuchen."
        )
    elif tier_idx == 0:
        parts.append(
            "## ✅ Perfekter Plan\n\n"
            "Alle harten Constraints sind erfüllt - keine Vorgabe musste "
            "gelockert werden."
        )
    else:
        parts.append(
            f"## ⚠️ Plan mit gelockerten Vorgaben (Stufe {tier_idx})\n\n"
            "Ein perfekter Plan war nicht möglich. Folgende Vorgaben mussten "
            f"gelockert werden, um überhaupt eine Lösung zu finden:\n\n"
            f"**{rcfg.label()}**\n\n"
            "Tipp: Wenn das nicht passt, kannst du im Editor unten den Plan "
            "von Hand nachjustieren - oder zuerst die Eingangsdaten ändern "
            "(z.B. mehr Verfügbarkeit eintragen, Mindeststunden senken)."
        )

    md = diag.as_markdown()
    if md:
        parts.append("")
        parts.append(md)

    parts.append("")
    parts.append(
        f"_Solver-Status: `{status}`, Rechenzeit: {wall_time:.1f}s_"
    )
    return "\n".join(parts)
