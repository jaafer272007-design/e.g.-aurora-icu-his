<#
  AURORA ICU - native provisioning engine (installer Option B,
  HOSPITAL_INSTALLER_RUNTIME_DESIGN.md). Docker-free. Invoked by the Inno
  Setup installer (aurora.iss) AFTER the files are laid down; can also be run
  by hand to re-provision or debug.

  It performs every system change the "double-click install" needs:
    1. initialise a PRIVATE PostgreSQL cluster (no separate Postgres install)
    2. register + start the AuroraPostgres Windows service (Automatic)
    3. create the aurora role + database
    4. write the ACL-locked machine config (server\aurora.env - the PR-A
       AuroraEnvFile loader reads it; the real env is not used by a service)
    5. register + start the AuroraServer Windows service - Automatic (starts
       at boot BEFORE any login), depends-on AuroraPostgres, SCM Recovery =
       restart on crash. On first boot the server migrates + seeds
       (catalogues + configuration + ONE bootstrap admin; zero patients).
    6. the backup-key ceremony (init-key) - the key is written to -KeyOutFile
       for the installer to DISPLAY ONCE, then that file is deleted.
    7. register the nightly backup (native - aurora-backup.ps1, NOT the Docker
       backup.ps1)
    8. open the Windows Firewall for the chosen port

  DESIGN NOTES
  - The whole point of Option B: everything is a Windows SERVICE (Automatic +
    SCM Recovery), so it starts on boot before login and restarts on crash -
    no Docker, no logged-in user. This script only REGISTERS/STARTS them;
    auto-start-on-boot and restart-on-crash are the services' own SCM config,
    also set here (start=auto, sc failure).
  - Absolute paths everywhere: a Windows service's working directory is
    System32, so aurora.env carries absolute DATABASE_URL/BACKUP_DIR/etc.
  - Idempotent where practical: existing services are updated, an existing
    cluster is not re-initialised.

  WINDOWS-ONLY - CODE-REVIEWED, NOT executed in CI (the Linux sandbox
  cannot run Windows services / SCM / initdb-for-Windows). Verify on the
  hospital-class Windows machine per installer/README.md.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$InstallDir,     # e.g. C:\Aurora  (server\, pgsql\, model\)
  [Parameter(Mandatory)][string]$DataDir,        # e.g. C:\Aurora\data (pg\, backups\, secrets\)
  # The PRIMARY backup target. Defaults to <DataDir>\backups, but SHOULD be a
  # DIFFERENT PHYSICAL DISK from the database: with both on one disk, a single
  # drive failure destroys the live data AND every backup of it at the same
  # moment. The wizard now asks for this separately and warns on a same-drive
  # choice; this parameter is what carries that decision.
  [string]$BackupDir = '',
  # The OFF-SITE copy (a removable/second disk the hospital rotates away). Empty
  # = no off-site copy, and the dashboard says so LOUDLY rather than implying
  # the on-server copy is enough.
  [string]$BackupUsb = '',
  [Parameter(Mandatory)][int]$Port,              # the LAN port clinicians open (e.g. 8080)
  [Parameter(Mandatory)][string]$AccessUrl,      # CORS_ORIGINS - http://<lan-ip>:<port> (not localhost)
  [ValidateSet('starter','empty')][string]$FormularySeed = 'starter',
  [string]$TimeZone = '',                         # IANA id; '' = server displays UTC (operator can edit)
  [Parameter(Mandatory)][string]$AdminPasswordFile, # temp file holding the bootstrap admin password
  [Parameter(Mandatory)][string]$KeyOutFile,     # where to write the show-once backup key for the wizard
  [string]$UrlOutFile = '',                       # optional: relay the REAL derived access URL back to the wizard finish page
  [switch]$AiEnabled,                             # GPU present -> register the native AuroraAI (llama-server) service
  # ---- AI concurrency knobs (HOSPITAL_INSTALLER_RUNTIME_DESIGN.md sec 5). The
  #      defaults match the RTX 4060 + Qwen2.5-7B analysis; the owner's
  #      llama-bench run (sec 5.6) validates them on the real card and can retune
  #      by re-running this script (or editing the AuroraAI service). ----
  [int]$AiPort     = 8081,        # llama-server port - 127.0.0.1 ONLY, never on the LAN
  [int]$AiParallel = 4,           # --parallel: concurrent AI slots (sec 5.4 guardrail 1; the ~4 ceiling on a 4060)
  [int]$AiCtxSize  = 16384,       # --ctx-size TOTAL; per slot = ctx/parallel (16384/4 = 4096 per slot, sec 5.3)
  [string]$AiModel = 'qwen2.5-7b-instruct-q4_k_m'  # AI_MODEL the server sends (Qwen2.5-7B - GQA, sec 5.5)
)
$ErrorActionPreference = 'Stop'
# Per-run identity for the APPEND transcript (owner's ruling, 2026-08-19):
# provision.log accumulates strata across installs/re-provisions, and on a
# real production machine we could not tell WHICH run's claims we were
# reading. Every run gets an id; the start header, the failure line and the
# completion line all carry it, so a claim in this log is always attributable
# to a dated run.
$runId = [guid]::NewGuid().ToString('N').Substring(0, 8)
function Say([string]$m) { Write-Host "[aurora-provision] $m" }
function Fail([string]$m) {
  # Write the REASON into the transcript BEFORE closing it. Stop-Transcript ends
  # the log, so anything written after it is lost - which meant every explicit
  # failure reason was missing from provision.log, the file whose entire purpose
  # is to record where provisioning stalled. A real install died at the database
  # step with a log that simply ended (2026-07-26), and the message even said
  # "see provision.log". Say it first, then close, then surface it to the caller.
  Write-Host "[aurora-provision] FAILED (run $runId at $((Get-Date).ToUniversalTime().ToString('yyyy-MM-dd HH:mm:ss')) UTC): $m"
  try { Stop-Transcript | Out-Null } catch {}
  Write-Error "[aurora-provision] $m"
  exit 1
}
. (Join-Path $PSScriptRoot 'aurora-ai-service.ps1')   # shared AI helpers (Register-AuroraAI, Find-AiModelGguf, ...)

