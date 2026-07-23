<#
  AURORA ICU — native provisioning engine (installer Option B,
  HOSPITAL_INSTALLER_RUNTIME_DESIGN.md). Docker-free. Invoked by the Inno
  Setup installer (aurora.iss) AFTER the files are laid down; can also be run
  by hand to re-provision or debug.

  It performs every system change the "double-click install" needs:
    1. initialise a PRIVATE PostgreSQL cluster (no separate Postgres install)
    2. register + start the AuroraPostgres Windows service (Automatic)
    3. create the aurora role + database
    4. write the ACL-locked machine config (server\aurora.env — the PR-A
       AuroraEnvFile loader reads it; the real env is not used by a service)
    5. register + start the AuroraServer Windows service — Automatic (starts
       at boot BEFORE any login), depends-on AuroraPostgres, SCM Recovery =
       restart on crash. On first boot the server migrates + seeds
       (catalogues + configuration + ONE bootstrap admin; zero patients).
    6. the backup-key ceremony (init-key) — the key is written to -KeyOutFile
       for the installer to DISPLAY ONCE, then that file is deleted.
    7. register the nightly backup (native — aurora-backup.ps1, NOT the Docker
       backup.ps1)
    8. open the Windows Firewall for the chosen port

  DESIGN NOTES
  - The whole point of Option B: everything is a Windows SERVICE (Automatic +
    SCM Recovery), so it starts on boot before login and restarts on crash —
    no Docker, no logged-in user. This script only REGISTERS/STARTS them;
    auto-start-on-boot and restart-on-crash are the services' own SCM config,
    also set here (start=auto, sc failure).
  - Absolute paths everywhere: a Windows service's working directory is
    System32, so aurora.env carries absolute DATABASE_URL/BACKUP_DIR/etc.
  - Idempotent where practical: existing services are updated, an existing
    cluster is not re-initialised.

  🔎 WINDOWS-ONLY — CODE-REVIEWED, NOT executed in CI (the Linux sandbox
  cannot run Windows services / SCM / initdb-for-Windows). Verify on the
  hospital-class Windows machine per installer/README.md.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$InstallDir,     # e.g. C:\Aurora  (server\, pgsql\, model\)
  [Parameter(Mandatory)][string]$DataDir,        # e.g. C:\Aurora\data (pg\, backups\, secrets\)
  [Parameter(Mandatory)][int]$Port,              # the LAN port clinicians open (e.g. 8080)
  [Parameter(Mandatory)][string]$AccessUrl,      # CORS_ORIGINS — http://<lan-ip>:<port> (not localhost)
  [ValidateSet('starter','empty')][string]$FormularySeed = 'starter',
  [string]$TimeZone = '',                         # IANA id; '' = server displays UTC (operator can edit)
  [Parameter(Mandatory)][string]$AdminPasswordFile, # temp file holding the bootstrap admin password
  [Parameter(Mandatory)][string]$KeyOutFile,     # where to write the show-once backup key for the wizard
  [switch]$AiEnabled,                             # GPU present → register the native AuroraAI (llama-server) service
  # ---- AI concurrency knobs (HOSPITAL_INSTALLER_RUNTIME_DESIGN.md §5). The
  #      defaults match the RTX 4060 + Qwen2.5-7B analysis; the owner's
  #      llama-bench run (§5.6) validates them on the real card and can retune
  #      by re-running this script (or editing the AuroraAI service). ----
  [int]$AiPort     = 8081,        # llama-server port — 127.0.0.1 ONLY, never on the LAN
  [int]$AiParallel = 4,           # --parallel: concurrent AI slots (§5.4 guardrail 1; the ~4 ceiling on a 4060)
  [int]$AiCtxSize  = 16384,       # --ctx-size TOTAL; per slot = ctx/parallel (16384/4 = 4096 per slot, §5.3)
  [string]$AiModel = 'qwen2.5-7b-instruct-q4_k_m'  # AI_MODEL the server sends (Qwen2.5-7B — GQA, §5.5)
)
$ErrorActionPreference = 'Stop'
function Say([string]$m) { Write-Host "[aurora-provision] $m" }
function Fail([string]$m) { Write-Error "[aurora-provision] $m"; exit 1 }
. (Join-Path $PSScriptRoot 'aurora-ai-service.ps1')   # shared AI helpers (Register-AuroraAI, Find-AiModelGguf, …)

