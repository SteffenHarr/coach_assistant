"""Weights for the soft-constraint objective.

All weights are non-negative integers (CP-SAT requires integral coefficients).
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class ObjectiveWeights:
    preferred_coach: int = 5
    preferred_partner: int = 4
    fulfill_player_demand: int = 10  # reward per scheduled player-slot
    coach_idle_penalty: int = 1      # discourage tiny isolated sessions
    court_switch_penalty: int = 2    # discourage switching courts mid-day for a coach