$server   = Join-Path $InstallDir 'server'
$pgbin    = Join-Path $InstallDir 'pgsql\bin'
$pgdata   = Join-Path $DataDir 'pg'
# -BackupDir wins when given; otherwise the historical <DataDir>\backups.
$backups  = if ($BackupDir) { $BackupDir } else { Join-Path $DataDir 'backups' }
$secrets  = Join-Path $DataDir 'secrets'
$envFile  = Join-Path $server 'aurora.env'          # AuroraEnvFile default path = beside the exe
$exe      = Join-Path $server 'AuroraIcu.Api.exe'
$pgPort   = 5432                                     # local-only; never exposed on the LAN

# ---- 0. always-on diagnostics - a hidden-window hang used to leave NO trace ----
# The installer runs us with SW_HIDE by default, so before this there was no
# record of WHERE provisioning stalled. Always leave a readable log beside the
# app; Fail/exit both flush it.
try { Start-Transcript -Path (Join-Path $InstallDir 'provision.log') -Append -Force | Out-Null } catch {}
Say "===== run $runId - started $((Get-Date).ToUniversalTime().ToString('yyyy-MM-dd HH:mm:ss')) UTC ====="
Say "aurora-provision starting - InstallDir=$InstallDir DataDir=$DataDir Port=$Port AiEnabled=$AiEnabled"

# ---- 0a. RECOVERABILITY POSTURE - state it plainly in the log ----
# The single most consequential fact about this install is whether the backups
# can survive the thing that kills the database. Say it out loud at provision
# time so provision.log always carries the answer.
function Get-Vol([string]$p) { try { (Split-Path -Qualifier (Resolve-Path -LiteralPath $p -ErrorAction Stop).Path).ToUpper() } catch { try { (Split-Path -Qualifier $p).ToUpper() } catch { '' } } }
$dbVol  = Get-Vol $pgdata
$bkVol  = Get-Vol $backups
if ($dbVol -and $bkVol -and $dbVol -eq $bkVol) {
  Say "WARNING: the database ($pgdata) and the primary backups ($backups) are on the SAME DISK ($dbVol)."
  Say "         ONE disk failure destroys both at once. Put the backups on a different physical disk,"
  Say "         and configure an OFF-SITE copy (rotated removable disk) - that is the real protection."
} else {
  Say "Recoverability: database on $dbVol, primary backups on $bkVol (separate volumes - good)."
}
if ($BackupUsb) { Say "Off-site copy target: $BackupUsb (mirrored after every nightly backup)." }
else { Say "NOTE: no off-site copy configured. Backups will exist ONLY on this machine until BACKUP_USB is set." }

# The BACKUP folder is one of the two we lock down with icacls below (backups +
# secrets = the hospital's recoverability). Applying "inheritance:r, SYSTEM and
# Administrators only" to a DRIVE ROOT would re-permission that entire disk -
# on C: that means breaking the machine for every normal user. A root is never
# a legitimate backup target for that reason, so refuse it here with an
# instruction rather than silently skipping the hardening.
if ($backups -match '^[A-Za-z]:\\?$') {
  Fail "the backup location must be a FOLDER, not a whole drive ($backups). Aurora restricts the backup folder to Administrators and SYSTEM, and it must never do that to an entire disk - use a folder such as D:\AuroraBackups and run Setup again"
}
# A DRIVE ROOT is a legitimate thing for an operator to type elsewhere - 'E:\'
# is exactly how you name a USB disk - but New-Item cannot create one: Windows
# answers "The path is not of a legal form", which under EAP=Stop killed
# provisioning at its first step. (Found on a real install, 2026-07-26, with
# C:\ as the backup location.) So: create only what is missing, and if a
# MISSING path is a drive root, say plainly that the disk is not there rather
# than trying to make it.
foreach ($p in @($DataDir,$pgdata,$backups,$secrets)) {
  if ([string]::IsNullOrWhiteSpace($p)) { continue }
  if (Test-Path -LiteralPath $p) { continue }
  if ($p -match '^[A-Za-z]:\\?$') {
    Fail "the location $p is a drive that is not available on this machine - plug the disk in (or choose a folder on a drive that exists) and run Setup again"
  }
  New-Item -ItemType Directory -Force -Path $p | Out-Null
}
# Lock the two folders that hold the hospital's recoverability: the encrypted
# backups and the key. SYSTEM + Administrators only - a limited user (or malware
# running as one) can no longer read or delete them. This is NOT ransomware-proof
# (anything running as SYSTEM/Administrator still can - see the runbook), but it
# removes the easy path and stops ordinary users stumbling into them.
foreach ($p in @($backups,$secrets)) {
  try { & icacls.exe $p /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'Administrators:(OI)(CI)F' | Out-Null }
  catch { Say "NOTE: could not tighten permissions on $p ($($_.Exception.Message))." }
}
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