$server   = Join-Path $InstallDir 'server'
$pgbin    = Join-Path $InstallDir 'pgsql\bin'
$pgdata   = Join-Path $DataDir 'pg'
$backups  = Join-Path $DataDir 'backups'
$secrets  = Join-Path $DataDir 'secrets'
$envFile  = Join-Path $server 'aurora.env'          # AuroraEnvFile default path = beside the exe
$exe      = Join-Path $server 'AuroraIcu.Api.exe'
$pgPort   = 5432                                     # local-only; never exposed on the LAN

foreach ($p in @($DataDir,$pgdata,$backups,$secrets)) { New-Item -ItemType Directory -Force -Path $p | Out-Null }
foreach ($f in @($exe, (Join-Path $pgbin 'initdb.exe'), (Join-Path $pgbin 'pg_ctl.exe'), (Join-Path $pgbin 'psql.exe'))) {
  if (-not (Test-Path $f)) { Fail "missing bundled file: $f (the installer lays these down before provisioning)" }
}

# ---- crypto helpers: random secrets (never hardcoded, never logged) ----
function New-Secret([int]$bytes) {
  $b = New-Object byte[] $bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  -join ($b | ForEach-Object { $_.ToString('x2') })
}
$jwt   = New-Secret 48
$pgpw  = New-Secret 24     # the aurora DB role's password (local scram)

# ---- 1. initialise the private PostgreSQL cluster (once) ----
if (-not (Test-Path (Join-Path $pgdata 'PG_VERSION'))) {
  Say "initialising the private PostgreSQL cluster at $pgdata"
  $pwFile = Join-Path $env:TEMP ("aurora-pg-super-" + [Guid]::NewGuid().ToString('N') + '.txt')
  Set-Content -Encoding ascii -Path $pwFile -Value (New-Secret 24)   # postgres superuser pw (local only)
  try {
    & (Join-Path $pgbin 'initdb.exe') -D $pgdata -U postgres -A scram-sha-256 --pwfile=$pwFile -E UTF8 --locale=C | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "initdb failed ($LASTEXITCODE)" }
  } finally { Remove-Item -Force $pwFile -ErrorAction SilentlyContinue }
  # local-only + the chosen port; only the API is exposed on the LAN
  Add-Content -Path (Join-Path $pgdata 'postgresql.conf') -Value "`nlisten_addresses = '127.0.0.1'`nport = $pgPort`n"
  Set-Content  -Path (Join-Path $pgdata 'pg_hba.conf') -Encoding ascii -Value @(
    '# Aurora appliance — local connections only',
    'local   all   all                  scram-sha-256',
    'host    all   all   127.0.0.1/32   scram-sha-256',
    'host    all   all   ::1/128        scram-sha-256')
} else { Say "PostgreSQL cluster already present at $pgdata (leaving it in place)" }

# ---- 2. register + start the AuroraPostgres service (Automatic) ----
Say "registering the AuroraPostgres Windows service (Automatic start)"
& (Join-Path $pgbin 'pg_ctl.exe') register -N 'AuroraPostgres' -D $pgdata -S auto -w | Out-Null
# SCM recovery: restart on crash (5s / 10s / 30s), reset the failure count after 5 min
& sc.exe config AuroraPostgres start= auto | Out-Null
& sc.exe failure AuroraPostgres reset= 300 actions= restart/5000/restart/10000/restart/30000 | Out-Null
& sc.exe start AuroraPostgres 2>$null | Out-Null
Say "waiting for PostgreSQL to accept connections"
for ($i = 0; $i -lt 60; $i++) {
  & (Join-Path $pgbin 'pg_isready.exe') -h 127.0.0.1 -p $pgPort -U postgres *> $null
  if ($LASTEXITCODE -eq 0) { break }
  Start-Sleep 2
}
if ($LASTEXITCODE -ne 0) { Fail "PostgreSQL did not become ready" }

# ---- 3. create the aurora role + database ----
Say "creating the aurora role + database"
$env:PGHOST = '127.0.0.1'; $env:PGPORT = "$pgPort"; $env:PGUSER = 'postgres'
# superuser trust is not enabled; use the postgres pw only for setup — but we
# reset it above per-init. For an existing cluster we rely on the role already
# existing; a first install creates it here. Use a here-string via psql -f.
$setup = Join-Path $env:TEMP ("aurora-setup-" + [Guid]::NewGuid().ToString('N') + '.sql')
Set-Content -Encoding ascii -Path $setup -Value @"
DO `$`$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='aurora') THEN
    CREATE ROLE aurora LOGIN PASSWORD '$pgpw';
  ELSE
    ALTER ROLE aurora PASSWORD '$pgpw';
  END IF;
