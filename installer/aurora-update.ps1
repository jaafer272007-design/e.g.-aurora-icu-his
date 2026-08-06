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
      [-InstallDir C:\Aurora] [-FallbackInstallDir C:\Aurora] [-AllowMajor] [-HealthTimeoutSec 120]

    -InstallDir is a SUPERVISED OVERRIDE - pass it only when you mean "use exactly
    this directory, do not ask the service". -FallbackInstallDir is what the wizard
    passes: a guess used ONLY when the AuroraServer service cannot be read. See the
    resolution block below for why the two must be different parameters.

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
  # SUPERVISED OVERRIDE ONLY. Passing this suppresses the service lookup entirely.
  # aurora-update.iss must NOT pass it - see $FallbackInstallDir.
  [string]$InstallDir = '',
  # The wizard's guess ({app}). Used ONLY when the service cannot be read. Until
  # 2026-08-06 aurora-update.iss passed its guess as -InstallDir, which made the
  # service lookup below unreachable in the ONLY path that ships: every install
  # not at C:\Aurora was refused at the version.json preflight, and update.log was
  # written into the guessed directory rather than the real one. Two parameters,
  # because "the operator insisted" and "nobody asked, here is a default" are
  # different facts and only one of them may outrank the service.
  [string]$FallbackInstallDir = 'C:\Aurora',
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
# ---- install-directory resolution ORDER (pure; the CIM lookup is separate) -----
# Kept pure and unit-tested precisely because the previous version of this rule
# was WRONG IN THE ONLY PATH THAT SHIPS and nothing noticed. Three candidates,
# strictly ranked:
#   1. Explicit  - an operator ran the .ps1 by hand and named a directory. They
#                  outrank everything, including the service (that is what a
#                  supervised override means).
#   2. Service   - the registered AuroraServer's ImagePath. This is the ONLY
#                  authoritative source: it is what Windows actually starts.
#   3. Fallback  - the wizard's {app}, which is just DefaultDirName unless the
#                  operator was shown a folder page. A guess, used last.
function Select-AuroraInstallDir {
  param(
    [AllowEmptyString()][string]$Explicit,
    [AllowEmptyString()][string]$FromService,
    [AllowEmptyString()][string]$Fallback
  )
  if ($Explicit)    { return $Explicit }
  if ($FromService) { return $FromService }
  return $Fallback
}

# Collapse an arbitrary captured value (file text, native output, $null) into ONE
# trimmed single-line string, safely.
#
# PowerShell's -replace operator DOES NOT return '' for a $null left-hand side -
# it returns an EMPTY System.Object[]. Calling .Trim() on that throws
#   "Method invocation failed because [System.Object[]] does not contain a
#    method named 'Trim'."
# which under $ErrorActionPreference='Stop' kills the script outright.
#
# This shipped, and it broke the HAPPY PATH. aurora-update.ps1 formatted psql's
# stderr with ((Get-Content -Raw $headErr) -replace '\s+',' ').Trim(). When psql
# SUCCEEDS it writes nothing, so the redirection leaves a ZERO-BYTE file,
# Get-Content -Raw returns $null, and the update died at the exact moment
# everything had gone right - reported to the operator as exit 1, "the update was
# NOT applied". No update could ever complete. Found 2026-08-06 on the first real
# field run that got past package verification; reproduced and measured before
# this fix, on a 0-byte file, in a real PowerShell.
#
# The [string] cast is the whole fix: [string]$null is '', and '' -replace ...
# is a String. PURE - unit-tested in installer\test-update-pure.ps1.
function ConvertTo-SingleLine {
  param([Parameter(Mandatory)][AllowNull()][AllowEmptyString()][AllowEmptyCollection()]$Value)
  if ($Value -is [array]) { $Value = ($Value -join ' ') }
  return (([string]$Value) -replace '\s+', ' ').Trim()
}

