<#
  AURORA ICU - app-only updater (replaces re-running the 5 GB AuroraSetup.exe for
  a routine application update). Swaps the .NET server payload for a newer build,
  applies any new EF migrations on boot, and - this is the crux - GUARANTEES a way
  back: a born-verified database restore point is taken first, the old binary is
  kept in server.prev, and any failure returns the system to EXACTLY the
  pre-update state (see installer/UPDATE_AND_ENABLE_AI_DESIGN.md sec 2).

  The database, the model, PostgreSQL, aurora.env (and every secret in it), the
     backup key and the AI service are UNTOUCHED on the happy path. Clinician
     downtime is only the stop->start window.

  The rollback contract (sec 2.5): EF migrations are forward-only, so restoring the
     old binary alone can leave it running against a newer schema. We compute
     migrationWillRun UP FRONT; if the failed update advanced the schema, rollback
     restores BOTH the old binary AND the pre-update database snapshot (the new
     `restore` verb). At every step a known-good binary (server.prev) and a
     verified pre-update backup exist on disk, with the exact manual-recovery
     commands recorded if automation cannot complete the return.

  USAGE (normally invoked by AuroraUpdate-<ver>.exe; runnable standalone):
    powershell -ExecutionPolicy Bypass -File aurora-update.ps1 -PackageDir <extracted-bundle>
      [-InstallDir C:\Aurora] [-AllowMajor] [-HealthTimeoutSec 120]

  WINDOWS-ONLY at run time (services/SCM/psql/the health probe). The pure
     version-skew guard (Compare-SemVer / Test-VersionSkew / Test-VersionSkipHop /
     Get-MissingEnvKeys) is unit-tested by installer\test-update-pure.ps1.

  WINDOWS POWERSHELL 5.1 ONLY - no PowerShell 7 syntax anywhere in this file.
     aurora-update.iss launches this script with `powershell.exe`, which on every
     Windows Server / Windows 10-11 box is Windows PowerShell 5.1. PS7-only
     constructs (the `? :` ternary, `??`, `?.`) are a PARSE error there, and a
     parse error kills the WHOLE FILE at load - before a single statement runs.
     This shipped once: two ternaries in Compare-SemVer meant no hospital could
     apply any update, while the Linux unit tests (pwsh 7) passed. The CI job
     `installer-powershell` now parses every installer .ps1 with the real 5.1
     engine and runs these pure tests there, so the class cannot recur.
#>
[CmdletBinding()]
param(
  [string]$PackageDir = $PSScriptRoot,      # the extracted update bundle: server\ + SHA256SUMS
  [string]$InstallDir = 'C:\Aurora',
  [switch]$AllowMajor,                       # permit a cross-major update (supervised only)
  # Seconds to wait for the NEW build to answer /healthz with its own build stamp.
  # Migrations run BEFORE the server serves anything, so this is really "how long
  # may the schema work take". Raised automatically for a skipped-release hop -
  # see $SkipHealthTimeoutSec below. Keep the literal in sync with
  # $DefaultHealthTimeoutSec (an explicit -HealthTimeoutSec always wins).
  [int]$HealthTimeoutSec = 120
)

# ============================ PURE, UNIT-TESTED CORE ============================
# Split a version into @{ nums = <3 ints>; pre = <pre-release suffix or ''> }.
# Shared by Compare-SemVer and Test-VersionSkipHop so "what 4.2.1 means" is
# decided in exactly one place. PURE. 5.1-safe (no ternary, no ??).
function Split-SemVer {
  param([Parameter(Mandatory)][string]$V)
  $core, $pre = ($V -split '-', 2)
  $nums = @($core -split '\.' | ForEach-Object { [int]($_ -replace '[^\d].*$', '') })
  while ($nums.Count -lt 3) { $nums += 0 }
  if ($null -eq $pre) { $pre = '' }    # no '-' in the string -> -split yields one element
  return @{ nums = $nums; pre = $pre }
}

