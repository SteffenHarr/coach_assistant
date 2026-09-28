"""Weights for the soft-constraint objective.

All weights are non-negative integers (CP-SAT requires integral coefficients).
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class ObjectiveWeights:
    preferred_coach: int = 5
    # War 4 — zu schwach gegen konkurrierende Tie-Breaker wie LK+Alter
    # (zusammen 5): Wunschmitspieler wurden dadurch regelmäßig zugunsten
    # einer marginal besseren LK-/Alters-Passung verworfen, obwohl beide
    # zeitlich zusammen gepasst hätten.
    # Bewusst der stärkste Bonus im Modell nach der Grundnachfrage: ein
    # erfülltes Wunschpaar (2 Slots = 1 Std.) bringt damit 50 Punkte und
    # setzt sich gegen Gruppen-, LK- und Altersboni klar durch.
    preferred_partner: int = 25
    fulfill_player_demand: int = 10  # reward per scheduled player-slot
    # Belohnt jeden Trainer bis zu COACH_SPREAD_TARGET Slots (siehe model.py)
    # mit abnehmendem Grenznutzen danach — ohne das gab es keinerlei Anreiz,
    # einen verfügbaren Trainer überhaupt einzusetzen, sodass manche Wochen
    # komplett leer ausgingen, während andere Trainer alles bekamen.
    coach_spread_bonus: int = 6
    # Strafe pro zusätzlich benutztem Platz je Trainer und Tag. Deutlich
    # erhöht (war 6): ein unnötiger Platzwechsel muss teurer sein als die
    # kleinen Boni (LK 3, Alter 2, Gruppengröße 3), die ihn sonst
    # rechtfertigen — sonst wandert ein Trainer ohne Not über die Plätze.
    court_switch_penalty: int = 25
    lk_match: int = 3                # Bonus, wenn LK des Spielers im Trainer-Wunschbereich
    age_match: int = 2               # Bonus, wenn Alter des Spielers im Trainer-Wunschbereich
    group_size_match: int = 3        # Bonus pro Slot, wenn Gruppengröße der Spieler-Präferenz entspricht
    # Muss deutlich über grouping_bonus liegen, sonst würde der Wunsch
    # "nur Einzeltraining" vom Gruppen-Bonus überstimmt.
    group_size_mismatch_penalty: int = 20
    # Bonus pro Spieler ab dem zweiten in derselben Einheit (pro Slot) —
    # macht Gruppen attraktiver als mehrere Einzelstunden. Siehe model.py.
    grouping_bonus: int = 8
    # Tie-Breaker: bevorzugt Plätze mit niedrigerer `priority`-Zahl
    # (0 = am liebsten), z.B. "in der Halle immer erst Platz 1, 2, 3".
    # Klein genug, dass echte Nachfrage/Präferenzen (Wunschtrainer,
    # Gruppengröße, ...) immer schwerer wiegen — aber hoch genug, um sich
    # gegen andere kleine Boni (LK-/Alters-Bonus etc.) durchzusetzen.
    court_priority_penalty: int = 2
    # Bestraft unnötige Lücken im Tagesplan eines Trainers (z.B. eine halbe
    # Stunde Pause zwischen zwei Blöcken, obwohl ein durchgehender Block
    # möglich gewesen wäre) — pro zusätzlichem, vom ersten getrennten
    # Arbeitsblock am selben Tag. Der erste Block am Tag ist immer "gratis".
    coach_fragmentation_penalty: int = 5