# ---- LAN access helpers: the URL clinicians actually reach + its DHCP status ----
# Port 80 is the HTTP default, so a URL on :80 is written WITHOUT the port (staff
# type just http://<server> - no error-prone port). Any other port is explicit.
function New-AccessUrl([string]$hostOrIp, [int]$port) {
  if ($port -eq 80) { "http://$hostOrIp" } else { "http://${hostOrIp}:$port" }
}
# Find this server's real LAN IPv4: prefer the interface carrying the default
# route (the one on the hospital network), skip loopback / APIPA (169.254.*) and
# obvious virtual adapters (Hyper-V, WSL, VirtualBox, VMware, Bluetooth, tunnels)
# so we do not advertise an address no clinician device can reach. Returns the
# primary IP + whether it is DHCP-assigned + every candidate URL.
function Get-LanAccess([int]$port) {
  $skip = 'Loopback|Pseudo|vEthernet|Hyper-V|Virtual|VMware|VirtualBox|WSL|Bluetooth|Tunnel|TAP'
  $primaryIp = $null; $isDhcp = $false; $ips = New-Object System.Collections.Generic.List[string]
  function Add-Candidate($addr) {
    if (-not $addr) { return }
    if ($addr.IPAddress -match '^(127\.|169\.254\.)') { return }
    $desc = ''
    try { $desc = (Get-NetAdapter -InterfaceIndex $addr.InterfaceIndex -ErrorAction SilentlyContinue).InterfaceDescription } catch {}
    if ($desc -and ($desc -match $skip)) { return }
    if (-not $script:__primaryIp) { $script:__primaryIp = $addr.IPAddress; $script:__isDhcp = ($addr.PrefixOrigin -eq 'Dhcp') }
    if (-not $ips.Contains($addr.IPAddress)) { $ips.Add($addr.IPAddress) }
  }
  $script:__primaryIp = $null; $script:__isDhcp = $false
  try {
    # default-route interfaces first (lowest metric = the LAN clinicians use)
    $routes = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric, ifMetric
    foreach ($r in $routes) {
      Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $r.InterfaceIndex -ErrorAction SilentlyContinue | ForEach-Object { Add-Candidate $_ }
    }
  } catch {}
  if (-not $script:__primaryIp) {
    # fallback: any preferred IPv4 that is not loopback/APIPA/virtual
    try {
      Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.AddressState -eq 'Preferred' } | ForEach-Object { Add-Candidate $_ }
    } catch {}
  }
  $primaryIp = $script:__primaryIp; $isDhcp = $script:__isDhcp
  $primaryUrl = if ($primaryIp) { New-AccessUrl $primaryIp $port } else { $null }
  $alt = @()
  foreach ($ip in $ips) { $u = New-AccessUrl $ip $port; if ($u -ne $primaryUrl) { $alt += $u } }
  [pscustomobject]@{ PrimaryIp = $primaryIp; IsDhcp = $isDhcp; PrimaryUrl = $primaryUrl; AltUrls = $alt; AllIps = $ips }
}

# ---- 0b. antivirus posture (fixes the classic "frozen at Setting up Aurora" hang) ----
# Windows Defender (block-at-first-sight / cloud verdict) can stall a freshly
# extracted initdb.exe / postgres.exe / AuroraIcu.Api.exe the FIRST time it runs.
# Inside the installer's hidden window that appears only as a frozen wizard with
# no way to close it. Excluding the Aurora install + data folders removes the
# stall AND is standard practice for a database server (live AV scanning of a
# Postgres data directory is a well-known performance problem). Best-effort:
# never fail the install if AV is locked down (Tamper Protection / 3rd-party AV).
# SCOPE: exclude the BINARIES ($InstallDir) and the live Postgres cluster
# ($pgdata) only - NOT the whole $DataDir. Excluding $DataDir also excluded
# $DataDir\backups and $DataDir\secrets, which meant antivirus stopped watching
# the very files a ransomware attack would encrypt (and the key file). The
# performance reason for exclusions is the hot Postgres data directory; backups
# are written once a night and benefit from being scanned. Narrower = safer.
try {
  Add-MpPreference -ExclusionPath $InstallDir -ErrorAction Stop
  Add-MpPreference -ExclusionPath $pgdata     -ErrorAction Stop
  Add-MpPreference -ExclusionProcess 'initdb.exe','postgres.exe','pg_ctl.exe','psql.exe','createdb.exe','pg_isready.exe','AuroraIcu.Api.exe','llama-server.exe' -ErrorAction Stop
  Say "added Windows Defender exclusions for $InstallDir and $pgdata (backups + secrets stay SCANNED on purpose)"
} catch {
  Say "NOTE: could not set Windows Defender exclusions ($($_.Exception.Message))."
  Say "      If setup stalls at the database step, add $InstallDir and $pgdata to the machine's antivirus exclusions, then re-run."
}

