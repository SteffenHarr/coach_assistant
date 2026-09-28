# Coach Assistant - taegliches DB-Backup
#
# Erstellt einen pg_dump (custom format) des laufenden db-Containers und legt
# ihn unter <repo>\backups\ ab. Backups aelter als $RetentionDays werden
# danach automatisch geloescht.
#
# Wird per Windows-Aufgabenplanung taeglich ausgefuehrt (Task
# "CoachAssistant-DailyBackup"). Laeuft unabhaengig davon, ob Docker
# Desktop gerade laeuft - schlaegt dann nur fehl und schreibt das ins Log,
# statt den ganzen Task abzubrechen.
#
# Nur ASCII-Zeichen in diesem Skript (bewusst, wegen Encoding-Problemen mit
# Windows PowerShell 5.1 und nicht-ASCII-Zeichen ohne BOM).

param(
    [int]$RetentionDays = 14
)

$ErrorActionPreference = "Stop"
$RepoRoot   = Split-Path -Parent $PSScriptRoot
$BackupDir  = Join-Path $RepoRoot "backups"
$LogFile    = Join-Path $BackupDir "backup.log"
$ComposeFile = Join-Path $RepoRoot "deploy\docker-compose.yml"
$EnvFile    = Join-Path $RepoRoot ".env"
$Timestamp  = Get-Date -Format "yyyyMMdd_HHmmss"
$OutFile    = Join-Path $BackupDir "coach_assistant_$Timestamp.dump"

if (-not (Test-Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir | Out-Null
}

function Write-Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg"
    Add-Content -Path $LogFile -Value $line -Encoding utf8
}

try {
    # POSTGRES_USER / POSTGRES_DB aus .env lesen (gleiche Werte, die der
    # db-Container selbst beim Start bekommt).
    $envContent = Get-Content $EnvFile
    $pgUser = ($envContent | Where-Object { $_ -match '^POSTGRES_USER=' }) -replace '^POSTGRES_USER=', ''
    $pgDb   = ($envContent | Where-Object { $_ -match '^POSTGRES_DB=' })   -replace '^POSTGRES_DB=', ''
    if (-not $pgUser -or -not $pgDb) { throw "POSTGRES_USER/POSTGRES_DB nicht in .env gefunden" }

    docker compose --env-file $EnvFile -f $ComposeFile exec -T db pg_dump -U $pgUser -d $pgDb -F c -f /tmp/backup.dump
    if ($LASTEXITCODE -ne 0) { throw "pg_dump fehlgeschlagen (exit $LASTEXITCODE) - laeuft Docker Desktop?" }

    docker cp coach-assistant-db-1:/tmp/backup.dump $OutFile
    if ($LASTEXITCODE -ne 0) { throw "docker cp fehlgeschlagen (exit $LASTEXITCODE)" }

    docker compose --env-file $EnvFile -f $ComposeFile exec -T db rm /tmp/backup.dump

    $size = (Get-Item $OutFile).Length
    Write-Log "OK: $OutFile ($size bytes)"
}
catch {
    Write-Log "FEHLER: $($_.Exception.Message)"
    # Kein weiterer Abbruch noetig - der Task laeuft am naechsten Tag einfach
    # wieder. Absichtlich kein throw hier, damit die Aufgabenplanung nicht
    # dauerhaft als "fehlgeschlagen" markiert wird, wenn nur Docker gerade
    # zu war (z.B. Laptop war aus).
}

# Alte Backups aufraeumen (aelter als $RetentionDays Tage).
$cutoff = (Get-Date).AddDays(-$RetentionDays)
Get-ChildItem -Path $BackupDir -Filter "coach_assistant_*.dump" |
    Where-Object { $_.LastWriteTime -lt $cutoff } |
    ForEach-Object {
        Remove-Item $_.FullName -Force
        Write-Log "geloescht (aelter als $RetentionDays Tage): $($_.Name)"
    }