# Semver compare: -1 / 0 / +1. Numeric dotted release only (build metadata ignored);
# a pre-release suffix (1.2.0-rc1) sorts BEFORE its release, per semver.
function Compare-SemVer {
  param([Parameter(Mandatory)][string]$A, [Parameter(Mandatory)][string]$B)
  $x = Split-SemVer $A; $y = Split-SemVer $B
  for ($i = 0; $i -lt 3; $i++) {
    if ($x.nums[$i] -lt $y.nums[$i]) { return -1 }
    if ($x.nums[$i] -gt $y.nums[$i]) { return 1 }
  }
  if ($x.pre -eq $y.pre) { return 0 }
  if ($x.pre -eq '') { return 1 }      # release > pre-release
  if ($y.pre -eq '') { return -1 }
  if ([string]::CompareOrdinal($x.pre, $y.pre) -lt 0) { return -1 }
  return 1
}

# The version-skew guard (sec 2.4). Returns @{ ok; reason; migrationWillRun }. Refuses
# a downgrade / same-version / DB-ahead / cross-major / wrong-environment package
# BEFORE any change. $Installed/$Package are @{version;major;migrationHead;environment}.
function Test-VersionSkew {
  param(
    [Parameter(Mandatory)]$Installed,
    [Parameter(Mandatory)]$Package,
    [Parameter(Mandatory)][string]$DbHead,
    [switch]$AllowMajor
  )
  $migrationWillRun = ($Package.migrationHead -ne $DbHead)
  if ($Package.environment -ne 'production') {
    return @{ ok = $false; migrationWillRun = $migrationWillRun
      reason = "the update package is a '$($Package.environment)' build, not 'production' - a non-production build must never be applied to a hospital." }
  }
  if ((Compare-SemVer $Package.version $Installed.version) -le 0) {
    return @{ ok = $false; migrationWillRun = $migrationWillRun
      reason = "the package version ($($Package.version)) is not newer than the installed version ($($Installed.version)). Going backwards is a ROLLBACK, not an update - use the DR restore path, never a package swap (an older binary against the current schema is the forward-only-migration hazard)." }
  }
  # DB already ahead of the package's newest migration = the same hazard, seen from the DB.
  if ([string]::CompareOrdinal([string]$Package.migrationHead, [string]$DbHead) -lt 0) {
    return @{ ok = $false; migrationWillRun = $migrationWillRun
      reason = "the database has already applied a migration ($DbHead) newer than the package's newest ($($Package.migrationHead)). This package is behind the live schema; applying it would run an old binary against a newer database." }
  }
  if (($Package.major -ne $Installed.major) -and -not $AllowMajor) {
    return @{ ok = $false; migrationWillRun = $migrationWillRun
      reason = "this is a cross-major update ($($Installed.major).x -> $($Package.major).x). A major release may carry a non-additive migration whose safe application needs the supervised path. Re-run with -AllowMajor only if you know this package is safe to apply in place." }
  }
  return @{ ok = $true; reason = ''; migrationWillRun = $migrationWillRun }
}

# Is this a SKIPPED-RELEASE hop - a hospital that sat out one or more releases -
# rather than the next release? Skipping is LEGAL (Test-VersionSkew has no
# adjacency rule, by design: 4.2 -> 4.4 is accepted and EF applies 4.3's and
# 4.4's migrations in order in one boot). It is not, however, the same RISK: all
# of those migrations run inside one health-timeout window.
#
# HONEST LIMIT: the updater knows only two versions - what is installed and what
# is in the package. It cannot know which releases actually exist, so it cannot
# distinguish "4.2.5 -> 4.3.0 with nothing in between" from "4.2.5 -> 4.3.0 with
# 4.2.6..4.2.9 skipped". The rule below is therefore a floor, not an oracle: it
# is certain about a gap it can see, and silent about one it cannot. When in
# doubt an operator should pass -HealthTimeoutSec explicitly.
function Test-VersionSkipHop {
  param([Parameter(Mandatory)][string]$InstalledVersion, [Parameter(Mandatory)][string]$PackageVersion)
  $a = (Split-SemVer $InstalledVersion).nums
  $b = (Split-SemVer $PackageVersion).nums
  if ($b[0] -ne $a[0]) { return $true }                                    # any cross-major hop
  if (($b[1] - $a[1]) -gt 1) { return $true }                              # 4.2.x -> 4.4.x
  if (($b[1] -eq $a[1]) -and (($b[2] - $a[2]) -gt 1)) { return $true }     # 4.2.1 -> 4.2.3
  return $false
}

