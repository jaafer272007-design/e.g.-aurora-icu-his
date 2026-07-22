# AURORA appliance — one command up (design §2.2).
# The validator's testbed: Windows 11 Pro + NVIDIA RTX 4060.
# Run from PowerShell:  .\run.ps1     (in the appliance\ folder)
#
# Same steps as run.sh: Docker check → generate local secrets →
# fetch + sha256-verify the OFFICIAL model → detect the GPU →
# compose up → print the origins. Without a GPU, Aurora runs fully
# and the AI screen says exactly why it is unavailable (§2.3).
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$MODEL1 = "qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf"
$MODEL2 = "qwen2.5-7b-instruct-q4_k_m-00002-of-00002.gguf"
$SHA1 = "dfce12e3862a5283ccfb88221b48480e58745165de856439950d0f22590580db"
$SHA2 = "539cf93f78e887edea1c04e2d7d8cdaca9d01dae9c9025bcb8accbe29df3d72a"
$HF = "https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/main"

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Error "Docker Desktop is required (WSL2 backend). Install it, then re-run."
}

# ---- secrets (generated locally, once; never committed, never baked) ----
if (-not (Test-Path ".env")) {
  Write-Host "First run - generating appliance\.env (secrets stay on this machine)"
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  function New-Hex([int]$bytes) {
    $b = New-Object byte[] $bytes; $rng.GetBytes($b)
    -join ($b | ForEach-Object { $_.ToString("x2") })
  }
  @(
    "JWT_SECRET=$(New-Hex 48)"
    "POSTGRES_PASSWORD=$(New-Hex 24)"
  ) | Set-Content -Encoding ascii ".env"
}

# ---- install mode: demo testbed (default) vs a real hospital ----
# A hospital install is a PRODUCTION install (APP_ENV=production): the server
# seeds catalogues + config + ONE bootstrap admin, ZERO patients, ZERO demo
# credentials, and the boot tripwires enforce it. Demo (staging) is default.
#
#   .\run.ps1                                  -> demo testbed
#   $env:AURORA_MODE="production"; .\run.ps1   -> a real hospital install
#     (once; the choice persists in appliance\.env for later reboots)
function Get-EnvVal([string]$key) {
  $line = Select-String -Path ".env" -Pattern "^$key=" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($line) { return ($line.Line -replace "^$key=", "") } else { return "" }
}
function Set-EnvVal([string]$key, [string]$val) {
  $lines = @()
  if (Test-Path ".env") { $lines = Get-Content ".env" | Where-Object { $_ -notmatch "^$key=" } }
  $lines += "$key=$val"
  Set-Content -Encoding ascii ".env" $lines
}
$DemoPw = "Aurora2026!"   # the shared demo password — forbidden in production
$Mode = if ($env:AURORA_MODE) { $env:AURORA_MODE } elseif ((Get-EnvVal "APPLIANCE_ENV") -eq "production") { "production" } else { "staging" }
if ($Mode -eq "production") {
  Write-Host "PRODUCTION install mode - a real hospital deployment (no demo data)."
  Set-EnvVal "APPLIANCE_ENV" "production"
  $env:DEMO_PASSWORD = $null   # must never reach a production environment (T2 refuses it)
  # -- formulary install policy (server refuses an unset/unknown value) --
  $fs = Get-EnvVal "FORMULARY_SEED"
  if ($fs -ne "starter" -and $fs -ne "empty") {
    if ($env:FORMULARY_SEED) { $fs = $env:FORMULARY_SEED }
    else {
      Write-Host "Formulary at install: [starter] seeds a reference drug list DEACTIVATED"
      Write-Host "(pharmacy reactivates each drug after review), or [empty] to build from scratch."
      $fs = Read-Host "  FORMULARY_SEED (starter/empty) [starter]"
      if (-not $fs) { $fs = "starter" }
    }
    if ($fs -ne "starter" -and $fs -ne "empty") { Write-Error "FORMULARY_SEED must be 'starter' or 'empty'." }
  }
  Set-EnvVal "FORMULARY_SEED" $fs
  # -- same-origin access URL -> CORS_ORIGINS (belt-and-suspenders; the server
  #    still requires it explicit and non-local in production) --
  if (-not (Get-EnvVal "CORS_ORIGINS")) {
    $co = $env:CORS_ORIGINS
    if (-not $co) {
      Write-Host "The URL clinicians open in their browser (this server's address on the LAN),"
      Write-Host "e.g. http://192.168.1.50:8080 - not localhost."
      $co = Read-Host "  Access URL"
    }
    if (-not $co -or $co -match "localhost" -or $co -match "127\.0\.0\.1") {
      Write-Error "A non-local access URL is required in production (the server refuses localhost)."
    }
    Set-EnvVal "CORS_ORIGINS" $co
  }
  # -- the first administrator's credential (provision-time, shown once,
  #    rotated after first login; never the demo password) --
  if (-not (Get-EnvVal "ADMIN_BOOTSTRAP_PASSWORD")) {
    $bp = $env:ADMIN_BOOTSTRAP_PASSWORD
    if (-not $bp) {
      Write-Host "Set the first administrator's password (user 'admin'; you MUST change it at first login)."
      $s1 = Read-Host "  Bootstrap admin password" -AsSecureString
      $s2 = Read-Host "  Confirm" -AsSecureString
      $bp  = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s1))
      $bp2 = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s2))
      if ($bp -ne $bp2) { Write-Error "Passwords did not match. Re-run." }
    }
    if (-not $bp) { Write-Error "ADMIN_BOOTSTRAP_PASSWORD is required for a production install." }
    if ($bp -eq $DemoPw) { Write-Error "The bootstrap password cannot be the shared demo password. Choose a real one." }
    Set-EnvVal "ADMIN_BOOTSTRAP_PASSWORD" $bp
    Write-Host "Recorded the bootstrap admin credential in appliance\.env (delete that line after you rotate it post-login)."
  }
  Write-Host "Note: a data volume that already holds DEMO data cannot be served in production"
  Write-Host "      (the T1 tripwire refuses the demo credential). Start clean: docker compose down -v."
}

