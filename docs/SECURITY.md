# Sicherheitskonzept

## Threat-Modell (Kurzfassung, STRIDE)

| Bedrohung | Maßnahme |
|---|---|
| Spoofing (Identitätsdiebstahl) | Argon2id für Passwörter, JWT mit kurzer Laufzeit, Rate Limiting auf Login |
| Tampering (Daten-Manipulation) | Server-seitige Pydantic-Validierung, Audit-Log aller Writes, RBAC |
| Repudiation (Bestreitbarkeit) | Audit-Log mit Actor-, Action-, Target-ID, Timestamp |
| Information Disclosure | TLS überall, restriktive CORS, Security-Header, lokales LLM (keine Daten verlassen den Server) |
| Denial of Service | Rate Limiting (slowapi), Timeout im Solver, Request-Body-Limit (Caddy 1 MB) |
| Elevation of Privilege | Rollen-basierte Dependencies (`require_role`), Superuser nur via DB-Migration setzbar |

## Authentifizierung & Autorisierung

- **Passwort-Hashing:** Argon2id (`argon2-cffi` mit sicheren Defaults). Automatisches Re-Hash bei geänderten Parametern.
- **Tokens:** JWT (HS256), Access-Token TTL 15 min. Refresh-Tokens optional als httpOnly+Secure+SameSite=Strict Cookie. Web-Frontend speichert Access-Token in `sessionStorage` (verschwindet beim Tab-Schließen).
- **Rollen:** `admin`, `coach`, `player`. Endpoints erzwingen Mindestrolle via FastAPI-Dependency `require_role`.
- **Mindestpasswortlänge:** 12 Zeichen (Pydantic-Validator).

## Transport & Header

- TLS-Terminierung in Caddy (Let's Encrypt automatisch oder interne CA für Dev).
- HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy — gesetzt sowohl in Caddy als auch in der API (Defence in Depth).

## Eingabevalidierung & Output

- **Input:** Pydantic v2 mit strikten Längen-/Range-Validatoren.
- **Output:** Antwort-Modelle blenden interne Felder (`hashed_password`, etc.) systematisch aus.
- **SQL-Injection:** SQLAlchemy 2 ORM mit parametrisierten Queries.
- **XSS:** React rendert standardmäßig escaped; keine `dangerouslySetInnerHTML`. CSP blockiert Inline-Skripte.

## Rate Limiting & Quotas

- `slowapi` global (per IP) — Default 60 req/min konfigurierbar via `API_RATE_LIMIT_PER_MINUTE`.
- Caddy: max. Request-Body 1 MB.
- Solver: harter Zeitlimit in Sekunden (Default 30) — verhindert Endlos-Berechnungen.

## LLM-Sicherheit

- **Lokales Modell** (Ollama). Es wird kein API-Key benötigt und keine Daten verlassen den Server.
- **Tool-Calls:** Schreibende Tools des Agents werden nur ausgeführt, wenn der Nutzer explizit bestätigt (`AGENT_REQUIRE_CONFIRMATION=true`).
- **Prompt-Injection:** System-Prompt enthält klare Regeln; Tool-Outputs werden vom Agent als Daten behandelt, nicht als Anweisungen. Audit-Log aller Tool-Calls.
- **Begrenzung:** `AGENT_MAX_TOOL_CALLS=10` pro Konversation.

## Container & Deployment

- Container laufen als Non-Root-User (UID ≥ 10000).
- DB, Redis, Ollama haben **keine** Host-Port-Bindings — nur das interne Docker-Netz.
- Healthchecks für DB und API.
- Secrets ausschließlich über Umgebungsvariablen (`.env` nicht committen, nutzt z. B. Docker Secrets oder Vault in Produktion).

## Abhängigkeiten

- Pin auf Major-Versionen, regelmäßiges `pip list --outdated` und `npm audit`.
- Empfehlung: Dependabot/Renovate aktivieren.

## Vulnerability Disclosure

Sicherheitslücken bitte vertraulich an `security@example.org` melden (in Produktion durch reale Adresse ersetzen).