# ---- failure reporting + EXIT CODES -------------------------------------------
# These live ABOVE the pure-test boundary so installer\test-update-exitcodes.ps1
# can dot-source THE REAL DEFINITIONS and invoke them in a real process. They
# were previously below it, which is why nothing caught the defect described
# next: the only tests that existed could not reach them.
#
# aurora-update.iss maps these codes to what the operator is told, so each must
# mean exactly one thing:
#   0 = APPLIED. Nothing else may exit 0 - the wizard treats 0 as proof of
#       success and says so on its finished page. A refusal is 1, never 0.
#   1 = REFUSED before anything changed - the system is untouched
#   2 = between states - manual recovery needed
#   3 = failed, and successfully rolled back - the system is healthy on the old build
#
# -ErrorAction Continue IS LOAD-BEARING. The live script sets
# $ErrorActionPreference = 'Stop', under which a bare Write-Error raises a
# TERMINATING error - so `Stop-Log; exit N` never ran and PowerShell exited 1
# for EVERY failure. Codes 2 and 3 were unreachable, and the wizard therefore
# showed the rc=1 text ("NOT applied ... Nothing needs to be recovered") even
# for a swap that died with the service stopped. Worse, FailRolledBack is called
# from INSIDE the rollback try{} (see the ROLLBACK section): its terminating
# error was caught by that block's catch{}, so a SUCCESSFUL rollback reported
# "CRITICAL: the automatic rollback could not complete" and exited 2, pushing an
# operator toward a database restore on a healthy system. Measured, not
# theorised - both directions reproduced in a real PowerShell before this fix.
# `exit` is not an exception, so it passes through that catch{} untouched.
#
# Write-Error (not [Console]::Error.WriteLine) because Start-Transcript captures
# error records but NOT direct console writes, and update.log is the file the
# wizard tells the operator to read.
$script:TranscriptOn = $false
function Stop-Log { if ($script:TranscriptOn) { try { Stop-Transcript | Out-Null } catch { } } }
function Say([string]$m)  { Write-Host "[aurora-update] $m" }
function Fail([string]$m)              { Write-Error "[aurora-update] $m" -ErrorAction Continue; Stop-Log; exit 1 }
function FailBetweenStates([string]$m) { Write-Error "[aurora-update] $m" -ErrorAction Continue; Stop-Log; exit 2 }
function FailRolledBack([string]$m)    { Write-Error "[aurora-update] $m" -ErrorAction Continue; Stop-Log; exit 3 }
# ========================== END PURE, UNIT-TESTED CORE =========================

# The Windows-only orchestration runs only when NOT dot-sourced for tests. A test
# harness dot-sources this file to exercise the pure functions above; it sets
# $AuroraUpdatePureTest first so the live update below does not execute.
if ($AuroraUpdatePureTest) { return }

$ErrorActionPreference = 'Stop'

# ---- where Aurora ACTUALLY lives ----------------------------------------------
# Resolved BEFORE the transcript starts, because update.log must be written into
# the REAL install directory - not into the wizard's guess. Until 2026-08-06 the
# order was reversed and a machine installed at D:\Aurora wrote its log to
# C:\Aurora\update.log (which on the owner's box was a git working tree).
#
# Never trust a wizard page for this. The registered AuroraServer service knows
# the real path; a folder picker only knows what someone clicked. aurora-update.iss
# passes its guess as -FallbackInstallDir; it must NEVER pass -InstallDir, which
# is reserved for a human running this script deliberately.
function Get-AuroraInstallDirFromService {
  try {
    $svc = Get-CimInstance Win32_Service -Filter "Name='AuroraServer'" -ErrorAction Stop
    if (-not $svc) { return '' }
    $cmd = [string]$svc.PathName
    if (-not $cmd) { return '' }
    $cmd = $cmd.Trim()
    if ($cmd.StartsWith('"')) { $exePath = ($cmd -split '"')[1] } else { $exePath = ($cmd -split '\s+')[0] }
    if (-not $exePath) { return '' }
    $srvDir = Split-Path -Parent $exePath          # ...\Aurora\server
    if (-not $srvDir) { return '' }
    return (Split-Path -Parent $srvDir)            # ...\Aurora
  } catch { return '' }
}
$fromSvc = ''
if (-not $InstallDir) {
  $cand = Get-AuroraInstallDirFromService
  # only believe the service if the directory it names actually looks installed
  if ($cand -and (Test-Path (Join-Path $cand 'server\version.json'))) { $fromSvc = $cand }
}
$resolvedFrom = 'the -FallbackInstallDir the wizard supplied'
if ($InstallDir)     { $resolvedFrom = 'an explicit -InstallDir (supervised override)' }
elseif ($fromSvc)    { $resolvedFrom = 'the registered AuroraServer service' }
$InstallDir = Select-AuroraInstallDir -Explicit $InstallDir -FromService $fromSvc -Fallback $FallbackInstallDir

