# Entschlüsselt ein mit backup.ps1 erstelltes .sql.enc-Backup zurück in eine
# lesbare .sql-Datei, die dann per psql eingespielt werden kann (siehe
# docs/SETUP.md, Schritt 10 "Wiederherstellung").
#
# Nutzung:
#   .\deploy\restore-decrypt.ps1 -EncFile "C:\Users\steff\OneDrive\CoachAssistantBackups\coach-2026-08-24.sql.enc" -OutFile ".\restore.sql"

param(
    [Parameter(Mandatory = $true)][string]$EncFile,
    [Parameter(Mandatory = $true)][string]$OutFile
)
$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$pwLine = Get-Content "$repo\.env" | Where-Object { $_ -match '^BACKUP_ENCRYPTION_PASSWORD=' }
if (-not $pwLine) { throw "BACKUP_ENCRYPTION_PASSWORD fehlt in .env" }
$password = $pwLine -replace '^BACKUP_ENCRYPTION_PASSWORD=', ''

$allBytes = [System.IO.File]::ReadAllBytes($EncFile)
$salt = $allBytes[0..15]
$iv = $allBytes[16..31]
$cipherBytes = $allBytes[32..($allBytes.Length - 1)]

$deriveBytes = New-Object System.Security.Cryptography.Rfc2898DeriveBytes($password, $salt, 100000, [System.Security.Cryptography.HashAlgorithmName]::SHA256)
$key = $deriveBytes.GetBytes(32)

$aes = [System.Security.Cryptography.Aes]::Create()
$aes.Key = $key
$aes.IV = $iv
$aes.Mode = [System.Security.Cryptography.CipherMode]::CBC

$decryptor = $aes.CreateDecryptor()
$plainBytes = $decryptor.TransformFinalBlock($cipherBytes, 0, $cipherBytes.Length)
[System.IO.File]::WriteAllBytes($OutFile, $plainBytes)
$aes.Dispose()

Write-Host "Entschlüsselt nach: $OutFile"
