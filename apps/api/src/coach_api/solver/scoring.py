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
    lk_match: int = 3                # Bonus, wenn LK des Spielers im Trainer-Wunschbereich
    age_match: int = 2               # Bonus, wenn Alter des Spielers im Trainer-Wunschbereich
    mandatory_mate: int = 1          # nur dokumentarisch - mandatory ist hartes Constraint
    optional_mate: int = 3           # Bonus pro Co-Anwesenheit eines optionalen Wunschpartners
    group_size_match: int = 3        # Bonus pro Slot, wenn Gruppengröße der Spieler-Präferenz entspricht
    group_size_mismatch_penalty: int = 4  # Strafe pro Slot, wenn ein Spieler in falscher Gruppengröße landet