# ---- 1. initialise the private PostgreSQL cluster (once) ----
# $superpw is the postgres SUPERUSER password. It is set at initdb and RETAINED
# (in-memory only) so step 3 can authenticate to create the aurora role - the
# cluster's pg_hba requires scram even on 127.0.0.1, so an empty password makes
# psql prompt "Password for user postgres:" and fail. Never written to disk.
$superpw = ''
# Did THIS run create the cluster? If it did and a later step fails, the cluster
# is brand-new and empty, and its superuser password existed only in memory -
# so it can never be authenticated to again and Setup's adopt path will refuse
# it (no aurora.env). The operator has to be TOLD it is safe to delete.
$freshCluster = $false
if (-not (Test-Path (Join-Path $pgdata 'PG_VERSION'))) {
  Say "initialising the private PostgreSQL cluster at $pgdata"
  $freshCluster = $true
  $pwFile = Join-Path $env:TEMP ("aurora-pg-super-" + [Guid]::NewGuid().ToString('N') + '.txt')
  $superpw = New-Secret 24                                           # postgres superuser pw (local only, kept for step 3)
  # Byte-exact pwfile (no editor/encoding newline surprises). initdb strips a
  # trailing CRLF itself, so this is belt-and-braces, not a proven failure
  # cause - but the password the cluster stores and the one this script keeps
  # in memory MUST be the same bytes, so write exactly those bytes.
  [IO.File]::WriteAllText($pwFile, $superpw, [Text.Encoding]::ASCII)
  try {
    & (Join-Path $pgbin 'initdb.exe') -D $pgdata -U postgres -A scram-sha-256 --pwfile=$pwFile -E UTF8 --locale=C | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "initdb failed ($LASTEXITCODE)" }
  } finally { Remove-Item -Force $pwFile -ErrorAction SilentlyContinue }
  # local-only + the chosen port; only the API is exposed on the LAN. The logging
  # collector is ON so database errors land in a FILE the operator (and support)
  # can read: registered as a Windows service with no -l, Postgres otherwise
  # writes only to the Windows event log, which is where a real install's
  # authentication failure had to be dug out of (2026-07-26).
  Add-Content -Path (Join-Path $pgdata 'postgresql.conf') -Value "`nlisten_addresses = '127.0.0.1'`nport = $pgPort`nlogging_collector = on`nlog_directory = 'log'`nlog_filename = 'postgresql-%Y-%m-%d.log'`nlog_min_messages = warning`n"
  Set-Content  -Path (Join-Path $pgdata 'pg_hba.conf') -Encoding ascii -Value @(
    '# Aurora appliance - local connections only',
    'local   all   all                  scram-sha-256',
    'host    all   all   127.0.0.1/32   scram-sha-256',
    'host    all   all   ::1/128        scram-sha-256')
} else { Say "PostgreSQL cluster already present at $pgdata (leaving it in place)" }

# ---- 1c. the port must be OURS - a postmaster can outlive a deleted service ----
# Deleting a service while it is STOP_PENDING leaves its postgres.exe running
# and holding the port. Then OUR service cannot bind, pg_isready happily gets
# an answer from the WRONG cluster, and step 3 dies with "password
# authentication failed for user postgres" - which is exactly how two real
# installs failed on 2026-07-26. postmaster.pid in OUR $pgdata is the proof of
# ownership: present = the listener is our cluster; absent while the port is
# busy = a foreign/leftover postgres that must be stopped first.
$pidFile = Join-Path $pgdata 'postmaster.pid'
$portBusy = $false
try { $portBusy = [bool](Get-NetTCPConnection -LocalPort $pgPort -State Listen -ErrorAction SilentlyContinue) } catch {}
if ($portBusy -and -not (Test-Path $pidFile)) {
  $who = ''
  try {
    $owners = (Get-NetTCPConnection -LocalPort $pgPort -State Listen -ErrorAction SilentlyContinue).OwningProcess | Select-Object -Unique
    $who = ($owners | ForEach-Object { $p = Get-Process -Id $_ -ErrorAction SilentlyContinue; if ($p) { "$($p.ProcessName) (pid $_)" } }) -join ', '
  } catch {}
  Fail ("port $pgPort is already in use by another process ($who) that is NOT this install's database. " +
        "Usually a PostgreSQL left running after its service was removed. Stop it " +
        "(Get-Process postgres | Stop-Process -Force) or reboot, then run Setup again")
}

# ---- 2. register + start the AuroraPostgres service (Automatic) ----
# pg_ctl register SILENTLY NO-OPS when a service of that name already exists
# (the machine-global-service gotcha behind the reinstall guard) - so if a
# leftover AuroraPostgres points at a DIFFERENT data directory, re-register it
# at ours instead of silently starting the wrong cluster.
$svcPath = ''
try { $svcPath = (Get-CimInstance Win32_Service -Filter "Name='AuroraPostgres'" -ErrorAction SilentlyContinue).PathName } catch {}
if ($svcPath -and ($svcPath -notlike "*$pgdata*")) {
  Say "an AuroraPostgres service from another location exists - re-registering it for $pgdata"
  & sc.exe stop AuroraPostgres 2>&1 | Out-Null
  Start-Sleep 3
  & sc.exe delete AuroraPostgres 2>&1 | Out-Null
  Start-Sleep 2
}
Say "registering the AuroraPostgres Windows service (Automatic start)"
& (Join-Path $pgbin 'pg_ctl.exe') register -N 'AuroraPostgres' -D $pgdata -S auto -w | Out-Null
# SCM recovery: restart on crash (5s / 10s / 30s), reset the failure count after 5 min
& sc.exe config AuroraPostgres start= auto | Out-Null
& sc.exe failure AuroraPostgres reset= 300 actions= restart/5000/restart/10000/restart/30000 | Out-Null
& sc.exe start AuroraPostgres 2>$null | Out-Null
Say "waiting for PostgreSQL to accept connections"
# Two gates, in order. FIRST our own postmaster.pid - proof the cluster that
# answers is the one at $pgdata; pg_isready alone cannot tell ours from a
# stranger's. THEN pg_isready for accepting-connections.
$pidSeen = $false
for ($i = 0; $i -lt 60; $i++) {
  if (Test-Path $pidFile) { $pidSeen = $true; break }
  Start-Sleep 2
}
if (-not $pidSeen) {
  Fail ("the AuroraPostgres service did not start a postmaster for $pgdata (no postmaster.pid). " +
        "Check $pgdata\log and the Windows event log; if another process holds port $pgPort, stop it and run Setup again")
}
for ($i = 0; $i -lt 60; $i++) {
  & (Join-Path $pgbin 'pg_isready.exe') -h 127.0.0.1 -p $pgPort -U postgres *> $null
  if ($LASTEXITCODE -eq 0) { break }
  Start-Sleep 2
}
if ($LASTEXITCODE -ne 0) { Fail "PostgreSQL did not become ready (its postmaster is running for $pgdata - check $pgdata\log)" }