# Which of $RequiredKeys are absent from a live aurora.env? The updater carries
# aurora.env across VERBATIM and never adds keys, so a key introduced by a
# release this hospital skipped is simply missing. Comments and blank lines are
# ignored; only the text left of the FIRST '=' is the key (values contain '=',
# e.g. a connection string or a base64 secret). PURE.
function Get-MissingEnvKeys {
  param(
    # AllowEmptyString is NOT decoration: a real aurora.env contains blank lines,
    # Get-Content yields them as '', and a Mandatory [string[]] rejects an empty
    # element unless this is present ("Cannot bind argument ... empty string").
    [Parameter(Mandatory)][AllowEmptyCollection()][AllowEmptyString()][string[]]$EnvLines,
    [Parameter(Mandatory)][AllowEmptyCollection()][AllowEmptyString()][string[]]$RequiredKeys
  )
  $present = @{}
  foreach ($line in $EnvLines) {
    $t = $line.Trim()
    if ($t -eq '' -or $t.StartsWith('#')) { continue }
    $k = (($t -split '=', 2)[0]).Trim()
    if ($k -ne '') { $present[$k] = $true }
  }
  return @($RequiredKeys | Where-Object { -not $present.ContainsKey($_) })
}
# ========================== END PURE, UNIT-TESTED CORE =========================

# The Windows-only orchestration runs only when NOT dot-sourced for tests. A test
# harness dot-sources this file to exercise the pure functions above; it sets
# $AuroraUpdatePureTest first so the live update below does not execute.
if ($AuroraUpdatePureTest) { return }

$ErrorActionPreference = 'Stop'
function Say([string]$m)  { Write-Host "[aurora-update] $m" }
function Fail([string]$m) { Write-Error "[aurora-update] $m"; exit 1 }

$server    = Join-Path $InstallDir 'server'
$serverPrev= Join-Path $InstallDir 'server.prev'
$envFile   = Join-Path $server 'aurora.env'
$exe       = Join-Path $server 'AuroraIcu.Api.exe'
$pkgServer = Join-Path $PackageDir 'server'
$pkgExe    = Join-Path $pkgServer 'AuroraIcu.Api.exe'
$installedVerFile = Join-Path $server 'version.json'
$pkgVerFile= Join-Path $pkgServer 'version.json'
$pgbin     = Join-Path $InstallDir 'pgsql\bin'
$stateFile = Join-Path $InstallDir 'update-state.json'

function Read-Json([string]$p) { Get-Content -Raw -Path $p | ConvertFrom-Json }
function Env-Value([string[]]$lines, [string]$key) {
  ($lines | Where-Object { $_ -match "^$key=" } | Select-Object -First 1) -replace "^$key=", ''
}

# ---- 1. verify the package (checksums). A package that fails verification is
#         treated as NONEXISTENT - nothing is touched. (Transfer channel is untrusted.) ----
Say "verifying the update package under $PackageDir"
if (-not (Test-Path $pkgServer))   { Fail "no server\ payload in the package ($pkgServer) - is -PackageDir the extracted bundle?" }
if (-not (Test-Path $pkgVerFile))  { Fail "the package has no server\version.json - it is not an Aurora update bundle." }
$sumsFile = Join-Path $PackageDir 'SHA256SUMS'
if (-not (Test-Path $sumsFile))    { Fail "the package has no SHA256SUMS - refusing to apply an unverifiable package." }
$bad = @()
foreach ($line in (Get-Content $sumsFile)) {
  if ($line -notmatch '^\s*([0-9a-fA-F]{64})\s+(.+?)\s*$') { continue }
  $want = $Matches[1].ToLowerInvariant(); $rel = $Matches[2]
  $path = Join-Path $PackageDir $rel
  if (-not (Test-Path $path)) { $bad += "$rel (missing)"; continue }
  $have = (Get-FileHash -Algorithm SHA256 -Path $path).Hash.ToLowerInvariant()
  if ($have -ne $want) { $bad += "$rel (checksum mismatch)" }
}
if ($bad.Count -gt 0) { Fail ("the update package FAILED verification (" + ($bad -join '; ') + "). It is treated as nonexistent - NOTHING was changed. Re-transfer the package.") }
Say "package verified ($((Get-Content $sumsFile | Measure-Object -Line).Lines) files checksum-match)"

