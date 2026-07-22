# AURORA appliance — DISASTER RECOVERY restore (BACKUP_DR_DESIGN.md §7).
#
# The burned-down-server path: a DIFFERENT clean machine + Docker + this
# installer + a backup file from the off-site USB + the key (from a
# recorded off-server copy) → a running Aurora with VERIFIED data. Mirrors
# run.ps1 minus the demo seed, and ends with the design's §8 acceptance
# comparison: source-vs-restored record counts + per-table content digests
# across every table, plus the hospital logo — because a restore that
# completes but loses data is a FAILED restore.
#
#   .\restore.ps1 -BackupFile D:\usb\aurora-20260722T020000Z.aurbk
#   .\restore.ps1 -BackupFile <file> -Env staging     (restoring demo/test data)
#
# The engine (decrypt / pg_restore / verify) runs inside the aurora
# container — the SAME implementation the nightly backup and the in-app
# Backup area use. The backup key is asked for interactively and passed to
# the container once; it is never written to disk here.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$BackupFile,  # the .aurbk from the USB
  [ValidateSet("production", "staging")][string]$Env = "production",
  [string]$Key   # the backup key (else prompted securely)
)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Error "Docker Desktop is required. Install it, then re-run."
}
if (-not (Test-Path $BackupFile)) { Write-Error "Backup file not found: $BackupFile" }

# --- the manifest sidecar (UNENCRYPTED — it carries the TZ and the source
#     record counts the restore verifies against; design §3/§8) ---
$base = [System.IO.Path]::GetFileNameWithoutExtension($BackupFile)   # aurora-<stamp>
$srcDir = Split-Path -Parent $BackupFile
$manifestSrc = Join-Path $srcDir "$base.manifest.json"
if (-not (Test-Path $manifestSrc)) {
  Write-Error "Manifest sidecar not found next to the backup: $manifestSrc`nThe restore verifies source-vs-restored counts against it — copy the whole backup pair from the USB (the .aurbk AND the .manifest.json)."
}
$manifest = Get-Content -Raw $manifestSrc | ConvertFrom-Json
$tz = $manifest.timeZone

Write-Host "Restoring backup : $([System.IO.Path]::GetFileName($BackupFile))"
Write-Host "  taken (UTC)    : $($manifest.createdAtUtc)"
Write-Host "  hospital TZ    : $tz  (restored so the clock stays the hospital's)"
Write-Host "  needs key id   : $($manifest.keyId)"
Write-Host "  source records : $(( $manifest.tableCounts.PSObject.Properties | Measure-Object -Property Value -Sum ).Sum) rows across $(($manifest.tableCounts.PSObject.Properties | Measure-Object).Count) tables"
Write-Host ""

# --- fresh .env: NEW secrets (everyone re-logs-in — fine, more secure;
#     design §3), the hospital TZ from the manifest, and the environment.
#     Old secrets are deliberately NOT restored — the backup carries no
#     .env. ---
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
function New-Hex([int]$bytes) { $b = New-Object byte[] $bytes; $rng.GetBytes($b); -join ($b | ForEach-Object { $_.ToString("x2") }) }
$envLines = @(
  "JWT_SECRET=$(New-Hex 48)"
  "POSTGRES_PASSWORD=$(New-Hex 24)"
  "APPLIANCE_ENV=$Env"
)
if ($tz) { $envLines += "TZ=$tz" }
if ($Env -eq "production") {
  # the production boot gates (BootGuards T2) require these even for a
  # restore; the seeder itself will NOT re-seed the restored (populated)
  # database, and no bootstrap admin is created because the backup brings
  # the real user accounts with it.
  if (-not $Key) { } # (key handled below)
  Write-Host "Production restore — the app needs the clinicians' access URL (this server's LAN address, not localhost)."
  $co = Read-Host "  Access URL (e.g. http://192.168.1.50:8080)"
  if (-not $co -or $co -match "localhost" -or $co -match "127\.0\.0\.1") {
    Write-Error "A non-local access URL is required in production (the server refuses localhost)."
  }
  $envLines += "CORS_ORIGINS=$co"
  # FORMULARY_SEED is a required production install decision, but the
  # restored database is already populated, so its value is inert here —
  # 'empty' seeds nothing on top of the restored catalogues.
  $envLines += "FORMULARY_SEED=empty"
}
Set-Content -Encoding ascii ".env" $envLines
Write-Host "Wrote a fresh appliance\.env (new secrets; everyone signs in again — the backup carries no old secrets)."

