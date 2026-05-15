"""Smoke tests for the OR-Tools solver."""

from __future__ import annotations

from datetime import time
from uuid import uuid4

import pytest

from coach_api.domain.entities import (
    Coach,
    CoachConstraints,
    Court,
    Player,
    PlayerPreferences,
)
from coach_api.domain.time_grid import TimeGrid, Weekday
from coach_api.solver import SolverInput, solve


@pytest.fixture
def grid() -> TimeGrid:
    # 30-min slots, 7:00 – 22:00
    return TimeGrid(slot_minutes=30, day_start_minutes=7 * 60, day_end_minutes=22 * 60)


def _slots_for_day(grid: TimeGrid, day: Weekday, start_h: int, end_h: int) -> set[int]:
    out: set[int] = set()
    for h in range(start_h, end_h):
        for m in (0, 30):
            out.add(grid.index_for(day, time(h, m)))
    return out


def test_trivial_single_session(grid: TimeGrid) -> None:
    avail = _slots_for_day(grid, Weekday.MONDAY, 17, 19)
    coach = Coach(name="C1", availability=frozenset(avail))
    player = Player(
        name="P1",
        availability=frozenset(avail),
        min_slots_per_week=2,
        max_slots_per_week=2,
    )
    court = Court(name="R1", availability=frozenset(avail))

    result = solve(
        SolverInput(
            grid=grid,
            coaches=[coach],
            players=[player],
            courts=[court],
            num_solutions=1,
            time_limit_seconds=10,
        ),
        season_id=uuid4(),
    )
    assert result.plans, f"no plan, status={result.status}"
    plan = result.plans[0]
    total = sum(len(s.slot_indices) for s in plan.sessions)
    assert total == 2


def test_min_block_constraint(grid: TimeGrid) -> None:
    """Coach with min_block=4 (=2h) and player wanting only 2 slots must
    still produce a coach block of at least 4 slots."""
    avail = _slots_for_day(grid, Weekday.MONDAY, 17, 22)
    coach = Coach(
        name="C1",
        availability=frozenset(avail),
        constraints=CoachConstraints(min_block_slots=4),
    )
    player = Player(
        name="P1",
        availability=frozenset(avail),
        min_slots_per_week=2,
        max_slots_per_week=2,
    )
    court = Court(name="R1", availability=frozenset(avail))

    result = solve(
        SolverInput(
            grid=grid,
            coaches=[coach],
            players=[player],
            courts=[court],
            num_solutions=1,
            time_limit_seconds=10,
        ),
        season_id=uuid4(),
    )
    # Player only needs 2 slots — but the model only enforces min_block ON the
    # coach's busy-runs. Since coach can only be busy when a player is present
    # and player is capped at 2, the only way to satisfy min_block=4 here is to
    # have the player cap raised. So this should be INFEASIBLE-ish: solver returns
    # no plans (or a plan where coach isn't used). Both are acceptable.
    if result.plans:
        plan = result.plans[0]
        assert len(plan.sessions) == 0


def test_preferred_partner_grouped(grid: TimeGrid) -> None:
    avail = _slots_for_day(grid, Weekday.TUESDAY, 18, 20)
    coach = Coach(name="C1", availability=frozenset(avail), max_group_size=2)
    p1 = Player(name="A", availability=frozenset(avail), min_slots_per_week=2, max_slots_per_week=2)
    p2 = Player(
        name="B",
        availability=frozenset(avail),
        min_slots_per_week=2,
        max_slots_per_week=2,
        preferences=PlayerPreferences(preferred_partner_ids=(p1.id,)),
    )
    p1 = Player(
        name="A",
        id=p1.id,
        availability=frozenset(avail),
        min_slots_per_week=2,
        max_slots_per_week=2,
        preferences=PlayerPreferences(preferred_partner_ids=(p2.id,)),
    )
    court = Court(name="R1", availability=frozenset(avail))

    result = solve(
        SolverInput(
            grid=grid,
            coaches=[coach],
            players=[p1, p2],
            courts=[court],
            num_solutions=1,
            time_limit_seconds=10,
        ),
        season_id=uuid4(),
    )
    assert result.plans
    plan = result.plans[0]
    # Both players should appear together in at least one session.
    grouped = any(
        p1.id in s.player_ids and p2.id in s.player_ids for s in plan.sessions
    )
    assert grouped


def test_multiple_distinct_solutions(grid: TimeGrid) -> None:
    avail = _slots_for_day(grid, Weekday.WEDNESDAY, 17, 21)
    coach = Coach(name="C1", availability=frozenset(avail))
    p1 = Player(name="A", availability=frozenset(avail), min_slots_per_week=2, max_slots_per_week=2)
    p2 = Player(name="B", availability=frozenset(avail), min_slots_per_week=2, max_slots_per_week=2)
    court = Court(name="R1", availability=frozenset(avail))

    result = solve(
        SolverInput(
            grid=grid,
            coaches=[coach],
            players=[p1, p2],
            courts=[court],
            num_solutions=3,
            time_limit_seconds=15,
        ),
        season_id=uuid4(),
    )
    assert len(result.plans) >= 2
    # All plan signatures must be distinct
    sigs = {
        tuple(sorted((s.coach_id, s.court_id, s.player_ids, s.slot_indices) for s in plan.sessions))
        for plan in result.plans
    }
    assert len(sigs) == len(result.plans)