# ---- the hospital's timezone (Locale/Timezone design §1.3) ----
# The app stores UTC and DISPLAYS the server's local time; the container
# defaults to UTC, so the HOST's zone must be handed in as an IANA id.
# Windows names zones its own way ("Arab Standard Time") — .NET 6+ can
# convert (PowerShell 7); Windows PowerShell 5.1 cannot, and a WRONG
# guess would stamp every screen with the wrong wall clock, so when the
# conversion API is unavailable we WARN with the exact line to add
# instead of guessing. Written once; correctable in appliance\.env.
if (-not (Select-String -Path ".env" -Pattern '^TZ=' -Quiet)) {
  $iana = $null
  try {
    $winId = (Get-TimeZone).Id
    $out = $null
    if ([System.TimeZoneInfo].GetMethod('TryConvertWindowsIdToIanaId', [type[]]@([string], [string].MakeByRefType()))) {
      if ([System.TimeZoneInfo]::TryConvertWindowsIdToIanaId($winId, [ref]$out)) { $iana = $out }
    }
  } catch { $iana = $null }
  if ($iana) {
    Add-Content -Encoding ascii ".env" "TZ=$iana"
    Write-Host "timezone: $iana (converted from this machine's '$((Get-TimeZone).Id)' - edit TZ= in appliance\.env if wrong)"
  } else {
    Write-Host "WARNING: could not convert this machine's Windows timezone to an IANA id - Aurora will DISPLAY times in UTC." -ForegroundColor Yellow
    Write-Host "         Set it explicitly: add a line like  TZ=Asia/Baghdad  to appliance\.env and re-run.  (PowerShell 7 converts automatically.)" -ForegroundColor Yellow
  }
}

# the packaged commit — /build.txt and /healthz stamp it.
# Native stderr goes through cmd.exe: under $ErrorActionPreference=Stop,
# Windows PowerShell 5.1 turns a redirected stderr write from a native
# command into a TERMINATING error — git printing "not a git repository"
# (a zip-download install) would kill the whole script otherwise.
$env:AURORA_BUILD_COMMIT = (cmd /c "git -C .. rev-parse HEAD 2>nul"); if (-not $env:AURORA_BUILD_COMMIT) { $env:AURORA_BUILD_COMMIT = "dev" }

# ---- the model (alongside-as-a-file; offline-capable) ----
New-Item -ItemType Directory -Force -Path models | Out-Null
function Get-Model([string]$file, [string]$sha) {
  $path = "models\$file"
  if (-not (Test-Path $path)) {
    Write-Host "downloading OFFICIAL model shard: $file (one-time; place files in appliance\models\ for offline installs)"
    Invoke-WebRequest -Uri "$HF/$file" -OutFile "$path.part"
    Move-Item "$path.part" $path
  } else { Write-Host "model shard present: $file" }
  Write-Host "verifying sha256 of $file against the pinned official digest..."
  $actual = (Get-FileHash -Algorithm SHA256 $path).Hash.ToLower()
  if ($actual -ne $sha) {
    Write-Error "SHA256 MISMATCH on $file - refusing to serve an unverified model. Delete the file and retry."
  }
}
Get-Model $MODEL1 $SHA1
Get-Model $MODEL2 $SHA2