# ---- 3. create the aurora role + database (fresh cluster), or REUSE the
#         existing credentials (pre-existing cluster: a reinstall over live
#         data, deliberately allowed through the installer's reinstall guard) ----
if (-not $superpw) {
  # The cluster pre-existed, so initdb did not run and the superuser password is
  # unknown BY DESIGN (it is never written to disk). The aurora role + database
  # already live in that cluster - reuse the DATABASE_URL from the existing
  # aurora.env instead of minting a password we could not set on the role. The
  # env file survives both the file copy (the payload ships no aurora.env) and
  # an uninstall (only [Files]-installed artifacts are removed), so a reinstall
  # over existing data lands here and comes back up on its own database.
  Say "pre-existing cluster at $pgdata - reusing the aurora credentials from $envFile"
  $dbUrl = ''
  if (Test-Path $envFile) {
    $m = Select-String -Path $envFile -Pattern '^DATABASE_URL=(.+)$' | Select-Object -First 1
    if ($m) { $dbUrl = $m.Matches[0].Groups[1].Value.Trim() }
  }
  if (-not $dbUrl) {
    # NEVER advise deleting the data directory here - an earlier version of this
    # message did exactly that, and following it destroys the hospital record.
    Fail ("an existing PostgreSQL cluster is at $pgdata but no aurora.env with a DATABASE_URL was found at $envFile to reuse. " +
          "Do NOT delete or move the database. Upgrades use AuroraUpdate; for a repair, restore the original aurora.env beside the server exe (or contact support), then run Setup again.")
  }
} else {
Say "creating the aurora role + database"
# What the operator must do if this step fails on a cluster we just created.
$freshHint = if ($freshCluster) {
  ". This cluster was created moments ago by this run and holds NO data, and its superuser password only ever existed in memory - DELETE $pgdata and run Setup again. Check $pgdata\log for the database's own error first."
} else { " - see provision.log" }
$env:PGHOST = '127.0.0.1'; $env:PGPORT = "$pgPort"; $env:PGUSER = 'postgres'
# authenticate as the superuser with the password set at initdb (scram is required
# on 127.0.0.1). Without this psql prompts for a password and fails the install.
$env:PGPASSWORD = $superpw
# superuser trust is not enabled; use the postgres pw only for setup - but we
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
-- CREATEDB lets the aurora role create the throwaway scratch database the backup
-- engine born-restore-verifies into, and the empty database the DR / update-rollback
-- 'restore' recreates. It grants NO access to other databases - a plain capability,
-- idempotent to re-assert on every provision.
ALTER ROLE aurora CREATEDB;
SELECT 'ensure-db' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname='aurora');
"@
# createdb is separate (CREATE DATABASE cannot run inside a DO block)
try {
  & (Join-Path $pgbin 'psql.exe') -w -v ON_ERROR_STOP=1 -d postgres -f $setup | Out-Null
  # a silent psql failure here used to let provisioning continue and write an
  # aurora.env whose credentials were never applied to any role - fail loudly
  if ($LASTEXITCODE -ne 0) { Fail ("could not create/update the aurora role (psql exit $LASTEXITCODE)" + $freshHint) }
  $exists = & (Join-Path $pgbin 'psql.exe') -w -tAc "SELECT 1 FROM pg_database WHERE datname='aurora'" -d postgres
  if (-not $exists) {
    & (Join-Path $pgbin 'createdb.exe') -O aurora aurora | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail ("could not create the aurora database (createdb exit $LASTEXITCODE)" + $freshHint) }
  }
} finally {
  Remove-Item -Force $setup -ErrorAction SilentlyContinue
  Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue   # don't leave the superuser pw in the environment
}
$dbUrl = "postgresql://aurora:$pgpw@127.0.0.1:$pgPort/aurora"
}