# ---- the transcript. Without this NOTHING is diagnosable. ----------------------
# aurora-update.iss runs us via Exec(..., SW_HIDE): the console is invisible and
# is destroyed when we exit. Until 2026-08-05 every Say/Fail went ONLY to that
# console, so a failed update at a hospital left no trace at all - and the
# dialog told the operator to read installer\update.log, a file that was only
# ever written on the rollback-FAILED path. Two real field failures were
# undiagnosable because of it. aurora-provision.ps1:99 has always done this
# correctly; the updater simply never got the same treatment.
# Prefer the install directory; fall back to TEMP so a wrong directory still
# leaves evidence somewhere rather than nowhere.
$script:LogPath = ''
foreach ($cand in @($InstallDir, $env:TEMP)) {
  if ($script:TranscriptOn) { break }
  if ($cand -and (Test-Path $cand)) {
    try {
      $script:LogPath = Join-Path $cand 'update.log'
      Start-Transcript -Path $script:LogPath -Append -Force | Out-Null
      $script:TranscriptOn = $true
    } catch { $script:LogPath = '' }
  }
}
# Tell the wizard where the log ACTUALLY is. Its [Code] cannot know: {app} is
# only DefaultDirName. Same relay pattern aurora.iss uses for {tmp}\aurora-url.txt.
# Written beside the extracted package, i.e. Inno's {tmp}.
if ($script:LogPath) {
  try { Set-Content -Encoding ascii -Path (Join-Path (Split-Path -Parent $PackageDir) 'aurora-update-log.txt') -Value $script:LogPath } catch { }
}

Say "updating the Aurora install at: $InstallDir (resolved from $resolvedFrom)"

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

