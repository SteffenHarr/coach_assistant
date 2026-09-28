"""RQ job: run plan generation in the background worker.

The solver can legitimately take a minute or more (multiple candidate
variants, each with its own time budget, tried across several fallback
tiers). Running that synchronously inside an HTTP request is fragile: any
proxy or browser timeout along the way (Cloudflare Tunnel, the API client's
own request timeout, ...) kills it, even though the computation itself is
still fine. Here it runs in the ``worker`` container instead; the API just
enqueues and polls.
"""

from __future__ import annotations

import asyncio
from typing import Any
from uuid import UUID

from rq import get_current_job

from coach_api.application.use_cases import GeneratePlanCommand, GeneratePlanUseCase
from coach_api.infrastructure.db import SessionLocal
from coach_api.infrastructure.repositories import (
    SqlCoachRepository,
    SqlCourtRepository,
    SqlPlanRepository,
    SqlPlayerRepository,
    SqlSeasonRepository,
)


def run_plan_generation(
    season_id: str,
    num_solutions: int,
    time_limit_seconds: float,
    court_filter: str,
) -> dict[str, Any]:
    """RQ entry point — must be a plain sync function; bridges into the
    existing async application/infrastructure code via ``asyncio.run``."""
    return asyncio.run(
        _run(season_id, num_solutions, time_limit_seconds, court_filter)
    )


async def _run(
    season_id: str,
    num_solutions: int,
    time_limit_seconds: float,
    court_filter: str,
) -> dict[str, Any]:
    job = get_current_job()

    def on_progress(message: str) -> None:
        if job is None:
            return
        job.meta["status_text"] = message
        job.save_meta()

    if job is not None:
        job.meta["status_text"] = "Lade Daten…"
        job.save_meta()

    async with SessionLocal() as db:
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
                    season_id=UUID(season_id),
                    num_solutions=num_solutions,
                    time_limit_seconds=time_limit_seconds,
                    court_filter=court_filter,
                ),
                on_progress=on_progress,
            )
        except ValueError as e:
            return {"error": str(e)}

    return {
        "plans": [
            {
                "id": str(p.id),
                "season_id": str(p.season_id),
                "score": p.score,
                "sessions": len(p.sessions),
            }
            for p in plans
        ]
    }