# ---- 4. write the ACL-locked machine config (server\aurora.env) ----
Say "writing the machine config $envFile (ACL-locked)"
$adminPw = (Get-Content -Raw $AdminPasswordFile).TrimEnd("`r","`n")
# Detect the real LAN address(es) now so CORS_ORIGINS allows every origin a
# browser might actually use (the typed URL PLUS each live interface), not only
# the one address the operator happened to type. Same detection is reused for
# the finish-page URL + DHCP warning at step 9. Loopback origins are stripped
# (production BootGuards refuses them); the typed URL is always kept as a floor.
$access = Get-LanAccess -Port $Port
$originList = New-Object System.Collections.Generic.List[string]
foreach ($o in @($AccessUrl) + @($access.PrimaryUrl) + $access.AltUrls) {
  if (-not $o) { continue }
  $o = $o.TrimEnd('/')
  if ($o -match 'localhost|127\.0\.0\.1') { continue }
  if (-not $originList.Contains($o)) { $originList.Add($o) }
}
if ($originList.Count -eq 0) { $originList.Add($AccessUrl) }   # never leave CORS empty
$corsValue = ($originList -join ';')
# AURORA-ENV-KEYS-BEGIN
# Everything between these two markers is the aurora.env contract. build.ps1
# extracts the KEY= names from THIS REGION ONLY and stamps them into
# server\version.json as requiredEnvKeys (minus a short declared-optional list),
# so aurora-update.ps1 can tell a hospital when its carried-across aurora.env is
# missing a key a newer build expects. Add a key here and it is picked up
# automatically - but a key added OUTSIDE these markers is invisible to that
# check, and a key that is only sometimes written must be added to
# $optionalEnvKeys in build.ps1 or every install will warn about it.
$lines = @(
  '# Aurora ICU machine config (written by the installer). ACL-locked.',
  '# The server (a Windows service, no compose) reads this via AuroraEnvFile.',
  'APP_ENV=production',
  "PORT=$Port",
  "CORS_ORIGINS=$corsValue",
  "DATABASE_URL=$dbUrl",
  "JWT_SECRET=$jwt",
  "FORMULARY_SEED=$FormularySeed",
  "ADMIN_BOOTSTRAP_PASSWORD=$adminPw",   # remove this line after the admin changes it at first login
  "BACKUP_DIR=$backups",
  "BACKUP_KEY_FILE=$(Join-Path $secrets 'backup.key')",
  'BACKUP_SCHEDULE=daily 02:00',
  # the bundled PostgreSQL client tools (pg_dump/pg_restore) the backup engine
  # shells out to. The AuroraServer service runs from C:\Windows\system32 with
  # pgsql\bin NOT on PATH, so the engine must be told where they are or every
  # backup fails "cannot find the file specified". (The server also falls back
  # to pgsql\bin as a sibling of its exe dir, so this is belt-and-suspenders.)
  "PG_BIN=$pgbin"
)
# The off-site copy the nightly task mirrors to. Written ONLY when the operator
# chose one, so the dashboard can tell "never configured" from "configured but
# the disk has not been seen" - two very different problems.
if ($BackupUsb) { $lines += "BACKUP_USB=$BackupUsb" }
if ($TimeZone) { $lines += "TZ=$TimeZone" }

# ---- AI wiring (sec 5). The native AI is the AuroraAI Windows service
#      (llama-server, registered in step 5b) - ENABLED only when the machine
#      has a GPU AND the AI payload (llama-server.exe + nssm.exe + a .gguf
#      model) actually shipped in this build. The HIS never depends on it:
#      any absence -> AI_PROVIDER=none + an HONEST reason the AI screen shows,
#      never a fault (sec 2.3 "warn and disable, never refuse"). ----
$aiLlamaExe = Join-Path $InstallDir 'llama\llama-server.exe'
$aiNssmExe  = Join-Path $InstallDir 'llama\nssm.exe'
$aiModelGguf = Find-AiModelGguf (Join-Path $InstallDir 'model')   # shared helper (first split part, else the single file)
$aiReady = $AiEnabled -and (Test-Path $aiLlamaExe) -and (Test-Path $aiNssmExe) -and $aiModelGguf
if ($aiReady) {
  $lines += 'AI_PROVIDER=openai'
  $lines += "AI_ENDPOINT=http://127.0.0.1:$AiPort/v1"   # local only - never on the LAN
  $lines += "AI_MODEL=$AiModel"
  $lines += 'AI_TIMEOUT_SECONDS=120'
} elseif ($AiEnabled) {
  $lines += 'AI_PROVIDER=none'
  $lines += 'AI_UNAVAILABLE_REASON=the AI runtime was not included in this build'
} else {
  # Worded so ADDING a GPU later never falsifies it (speaks to setup, not "now"),
  # and points at the fix. aurora-enable-ai removes this line when it turns AI on.
  $lines += 'AI_PROVIDER=none'
  $lines += 'AI_UNAVAILABLE_REASON=AI is turned off on this install - no GPU was detected at setup. Add an NVIDIA GPU and run aurora-enable-ai to turn it on.'
}
Set-Content -Encoding ascii -Path $envFile -Value $lines
# AURORA-ENV-KEYS-END
# lock it to SYSTEM + Administrators only (contains the bootstrap + DB + JWT secrets)
& icacls.exe $envFile /inheritance:r /grant:r 'SYSTEM:F' 'Administrators:F' | Out-Null