# The DB's applied migration head, read live via the bundled psql.
#
# EVERY detail of this invocation is load-bearing. The original one-liner
#   & $psql $dbUrl -tAc 'SELECT "MigrationId" FROM "__EFMigrationsHistory" ...'
# HUNG THE UPDATER FOREVER on a real Windows box (found 2026-08-05, first
# field run), for two INDEPENDENT reasons:
#
#  1. ARGUMENT ORDER. psql's Windows getopt does NOT permute: the first
#     non-option argument ends option parsing. With the connection URI first,
#     -tAc and the SQL were treated as POSITIONAL arguments - psql printed
#     "extra command-line argument ... ignored", never saw a -c, and started
#     an INTERACTIVE SESSION. aurora-update.iss runs us via Exec(..., SW_HIDE),
#     so that "aurora=>" prompt is invisible and unanswerable: psql waits on
#     stdin, PowerShell waits on psql, Inno waits on PowerShell. The installer
#     window could not even be closed. Options now come FIRST and the database
#     is passed with -d, matching aurora-provision.ps1:388 which had it right.
#
#  2. QUOTE MANGLING. Windows PowerShell strips embedded double quotes when
#     building a native command line, so "MigrationId" arrived as MigrationId.
#     Postgres folds unquoted identifiers to lower case while EF Core created
#     the table case-sensitively, so the query could never have matched even
#     if -c had been honoured. The SQL is therefore passed in a FILE (-f),
#     which no argument parser can corrupt.
#
#  3. -w (--no-password) so psql can NEVER block on a password prompt. A
#     process launched with a hidden console must not be able to wait on
#     stdin - that is the whole class of defect, not just this instance.
$psql = Join-Path $pgbin 'psql.exe'
if (-not (Test-Path $psql)) { Fail "bundled psql not found at $psql." }
$headSql = Join-Path $env:TEMP ('aurora-dbhead-' + [Guid]::NewGuid().ToString('N') + '.sql')
$headErr = Join-Path $env:TEMP ('aurora-dbhead-' + [Guid]::NewGuid().ToString('N') + '.err')
Set-Content -Encoding ascii -Path $headSql `
  -Value 'SELECT "MigrationId" FROM "__EFMigrationsHistory" ORDER BY "MigrationId" DESC LIMIT 1;'
$headRc = 1; $headOut = @(); $headErrText = ''
#  4. RELAX THE PREFERENCE around the call. This try{} has only a finally{} - no
#     catch - so a terminating NativeCommandError propagates straight out and
#     kills the script. psql writes NOTICE/WARNING lines to stderr on perfectly
#     SUCCESSFUL queries, and 5.1 turns any of them into exactly that (measured
#     twice in this repo: aurora-provision.ps1:544-547, aurora-ai-service.ps1:87-89
#     - and redirection, including the 2>$headErr below, is NOT the mitigation).
#     Without this a benign notice aborts the run with a raw PowerShell error
#     instead of the honest "could not read the live migration head" message.
$prevEapH = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
  $headOut = @(& $psql -w -t -A -v ON_ERROR_STOP=1 -d $dbUrl -f $headSql 2>$headErr)
  $headRc  = $LASTEXITCODE
  # ConvertTo-SingleLine, NOT an inline -replace + .Trim(). A SUCCESSFUL psql
  # writes nothing, so this file is ZERO BYTES, Get-Content -Raw returns $null,
  # and $null -replace returns an empty Object[] that has no .Trim(). See the
  # function's note - that inline form is what killed the first real field run.
  if (Test-Path $headErr) { $headErrText = ConvertTo-SingleLine (Get-Content -Raw $headErr) }
} finally {
  $ErrorActionPreference = $prevEapH
  Remove-Item -Force $headSql, $headErr -ErrorAction SilentlyContinue
}
if ($headRc -ne 0) {
  Fail "could not read the live migration head from the database (psql exit $headRc). $headErrText"
}
$dbHead = ''
foreach ($line in $headOut) {
  if ($null -ne $line -and $line.ToString().Trim()) { $dbHead = $line.ToString().Trim(); break }
}
if (-not $dbHead) { Fail "the database returned no migration head (is __EFMigrationsHistory empty?). $headErrText" }
Say "installed $($installed.version) (migrationHead $($installed.migrationHead)) - package $($package.version) (migrationHead $($package.migrationHead)) - DB head $dbHead"

# ---- 3. version-skew guard (pure) - refuse-and-exit-0-change on any skew ----
$skew = Test-VersionSkew -Installed $installed -Package $package -DbHead $dbHead -AllowMajor:$AllowMajor
# Fail (exit 1 - "REFUSED before anything changed"), NOT exit 0.
#
# Until 2026-08-06 a skew refusal exited 0. aurora-update.iss maps 0 to an EMPTY
# branch and then its finished page says "The Aurora update has been applied."
# So the one path whose entire purpose is to refuse - a downgrade, a re-run of a
# package already installed, a package behind the live schema, an unapproved
# cross-major hop - told the operator the opposite of what happened, and the
# refusal reason existed only in a log nobody was sent to. Exit 1 is not a
# demotion of this case; it is precisely what 1 already means, and it is true.
if (-not $skew.ok) { Fail "NO UPDATE APPLIED - $($skew.reason)" }
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
# Relax the preference around the native call - see the note on the rollback
# restore below. 2>&1 alone is NOT the mitigation; this repo measured that twice.
# Capture $LASTEXITCODE IMMEDIATELY: anything between the call and the test can
# overwrite it.
$prevEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$backupOut = & $exe backup --actor update 2>&1
$backupRc  = $LASTEXITCODE
$ErrorActionPreference = $prevEap
$backupOut | ForEach-Object { Say "  $_" }
if ($backupRc -ne 0) { Fail "the pre-update backup FAILED - no restore point, no update. Nothing has changed." }
$backupFile = ([regex]::Match(($backupOut -join "`n"), 'BACKUP OK:\s*(\S+)').Groups[1].Value)
if (-not $backupFile) { Fail "could not determine the backup filename from the backup output - aborting before any change." }
Say "restore point = $backupFile"

# ---- 5. stop AuroraServer (Postgres + AuroraAI stay up) - the DB is now quiescent ----
Say "stopping AuroraServer (clinicians briefly offline)..."
# Wrapped. Bare, this ran under $ErrorActionPreference='Stop' outside any try, so
# a service that would not stop killed the script with a RAW PowerShell error and
# PowerShell's own exit 1 - which the wizard renders as the tidy "the update was
# NOT applied ... nothing needs to be recovered". True here by luck, but stated by
# accident rather than by the code. Say it deliberately instead.
try { Stop-Service AuroraServer -Force }
catch { Fail "could not stop AuroraServer ($($_.Exception.Message)) - nothing has been changed and the binaries were not touched. The pre-update backup ($backupFile) is on disk." }

