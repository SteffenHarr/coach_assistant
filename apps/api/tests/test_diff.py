"""Tests for plan diff."""

from __future__ import annotations

from uuid import uuid4

from coach_api.application.diff import diff_plans
from coach_api.domain.entities import (
    SessionType,
    TrainingSession,
    WeeklyPlan,
)


def _session(coach, court, players, slots, st=SessionType.SINGLE):
    return TrainingSession(
        coach_id=coach,
        court_id=court,
        player_ids=tuple(players),
        slot_indices=tuple(slots),
        session_type=st,
    )


def test_diff_detects_added_removed_unchanged() -> None:
    season = uuid4()
    c1, r1 = uuid4(), uuid4()
    p1, p2 = uuid4(), uuid4()

    s_keep = _session(c1, r1, [p1], [10, 11])
    s_old_only = _session(c1, r1, [p2], [12, 13])
    s_new_only = _session(c1, r1, [p2], [20, 21])

    old = WeeklyPlan(season_id=season, sessions=(s_keep, s_old_only), score=10.0)
    new = WeeklyPlan(season_id=season, sessions=(s_keep, s_new_only), score=14.0)

    d = diff_plans(old, new)
    assert len(d.added) == 1 and d.added[0] == s_new_only
    assert len(d.removed) == 1 and d.removed[0] == s_old_only
    assert len(d.unchanged) == 1 and d.unchanged[0] == s_keep
    assert d.score_delta == 4.0
    # p2 has zero net change (lost 2 slots, gained 2) → pruned
    assert p2 not in d.workload.player_slots
    # coach total unchanged → pruned
    assert c1 not in d.workload.coach_slots


def test_diff_workload_changes() -> None:
    season = uuid4()
    c1, r1 = uuid4(), uuid4()
    p1 = uuid4()

    old = WeeklyPlan(season_id=season, sessions=(_session(c1, r1, [p1], [1, 2]),))
    new = WeeklyPlan(
        season_id=season,
        sessions=(
            _session(c1, r1, [p1], [1, 2]),
            _session(c1, r1, [p1], [10, 11, 12]),
        ),
    )
    d = diff_plans(old, new)
    assert d.workload.player_slots[p1] == 3
    assert d.workload.coach_slots[c1] == 3