# ---- 5. register + start the AuroraServer service (Automatic, depends-on Postgres, recovery) ----
Say "registering the AuroraServer Windows service (Automatic, depends-on AuroraPostgres)"
# sc.exe create requires a space after each '='; binPath is the self-contained exe
& sc.exe create AuroraServer binPath= "`"$exe`"" start= auto depend= AuroraPostgres DisplayName= "Aurora ICU" 2>$null | Out-Null
& sc.exe config AuroraServer start= auto depend= AuroraPostgres | Out-Null      # idempotent if it existed
& sc.exe failure AuroraServer reset= 300 actions= restart/5000/restart/10000/restart/30000 | Out-Null
& sc.exe description AuroraServer "Aurora ICU - the hospital ICU system (API + web app). Starts automatically at boot." | Out-Null
& sc.exe start AuroraServer 2>$null | Out-Null
Say "waiting for AuroraServer to become healthy (migrations + production seed run on first boot)"
$healthy = $false
for ($i = 0; $i -lt 90; $i++) {
  try { Invoke-RestMethod "http://127.0.0.1:$Port/healthz" -TimeoutSec 2 | Out-Null; $healthy = $true; break } catch {}
  Start-Sleep 2
}
if (-not $healthy) { Fail "AuroraServer did not become healthy - check the Windows Event Log (source AuroraServer)" }

# ---- 5b. register + start the native AI service (AuroraAI = llama-server) ----
# The GPU-native path (sec 5). llama-server is a console exe, so it runs under
# NSSM (a thin, battle-tested service host): Automatic start (BEFORE login) +
# restart-on-crash, exactly like AuroraServer/AuroraPostgres. Bound to
# 127.0.0.1 - ONLY AuroraServer (same box) calls it; it is NEVER on the LAN and
# the firewall never opens $AiPort. AuroraServer does NOT depend on it: the HIS
# runs with or without the AI, and the AI screen stays honest until it is ready.
# The --parallel / --ctx-size guardrails (sec 5.4) are set here and are tunable
# (re-run this script) once llama-bench measures the real card (sec 5.6).
if ($aiReady) {
  Say "registering the AuroraAI service (llama-server, --parallel $AiParallel, 127.0.0.1:$AiPort)"
  # The AI is OPTIONAL - "the HIS runs with or without it" (the comment above,
  # and the honest AI screen). Everything AFTER this block is not optional: the
  # backup-key ceremony, the nightly backup task and the firewall rule. So a
  # failure here must never abort provisioning and leave a hospital with no
  # backups configured - it degrades to the same honest AI-off state the
  # no-GPU path already produces. (A real install died exactly this way on
  # 2026-07-26: nssm stderr on a first registration killed the whole run.)
  try {
    Register-AuroraAI -NssmExe $aiNssmExe -LlamaExe $aiLlamaExe -ModelGguf $aiModelGguf.FullName `
      -Port $AiPort -Parallel $AiParallel -CtxSize $AiCtxSize -LogFile (Join-Path $DataDir 'ai.log')
    # the model loads in tens of seconds - do NOT block the install on it; the AI
    # screen is honest (server 503/502) until llama-server answers /health
    Say "AuroraAI starting - the model loads in the background; Aurora is already usable."
  }
  catch {
    $aiReady = $false
    Say "NOTE: the AI service could not be registered ($($_.Exception.Message))."
    Say "      Aurora, its database, backups and firewall are configured normally and the"
    Say "      AI screen will say the AI is off. Fix the cause and run aurora-enable-ai.ps1"
    Say "      later - no reinstall, no data touched."
  }
} elseif ($AiEnabled) {
  Say "GPU present but the AI runtime was not bundled in this build - AI stays disabled; the HIS is unaffected."
}

# ---- 6. backup-key ceremony (init-key) - write the key ONCE for the wizard to show ----
Say "generating the backup encryption key (shown once by the installer)"
# init-key writes the server copy AND prints the key; we capture the printed key
# for the installer's show-once page, then this relay file is deleted.
# init-key EXITS 1 and prints to stderr when a key already exists - the NORMAL
# case on every reinstall/repair this installer's guard now allows. Under
# $ErrorActionPreference='Stop', 2>&1 on a native command turns those stderr
# lines into TERMINATING errors in Windows PowerShell 5.1 - which would abort
# provisioning at the exact step that is supposed to be a no-op. Relax the
# preference around this one call; the exit code and output decide what happened.
$prevEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$out = & $exe init-key --actor installer 2>&1
$ErrorActionPreference = $prevEap
$keyMatch = $out | Select-String -Pattern '^\s*key\s*:\s*(.+)$'    | Select-Object -First 1
$idMatch  = $out | Select-String -Pattern '^\s*key id\s*:\s*(.+)$' | Select-Object -First 1
$keyLine = if ($keyMatch) { $keyMatch.Matches[0].Groups[1].Value.Trim() } else { '' }
$idLine  = if ($idMatch)  { $idMatch.Matches[0].Groups[1].Value.Trim() }  else { '' }
if ($keyLine) {
  Set-Content -Encoding ascii -Path $KeyOutFile -Value "$idLine`n$keyLine"
  & icacls.exe $KeyOutFile /inheritance:r /grant:r 'SYSTEM:F' 'Administrators:F' | Out-Null
} else {
  # A pre-existing key means THIS run showed the operator nothing. Say so
  # loudly: if the original ceremony was never recorded, every backup this
  # machine makes is already unrecoverable off-server and no one has been told.
  Say "NOTE: init-key produced no key - a key already exists, so NO show-once page is displayed."
  Say "      If the ORIGINAL key was never recorded (envelope / password manager), this hospital"
  Say "      CANNOT restore its backups on other hardware. Rotate the key and record the new one."
}
# The key file itself, ACL-locked explicitly. The secrets FOLDER is locked above
# and the file inherits that, but the file is written by the server process
# (File.WriteAllText) - assert the ACL on the artifact too rather than trusting
# inheritance. Losing this file is survivable ONLY if the envelope copy exists.
$keyFilePath = Join-Path $secrets 'backup.key'
if (Test-Path $keyFilePath) {
  try { & icacls.exe $keyFilePath /inheritance:r /grant:r 'SYSTEM:F' 'Administrators:F' | Out-Null }
  catch { Say "NOTE: could not tighten permissions on the backup key file ($($_.Exception.Message))." }
}

