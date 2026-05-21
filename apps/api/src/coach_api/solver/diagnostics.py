"""Solver-Diagnostik und gestufte Relaxierung der harten Constraints.

Wenn der strikte Solver keine Lösung findet, lockern wir Constraints in
einer festgelegten Reihenfolge (geringster Verlust für die Gesamtqualität
zuerst) und versuchen erneut. Außerdem führen wir vor dem Solver-Lauf
billige Pre-Flight-Checks durch, die menschenlesbare Hinweise liefern.

Die Ergebnisse werden als Markdown in ``WeeklyPlan.explanation``
geschrieben und vom Frontend angezeigt.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from coach_api.domain.entities import Coach, Player
from coach_api.solver.model import _coach_accepts_player


# ---------- Relaxation tiers ----------


@dataclass(slots=True, frozen=True)
class RelaxationConfig:
    """Steuert, welche harten Constraints gelockert werden.

    Bei ``relax_player_min`` wird die Mindeststundenzahl pro Spieler nicht
    erzwungen, sondern als Slack-Variable mit hoher Strafe ins Objective
    aufgenommen. Die restlichen Flags entfernen die jeweiligen harten
    Constraints komplett (der Solver bestraft sie nur noch implizit über
    das Demand-Reward).
    """

    relax_player_min: bool = False
    relax_coach_block: bool = False
    relax_coach_max: bool = False
    relax_category: bool = False

    def label(self) -> str:
        """Human-readable description of which constraints were dropped."""
        parts: list[str] = []
        if self.relax_player_min:
            parts.append("Mindeststunden pro Spieler")
        if self.relax_coach_block:
            parts.append("Mindest-Blocklänge der Trainer")
        if self.relax_coach_max:
            parts.append("Max. Stunden pro Tag/Woche der Trainer")
        if self.relax_category:
            parts.append("Trainings-Kategorie-Filter (Kinder/Jugend/Erwachsene/Mannschaft)")
        return ", ".join(parts) if parts else "keine"


# Reihenfolge: zuerst nichts lockern, dann von "kleinster Schmerz" zu
# "größtmögliche Flexibilität".
FALLBACK_TIERS: tuple[RelaxationConfig, ...] = (
    RelaxationConfig(),
    RelaxationConfig(relax_player_min=True),
    RelaxationConfig(relax_player_min=True, relax_coach_block=True),
    RelaxationConfig(
        relax_player_min=True, relax_coach_block=True, relax_coach_max=True
    ),
    RelaxationConfig(
        relax_player_min=True,
        relax_coach_block=True,
        relax_coach_max=True,
        relax_category=True,
    ),
)


# ---------- Pre-flight diagnostics ----------


@dataclass(slots=True)
class DiagnosticIssue:
    """Ein menschenlesbarer Hinweis auf ein Konfigurations-Problem."""

    severity: str  # "error" | "warning" | "info"
    message: str


@dataclass(slots=True)
class Diagnostics:
    issues: list[DiagnosticIssue] = field(default_factory=list)

    def add(self, severity: str, message: str) -> None:
        self.issues.append(DiagnosticIssue(severity=severity, message=message))

    @property
    def has_errors(self) -> bool:
        return any(i.severity == "error" for i in self.issues)

    def as_markdown(self) -> str:
        if not self.issues:
            return ""
        icon = {"error": "❌", "warning": "⚠️", "info": "ℹ️"}
        lines = ["**Pre-Flight-Diagnose:**", ""]
        for i in self.issues:
            lines.append(f"- {icon.get(i.severity, '•')} {i.message}")
        return "\n".join(lines)


def preflight(
    coaches: list[Coach], players: list[Player], courts: list, total_slots: int
) -> Diagnostics:
    """Billige Plausibilitäts-Checks bevor der Solver startet.

    Findet die häufigsten Ursachen für eine unlösbare Aufgabe und meldet
    sie als menschenlesbare Hinweise. Erzeugt keine Garantien - der
    Solver kann trotz "alles OK" noch fehlschlagen, aber wenn hier ein
    Fehler steht, ist der Solver garantiert chancenlos.
    """
    diag = Diagnostics()

    if not coaches:
        diag.add("error", "Keine Trainer angelegt - es kann nichts geplant werden.")
    if not players:
        diag.add("error", "Keine Spieler angelegt - es kann nichts geplant werden.")
    if not courts:
        diag.add("error", "Keine Plätze angelegt - es kann nichts geplant werden.")
    if not coaches or not players or not courts:
        return diag

    # Trainer ohne Verfügbarkeit
    coaches_without_availability = [c for c in coaches if not c.availability]
    for c in coaches_without_availability:
        diag.add(
            "warning",
            f"Trainer **{c.name}** hat keine Verfügbarkeit eingetragen - "
            "wird im Plan nicht eingesetzt.",
        )

    # Plätze ohne Verfügbarkeit
    courts_without_availability = [c for c in courts if not c.availability]
    for c in courts_without_availability:
        diag.add(
            "warning",
            f"Platz **{c.name}** hat keine Verfügbarkeit - wird nicht genutzt.",
        )

    # Spieler ohne Verfügbarkeit
    for p in players:
        if not p.availability:
            if p.min_slots_per_week > 0:
                diag.add(
                    "error",
                    f"Spieler **{p.name}** hat keine Verfügbarkeit, fordert "
                    f"aber min. {p.min_slots_per_week} Slots/Woche.",
                )
            else:
                diag.add(
                    "info",
                    f"Spieler **{p.name}** hat keine Verfügbarkeit - "
                    "wird nicht eingeplant.",
                )

    # Spieler ohne kompatiblen Trainer (Kategorie-Filter; Alter und LK
    # sind seit dem letzten Refactoring nur noch weiche Boni).
    for p in players:
        if not p.availability or p.min_slots_per_week == 0:
            continue
        compatible = [c for c in coaches if _coach_accepts_player(c, p)]
        if not compatible:
            cats_str = (
                ", ".join(sorted(c.value for c in p.categories))
                if p.categories
                else "frei"
            )
            diag.add(
                "error",
                f"Spieler **{p.name}** (Kategorien: {cats_str}) hat "
                "keinen Trainer mit passender Trainings-Kategorie. "
                "Trainer-Kategorien anpassen oder Spieler-Kategorien leeren."
                ,
            )
            continue
        # Soft LK-Warnung
        if p.level_lk is not None:
            from coach_api.solver.model import _lk_in_window
            in_window = any(_lk_in_window(c, p) for c in compatible)
            if not in_window and any(
                c.constraints.accepts_lk_min is not None
                or c.constraints.accepts_lk_max is not None
                for c in compatible
            ):
                diag.add(
                    "info",
                    f"Spieler **{p.name}** (LK {p.level_lk}) liegt außerhalb "
                    "des LK-Wunschbereichs aller Trainer – der Solver wird "
                    "trotzdem zuteilen, aber ohne LK-Bonus.",
                )
        # Soft Alter-Warnung
        if p.age is not None:
            from coach_api.solver.model import _age_in_window
            in_age = any(_age_in_window(c, p) for c in compatible)
            if not in_age and any(
                c.constraints.accepts_age_min is not None
                or c.constraints.accepts_age_max is not None
                for c in compatible
            ):
                diag.add(
                    "info",
                    f"Spieler **{p.name}** (Alter {p.age}) liegt außerhalb "
                    "des Alters-Wunschbereichs aller passenden Trainer – "
                    "Zuteilung trotzdem möglich, ohne Alters-Bonus.",
                )
        # Überlappung der Zeitfenster
        overlap = any(p.availability & c.availability for c in compatible)
        if not overlap:
            diag.add(
                "error",
                f"Spieler **{p.name}** hat keine gemeinsame Trainings-Zeit "
                "mit einem passenden Trainer.",
            )

    # Spieler-Nachfrage gegen Trainer-Kapazität (sehr grobe Abschätzung)
    total_demand_min = sum(p.min_slots_per_week for p in players)
    total_capacity = 0
    for c in coaches:
        cap = c.constraints.max_slots_per_week
        if cap is None:
            cap = len(c.availability)
        total_capacity += cap * c.max_group_size
    if total_demand_min > total_capacity > 0:
        diag.add(
            "warning",
            f"Gesamt-Nachfrage (min. **{total_demand_min}** Slots) übersteigt "
            f"die Trainer-Kapazität (max. **{total_capacity}** Slots * "
            "Gruppengröße). Mindeststunden werden eventuell verfehlt.",
        )

    # Mindest-Blocklänge vs. tatsächliche zusammenhängende Verfügbarkeit
    for c in coaches:
        mb = c.constraints.min_block_slots
        if mb <= 1 or not c.availability:
            continue
        # Längste zusammenhängende Verfügbarkeits-Sequenz
        sorted_slots = sorted(c.availability)
        longest_run = 1
        run = 1
        for i in range(1, len(sorted_slots)):
            if sorted_slots[i] == sorted_slots[i - 1] + 1:
                run += 1
                longest_run = max(longest_run, run)
            else:
                run = 1
        if longest_run < mb:
            diag.add(
                "warning",
                f"Trainer **{c.name}** verlangt Mindest-Block von {mb} Slots, "
                f"hat aber maximal {longest_run} aufeinanderfolgende Slots "
                "Verfügbarkeit.",
            )

    if not diag.issues:
        diag.add("info", "Keine offensichtlichen Konflikte vor dem Solver-Lauf.")

    return diag