# ---- 2. preflight - confirm an Aurora install + read the three version facts ----
if (-not (Get-Service AuroraServer -ErrorAction SilentlyContinue)) { Fail "AuroraServer is not installed at $InstallDir - run the full installer first." }
if (-not (Test-Path $installedVerFile)) { Fail "no installed server\version.json - this build predates versioning; use the full installer for this hop." }
if (-not (Test-Path $envFile))          { Fail "no aurora.env at $envFile." }
$installed = Read-Json $installedVerFile
$package   = Read-Json $pkgVerFile
$envLines  = @(Get-Content $envFile)
$dbUrl     = Env-Value $envLines 'DATABASE_URL'
$srvPort   = Env-Value $envLines 'PORT'; if (-not $srvPort) { $srvPort = '8080' }
if (-not $dbUrl) { Fail "DATABASE_URL is not set in aurora.env - cannot read the live migration head." }

# the DB's applied migration head, read live via the bundled psql
$psql = Join-Path $pgbin 'psql.exe'
if (-not (Test-Path $psql)) { Fail "bundled psql not found at $psql." }
$dbHead = (& $psql $dbUrl -tAc 'SELECT "MigrationId" FROM "__EFMigrationsHistory" ORDER BY "MigrationId" DESC LIMIT 1').Trim()
if (-not $dbHead) { Fail "could not read the live migration head from the database." }
Say "installed $($installed.version) (migrationHead $($installed.migrationHead)) - package $($package.version) (migrationHead $($package.migrationHead)) - DB head $dbHead"

# ---- 3. version-skew guard (pure) - refuse-and-exit-0-change on any skew ----
$skew = Test-VersionSkew -Installed $installed -Package $package -DbHead $dbHead -AllowMajor:$AllowMajor
if (-not $skew.ok) { Say "NO UPDATE APPLIED - $($skew.reason)"; exit 0 }
$migrationWillRun = $skew.migrationWillRun
Say "update $($installed.version) -> $($package.version) accepted (migrationWillRun=$migrationWillRun)"

# ---- 3b. SKIPPED-RELEASE handling (sec 2.4a). A hospital may sit out releases;
#          the guard allows the hop and EF applies every intervening migration in
#          order in ONE boot. Two consequences the operator must not meet blind. ----
$DefaultHealthTimeoutSec = 120    # keep in sync with the -HealthTimeoutSec param default
$SkipHealthTimeoutSec    = 600
$isSkip = Test-VersionSkipHop -InstalledVersion $installed.version -PackageVersion $package.version
if ($isSkip) {
  Say "SKIPPED RELEASES: $($installed.version) -> $($package.version) is not the next release - every intervening migration applies in ONE boot."
  # Migrations run BEFORE the server answers /healthz (Seeder.SeedAll precedes
  # app.Run()), so the health window is really the schema-work window. At the
  # 120s default a slow-but-SUCCEEDING multi-release migration is indistinguishable
  # from a hang, and the updater would stop the service mid-migration and restore
  # the snapshot - failing an update that was actually working.
  if ($PSBoundParameters.ContainsKey('HealthTimeoutSec')) {
    Say "  health timeout left at the explicitly requested ${HealthTimeoutSec}s (an explicit -HealthTimeoutSec always wins)."
  } else {
    $HealthTimeoutSec = $SkipHealthTimeoutSec
    Say "  health timeout raised automatically ${DefaultHealthTimeoutSec}s -> ${HealthTimeoutSec}s for this hop. Override with -HealthTimeoutSec."
  }
}

