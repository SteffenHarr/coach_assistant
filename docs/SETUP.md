# Coach Assistant – Installation und Betrieb

**Für wen ist diese Anleitung?**
Für jeden, der den Coach Assistant auf einem eigenen Rechner installieren und für seinen Verein/seine Trainingsgruppe weltweit erreichbar machen will. Es sind keine Programmier-Kenntnisse nötig – nur Geduld und ein wenig Sorgfalt beim Kopieren von Befehlen.

**Was bekommst du am Ende?**
Eine Webseite (z. B. `https://coach.dein-verein.de`), die du und alle Trainer/Schüler von überall im Internet sicher nutzen können. Trainingspläne werden automatisch berechnet, du kannst sie per Browser ansehen, und ein Chat-Assistent hilft beim Pflegen der Daten.

**Geschätzte Zeit für die einmalige Einrichtung:** ca. 60–90 Minuten.

---

## Inhalt

1. [Was du brauchst (Vorbereitung)](#1-was-du-brauchst-vorbereitung)
2. [Docker installieren](#2-docker-installieren)
3. [Coach Assistant herunterladen](#3-coach-assistant-herunterladen)
4. [Konfiguration anpassen (`.env`)](#4-konfiguration-anpassen-env)
5. [Erststart](#5-erststart)
6. [Admin-Account anlegen](#6-admin-account-anlegen)
7. [Von überall erreichbar machen (Cloudflare Tunnel)](#7-von-überall-erreichbar-machen-cloudflare-tunnel)
8. [Erste Daten anlegen und Plan rechnen](#8-erste-daten-anlegen-und-plan-rechnen)
9. [Tägliche Bedienung & Wartung](#9-tägliche-bedienung--wartung)
10. [Datensicherung (Backup)](#10-datensicherung-backup)
11. [Wenn etwas nicht funktioniert](#11-wenn-etwas-nicht-funktioniert)

---

## 1. Was du brauchst (Vorbereitung)

### Hardware (Server-Rechner)

| Komponente | Mindestens | Empfohlen |
|---|---|---|
| CPU | 2 Kerne | 4 Kerne |
| RAM | 4 GB (ohne Chat-Assistent) | 8 GB (mit Chat-Assistent) |
| Speicher | 10 GB frei | 20 GB frei |
| Internet | DSL 16 MBit/s | egal, was vorhanden |

Der Rechner muss **eingeschaltet sein**, wenn jemand auf die App zugreifen will. Idealerweise lässt du ihn 24/7 laufen.

### Software

- **Windows 10/11** (oder Windows Server). Die Anleitung verwendet Windows; mit kleinen Anpassungen funktioniert es auch auf macOS und Linux.
- **Docker Desktop** – installieren wir gleich.

### Konten (kostenlos)

- **Cloudflare-Konto:** https://dash.cloudflare.com/sign-up — für die weltweite Erreichbarkeit.
- **Eigene Domain (optional, ~10 €/Jahr):** z. B. `dein-verein.de`. Macht die App-Adresse schön und dauerhaft, ist aber **nicht zwingend nötig** — siehe [Schritt 7](#7-von-überall-erreichbar-machen-cloudflare-tunnel) für die Variante ohne Domain.

### Was kostet das Ganze?

| Posten | Pflicht? | Kosten |
|---|---|---|
| Coach Assistant selbst | – | **0 €** (Open Source) |
| Docker Desktop (privat / Verein <250 Personen) | ja | **0 €** |
| Cloudflare-Konto + Tunnel | ja, wenn von überall erreichbar | **0 €** |
| Eigene Domain | optional | **~10 €/Jahr** |
| Strom für den Server-PC | ja | je nach PC ~5–30 €/Jahr |

**Minimal-Variante (ohne Domain):** ~5–30 €/Jahr für Strom. Sonst nichts.
**Empfohlen (mit Domain):** zusätzlich ~10 €/Jahr — du bekommst eine schöne, dauerhafte Adresse.

---

## 2. Docker installieren

Docker ist ein Programm, das alle Bestandteile des Coach Assistants in „Containern" verpackt und ausführt. Du musst nichts manuell installieren – Docker erledigt alles.

1. **Docker Desktop herunterladen:** https://www.docker.com/products/docker-desktop/
2. Installer ausführen und alle Voreinstellungen akzeptieren.
3. Nach der Installation **Computer neu starten**.
4. Docker Desktop starten. Beim ersten Start wird eventuell „WSL2" mitinstalliert – einfach folgen, eventuell ist ein zweiter Neustart nötig.
5. Wenn Docker läuft, siehst du unten rechts in der Taskleiste das Wal-Symbol mit „Docker Desktop is running".

**Wichtige Einstellung:** Damit der Server nach jedem Hochfahren automatisch verfügbar ist, in Docker Desktop:

- Klick auf das Zahnrad oben rechts → **General**
- ✅ **Start Docker Desktop when you sign in to your computer**

---

## 3. Coach Assistant herunterladen

Wir holen den Code aus dem Internet.

1. **Git installieren** (falls noch nicht da): https://git-scm.com/download/win — alle Voreinstellungen akzeptieren.
2. Eine PowerShell öffnen (Windows-Taste → „PowerShell" eingeben → Enter).
3. Folgenden Befehl eingeben:

   ```powershell
   cd C:\
   git clone https://github.com/SteffenHarr/coach_assistant.git
   cd coach_assistant
   ```

   (Pfad anpassen, falls du das Repo woanders hast.)

---

## 4. Konfiguration anpassen (`.env`)

Die App braucht ein paar Geheimnisse (Passwörter), die nur du kennen sollst.

1. In der PowerShell, im Repo-Ordner:
   ```powershell
   Copy-Item .env.example .env
   notepad .env
   ```

2. Im Editor folgende Zeilen ändern (`<…>` durch deine Werte ersetzen):

   ```
   API_SECRET_KEY=<Befehl unten ausführen, Ergebnis hier einfügen>
   POSTGRES_PASSWORD=<irgendein langes Passwort, z.B. 24 Zeichen>
   DATABASE_URL=postgresql+psycopg://coach:<das gleiche Passwort wie oben>@db:5432/coach_assistant
   ```

   **Nur wenn du Variante A (eigene Domain) in [Schritt 7](#7-von-überall-erreichbar-machen-cloudflare-tunnel) wählst,** zusätzlich:
   ```
   DOMAIN=coach.dein-verein.de
   TLS_EMAIL=du@deine-email.de
   ```
   Bei Variante B (ohne Domain) lässt du `DOMAIN=localhost` einfach so stehen.

3. Sicheres `API_SECRET_KEY` generieren – in einer **zweiten** PowerShell:
   ```powershell
   [Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Max 256 }))
   ```
   Das Ergebnis kopieren und in die `.env` einsetzen.

4. Datei speichern und schließen.

> 🔒 **Wichtig:** Die `.env`-Datei niemandem zeigen, nicht ins Internet hochladen. Sie enthält die Schlüssel zu deiner Installation.

---

## 5. Erststart

In der PowerShell im Repo-Ordner:

```powershell
docker compose --env-file .env -f deploy/docker-compose.yml up -d --build
```

> 💡 **Wichtig:** Das `--env-file .env` muss bei **allen** `docker compose`-Befehlen mit angegeben werden, weil die Compose-Datei in `deploy/` liegt, die `.env` aber im Hauptordner. Ohne diesen Parameter findet Docker die Konfiguration nicht.

Das dauert beim **ersten** Mal 5–15 Minuten:
- Container werden gebaut.
- Wenn du das volle Setup nutzt, lädt der Chat-Assistent ca. 5 GB Modell-Dateien herunter.

Status prüfen:
```powershell
docker compose --env-file .env -f deploy/docker-compose.yml ps
```

Alles sollte als **`running` (oder `healthy`)** angezeigt werden.

Erster Test: Browser öffnen → http://localhost
- Du siehst die Coach-Assistant-Oberfläche. 🎉

> 🔒 **Zum Thema HTTPS:** Lokal über `localhost` ist die Verbindung unverschlüsselt, aber das ist sicher — die Daten verlassen deinen Rechner gar nicht. Sobald du in [Schritt 7](#7-von-überall-erreichbar-machen-cloudflare-tunnel) den Cloudflare Tunnel einrichtest, bekommen alle externen Nutzer automatisch eine **echte, vollwertige HTTPS-Verbindung** mit gültigem Zertifikat — Cloudflare kümmert sich um die Verschlüsselung.

---

## 6. Admin-Account anlegen

1. Im Browser: `http://localhost/api/docs` öffnen.
2. Den Abschnitt **`auth → POST /auth/register`** suchen, auf „Try it out" klicken.
3. Daten eingeben:
   ```json
   {
     "email": "admin@dein-verein.de",
     "password": "ein-sehr-langes-passwort-mind-12-zeichen"
   }
   ```
4. „Execute" klicken. Antwort sollte `201` zeigen.
5. **Den User zum Admin machen:** zurück in die PowerShell:
   ```powershell
   docker compose --env-file .env -f deploy/docker-compose.yml exec db `
     psql -U coach -d coach_assistant `
     -c "UPDATE users SET is_superuser=true, is_verified=true, role='ADMIN' WHERE email='admin@dein-verein.de';"
   ```
   (E-Mail im Befehl anpassen.)

6. Im Browser auf http://localhost öffnen → „Anmelden" → mit den Daten einloggen.

---

## 7. Von überall erreichbar machen (Cloudflare Tunnel)

So machen wir die App sicher aus dem Internet erreichbar – ohne Router-Konfiguration, ohne öffentliche IP, mit echtem HTTPS-Zertifikat.

Es gibt **zwei Varianten** — wähle eine:

| Variante | Adresse später | Kosten | Aufwand |
|---|---|---|---|
| **A) Mit eigener Domain** (empfohlen) | `https://coach.dein-verein.de` | ~10 €/Jahr | mittel |
| **B) Ohne Domain (Quick Tunnel)** | `https://coach-xyz123.trycloudflare.com` | 0 € | minimal |

> 💡 **Welche soll ich wählen?**
> – Wenn du die Adresse auf Plakaten, Flyern oder dauerhaft an Trainer/Schüler weitergeben willst → **Variante A**.
> – Wenn du nur kurz testen willst oder es dir egal ist, wie die Adresse aussieht → **Variante B**.
> – Du kannst später jederzeit von B nach A wechseln.

---

### Variante A: Mit eigener Domain (empfohlen)

#### A.1 Domain bei Cloudflare einrichten

1. Bei Cloudflare einloggen: https://dash.cloudflare.com
2. Oben links auf **„Add a Site"** → deine Domain eingeben (z. B. `dein-verein.de`) → **Free Plan** wählen.
3. Cloudflare zeigt dir zwei „Nameserver" an, z. B. `xyz.ns.cloudflare.com`.
4. Diese Nameserver bei deinem Domain-Anbieter (wo du die Domain gekauft hast) eintragen. Anleitung dort meist unter „DNS" oder „Nameserver". Nach dem Speichern dauert es bis zu 24 Stunden, meist aber nur ein paar Minuten.
5. Sobald Cloudflare „Active" anzeigt, geht's weiter.

#### A.2 Tunnel erstellen

1. In Cloudflare links im Menü: **Zero Trust** → bei der ersten Nutzung musst du einen kostenlosen Plan auswählen (Kreditkarte abfragen, wird aber nicht belastet).
2. **Networks → Tunnels → Create a tunnel**.
3. Tunnel-Typ: **Cloudflared** wählen.
4. Name: `coach-assistant` → Save.
5. Cloudflare zeigt dir einen Befehl wie:
   ```
   docker run cloudflare/cloudflared:latest tunnel --no-autoupdate run --token eyJ...sehr-langer-string...
   ```
   Den **Token** (die langen Buchstaben/Zahlen nach `--token`) kopieren.

#### A.3 Tunnel zur App hinzufügen

PowerShell, im Repo-Ordner:

```powershell
notepad deploy\docker-compose.yml
```

Am Ende der Datei (vor `volumes:`) folgenden Block einfügen:

```yaml
  cloudflared:
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
    command: tunnel --no-autoupdate run --token ${CLOUDFLARE_TUNNEL_TOKEN}
    networks: [internal]
    depends_on: [caddy]
```

In `.env` am Ende anhängen:
```
CLOUDFLARE_TUNNEL_TOKEN=<den Token hier einfügen>
```

Anwenden:
```powershell
docker compose --env-file .env -f deploy/docker-compose.yml up -d
```

#### A.4 Domain mit der App verbinden

Zurück in Cloudflare beim Tunnel:

1. **Public Hostname** → **Add a public hostname**
2. Subdomain: `coach`
3. Domain: `dein-verein.de`
4. Service-Type: **HTTPS**
5. URL: `caddy:443`
6. Unter **Additional application settings → TLS** → **No TLS Verify** aktivieren (weil Caddy intern selbst-signiert)
7. **Save**.

#### A.5 Fertig!

Browser öffnen: `https://coach.dein-verein.de` – die App ist jetzt **weltweit** erreichbar mit echtem HTTPS-Zertifikat. Diesen Link kannst du an Trainer und Schüler weitergeben.

---

### Variante B: Ohne Domain (Quick Tunnel)

Komplett kostenlos, nur ein Befehl. Die Adresse ist hässlich (`https://abc-def-ghi.trycloudflare.com`), aber funktioniert.

#### B.1 Tunnel-Service zur App hinzufügen

PowerShell, im Repo-Ordner:

```powershell
notepad deploy\docker-compose.yml
```

Am Ende der Datei (vor `volumes:`) folgenden Block einfügen:

```yaml
  cloudflared:
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
    command: tunnel --no-autoupdate --url https://caddy:443 --no-tls-verify
    networks: [internal]
    depends_on: [caddy]
```

Anwenden:

```powershell
docker compose --env-file .env -f deploy/docker-compose.yml up -d
```

#### B.2 Adresse herausfinden

```powershell
docker compose --env-file .env -f deploy/docker-compose.yml logs cloudflared
```

In der Ausgabe siehst du eine Zeile wie:
```
Your quick Tunnel has been created! Visit it at:
https://stupid-fox-loud-mountain.trycloudflare.com
```

Diese Adresse ist deine App-URL. Browser öffnen → fertig. Alle, die den Link haben, können die App nutzen.

> ⚠️ **Wichtig:** Bei jedem Neustart des `cloudflared`-Containers bekommst du eine **neue zufällige Adresse**. Für Dauerbetrieb deshalb besser Variante A. Aber: Solange du den Container nicht stoppst (oder neu startest), bleibt die Adresse stabil.

---

### Sicherheitshinweis (für beide Varianten)

> 🛡️ Cloudflare schützt automatisch vor DDoS-Angriffen und filtert verdächtigen Traffic. Dein Heim-Internet bleibt nach außen unsichtbar – nur der Tunnel ist offen.

---

## 8. Erste Daten anlegen und Plan rechnen

1. Auf der Webseite einloggen.
2. **„Saisonwechsel"** in der Navigation → folge dem Wizard.
3. Vor dem ersten Plan brauchst du mindestens:
   - **1 Trainer** (über `/api/docs` → `POST /coaches`)
   - **1 Spieler** (`POST /players`)
   - **1 Court** (`POST /courts`)
4. Verfügbarkeiten dann komfortabel im Reiter **„Verfügbarkeiten"** eintragen (Klicken & Ziehen im Wochenraster).
5. Trainer-Constraints (z. B. „mindestens 3 Stunden am Stück") im Reiter **„Trainer"**.
6. Im Saisonwechsel-Wizard **„Pläne generieren"** klicken → mehrere Vorschläge erhalten.
7. Plan anklicken → schöne Wochenkalender-Ansicht.

---

## 9. Tägliche Bedienung & Wartung

Alle Befehle in PowerShell, im Repo-Ordner. **Wichtig:** Immer `--env-file .env` mit angeben.

| Aktion | Befehl |
|---|---|
| Status der Container ansehen | `docker compose --env-file .env -f deploy/docker-compose.yml ps` |
| Logs in Echtzeit ansehen | `docker compose --env-file .env -f deploy/docker-compose.yml logs -f` |
| Stoppen | `docker compose --env-file .env -f deploy/docker-compose.yml stop` |
| Wieder starten | `docker compose --env-file .env -f deploy/docker-compose.yml start` |
| Komplett neu starten | `docker compose --env-file .env -f deploy/docker-compose.yml restart` |
| Auf neue Version updaten | `git pull; docker compose --env-file .env -f deploy/docker-compose.yml up -d --build` |

### Stromsparmodus deaktivieren

Damit der Server nachts nicht in den Schlaf geht:
```powershell
powercfg /change standby-timeout-ac 0
```

---

## 10. Datensicherung (Backup)

**Sehr wichtig** — sonst sind im Defekt-Fall alle Pläne weg.

Tägliches Backup einrichten:

1. Backup-Ordner anlegen, z. B. `C:\Backups\coach`. Idealerweise ein Cloud-synchronisierter Ordner (OneDrive, Dropbox).
2. Datei `C:\Backups\coach\backup.ps1` erstellen mit Inhalt:
   ```powershell
   $date = Get-Date -Format 'yyyy-MM-dd'
   $out = "C:\Backups\coach\coach-$date.sql"
   docker compose --env-file C:\Git_Repos\coach_assistant\.env `
     -f C:\Git_Repos\coach_assistant\deploy\docker-compose.yml `
     exec -T db pg_dump -U coach coach_assistant > $out
   # alte Backups (>30 Tage) löschen
   Get-ChildItem C:\Backups\coach\coach-*.sql |
     Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
     Remove-Item
   ```
3. Im Windows-Aufgabenplaner einen täglichen Job anlegen:
   - **Aufgabenplaner öffnen** → „Aufgabe erstellen"
   - Name: `Coach Assistant Backup`
   - Trigger: Täglich, z. B. 03:00 Uhr
   - Aktion: `powershell.exe -File C:\Backups\coach\backup.ps1`

### Wiederherstellung

Im Notfall:
```powershell
Get-Content C:\Backups\coach\coach-YYYY-MM-DD.sql | `
  docker compose --env-file .env -f deploy/docker-compose.yml exec -T db psql -U coach coach_assistant
```

---

## 11. Wenn etwas nicht funktioniert

| Symptom | Was tun? |
|---|---|
| `https://localhost` lädt nicht | `docker compose -f deploy/docker-compose.yml ps` — alles `healthy`? Sonst Logs ansehen: `docker compose ... logs api` |
| `https://coach.dein-verein.de` zeigt Cloudflare-Fehlerseite | Tunnel-Status in Cloudflare prüfen (Zero Trust → Tunnels). Container neu starten: `docker compose ... restart cloudflared` |
| Chat-Assistent antwortet nicht | Modell wird beim ersten Request geladen, das dauert auf langsamen Rechnern bis zu 60 Sek. Geduld. Sonst Logs: `docker compose ... logs ollama` |
| Container belegt zu viel RAM | In `.env` kleineres LLM-Modell setzen: `OLLAMA_MODEL=qwen2.5:3b`, dann `docker compose ... restart ollama` |
| Login-Daten vergessen | Direkt in DB neu setzen, siehe [Schritt 6](#6-admin-account-anlegen) — Passwort in DB löschen + neu registrieren |
| Update kaputt — alles tot | Letzte Version reaktivieren: `git checkout <vorherige-version>; docker compose ... up -d --build` |

### Hilfe holen

- Logs sammeln: `docker compose -f deploy/docker-compose.yml logs > logs.txt`
- Forum/Issue-Tracker des Projekts (Link einfügen).

---

## Anhang: Was läuft da eigentlich?

Wenn du wissen willst, was auf deinem Server passiert:

| Container | Aufgabe |
|---|---|
| `db` | PostgreSQL-Datenbank — speichert alle Daten |
| `redis` | Schneller Zwischenspeicher für Hintergrund-Jobs |
| `api` | Die eigentliche App (Python/FastAPI), Plan-Berechnung |
| `worker` | Lange Berechnungen im Hintergrund |
| `web` | Die Webseite (React) |
| `caddy` | Reverse-Proxy mit HTTPS |
| `ollama` | Lokaler KI-Chat (optional) |
| `cloudflared` | Sicherer Tunnel zu Cloudflare |

Alle Container laufen isoliert; keiner hat Zugriff auf den Rest deines Computers außer auf die definierten Ordner. Datenbank und KI sind **nicht** öffentlich erreichbar — nur über die App.

---

## Lizenz und Datenschutz

Der Coach Assistant ist Open Source unter der **AGPL-3.0**-Lizenz. Du darfst ihn frei nutzen, anpassen und teilen.

Da der Server bei dir steht und der KI-Chat lokal läuft, **verlassen keine personenbezogenen Daten deinen Server** (außer dem verschlüsselten HTTPS-Verkehr durch Cloudflare). Siehe `docs/PRIVACY.md` für Details.

Wenn du den Coach Assistant für andere Personen betreibst, bist du **Verantwortlicher** im Sinne der DSGVO und musst eine Datenschutzerklärung anbieten.