$env:AURORA_BUILD_COMMIT = (cmd /c "git -C .. rev-parse HEAD 2>nul"); if (-not $env:AURORA_BUILD_COMMIT) { $env:AURORA_BUILD_COMMIT = "dev" }

# --- stage the backup pair where the container can read it (/backups) ---
New-Item -ItemType Directory -Force -Path backups | Out-Null
Copy-Item $BackupFile (Join-Path "backups" "$base.aurbk") -Force
Copy-Item $manifestSrc (Join-Path "backups" "$base.manifest.json") -Force

# --- 1. start PostgreSQL ALONE (restore into an empty DB before Aurora
#        creates any tables) ---
Write-Host "Starting PostgreSQL…"
docker compose up -d --build postgres
if ($LASTEXITCODE -ne 0) { Write-Error "Failed to start postgres." }
Write-Host -NoNewline "waiting for PostgreSQL"
for ($i = 0; $i -lt 60; $i++) {
  docker compose exec -T postgres pg_isready -U aurora -d aurora *> $null
  if ($LASTEXITCODE -eq 0) { break }
  Write-Host -NoNewline "."; Start-Sleep 2
}
Write-Host ""

# --- 2. the key (from a recorded off-server copy) ---
if (-not $Key) {
  Write-Host "Enter the backup key for key id $($manifest.keyId) (from the sealed envelope / password manager)."
  $sec = Read-Host "  Backup key" -AsSecureString
  $Key = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
}

# --- 3. decrypt (AES-256-GCM — a wrong/corrupt key fails the auth tag
#        LOUDLY; nothing partial is ever restored) ---
Write-Host "Decrypting (AES-256-GCM authentication)…"
docker compose run --rm -T aurora dotnet AuroraIcu.Api.dll decrypt "/backups/$base.aurbk" "/backups/$base.dump" --key $Key
if ($LASTEXITCODE -ne 0) { Write-Error "Decrypt FAILED — wrong key or corrupt backup. Nothing was restored (an unauthenticated backup is never used). Check you used the key id $($manifest.keyId) copy." }

# --- 4. pg_restore into the empty database (the portable custom-format
#        dump restores on ANY fresh machine) ---
Write-Host "Restoring the database (pg_restore)…"
docker compose run --rm -T --entrypoint sh aurora -c 'pg_restore --no-owner --no-acl --exit-on-error -d "$DATABASE_URL" "/backups/'"$base"'.dump"'
if ($LASTEXITCODE -ne 0) { Write-Error "pg_restore FAILED — the database was not fully restored. Do not go live on this data." }

# --- 5. start Aurora (migrations are already satisfied by the restored
#        __EFMigrationsHistory; the app comes up on the restored data) ---
Write-Host "Starting Aurora…"
docker compose up -d --build aurora
$port = if ($env:AURORA_PORT) { $env:AURORA_PORT } else { "8080" }
Write-Host -NoNewline "waiting for AURORA"
for ($i = 0; $i -lt 60; $i++) {
  try { Invoke-RestMethod "http://localhost:$port/healthz" -TimeoutSec 2 | Out-Null; break } catch {}
  Write-Host -NoNewline "."; Start-Sleep 2
}
Write-Host ""

# --- 6. THE ACCEPTANCE COMPARISON (design §8): live DB vs the manifest —
#        source-vs-restored record counts + per-table content digests +
#        the hospital logo — recorded in the immutable audit as a restore. ---
Write-Host ""
Write-Host "Verifying the restore (source-vs-restored record counts + integrity)…"
docker compose exec -T aurora dotnet AuroraIcu.Api.dll verify-restored "/backups/$base.manifest.json" --actor "restore.ps1"
$verifyRc = $LASTEXITCODE

Write-Host ""
if ($verifyRc -eq 0) {
  Write-Host "RESTORE VERIFIED — this machine's record counts match the backup taken on the source machine." -ForegroundColor Green
  Write-Host "AURORA is up: http://localhost:$port"
  Write-Host "Everyone signs in again (new secrets). Re-register the nightly backup here: .\backup.ps1 -Install"
} else {
  Write-Host "RESTORE VERIFICATION FAILED — a restore that loses data is a FAILED restore." -ForegroundColor Red
  Write-Host "Do NOT go live on this data. Try the previous backup, and check the counts printed above."
  exit 1
}