# ---- 3c. CONFIG-KEY DRIFT (sec 2.4a). aurora.env is carried across UNCHANGED at
#          step 6 - the updater never adds keys - so a key introduced by a release
#          this hospital skipped is simply absent. WARN, never refuse: the server
#          has fallbacks for some keys, and an install predating a key is exactly
#          the machine that most needs the update. A key that really is required
#          fails the health check and rolls back safely. ----
$requiredKeys = @()
$missingKeys  = @()      # stays empty when the package predates the check (recorded in update-state.json)
if (($package.PSObject.Properties.Name -contains 'requiredEnvKeys') -and $package.requiredEnvKeys) {
  $requiredKeys = @($package.requiredEnvKeys)
}
if ($requiredKeys.Count -eq 0) {
  Say "config keys: the package declares no requiredEnvKeys (a build predating this check) - drift NOT checked."
} else {
  $missingKeys = Get-MissingEnvKeys -EnvLines $envLines -RequiredKeys $requiredKeys
  if ($missingKeys.Count -gt 0) {
    Say "WARNING - aurora.env is missing $($missingKeys.Count) key(s) this build expects: $($missingKeys -join ', ')"
    Say "  The updater carries aurora.env across UNCHANGED and never adds keys."
    if ($isSkip) { Say "  This is a SKIPPED-RELEASE hop, so a key introduced by a release you did not take is the likely cause." }
    Say "  If the new build requires one of these it will fail its health check and be rolled back automatically."
    Say "  To act now: add the key(s) to $envFile and re-run, or use the full installer for this hop."
  } else {
    Say "config keys: all $($requiredKeys.Count) expected key(s) present in aurora.env"
  }
}

# record the pre-update facts (crash-diagnosable) + audit
@{ phase='start'; installedVersion=$installed.version; packageVersion=$package.version
   dbHead=$dbHead; packageMigrationHead=$package.migrationHead; migrationWillRun=$migrationWillRun
   skippedReleaseHop=$isSkip; healthTimeoutSec=$HealthTimeoutSec
   missingEnvKeys=@($missingKeys)
   at=(Get-Date).ToUniversalTime().ToString('s') } | ConvertTo-Json | Set-Content -Encoding ascii $stateFile
try { & $exe audit app-update start --actor update | Out-Null } catch { }

# ---- 4. take the restore point (the SAME born-restore-verified backup engine) ----
Say "taking a born-verified database backup as the restore point..."
$backupOut = & $exe backup --actor update 2>&1
$backupOut | ForEach-Object { Say "  $_" }
if ($LASTEXITCODE -ne 0) { Fail "the pre-update backup FAILED - no restore point, no update. Nothing has changed." }
$backupFile = ([regex]::Match(($backupOut -join "`n"), 'BACKUP OK:\s*(\S+)').Groups[1].Value)
if (-not $backupFile) { Fail "could not determine the backup filename from the backup output - aborting before any change." }
Say "restore point = $backupFile"

# ---- 5. stop AuroraServer (Postgres + AuroraAI stay up) - the DB is now quiescent ----
Say "stopping AuroraServer (clinicians briefly offline)..."
Stop-Service AuroraServer -Force

# ---- 6. swap the binaries; carry aurora.env across UNCHANGED ----
try {
  if (Test-Path $serverPrev) { Remove-Item -Recurse -Force $serverPrev }
  Move-Item $server $serverPrev                                   # keep the known-good old build
  New-Item -ItemType Directory -Force -Path $server | Out-Null
  Copy-Item -Recurse -Force (Join-Path $pkgServer '*') $server    # lay the new payload
  Copy-Item -Force (Join-Path $serverPrev 'aurora.env') $envFile  # the machine config + secrets, verbatim
  & icacls.exe $envFile /inheritance:r /grant:r 'SYSTEM:F' 'Administrators:F' 2>$null | Out-Null
} catch {
  Fail "the binary swap failed ($($_.Exception.Message)). The old build is at $serverPrev; restore it with 'Move-Item `"$serverPrev`" `"$server`"' and 'sc start AuroraServer'."
}

