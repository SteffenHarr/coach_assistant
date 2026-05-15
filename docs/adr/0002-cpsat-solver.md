# ADR 0002: OR-Tools CP-SAT als Scheduling-Solver

**Status:** Accepted
**Date:** 2026-05-11

## Context

Wir benötigen einen Algorithmus, der einen wöchentlichen Trainingsplan
unter zahlreichen harten Nebenbedingungen (Verfügbarkeit, Block-Längen,
Plätze, Gruppengrößen) findet und gleichzeitig weiche Ziele
(Wunschtrainer, Wunschpartner, Auslastung) maximiert. Die UI soll
außerdem **mehrere alternative Pläne** zur Auswahl anbieten.

Optionen:

1. **OR-Tools CP-SAT** (Apache-2.0) — State-of-the-art Constraint Programming Solver.
2. Greedy-Heuristik — schnell, aber keine Optimalitätsgarantien.
3. Reines LLM — flexibel, aber Constraints werden nicht garantiert eingehalten.

## Decision

Wir wählen **CP-SAT**. Mehrere Lösungen werden durch wiederholtes Lösen
mit „No-good cuts" erzeugt: nach jeder gefundenen Lösung wird sie als
verboten markiert und der Solver erneut aufgerufen.

## Consequences

- ➕ Hard Constraints sind garantiert erfüllt.
- ➕ Erklärbare Optimalität (Objective-Wert vergleichbar zwischen Plänen).
- ➕ Kostenlos, Open Source, sehr gut gewartet.
- ➖ Lernkurve für CP-SAT-Modellierung.
- ➖ Bei sehr großen Vereinen (>50 Spieler, >10 Plätze) muss das Modell
  ggf. in Blöcken (z. B. pro Tag) gelöst werden.