# ---- GPU detection → AI mode (§2.3: warn and disable, never refuse) ----
$composeArgs = @("-f", "docker-compose.yml")
# The probe runs through cmd.exe for the same 5.1 stderr rule as above:
# docker's FIRST-EVER pull of ubuntu:24.04 reports progress on stderr, so
# `docker ... 2>$null` inside this script threw mid-pull and the probe
# reported "no GPU" on a machine whose GPU was fine (the validator's
# first Windows run hit exactly this). cmd.exe swallows stderr before
# PowerShell ever sees it; $LASTEXITCODE still carries docker's verdict.
cmd /c "docker run --rm --gpus all ubuntu:24.04 true >nul 2>nul" | Out-Null
$gpu = ($LASTEXITCODE -eq 0)
if ($gpu) {
  Write-Host "GPU detected - AI ENABLED (llama-server, CUDA build)"
  $env:LLAMA_RUNTIME = "cuda"; $env:AI_PROVIDER = "openai"
  $env:AI_ENDPOINT = "http://llama:8081/v1"; $env:AI_UNAVAILABLE_REASON = ""
  $composeArgs += @("-f", "docker-compose.gpu.yml", "--profile", "ai")
} elseif ($env:AURORA_AI -eq "cpu") {
  Write-Host "AURORA_AI=cpu - AI ENABLED ON CPU (testing only; a cold question can take ~60 s)"
  $env:LLAMA_RUNTIME = "cpu"; $env:AI_PROVIDER = "openai"
  $env:AI_ENDPOINT = "http://llama:8081/v1"; $env:AI_UNAVAILABLE_REASON = ""
  if (-not $env:AI_TIMEOUT_SECONDS) { $env:AI_TIMEOUT_SECONDS = "180" }
  $composeArgs += @("--profile", "ai")
} else {
  Write-Host "WARNING: no NVIDIA GPU visible to Docker - the AI assistant is DISABLED; everything else runs."
  Write-Host "         (The AI screen will say exactly why. The HIS never stops because of the AI.)"
  $env:AI_PROVIDER = "none"; $env:AI_ENDPOINT = ""
  $env:AI_UNAVAILABLE_REASON = "no GPU on this server"
}

# ---- up ----
# AURORA_NO_BUILD=1 skips image builds — for installs where the images
# arrive pre-built (docker load from install media; the offline path)
$buildFlag = if ($env:AURORA_NO_BUILD) { "--no-build" } else { "--build" }
docker compose @composeArgs up -d $buildFlag
if ($LASTEXITCODE -ne 0) { Write-Error "docker compose up failed" }

$port = if ($env:AURORA_PORT) { $env:AURORA_PORT } else { "8080" }
Write-Host -NoNewline "waiting for AURORA"
for ($i = 0; $i -lt 60; $i++) {
  try { Invoke-RestMethod "http://localhost:$port/healthz" -TimeoutSec 2 | Out-Null; break } catch {}
  Write-Host -NoNewline "."; Start-Sleep 2
}
Write-Host ""

# ---- Backup & Disaster Recovery: the encryption key (design §4) ----
# The key is generated at install into the ACL-restricted host file
# secrets\backup.key (mounted read-only into the container as the source
# of unattended nightly encryption) AND DISPLAYED EXACTLY ONCE here for
# the operator to record off-server. It is never shown again — the
# server's copy dies with the server, so the recorded copies ARE disaster
# recovery. init-key inside the container writes the file and prints the
# ceremony; we only trigger it when the key does not yet exist.
New-Item -ItemType Directory -Force -Path secrets | Out-Null
if (-not (Test-Path "secrets\backup.key")) {
  Write-Host ""
  Write-Host "Generating the backup encryption key (shown ONCE - have pen and the sealed envelope ready)..." -ForegroundColor Yellow
  docker compose @composeArgs exec -T aurora dotnet AuroraIcu.Api.dll init-key --actor "installer"
  if ($LASTEXITCODE -ne 0) {
    Write-Host "WARNING: could not initialise the backup key automatically. Run it yourself once Aurora is up:" -ForegroundColor Yellow
    Write-Host "         docker compose exec aurora dotnet AuroraIcu.Api.dll init-key" -ForegroundColor Yellow
  }
  # lock the key file down to the current user (best-effort; the operator
  # should confirm the ACL matches hospital policy)
  try {
    $acl = Get-Acl "secrets\backup.key"
    $acl.SetAccessRuleProtection($true, $false)
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
      [System.Security.Principal.WindowsIdentity]::GetCurrent().Name, "FullControl", "Allow")
    $acl.AddAccessRule($rule)
    Set-Acl "secrets\backup.key" $acl
    Write-Host "Locked secrets\backup.key to $([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) (confirm this matches hospital policy)."
  } catch { Write-Host "NOTE: set the ACL on secrets\backup.key so only the Task Scheduler account can read it." -ForegroundColor Yellow }
}

