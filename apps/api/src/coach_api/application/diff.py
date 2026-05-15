"""Plan-Diff: Vergleich zweier WeeklyPlans (z. B. alter vs. neuer Saison-Plan).

Vergleicht die Sessions auf Basis von (coach, court, slot_indices, player-set)
und liefert Listen: hinzugefügte, entfernte und unveränderte Sessions sowie
Auslastungs-Veränderungen pro Trainer und Spieler.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from uuid import UUID

from coach_api.domain.entities import TrainingSession, WeeklyPlan


def _session_key(s: TrainingSession) -> tuple:
    return (
        s.coach_id,
        s.court_id,
        s.slot_indices,
        tuple(sorted(s.player_ids)),
        s.session_type.value,
    )


@dataclass(slots=True)
class WorkloadDelta:
    """Signed deltas in slot counts."""

    coach_slots: dict[UUID, int] = field(default_factory=dict)
    player_slots: dict[UUID, int] = field(default_factory=dict)


@dataclass(slots=True)
class PlanDiff:
    added: list[TrainingSession]
    removed: list[TrainingSession]
    unchanged: list[TrainingSession]
    workload: WorkloadDelta
    score_delta: float


def _accumulate(plan: WeeklyPlan, sign: int, agg: WorkloadDelta) -> None:
    for s in plan.sessions:
        n = len(s.slot_indices)
        agg.coach_slots[s.coach_id] = agg.coach_slots.get(s.coach_id, 0) + sign * n
        for p in s.player_ids:
            agg.player_slots[p] = agg.player_slots.get(p, 0) + sign * n


def diff_plans(old: WeeklyPlan, new: WeeklyPlan) -> PlanDiff:
    old_keys = {_session_key(s): s for s in old.sessions}
    new_keys = {_session_key(s): s for s in new.sessions}

    added = [s for k, s in new_keys.items() if k not in old_keys]
    removed = [s for k, s in old_keys.items() if k not in new_keys]
    unchanged = [s for k, s in new_keys.items() if k in old_keys]

    workload = WorkloadDelta()
    _accumulate(new, +1, workload)
    _accumulate(old, -1, workload)
    # prune zero entries for cleanliness
    workload.coach_slots = {k: v for k, v in workload.coach_slots.items() if v != 0}
    workload.player_slots = {k: v for k, v in workload.player_slots.items() if v != 0}

    return PlanDiff(
        added=added,
        removed=removed,
        unchanged=unchanged,
        workload=workload,
        score_delta=new.score - old.score,
    )
