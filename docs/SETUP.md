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
11. [Umzug auf einen neuen Rechner / in die Cloud](#11-umzug-auf-einen-neuen-rechner--in-die-cloud)
12. [Wenn etwas nicht funktioniert](#12-wenn-etwas-nicht-funktioniert)

---

## 1. Was du brauchst (Vorbereitung)

### Hardware (Server-Rechner)

| Komponente | Mindestens | Empfohlen |
|---|---|---|
| CPU | 2 Kerne | 4 Kerne |
| RAM | 2 GB | 4 GB |
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
   ```
   Bei Variante B (ohne Domain) lässt du `DOMAIN=localhost` einfach so stehen. `TLS_EMAIL` kannst du unverändert lassen — Caddy nutzt für die interne Verbindung ohnehin immer ein selbstsigniertes Zertifikat (`tls internal`), die öffentliche Verschlüsselung übernimmt Cloudflare an dessen Edge.

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

Das dauert beim **ersten** Mal 5–15 Minuten (Python-Pakete und npm werden installiert).

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

Aus Sicherheitsgründen kann sich hier **niemand selbst registrieren** — Konten werden ausschließlich von einem Admin über die Benutzerverwaltung angelegt. Für den *allerersten* Account (es gibt ja noch keinen Admin) gibt es deshalb einen einmaligen Kommandozeilen-Befehl:

1. In der PowerShell, im Repo-Ordner:
   ```powershell
   docker compose --env-file .env -f deploy/docker-compose.yml exec api `
     python -m coach_api.scripts.create_admin admin@dein-verein.de "ein-sehr-langes-passwort-mind-12-zeichen"
   ```
   (E-Mail und Passwort anpassen.) Die Ausgabe sollte `Admin-Account angelegt: admin@dein-verein.de` zeigen.

2. Im Browser auf http://localhost öffnen → „Anmelden" → mit den Daten einloggen.

3. **Optional — Master-Admin-Schutz:** Willst du, dass dein eigener Account niemals von einem anderen Admin geändert oder gelöscht werden kann (auch nicht versehentlich)? Dann direkt danach:
   ```powershell
   docker compose --env-file .env -f deploy/docker-compose.yml exec db `
     psql -U coach -d coach_assistant `
     -c "UPDATE users SET is_protected=true WHERE email='admin@dein-verein.de';"
   ```
   Das lässt sich absichtlich **nur** direkt in der Datenbank setzen, nicht über die Oberfläche — so kann kein anderer Admin diesen Schutz aufheben.

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

> ⚠️ **Falls dein Domain-Anbieter die Nameserver-Änderung blockiert** (z. B. Meldung „Hosting ist an ein Paket gebunden, manche Änderungen sind eingeschränkt"): Das kommt bei manchen Billig-Registraren vor, wenn die Domain an ein Hosting-/Parking-Produkt gebunden ist. Entweder beim Support um Freischaltung bitten, oder — deutlich einfacher — **eine neue, kleine Domain direkt bei Cloudflare selbst kaufen** (im Dashboard unter „Domain Registration", ~10 €/Jahr). Die ist dann von Anfang an frei verwaltbar, ganz ohne Nameserver-Umzug.

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

#### A.3 Token eintragen

Der `cloudflared`-Dienst ist bereits fertig in `deploy/docker-compose.yml` eingerichtet — du musst dort nichts bearbeiten. Nur den Token brauchst du noch in deiner `.env`:

```powershell
notepad .env
```

Zeile suchen und den kopierten Token einfügen:
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
2. Subdomain: `coach` (oder leer lassen, wenn die App direkt unter der nackten Domain laufen soll)
3. Domain: `dein-verein.de`
4. Service-Type: **HTTPS**
5. URL: `caddy:443`
6. Unter **Additional application settings → TLS**:
   - **No TLS Verify** aktivieren (weil Caddy intern selbst-signiert ist)
   - **Origin Server Name** auf **exakt deine Domain** setzen (z. B. `coach.dein-verein.de`) — **dieser Schritt ist Pflicht, nicht optional!** Ohne ihn schickt der Tunnel beim TLS-Handshake den Servernamen `caddy` statt deiner Domain, Caddy findet dann kein passendes Zertifikat und du bekommst „502 Bad Gateway" bzw. im Log `remote error: tls: internal error`.
7. **Save**.

> 💡 In `deploy/Caddyfile` ist bereits `tls internal` fest hinterlegt (Caddy nutzt also immer sein eigenes, selbstsigniertes Zertifikat für die interne Verbindung zum Tunnel) — daran musst du nichts ändern, das ist schon vorbereitet.

#### A.5 Fertig!

Browser öffnen: `https://coach.dein-verein.de` – die App ist jetzt **weltweit** erreichbar mit echtem HTTPS-Zertifikat. Diesen Link kannst du an Trainer und Schüler weitergeben.

---

### Variante B: Ohne Domain (Quick Tunnel)

Komplett kostenlos, nur ein Befehl. Die Adresse ist hässlich (`https://abc-def-ghi.trycloudflare.com`), aber funktioniert.

#### B.1 Quick Tunnel starten

Der in `docker-compose.yml` enthaltene `cloudflared`-Dienst ist für den dauerhaften Tunnel mit Token gedacht (Variante A). Für den kostenlosen Quick Tunnel ohne eigene Domain reicht ein einzelner, separater Docker-Befehl daneben — die App selbst (`caddy`, `api`, `web`, …) muss dafür bereits laufen (Schritt 5):

```powershell
docker run -d --name quick-tunnel --network coach-assistant_internal cloudflare/cloudflared:latest tunnel --no-autoupdate --url https://caddy:443 --no-tls-verify --http-host-header=localhost
```

> 💡 Der `--http-host-header=localhost`-Teil ist wichtig: Ohne ihn leitet Cloudflare die von außen sichtbare (zufällige) Adresse als Host-Header weiter, Caddy kennt aber nur `localhost` als gültigen Namen und lehnt die Anfrage sonst mit „502 Bad Gateway" ab.

#### B.2 Adresse herausfinden

```powershell
docker logs quick-tunnel
```

In der Ausgabe siehst du eine Zeile wie:
```
Your quick Tunnel has been created! Visit it at:
https://stupid-fox-loud-mountain.trycloudflare.com
```

Diese Adresse ist deine App-URL. Browser öffnen → fertig. Alle, die den Link haben, können die App nutzen.

> ⚠️ **Wichtig:** Bei jedem Neustart des `quick-tunnel`-Containers bekommst du eine **neue zufällige Adresse**. Für Dauerbetrieb deshalb besser Variante A. Aber: Solange du den Container nicht stoppst (oder neu startest), bleibt die Adresse stabil.
>
> Zum Beenden: `docker rm -f quick-tunnel` (läuft außerhalb von Docker Compose, wird also nicht automatisch mit `docker compose down` gestoppt).

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

Die Backups werden **vor** dem Ablegen im Cloud-Ordner mit AES-256 verschlüsselt (Passwort aus
`.env`, siehe unten) — dadurch sieht auch der Cloud-Anbieter (z. B. OneDrive) nur eine unlesbare
`.sql.enc`-Datei, keine Klartext-Personendaten.

Tägliches Backup einrichten:

1. Verschlüsselungspasswort in `.env` erzeugen (falls noch nicht geschehen, siehe [Schritt 4](#4-konfiguration-anpassen-env)):
   ```powershell
   [Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Max 256 }))
   ```
   In `.env` als `BACKUP_ENCRYPTION_PASSWORD=...` eintragen und **sicher aufbewahren** (z. B.
   Passwort-Manager) — ohne dieses Passwort sind die Backups im Ernstfall nicht wiederherstellbar.
2. Backup-Ordner anlegen, z. B. `C:\Backups\coach`. Idealerweise ein Cloud-synchronisierter Ordner (OneDrive, Dropbox).
3. Datei `C:\Backups\coach\backup.ps1` erstellen mit Inhalt:
   ```powershell
   $ErrorActionPreference = "Stop"

   $repo = "C:\Git_Repos\coach_assistant"
   $backupDir = "C:\Backups\coach"
   $date = Get-Date -Format 'yyyy-MM-dd'
   $plainFile = Join-Path $backupDir "coach-$date.sql"
   $encFile = "$plainFile.enc"

   $pwLine = Get-Content "$repo\.env" | Where-Object { $_ -match '^BACKUP_ENCRYPTION_PASSWORD=' }
   if (-not $pwLine) { throw "BACKUP_ENCRYPTION_PASSWORD fehlt in .env" }
   $password = $pwLine -replace '^BACKUP_ENCRYPTION_PASSWORD=', ''
   if ([string]::IsNullOrWhiteSpace($password)) { throw "BACKUP_ENCRYPTION_PASSWORD ist leer" }

   docker compose --env-file "$repo\.env" -f "$repo\deploy\docker-compose.yml" `
     exec -T db pg_dump -U coach coach_assistant > $plainFile

   # --- AES-256 verschlüsseln (Salt + IV werden vorangestellt) ---
   $salt = New-Object byte[] 16
   [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($salt)
   $iv = New-Object byte[] 16
   [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($iv)

   $deriveBytes = New-Object System.Security.Cryptography.Rfc2898DeriveBytes($password, $salt, 100000, [System.Security.Cryptography.HashAlgorithmName]::SHA256)
   $key = $deriveBytes.GetBytes(32)

   $aes = [System.Security.Cryptography.Aes]::Create()
   $aes.Key = $key
   $aes.IV = $iv
   $aes.Mode = [System.Security.Cryptography.CipherMode]::CBC

   $plainBytes = [System.IO.File]::ReadAllBytes($plainFile)
   $encryptor = $aes.CreateEncryptor()
   $cipherBytes = $encryptor.TransformFinalBlock($plainBytes, 0, $plainBytes.Length)

   $outStream = [System.IO.File]::Create($encFile)
   $outStream.Write($salt, 0, $salt.Length)
   $outStream.Write($iv, 0, $iv.Length)
   $outStream.Write($cipherBytes, 0, $cipherBytes.Length)
   $outStream.Close()
   $aes.Dispose()

   # Klartext-Datei löschen — nur die verschlüsselte Version bleibt und synct in die Cloud
   Remove-Item $plainFile -Force

   # alte Backups (>30 Tage) löschen
   Get-ChildItem "$backupDir\coach-*.sql.enc" |
     Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
     Remove-Item
   ```
4. Im Windows-Aufgabenplaner einen täglichen Job anlegen:
   - **Aufgabenplaner öffnen** → „Aufgabe erstellen"
   - Name: `Coach Assistant Backup`
   - Trigger: Täglich, z. B. 03:00 Uhr
   - Aktion: `powershell.exe -File C:\Backups\coach\backup.ps1`

### Wiederherstellung

Im Notfall zuerst entschlüsseln, dann einspielen:
```powershell
.\deploy\restore-decrypt.ps1 -EncFile "C:\Backups\coach\coach-YYYY-MM-DD.sql.enc" -OutFile ".\restore.sql"
Get-Content .\restore.sql | `
  docker compose --env-file .env -f deploy/docker-compose.yml exec -T db psql -U coach coach_assistant
```
`restore-decrypt.ps1` liest das Passwort automatisch aus `BACKUP_ENCRYPTION_PASSWORD` in `.env`.

---

## 11. Umzug auf einen neuen Rechner / in die Cloud

Der Laptop, auf dem du ursprünglich installiert hast, muss nicht für immer der Host bleiben. Weil alles in Docker läuft, ist ein Umzug — z. B. auf einen Mini-PC zuhause oder einen Cloud-Server — unkompliziert und **ohne Datenverlust** möglich. Es gibt nur drei Dinge, die mitgenommen werden müssen: die `.env`-Datei, ein Datenbank-Dump und (falls genutzt) der Cloudflare-Tunnel-Token.

> 💡 **Der Cloudflare Tunnel muss dabei nicht neu eingerichtet werden.** Der Token ist nicht an eine bestimmte Maschine gebunden — sobald `cloudflared` mit demselben Token auf dem neuen Rechner läuft, verbindet sich der bestehende Tunnel einfach von dort aus neu. Im Cloudflare-Dashboard ist nichts zu tun.

### 11.1 Auf der alten Maschine

1. Frisches Backup erstellen (siehe [Schritt 10](#10-datensicherung-backup), z. B. `.\backup.ps1`
   einmal manuell ausführen) oder die neueste `coach-YYYY-MM-DD.sql.enc`-Datei aus dem Backup-Ordner
   nehmen. Sie ist bereits AES-256-verschlüsselt und kann daher gefahrlos z. B. per USB-Stick oder
   Cloud-Speicher transportiert werden.
2. Die Datei `.env` aus dem Repo-Hauptordner sichern (z. B. auf einen USB-Stick oder verschlüsselt per Cloud-Speicher übertragen — sie enthält alle Passwörter/Secrets **und** das Backup-Verschlüsselungspasswort, also **nicht** unverschlüsselt per E-Mail verschicken).
3. Die `.sql.enc`-Datei ebenfalls mitnehmen.

### 11.2 Auf der neuen Maschine

1. [Schritt 2](#2-docker-installieren) (Docker installieren) und [Schritt 3](#3-coach-assistant-herunterladen) (Repo klonen) durchführen.
2. Die gesicherte `.env`-Datei unverändert in den neuen Repo-Ordner kopieren (Schritt 4 entfällt dadurch — nichts neu generieren, sonst passen z. B. Datenbank-Passwort und `API_SECRET_KEY` nicht mehr zu den alten Daten).
3. **Nur die Datenbank starten** (wichtig — noch nicht die ganze App, sonst legt die API beim Start ein leeres Datenbank-Schema an und der Restore schlägt fehl):
   ```powershell
   docker compose --env-file .env -f deploy/docker-compose.yml up -d db
   ```
   Kurz warten, bis `docker compose --env-file .env -f deploy/docker-compose.yml ps` bei `db` „healthy" zeigt.
4. Backup entschlüsseln und einspielen:
   ```powershell
   .\deploy\restore-decrypt.ps1 -EncFile coach-YYYY-MM-DD.sql.enc -OutFile .\umzug.sql
   Get-Content umzug.sql | docker compose --env-file .env -f deploy/docker-compose.yml exec -T db psql -U coach coach_assistant
   ```
5. Jetzt den kompletten Stack starten:
   ```powershell
   docker compose --env-file .env -f deploy/docker-compose.yml up -d --build
   ```
   Alle Trainingspläne, Spieler, Trainer und Benutzerkonten sind jetzt da — Schritt 6 (Admin anlegen) entfällt, der Admin-Account ist ja schon im Backup enthalten.
6. Falls du einen dauerhaften Cloudflare Tunnel nutzt: `CLOUDFLARE_TUNNEL_TOKEN` steht bereits korrekt in der kopierten `.env` — nichts weiter zu tun, der Tunnel verbindet sich automatisch von der neuen Maschine aus.

### 11.3 Alte Maschine abschalten

**Wichtig:** Sobald die neue Maschine läuft, die App auf der alten Maschine stoppen (`docker compose --env-file .env -f deploy/docker-compose.yml down`) — sonst laufen kurzzeitig zwei Instanzen mit demselben Tunnel-Token gegen zwei unterschiedliche Datenbanken, und spätere Änderungen könnten je nachdem, welche Maschine gerade antwortet, in der falschen Datenbank landen.

> 💡 Die TLS-Zertifikate (Caddy-interne CA) müssen **nicht** mitgenommen werden — Caddy erzeugt sich auf der neuen Maschine beim ersten Start automatisch neue.

---

## 12. Wenn etwas nicht funktioniert

| Symptom | Was tun? |
|---|---|
| `https://localhost` lädt nicht | `docker compose -f deploy/docker-compose.yml ps` — alles `healthy`? Sonst Logs ansehen: `docker compose ... logs api` |
| `https://coach.dein-verein.de` zeigt „502 Bad Gateway" | Meist fehlt der **Origin Server Name** (siehe [A.4](#a4-domain-mit-der-app-verbinden)) — in den `cloudflared`-Logs steht dann `remote error: tls: internal error`. Im Tunnel unter Public Hostname → Additional application settings → TLS → Origin Server Name exakt auf deine Domain setzen. |
| `https://coach.dein-verein.de` zeigt Cloudflare-Fehler **1033** | Tunnel-Container läuft nicht oder hat sich neu verbunden (z. B. nach Neustart bei Variante B eine **neue** URL). Logs prüfen: `docker compose ... logs cloudflared`, dort die aktuelle URL ablesen. |
| `https://coach.dein-verein.de` zeigt sonstige Cloudflare-Fehlerseite | Tunnel-Status in Cloudflare prüfen (Zero Trust → Networks → Tunnels). Container neu starten: `docker compose ... restart cloudflared` |
| Nameserver-Wechsel bei Cloudflare geht nicht / Anbieter blockiert | Siehe Hinweis in [A.1](#a1-domain-bei-cloudflare-einrichten) — oft hilft eine bei Cloudflare selbst gekaufte Domain |
| Chat-Assistent antwortet nicht | API-Logs prüfen: `docker compose ... logs api` |
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
| `cloudflared` | Sicherer Tunnel zu Cloudflare |

Alle Container laufen isoliert; keiner hat Zugriff auf den Rest deines Computers außer auf die definierten Ordner. Datenbank und KI sind **nicht** öffentlich erreichbar — nur über die App.

---

## Lizenz und Datenschutz

Der Coach Assistant ist Open Source unter der **AGPL-3.0**-Lizenz. Du darfst ihn frei nutzen, anpassen und teilen.

Da der Server bei dir steht und der Chat-Assistent regelbasiert lokal läuft, **verlassen keine personenbezogenen Daten deinen Server** (außer dem verschlüsselten HTTPS-Verkehr durch Cloudflare). Siehe `docs/PRIVACY.md` für Details.

Wenn du den Coach Assistant für andere Personen betreibst, bist du **Verantwortlicher** im Sinne der DSGVO und musst eine Datenschutzerklärung anbieten.
