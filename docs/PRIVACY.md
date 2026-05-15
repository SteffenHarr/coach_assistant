# Datenschutzkonzept (DSGVO)

Diese Anwendung verarbeitet personenbezogene Daten von Trainern und Schülern.
Nachfolgend die Umsetzung der zentralen DSGVO-Anforderungen.

## Datenminimierung (Art. 5 Abs. 1 lit. c)

Es werden nur die Daten gespeichert, die für die Trainingsplanung erforderlich sind:

- **User:** E-Mail, Passwort-Hash, Rolle, Aktivierungs-Status.
- **Player/Coach:** Name, Verfügbarkeits-Slots, Präferenzen, Constraints.
- **Plan:** generierte Sessions (verknüpft IDs, keine Inhaltsdaten).

Es werden **keine** Geburtsdaten, Adressen, Telefonnummern, Zahlungsdaten oder Trainingsleistungs-Bewertungen gespeichert (sofern nicht später ausdrücklich ergänzt).

## Auskunftsrecht (Art. 15)

Endpoint `GET /me/export` liefert alle zur einloggenden Person gespeicherten Daten als JSON.

## Recht auf Löschung (Art. 17)

Endpoint `DELETE /me` löscht den eigenen Account. Verknüpfte Spieler-/Trainer-Datensätze bleiben pseudonymisiert (User-FK auf `NULL`), damit historische Pläne konsistent bleiben — auf Anfrage werden auch diese gelöscht.

## Speicherdauer (Art. 5 Abs. 1 lit. e)

- Audit-Log: 12 Monate, danach automatische Bereinigung (cron-Job in Worker, in Folge-Iteration).
- Inaktive Accounts: nach 24 Monaten ohne Login automatisch gelöscht.

## Sicherheit der Verarbeitung (Art. 32)

Siehe [SECURITY.md](SECURITY.md). Insbesondere:

- Verschlüsselung in Transit (TLS).
- Passwörter mit Argon2id gehasht.
- Zugriff nur authentifiziert; rollenbasiert beschränkt.
- Audit-Log aller schreibenden Aktionen.

## Auftragsverarbeitung (Art. 28)

- Es findet **keine** Übermittlung an Dritte statt — das LLM läuft lokal (Ollama).
- Beim Self-Hosting ist der Betreiber Verantwortlicher; bei externem Hosting ist ein AVV mit dem Hoster abzuschließen.

## Hinweise an Nutzer

- Bei Anlegen eines neuen Accounts muss eine Datenschutzerklärung angezeigt und akzeptiert werden (Frontend-TODO für M5).
- Cookies: nur funktional notwendig (Refresh-Token), kein Tracking, keine Drittanbieter — kein Cookie-Banner erforderlich (TTDSG §25 Abs. 2 Nr. 2).

## Datenexport-Format

JSON, inkl. UUIDs, ISO-8601-Timestamps. Bei Bedarf zusätzlich CSV durch zukünftiges Worker-Job.
