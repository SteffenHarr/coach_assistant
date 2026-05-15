# Coach Assistant – Tennis-Trainingsplaner

Open-Source-Webanwendung zur automatischen Erstellung wöchentlicher Tennis-Trainingspläne
mit einem mathematischen Optimierer (OR-Tools CP-SAT) und einem konversationellen
LLM-Agenten (lokal via Ollama).

## Features

- Verfügbarkeits-Pflege für Trainer, Spieler und Plätze (Wochenkalender).
- Wunsch-Trainer und Wunsch-Spielpartner pro Spieler.
- Trainer-Constraints (z. B. „mindestens 3 Stunden am Stück", max. Stunden pro Tag/Woche).
- Saisonale Pläne (zwei pro Jahr), versioniert und immutable.
- Solver liefert mehrere Plan-Varianten mit Score und Begründung.
- Chat-Agent zum Pflegen von Daten und Erklären/Vergleichen von Plänen.
- Export als ICS und PDF.
- Rollen: Admin, Coach, Player.

## Tech-Stack (alles Open Source)

| Schicht | Technologie | Lizenz |
|---|---|---|
| Frontend | React + TypeScript + Vite + TanStack Query + react-big-calendar | MIT |
| API | FastAPI + Pydantic v2 | MIT/BSD |
| Solver | Google OR-Tools (CP-SAT) | Apache-2.0 |
| Agent | LangGraph + LangChain (mit Ollama-Backend) | MIT |
| LLM | Ollama (z. B. `llama3.1`, `qwen2.5`) lokal | MIT |
| DB | PostgreSQL 16 + SQLAlchemy 2 + Alembic | PostgreSQL/MIT |
| Queue | Redis + RQ | BSD/MIT |
| Auth | fastapi-users + Argon2 + JWT | MIT |
| Reverse-Proxy / TLS | Caddy 2 | Apache-2.0 |
| Tests | pytest, hypothesis, Playwright | MIT/Apache |

Keine kostenpflichtigen Cloud-Dienste erforderlich. Alles kann komplett selbst gehostet werden.

## Schnellstart (Docker)

> 📖 **Ausführliche, teilbare Schritt-für-Schritt-Anleitung für Nicht-Techniker:**
> [docs/SETUP.md](docs/SETUP.md) — inkl. weltweit erreichbar machen via Cloudflare Tunnel.

```bash
cp .env.example .env            # Secrets anpassen, KEINE Default-Werte in Produktion!
docker compose -f deploy/docker-compose.yml up --build
# Web-UI:     https://localhost/
# OpenAPI:    https://localhost/api/docs
```

Beim ersten Start lädt Ollama automatisch das konfigurierte Modell
(siehe `OLLAMA_MODEL` in `.env.example`).

## Architektur

Hexagonal / Clean Architecture:

```
apps/api/src/coach_api/
  domain/         # Reine Business-Logik, framework-frei
  application/    # Use Cases, Ports
  infrastructure/ # SQLAlchemy, Auth, LLM-, Queue-Adapter
  interfaces/     # FastAPI-Router
  solver/         # OR-Tools CP-SAT-Modell
```

Architektur-Entscheidungen sind als ADRs in [docs/adr/](docs/adr/) dokumentiert.

## Sicherheit & Datenschutz

Siehe [docs/SECURITY.md](docs/SECURITY.md) und [docs/PRIVACY.md](docs/PRIVACY.md).
Kurzfassung:

- Passwörter mit Argon2id gehasht.
- Kurzlebige JWT-Access-Tokens + httpOnly Refresh-Cookies.
- Strikte CORS, Rate Limiting (slowapi).
- Security-Header (HSTS, CSP, X-Frame-Options) via Caddy.
- LLM läuft lokal — keine personenbezogenen Daten verlassen den Server.
- Audit-Log aller schreibenden Aktionen.
- DSGVO-Endpunkte: Datenexport (Art. 15) und Löschung (Art. 17).
- Secrets ausschließlich über Umgebungsvariablen.

## Lizenz

AGPL-3.0 (siehe [LICENSE](LICENSE)).