# ---- 6. swap the binaries; carry aurora.env across UNCHANGED ----
try {
  if (Test-Path $serverPrev) { Remove-Item -Recurse -Force $serverPrev }
  Move-Item $server $serverPrev                                   # keep the known-good old build
  New-Item -ItemType Directory -Force -Path $server | Out-Null
  Copy-Item -Recurse -Force (Join-Path $pkgServer '*') $server    # lay the new payload
  Copy-Item -Force (Join-Path $serverPrev 'aurora.env') $envFile  # the machine config + secrets, verbatim
  # NATIVE CALL INSIDE A try{} WHOSE catch{} REPORTS "between states". Relax the
  # preference: 5.1 turns a native command's stderr into a TERMINATING
  # NativeCommandError under EAP=Stop, and the 2>$null does NOT prevent it (this
  # repo measured exactly that twice - aurora-provision.ps1:544-547,
  # aurora-ai-service.ps1:87-89). Without this, one chatty-but-harmless icacls
  # line on a SUCCESSFUL swap lands in the catch below and the operator is shown
  # "CRITICAL: the update failed AND the automatic rollback could not complete",
  # which invites a database restore on a system that is perfectly fine.
  $prevEapI = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $aclOut = & icacls.exe $envFile /inheritance:r /grant:r 'SYSTEM:F' 'Administrators:F' 2>&1
  $aclRc  = $LASTEXITCODE
  $ErrorActionPreference = $prevEapI
  # Not fatal: the swap succeeded and aurora.env is already in place. Permission
  # hardening that did not take is a thing to SAY, not a reason to roll back a
  # working update - but it must never pass silently either.
  if ($aclRc -ne 0) {
    Say "WARNING - could not re-apply aurora.env permissions (icacls exit $aclRc): $(ConvertTo-SingleLine $aclOut)"
    Say "  aurora.env holds the database password and JWT secret. Check its ACL by hand after this update."
  }
} catch {
  FailBetweenStates "the binary swap failed ($($_.Exception.Message)). The old build is at $serverPrev; restore it with 'Move-Item `"$serverPrev`" `"$server`"' and 'sc start AuroraServer'."
}

# ---- 7. start + verify: healthy AND actually the new build (sec CI-evidence rule) ----
Say "starting AuroraServer (applying any database updates)..."
# THIS IS THE SEVERE ONE. Bare, under $ErrorActionPreference='Stop' and outside
# any try, a service that refuses to start killed the script with PowerShell's
# exit 1 - and 1 is the code the wizard renders as "the update was NOT applied,
# so Aurora is exactly as it was and is still running the previous version.
# Nothing needs to be recovered." At this point the binaries have ALREADY been
# swapped and the service is DOWN. That message is false in every clause, and it
# is shown for the single most likely real failure: a new build that will not run.
#
# A failed start is not a reason to abort - it is precisely the condition the
# rollback below exists for. Record it and fall through to the health loop, which
# will time out and roll back, giving the operator the honest exit 3.
try { Start-Service AuroraServer }
catch { Say "WARNING - Start-Service failed ($($_.Exception.Message)). Treating this as an unhealthy start; the health check below will time out and the rollback will run." }
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
  Stop-Log
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
    # RELAXING THE PREFERENCE IS THE MITIGATION - redirection is NOT.
    # Windows PowerShell 5.1 turns a NATIVE command's stderr into a TERMINATING
    # NativeCommandError under $ErrorActionPreference='Stop'. This repo has
    # measured TWICE, on real installs, that a redirection does not prevent it:
    # aurora-provision.ps1:544-547 ("2>&1 on a native command turns those stderr
    # lines into TERMINATING errors") and aurora-ai-service.ps1:87-89 ("`2>$null`
    # does NOT prevent that", found 2026-07-26). Both were closed by relaxing the
    # preference around the call, and so is this one.
    # It matters most HERE: this call sits inside the rollback try{}, whose
    # catch{} reports "CRITICAL: the automatic rollback could not complete".
    # pg_restore writes progress and benign warnings to stderr as a matter of
    # course, so without this a SUCCESSFUL restore is announced as a catastrophe
    # and an operator is pushed toward a database restore on a healthy system.
    # The exit code, not the chatter, decides whether this failed - captured
    # immediately, because anything in between can overwrite $LASTEXITCODE.
    $prevEapR = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $restoreOut = & $pkgExe restore $backupFile --yes --actor update-rollback 2>&1
    $restoreRc  = $LASTEXITCODE
    $ErrorActionPreference = $prevEapR
    $restoreOut | ForEach-Object { Say "  $_" }
    if ($restoreRc -ne 0) {
      throw "the database restore reported failure (exit $restoreRc)"
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
  FailRolledBack "UPDATE FAILED - the system was rolled back to $($installed.version) and is running normally. The failed package was not applied."
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
  Stop-Log
  exit 2
}