END `$`$;
SELECT 'ensure-db' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname='aurora');
"@
# createdb is separate (CREATE DATABASE cannot run inside a DO block)
try {
  & (Join-Path $pgbin 'psql.exe') -v ON_ERROR_STOP=1 -d postgres -f $setup | Out-Null
  $exists = & (Join-Path $pgbin 'psql.exe') -tAc "SELECT 1 FROM pg_database WHERE datname='aurora'" -d postgres
  if (-not $exists) { & (Join-Path $pgbin 'createdb.exe') -O aurora aurora | Out-Null }
} finally { Remove-Item -Force $setup -ErrorAction SilentlyContinue }

# ---- 4. write the ACL-locked machine config (server\aurora.env) ----
Say "writing the machine config $envFile (ACL-locked)"
$adminPw = (Get-Content -Raw $AdminPasswordFile).TrimEnd("`r","`n")
$lines = @(
  '# Aurora ICU machine config (written by the installer). ACL-locked.',
  '# The server (a Windows service, no compose) reads this via AuroraEnvFile.',
  'APP_ENV=production',
  "PORT=$Port",
  "CORS_ORIGINS=$AccessUrl",
  "DATABASE_URL=postgresql://aurora:$pgpw@127.0.0.1:$pgPort/aurora",
  "JWT_SECRET=$jwt",
  "FORMULARY_SEED=$FormularySeed",
  "ADMIN_BOOTSTRAP_PASSWORD=$adminPw",   # remove this line after the admin changes it at first login
  "BACKUP_DIR=$backups",
  "BACKUP_KEY_FILE=$(Join-Path $secrets 'backup.key')",
  'BACKUP_SCHEDULE=daily 02:00'
)
if ($TimeZone) { $lines += "TZ=$TimeZone" }

# ---- AI wiring (§5). The native AI is the AuroraAI Windows service
#      (llama-server, registered in step 5b) — ENABLED only when the machine
#      has a GPU AND the AI payload (llama-server.exe + nssm.exe + a .gguf
#      model) actually shipped in this build. The HIS never depends on it:
#      any absence → AI_PROVIDER=none + an HONEST reason the AI screen shows,
#      never a fault (§2.3 "warn and disable, never refuse"). ----
$aiLlamaExe = Join-Path $InstallDir 'llama\llama-server.exe'
$aiNssmExe  = Join-Path $InstallDir 'llama\nssm.exe'
$aiModelGguf = Find-AiModelGguf (Join-Path $InstallDir 'model')   # shared helper (first split part, else the single file)
$aiReady = $AiEnabled -and (Test-Path $aiLlamaExe) -and (Test-Path $aiNssmExe) -and $aiModelGguf
if ($aiReady) {
  $lines += 'AI_PROVIDER=openai'
  $lines += "AI_ENDPOINT=http://127.0.0.1:$AiPort/v1"   # local only — never on the LAN
  $lines += "AI_MODEL=$AiModel"
  $lines += 'AI_TIMEOUT_SECONDS=120'
} elseif ($AiEnabled) {
  $lines += 'AI_PROVIDER=none'
  $lines += 'AI_UNAVAILABLE_REASON=the AI runtime was not included in this build'
} else {
  # Worded so ADDING a GPU later never falsifies it (speaks to setup, not "now"),
  # and points at the fix. aurora-enable-ai removes this line when it turns AI on.
  $lines += 'AI_PROVIDER=none'
  $lines += 'AI_UNAVAILABLE_REASON=AI is turned off on this install — no GPU was detected at setup. Add an NVIDIA GPU and run aurora-enable-ai to turn it on.'
}
Set-Content -Encoding ascii -Path $envFile -Value $lines
# lock it to SYSTEM + Administrators only (contains the bootstrap + DB + JWT secrets)
& icacls.exe $envFile /inheritance:r /grant:r 'SYSTEM:F' 'Administrators:F' | Out-Null