# ---- Backup & Disaster Recovery: the nightly schedule (design §1) ----
# A hospital install ends with automatic nightly backups ON — the schedule is
# registered HERE, as PART OF THE INSTALL, not as a separate command a
# hospital must remember (a forgotten -Install left backups OFF). Reuses the
# ONE registration in backup.ps1 -Install (same task name, same trigger from
# BACKUP_SCHEDULE, same principal), so the scheduled time and the dashboard's
# "next scheduled" stay in lockstep. Idempotent — a reboot confirms and skips.
# NEVER fatal: registering a task needs elevation, and a HIS that comes up
# beats one blocked on an unelevated Task Scheduler call, so we warn with the
# one manual line and continue (mirrors the init-key handling above).
if ($Mode -eq "production") {
  $existing = Get-ScheduledTask -TaskName "AuroraBackup" -ErrorAction SilentlyContinue
  if ($existing) {
    Write-Host "Automatic nightly backup already registered (Task Scheduler 'AuroraBackup')."
  } else {
    Write-Host "Registering the automatic nightly backup (Windows Task Scheduler)..."
    try {
      & (Join-Path $PSScriptRoot "backup.ps1") -Install
      Write-Host "Automatic nightly backup is ON — it runs every night with no further action." -ForegroundColor Green
    } catch {
      Write-Host "WARNING: could not register the nightly backup task automatically ($($_.Exception.Message))." -ForegroundColor Yellow
      Write-Host "         Backups are NOT yet scheduled. Run this ONCE in an ELEVATED PowerShell to turn them on:" -ForegroundColor Yellow
      Write-Host "         .\backup.ps1 -Install" -ForegroundColor Yellow
    }
  }
}

# The LAN address other devices can reach is the one on the adapter that
# carries the DEFAULT ROUTE — "first non-loopback IPv4" is wrong on
# Docker-Desktop machines, where it lands on the WSL/Hyper-V virtual
# switch (a 172.x address no iPad can reach). Fall back to the old pick
# only if no default route is readable.
$ip = $null
$route = Get-NetRoute -DestinationPrefix "0.0.0.0/0" -ErrorAction SilentlyContinue |
  Sort-Object -Property RouteMetric, ifMetric | Select-Object -First 1
if ($route) {
  $ip = (Get-NetIPAddress -InterfaceIndex $route.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Select-Object -First 1).IPAddress
}
if (-not $ip) {
  $ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } | Select-Object -First 1).IPAddress
}
Write-Host ""
Write-Host "AURORA is up:"
Write-Host "  this machine : http://localhost:$port"
if ($ip) { Write-Host "  on the LAN   : http://${ip}:$port   (other devices on the network - iPad included)" }
Write-Host ""
Write-Host "BACKUP & DISASTER RECOVERY (the go-live gate):"
if ($Mode -eq "production") {
  Write-Host "  Automatic nightly backup: REGISTERED at install (Task Scheduler 'AuroraBackup') - it"
  Write-Host "  runs the encrypted, restore-verified daily backup every night with no further action."
  Write-Host "  Set BACKUP_USB in appliance\.env for the off-site copy. The System Administrator can also"
  Write-Host "  click 'Backup now' and watch health at  /backup  in the app - no PowerShell needed."
} else {
  Write-Host "  A PRODUCTION install registers the nightly backup AUTOMATICALLY. On this demo testbed,"
  Write-Host "  register it manually if you want it:  .\backup.ps1 -Install"
  Write-Host "  The System Administrator manages backups (incl. 'Backup now') at  /backup  in the app."
}
Write-Host "  Before go-live: prove a restore on a DIFFERENT clean machine with  .\restore.ps1  (the"
Write-Host "  non-negotiable acceptance test - a backup that has never been restored is only a hope)."
Write-Host ""
if ($Mode -eq "production") {
  Write-Host "PRODUCTION install - NO demo data: catalogues + configuration are seeded, the"
  Write-Host "unit starts with ZERO patients, and there are NO demo credentials."
  Write-Host "Sign in as the bootstrap administrator (user 'admin') with the password you set;"
  Write-Host "you will be required to change it, then create the clinical accounts from Users."
} else {
  Write-Host "NOT HOSPITAL-READY (design 2.4): this appliance seeds DEMO data - it is the"
  Write-Host "validator's testbed in the hospital topology. Demo sign-in: sara.rahman / Aurora2026!"
  Write-Host "For a real hospital install (no demo data): `$env:AURORA_MODE='production'; .\run.ps1"
}