# ---- 7. start + verify: healthy AND actually the new build (sec CI-evidence rule) ----
Say "starting AuroraServer (applying any database updates)..."
Start-Service AuroraServer
$healthy = $false
for ($i = 0; $i -lt [Math]::Ceiling($HealthTimeoutSec / 2); $i++) {
  try {
    $h = Invoke-RestMethod "http://127.0.0.1:$srvPort/healthz" -TimeoutSec 2
    if ($h.status -eq 'ok' -and $h.build -eq $package.commit) { $healthy = $true; break }
  } catch {}
  Start-Sleep 2
}

if ($healthy) {
  # ---- 8. success ----
  @{ phase='complete'; version=$package.version; at=(Get-Date).ToUniversalTime().ToString('s') } |
    ConvertTo-Json | Set-Content -Encoding ascii $stateFile
  try { & $exe audit app-update success --actor update | Out-Null } catch { }
  Say "UPDATE COMPLETE - Aurora is running version $($package.version). The previous build is kept at $serverPrev until the next successful update."
  exit 0
}

# ============================ ROLLBACK (sec 2.5) ============================
Say "the new build did not become healthy within ${HealthTimeoutSec}s - ROLLING BACK to $($installed.version)."
try {
  Stop-Service AuroraServer -Force -ErrorAction SilentlyContinue

  # restore the old binary (server.prev carries the old aurora.env too)
  if (Test-Path $serverPrev) {
    Remove-Item -Recurse -Force $server -ErrorAction SilentlyContinue
    Move-Item $serverPrev $server
  }

  # if the failed update advanced the schema, restore the pre-update snapshot too.
  # Use the PACKAGE binary for the restore (the OLD binary may predate the `restore`
  # verb); point it at the live aurora.env so it sees DATABASE_URL/BACKUP_*.
  if ($migrationWillRun) {
    Say "the update advanced the schema - restoring the pre-update database snapshot ($backupFile)..."
    $env:AURORA_ENV_FILE = $envFile
    & $pkgExe restore $backupFile --yes --actor update-rollback
    if ($LASTEXITCODE -ne 0) {
      throw "the database restore reported failure"
    }
  }

  Start-Service AuroraServer
  $back = $false
  for ($i = 0; $i -lt 60; $i++) {
    try { if ((Invoke-RestMethod "http://127.0.0.1:$srvPort/healthz" -TimeoutSec 2).status -eq 'ok') { $back = $true; break } } catch {}
    Start-Sleep 2
  }
  if (-not $back) { throw "AuroraServer did not come back healthy on the old build" }

  @{ phase='rolled-back'; version=$installed.version; at=(Get-Date).ToUniversalTime().ToString('s') } |
    ConvertTo-Json | Set-Content -Encoding ascii $stateFile
  try { & $exe audit app-update rolled-back --actor update | Out-Null } catch { }
  Fail "UPDATE FAILED - the system was rolled back to $($installed.version) and is running normally. The failed package was not applied."
}
catch {
  # the nightmare case, made recoverable: everything needed to return by hand is on disk.
  $msg = @"
CRITICAL: the automatic rollback could not complete ($($_.Exception.Message)).
The system may be between states. RECOVER MANUALLY - everything you need is on disk:

  1. The known-good OLD build is at:
       $serverPrev   (or already moved back to $server)
     Ensure it is at ${server} -  Move-Item "$serverPrev" "$server"   (skip if $server already holds it)

  2. The verified pre-update DATABASE backup is:
       $backupFile   (in the BACKUP_DIR from aurora.env)
     Restore it with the packaged engine:
       set AURORA_ENV_FILE=$envFile
       "$pkgExe" restore $backupFile --yes --actor manual-recovery

  3. Start the service:  sc start AuroraServer

Both the old binary and a born-verified pre-update backup remain intact - you can
always return to exactly the pre-update state. See installer/UPDATE_AND_ENABLE_AI_DESIGN.md sec 2.5.
"@
  Write-Host $msg
  try { Add-Content -Path (Join-Path $InstallDir 'update.log') -Value ((Get-Date).ToString('s') + " ROLLBACK-FAILED`n" + $msg) } catch { }
  try { & $pkgExe audit app-update rollback-failed --actor update | Out-Null } catch { }
  exit 2
}