# ---- 7. register the nightly backup (native - NOT the Docker backup.ps1) ----
# THE CLAIM FOLLOWS THE MEASUREMENT (owner's ruling after the 2026-08-19 field
# finding): the old log line announced the registration BEFORE attempting it,
# and on a real production install that line sat in provision.log while NO
# task existed on the machine. The pre-line below is deliberately an attempt
# marker only (the transcript's job is to show WHERE a hidden-window run
# stalled); the claim line prints after Get-ScheduledTask has actually seen
# the task, and a machine the task cannot be found on FAILS provisioning -
# a hospital without this task takes no automatic backups at all, which is
# the one failure this project cannot correct after the fact.
Say "step 7: nightly backup task (AuroraBackup, daily 02:00) - attempting registration"
$backupScript = Join-Path $server 'scripts\aurora-backup.ps1'
$action  = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$backupScript`"" -WorkingDirectory $server
$trigger = New-ScheduledTaskTrigger -Daily -At '02:00'
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings  = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd `
  -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 10)
Register-ScheduledTask -TaskName 'AuroraBackup' -Action $action -Trigger $trigger `
  -Principal $principal -Settings $settings -Force | Out-Null
$backupTask = Get-ScheduledTask -TaskName 'AuroraBackup' -ErrorAction SilentlyContinue
if (-not $backupTask) {
  Fail ("the nightly backup task did NOT register: Register-ScheduledTask returned, but " +
    "Get-ScheduledTask finds no 'AuroraBackup' on this machine. Aurora's services are up, but " +
    "WITHOUT this task the hospital takes NO automatic backups. Fix Task Scheduler (service " +
    "'Schedule' running?) and re-run provisioning, or register the task manually per the runbook.")
}
Say "step 7 VERIFIED: scheduled task 'AuroraBackup' exists (state: $($backupTask.State)) - nightly at 02:00, runs $backupScript"

# ---- 8. open the Windows Firewall for the API port (ALL profiles) ----
# The rule MUST cover the Public profile, not just Domain+Private. Windows
# readily classifies an unidentified hospital Wi-Fi/LAN as PUBLIC (it cannot
# find a domain controller), and a Public-excluded rule then blocks the port
# from every other device: localhost works on the server, both services show
# RUNNING, yet every tablet/phone/laptop gets "site can't be reached". Opening
# -Profile Any makes the system reachable immediately after a next-next-finish
# install with NO manual command. CREATE BEFORE REMOVE (owner's ruling,
# 2026-08-19 - this replaces remove-then-create): Windows allows several
# firewall rules with one DisplayName, so the correct new rule is created
# FIRST and the older instances are removed afterwards by instance id. The
# machine is never ruleless - the old ordering designed in a window with no
# rule at all - and the final state is still exactly one correct rule
# (Any profile + the chosen port), idempotent across re-provision.
Say "step 8: Windows Firewall rule 'Aurora ICU' (TCP $Port, all profiles) - attempting create"
$fwNew = New-NetFirewallRule -DisplayName 'Aurora ICU' -Direction Inbound -Action Allow `
  -Protocol TCP -LocalPort $Port -Profile Any
Get-NetFirewallRule -DisplayName 'Aurora ICU' -ErrorAction SilentlyContinue |
  Where-Object { $_.InstanceID -ne $fwNew.InstanceID } |
  Remove-NetFirewallRule -ErrorAction SilentlyContinue
$fwCheck = @(Get-NetFirewallRule -DisplayName 'Aurora ICU' -ErrorAction SilentlyContinue)
if ($fwCheck.Count -eq 0) {
  Fail ("the firewall rule did NOT register: New-NetFirewallRule returned, but no rule named " +
    "'Aurora ICU' exists. Without it every other device gets 'site can't be reached' while the " +
    "server itself looks healthy. Check the Windows Firewall service and re-run provisioning.")
}
Say "step 8 VERIFIED: firewall rule 'Aurora ICU' exists ($($fwCheck.Count) rule(s), enabled: $($fwCheck[0].Enabled), TCP $Port, profile Any)"

# ---- 9. record the REAL, working access URL for the installer's finish page ----
# What the operator typed can be wrong (no port) or already stale (DHCP moved
# the address after a reboot). Derive the authoritative URL from this server's
# live network interface + the port we actually bound, and hand it back to the
# wizard via -UrlOutFile so the finish screen shows a URL that truly works. Also
# flag DHCP: on a DHCP lease the address WILL change on reboot and break every
# bookmark - the operator must be told to get a static IP / DHCP reservation.
# ($access was computed at step 4 for CORS; reuse it.)
if ($access.PrimaryUrl) {
  Say "Access URL (from this server's live network interface): $($access.PrimaryUrl)"
} else {
  Say "Access URL: $AccessUrl (could not detect a LAN address automatically)"
}
if ($access.IsDhcp) {
  Say "WARNING: this server's address ($($access.PrimaryIp)) is assigned by DHCP and WILL"
  Say "         CHANGE on reboot, breaking every saved bookmark. Ask hospital IT for a"
  Say "         STATIC IP or a DHCP RESERVATION for this machine before rollout."
}
if ($UrlOutFile) {
  $relay = @("URL=$(if ($access.PrimaryUrl) { $access.PrimaryUrl } else { $AccessUrl })",
             "DHCP=$([int][bool]$access.IsDhcp)")
  foreach ($u in $access.AltUrls) { $relay += "ALT=$u" }
  try {
    Set-Content -Encoding ascii -Path $UrlOutFile -Value $relay
  } catch { Say "NOTE: could not write the access-URL relay file ($($_.Exception.Message))." }
}

Say "PROVISIONING COMPLETE (run $runId - finished $((Get-Date).ToUniversalTime().ToString('yyyy-MM-dd HH:mm:ss')) UTC) - Aurora is running as a Windows service and will start on every boot."
try { Stop-Transcript | Out-Null } catch {}
exit 0
