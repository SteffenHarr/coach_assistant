# ADR 0001: Hexagonal Architecture

**Status:** Accepted
**Date:** 2026-05-11

## Context

Der Coach Assistant kombiniert mehrere komplexe Bausteine: einen
mathematischen Optimierer (OR-Tools), einen LLM-Agenten, eine
relationale Datenbank und eine REST-API. Wir wollen, dass der
Solver-Kern und die Domänen-Logik unabhängig von Web-Framework und
Persistenz testbar bleiben.

## Decision

Wir adoptieren eine **Hexagonal / Clean Architecture** in vier Schichten:

1. `domain/` — reine Python-Datenklassen, keine Imports aus Frameworks.
2. `application/` — Use Cases, definiert Ports (Protocols).
3. `infrastructure/` — SQLAlchemy-Adapter, Auth, LLM-Client, Queue.
4. `interfaces/` — FastAPI-Router, Pydantic-Schemas.

Die Abhängigkeitsrichtung zeigt immer **nach innen**:
`interfaces → application → domain` und `infrastructure → application/domain`.

## Consequences

- ➕ Solver und Domain sind ohne DB / FastAPI testbar (siehe `tests/test_solver.py`).
- ➕ Persistenz austauschbar (z. B. SQLite für Tests, Postgres in Prod).
- ➕ Klare Verantwortlichkeiten erleichtern das Onboarding.
- ➖ Etwas mehr Boilerplate (ORM↔Domain-Mapping in Repositories).