# ---- 5. register + start the AuroraServer service (Automatic, depends-on Postgres, recovery) ----
Say "registering the AuroraServer Windows service (Automatic, depends-on AuroraPostgres)"
# sc.exe create requires a space after each '='; binPath is the self-contained exe
& sc.exe create AuroraServer binPath= "`"$exe`"" start= auto depend= AuroraPostgres DisplayName= "Aurora ICU" 2>$null | Out-Null
& sc.exe config AuroraServer start= auto depend= AuroraPostgres | Out-Null      # idempotent if it existed
& sc.exe failure AuroraServer reset= 300 actions= restart/5000/restart/10000/restart/30000 | Out-Null
& sc.exe description AuroraServer "Aurora ICU — the hospital ICU system (API + web app). Starts automatically at boot." | Out-Null
& sc.exe start AuroraServer 2>$null | Out-Null
Say "waiting for AuroraServer to become healthy (migrations + production seed run on first boot)"
$healthy = $false
for ($i = 0; $i -lt 90; $i++) {
  try { Invoke-RestMethod "http://127.0.0.1:$Port/healthz" -TimeoutSec 2 | Out-Null; $healthy = $true; break } catch {}
  Start-Sleep 2
}
if (-not $healthy) { Fail "AuroraServer did not become healthy — check the Windows Event Log (source AuroraServer)" }

# ---- 5b. register + start the native AI service (AuroraAI = llama-server) ----
# The GPU-native path (§5). llama-server is a console exe, so it runs under
# NSSM (a thin, battle-tested service host): Automatic start (BEFORE login) +
# restart-on-crash, exactly like AuroraServer/AuroraPostgres. Bound to
# 127.0.0.1 — ONLY AuroraServer (same box) calls it; it is NEVER on the LAN and
# the firewall never opens $AiPort. AuroraServer does NOT depend on it: the HIS
# runs with or without the AI, and the AI screen stays honest until it is ready.
# The --parallel / --ctx-size guardrails (§5.4) are set here and are tunable
# (re-run this script) once llama-bench measures the real card (§5.6).
if ($aiReady) {
  Say "registering the AuroraAI service (llama-server, --parallel $AiParallel, 127.0.0.1:$AiPort)"
  Register-AuroraAI -NssmExe $aiNssmExe -LlamaExe $aiLlamaExe -ModelGguf $aiModelGguf.FullName `
    -Port $AiPort -Parallel $AiParallel -CtxSize $AiCtxSize -LogFile (Join-Path $DataDir 'ai.log')
  # the model loads in tens of seconds — do NOT block the install on it; the AI
  # screen is honest (server 503/502) until llama-server answers /health
  Say "AuroraAI starting — the model loads in the background; Aurora is already usable."
} elseif ($AiEnabled) {
  Say "GPU present but the AI runtime was not bundled in this build — AI stays disabled; the HIS is unaffected."
}

# ---- 6. backup-key ceremony (init-key) — write the key ONCE for the wizard to show ----
Say "generating the backup encryption key (shown once by the installer)"
# init-key writes the ACL-locked server copy AND prints the key; we capture the
# printed key for the installer's show-once page, then this relay file is deleted.
$out = & $exe init-key --actor installer 2>&1
$keyLine = ($out | Select-String -Pattern '^\s*key\s*:\s*(.+)$').Matches.Groups[1].Value.Trim()
$idLine  = ($out | Select-String -Pattern '^\s*key id\s*:\s*(.+)$').Matches.Groups[1].Value.Trim()
if ($keyLine) {
  Set-Content -Encoding ascii -Path $KeyOutFile -Value "$idLine`n$keyLine"
  & icacls.exe $KeyOutFile /inheritance:r /grant:r 'SYSTEM:F' 'Administrators:F' | Out-Null
} else { Say "NOTE: init-key produced no key (already initialised?) — no show-once page." }

# ---- 7. register the nightly backup (native — NOT the Docker backup.ps1) ----
Say "registering the automatic nightly backup (Task Scheduler 'AuroraBackup', 02:00)"
$backupScript = Join-Path $server 'scripts\aurora-backup.ps1'
$action  = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$backupScript`"" -WorkingDirectory $server
$trigger = New-ScheduledTaskTrigger -Daily -At '02:00'
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings  = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd `
  -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 10)
Register-ScheduledTask -TaskName 'AuroraBackup' -Action $action -Trigger $trigger `
  -Principal $principal -Settings $settings -Force | Out-Null

# ---- 8. open the Windows Firewall for the API port ----
Say "opening the Windows Firewall for TCP $Port"
if (-not (Get-NetFirewallRule -DisplayName 'Aurora ICU' -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName 'Aurora ICU' -Direction Inbound -Action Allow `
    -Protocol TCP -LocalPort $Port -Profile Domain,Private | Out-Null
}

Say "PROVISIONING COMPLETE — Aurora is running as a Windows service and will start on every boot."
Say "Access URL: $AccessUrl"
exit 0
