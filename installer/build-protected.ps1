<#
  AURORA ICU - the PROTECTED installer build (single company password).

  THE CONFIGURED SHIPPING PATH (owner's decision, 2026-07-25, superseding the
  per-hospital scheme as the default): ONE company install password, held by
  the vendor's engineer ALONE. The engineer types it at every hospital
  install in person; the hospital never receives it, stores it, or records
  it. Recovery/reinstall therefore always happens with the vendor present -
  that is the service model, accepted explicitly. The per-hospital machinery
  (build-hospitals.ps1) stays in the tree DORMANT for a future at-scale
  switch.

  HOW THE PASSWORD ENTERS THE BUILD - and where it never goes:
    - You type it at a MASKED interactive prompt, twice. It is never a
      command-line argument (so it cannot land in PSReadLine's history file
      or your console scrollback) and this script never writes it to disk -
      no ledger, no temp file, nothing to delete afterwards.
    - It reaches the Inno compiler through the ISCC child process's
      ENVIRONMENT (aurora.iss reads GetEnv at preprocess time), not through
      /D arguments - so it is absent from the ISCC command line too. The
      variable is set immediately before ISCC and removed in a finally
      block.
    - Honest limits: the password exists in this PowerShell process's
      memory and in ISCC's environment while the compile runs; anyone who
      can debug your build machine's processes can read it. Build on a
      machine you trust.

  WHAT THE PASSWORD DOES (same cryptography as the per-hospital path):
  Inno Setup 6.4+ Encryption=yes - the whole payload is XChaCha20-encrypted
  with a key PBKDF2-HMAC-SHA256-derived from the password. A copied
  installer without the password cannot be installed and its payload
  (server, database engine, AI model, scripts) cannot be extracted. Honest
  limit: setup METADATA (names, paths, messages, the compiled [Code]
  wizard) is not encrypted - only the file data is. And: one company-wide
  password means a single leak burns EVERY shipped installer at once with
  no way to tell whose copy leaked - accepted because the password never
  leaves the vendor's head, so the leak surface is the vendor, not N
  hospitals.

  OUTPUT NAMING - protection state is IN the filename, by construction:
    AuroraSetup-<ver>-PROTECTED.exe    <- this script (password required)
    AuroraSetup-<ver>-UNPROTECTED.exe  <- plain build.ps1/build-all.ps1
                                          (smoke tests only - never ships)
  This script FAILS if the compile did not produce the -PROTECTED name, so
  a build where the password silently failed to reach the compiler cannot
  masquerade as protected.

  UPDATE PACKAGES TOO (owner's ruling, 2026-07-25): AuroraUpdate-<ver>.exe
  carries the newest server binaries, so it is locked with the SAME company
  password by the SAME machinery - an unprotected update exe would defeat
  the point of protecting the installer. Under the engineer-present service
  model the engineer runs updates anyway, so there is no operational cost.

  USAGE (Windows build machine, after the usual build inputs exist):

    # the full hospital installer -> AuroraSetup-<ver>-PROTECTED.exe
    powershell -ExecutionPolicy Bypass -File .\installer\build-protected.ps1 `
      -PgZip C:\aurora-build\postgresql-16.4-1-windows-x64-binaries.zip `
      -ModelDir C:\aurora-ai\model -LlamaDir C:\aurora-ai\llama

    # the app-only update package -> AuroraUpdate-<ver>-PROTECTED.exe
    # (no -PgZip/-ModelDir/-LlamaDir needed - server payload only)
    ... -UpdateOnly ...

    # payload already staged today (skip the slow staging steps):
    ... -SkipStage ...

    # re-cut the release you last shipped WITHOUT a version change (a
    # corrupted burn, a re-slice) - deliberate, recorded, never silent:
    ... -RebuildVersion -RebuildReason "re-slice after a bad USB write" ...

    # write the (multi-GB, sliced) artifact to another drive when the build
    # drive is tight - the staged payload stays where it is:
    ... -OutputDir E:\aurora-out ...

  WINDOWS-ONLY (ISCC). CODE-REVIEWED here; verify on the build machine.
#>
[CmdletBinding()]
param(
  [string]$PgZip = '',          # required for the full installer; unused with -UpdateOnly
  [string]$ModelDir = '',
  [string]$LlamaDir = '',
  [switch]$UpdateOnly,          # build the ENCRYPTED app-only update package instead of the full installer
  [string]$Iscc = 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe',
  [switch]$SkipStage,           # the payload is already staged (a previous run of this or build.ps1)
  [string]$OutputDir = '',      # write the artifact somewhere other than installer\Output (another drive
                                # when the build drive is tight - the AI build emits ~5.5 GB of slices)
  [switch]$RebuildVersion,      # re-cut the release you last shipped WITHOUT bumping AppVer
  [string]$RebuildReason = ''   # required with -RebuildVersion; recorded in the ledger
)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
function Say([string]$m) { Write-Host "[build-protected] $m" -ForegroundColor Cyan }
function Die([string]$m) { Write-Host "[build-protected] $m" -ForegroundColor Red; exit 1 }
if (-not $UpdateOnly -and -not $PgZip) {
  Die '-PgZip is required for the full installer build (it is only optional with -UpdateOnly)'
}
if ($RebuildVersion -and -not $RebuildReason) {
  Die '-RebuildVersion requires -RebuildReason "<why>" - a same-version re-cut is recorded, never silent'
}
if ($RebuildReason -and -not $RebuildVersion) {
  Die '-RebuildReason only means something with -RebuildVersion'
}

# ---- 0. THE VERSION GATE - before the password, before the 20-60 min compile ----
# A release built at a version that already shipped is not a small mistake: every
# hospital already running that version REFUSES the package (aurora-update.ps1's
# "not newer than installed" skew refusal), so the new code ships and never runs,
# and nothing anywhere says so. The ledger turns that silent field failure into a
# loud build failure. See installer\version-gate.ps1 and SHIPPED_VERSIONS.txt.
. (Join-Path $here 'version-gate.ps1')
$ledgerPath = Join-Path $here 'SHIPPED_VERSIONS.txt'
if (-not (Test-Path $ledgerPath)) {
  Die "the shipped-version ledger is missing: $ledgerPath (it is committed to the repo - restore it rather than building blind)"
}
$appVer = ([regex]::Match((Get-Content -Raw (Join-Path $here 'aurora.iss')),
  '#define\s+AppVer\s+"([^"]+)"').Groups[1].Value)
if (-not $appVer) { Die 'could not read AppVer from aurora.iss' }
$artifactKind = 'setup'
if ($UpdateOnly) { $artifactKind = 'update' }

$ledgerEntries = Read-ShippedLedger -Lines (Get-Content -Path $ledgerPath)
$ledgerProblems = Test-ShippedLedger -Entries $ledgerEntries
if ($ledgerProblems.Count -gt 0) {
  foreach ($lp in $ledgerProblems) { Write-Host "  $lp" -ForegroundColor Red }
  Die "$ledgerPath is not valid - fix it before building (CI checks the same rules)"
}
$gate = Test-ReleaseVersionGate -Entries $ledgerEntries -Kind $artifactKind -Version $appVer -Rebuild:$RebuildVersion
if (-not $gate.ok) {
  Write-Host ''
  Write-Host '  REFUSED - VERSION GATE' -ForegroundColor Red
  Write-Host "  $($gate.reason)" -ForegroundColor Red
  Write-Host ''
  Die 'nothing was compiled'
}
Say "version gate: $($gate.reason)"

# ---- 0b. THE SHIP GATE - what Aurora ships must be what Aurora verified ----
# The version gate above answers "may this VERSION be cut?"; this gate
# answers "has this exact CONTENT been verified?" - commit on origin/main
# with a clean tree, ci.yml green for that commit (by workflow identity,
# every required job), staging serving that content NOW, and every deployed
# suite in the drift-checked inventory green ON that content. Any failure -
# including verification being unavailable (offline, GitHub API down,
# staging suspended) - is a refusal, never a warning, and it happens HERE:
# before the password is typed, before the 20-60 min compile. There is no
# skip switch; the UNPROTECTED smoke build (build.ps1) is the dev/test
# packaging mode and is structurally non-shippable by filename.
# See installer\ship-gate.ps1 and scripts\ship-requirements.json.
. (Join-Path $here 'ship-gate.ps1')
$shipVerdict = Invoke-ShipGate -RepoRoot (Split-Path -Parent $here) `
  -RequirementsPath (Join-Path (Split-Path -Parent $here) 'scripts\ship-requirements.json')
if (-not $shipVerdict.ok) {
  Write-Host ''
  Write-Host "  REFUSED - SHIP GATE [$($shipVerdict.class)]" -ForegroundColor Red
  Write-Host "  $($shipVerdict.reason)" -ForegroundColor Red
  Write-Host ''
  Die 'nothing was compiled and no password was requested'
}
Say "ship gate: authorized commit $($shipVerdict.sha) - $($shipVerdict.reason)"

# ---- 1. the company password, typed blind, twice ----
# SecureString only shields the CONSOLE (no echo); the value is then held as
# a plain .NET string because ISCC needs it in its environment. That is the
# honest trade - see the header.
function Read-Masked([string]$prompt) {
  $sec = Read-Host -AsSecureString $prompt
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
$pw  = Read-Masked 'Company install password (typed blind; never stored anywhere)'
$pw2 = Read-Masked 'Type it again to confirm'
if ($pw -cne $pw2) { Die 'the two entries do not match - run again' }
# Same conservative rule as the per-hospital path: letters, digits and
# dashes, 12-64 chars. It rules out every character that could misbehave in
# the Password= directive after ISPP expansion, and it is the exact charset
# already proven on this pipeline.
if ($pw -notmatch '^[A-Za-z0-9-]{12,64}$') {
  Die 'the password must be 12-64 characters using only letters, digits and dashes (this exact rule is what the encrypted-build pipeline is verified with)'
}

# ---- 2. stage the payload ----
#   full build:  React bundle, server publish, pgsql, model (build.ps1 steps 1-4)
#   -UpdateOnly: React bundle, server publish, SHA256SUMS + manifest (steps 1-3u)
if (-not $SkipStage) {
  if ($UpdateOnly) {
    & (Join-Path $here 'build.ps1') -UpdateOnly -SkipCompile -Iscc $Iscc
  } else {
    $buildArgs = @{ PgZip = $PgZip; Iscc = $Iscc; SkipCompile = $true }
    if ($ModelDir) { $buildArgs.ModelDir = $ModelDir }
    if ($LlamaDir) { $buildArgs.LlamaDir = $LlamaDir }
    & (Join-Path $here 'build.ps1') @buildArgs
  }
} else {
  Say 'payload staging SKIPPED (-SkipStage)'
}
if ($UpdateOnly) {
  if (-not (Test-Path (Join-Path $here 'payload\SHA256SUMS'))) {
    Die 'the update payload is not staged - run once without -SkipStage first'
  }
} elseif (-not (Test-Path (Join-Path $here 'payload\server\AuroraIcu.Api.exe'))) {
  Die 'the payload is not staged - run once without -SkipStage first'
}
if (-not (Test-Path $Iscc)) { Die "Inno Setup compiler not found at $Iscc (install Inno Setup 6, or pass -Iscc)" }

# Where the artifact lands. Default installer\Output; -OutputDir sends it to
# another drive (the AI build emits ~5.5 GB of slices, which does not fit on a
# tight build drive next to the ~6 GB staged payload). ISCC's /O switch
# overrides the .iss OutputDir; the verification below looks in the same place,
# so a redirected build is still proven to be the PROTECTED one.
$outDir = if ($OutputDir) { $OutputDir } else { Join-Path $here 'Output' }
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }
$outDir = (Resolve-Path $outDir).Path
$isccOut = @()
if ($OutputDir) { $isccOut = @("/O$outDir"); Say "artifact output redirected to $outDir" }

# ---- 3. compile the ENCRYPTED artifact (password via ISCC's environment) ----
$started = Get-Date
$env:AURORA_INSTALL_PASSWORD = $pw
try {
  if ($UpdateOnly) {
    # aurora-update.iss expects /DAppVer; the single source of the version is
    # aurora.iss (the same read build.ps1 does for version.json, and the same
    # value the version gate above already checked)
    Say "compiling the PROTECTED update package AuroraUpdate-$appVer-PROTECTED.exe"
    & $Iscc "/DAppVer=$appVer" @isccOut (Join-Path $here 'aurora-update.iss')
  } else {
    Say 'compiling the PROTECTED installer (full LZMA2 pass - 20-60 min on an AI build)'
    & $Iscc @isccOut (Join-Path $here 'aurora.iss')
  }
  if ($LASTEXITCODE -ne 0) { Die 'ISCC failed (see the compiler output above)' }
} finally {
  Remove-Item Env:\AURORA_INSTALL_PASSWORD -ErrorAction SilentlyContinue
}

# ---- 4. prove the output really is the protected build ----
$wantFilter = if ($UpdateOnly) { 'AuroraUpdate-*-PROTECTED.exe' } else { 'AuroraSetup-*-PROTECTED.exe' }
$exe = Get-ChildItem $outDir -Filter $wantFilter -ErrorAction SilentlyContinue |
       Where-Object { $_.LastWriteTime -ge $started } | Sort-Object LastWriteTime | Select-Object -Last 1
if (-not $exe) {
  Die "ISCC succeeded but produced no fresh $wantFilter in $outDir - the password did NOT reach the compiler (is the .iss current?). Whatever it built is NOT protected; do not ship it."
}
$sha = (Get-FileHash -Algorithm SHA256 -Path $exe.FullName).Hash.ToLowerInvariant()

# ---- 4b. record the shipped version (the other half of the gate) ----
# Appended only after a PROVEN protected artifact exists, so a failed compile
# never burns a version number. The operator must COMMIT this - the build
# cannot, and says so loudly below.
$commitShort = '-'
try {
  $c = (& git -C $here rev-parse --short HEAD 2>$null)
  if ($LASTEXITCODE -eq 0 -and $c) { $commitShort = ($c | Select-Object -First 1).Trim() }
} catch { $commitShort = '-' }
$ledgerFlag = 'new'
$ledgerNote = "sha256 $($sha.Substring(0,16))"
if ($RebuildVersion) {
  $ledgerFlag = 'rebuild'
  $ledgerNote = "$ledgerNote - rebuild: $RebuildReason"
}
$ledgerLine = New-ShippedLedgerLine -Version $appVer -Kind $artifactKind -Flag $ledgerFlag `
  -Utc ((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')) `
  -Commit $commitShort -Note $ledgerNote
Add-Content -Path $ledgerPath -Value $ledgerLine -Encoding ascii
# The full installer is SLICED (DiskSpanning) - the .bin files beside the .exe
# are part of the artifact and must ship with it. List them so the operator
# cannot mistake the .exe for the whole thing.
$slices = Get-ChildItem $outDir -Filter ([IO.Path]::GetFileNameWithoutExtension($exe.Name) + '-*.bin') -ErrorAction SilentlyContinue |
          Where-Object { $_.LastWriteTime -ge $started } | Sort-Object Name
Say '----------------------------------------------------------------------'
Say ("DONE  ->  {0}   ({1} GB)" -f $exe.FullName, [math]::Round($exe.Length / 1GB, 2))
Say "sha256: $sha"
if ($slices) {
  $totalGb = [math]::Round((($slices | Measure-Object -Property Length -Sum).Sum + $exe.Length) / 1GB, 2)
  Say "SLICED build - ship these $($slices.Count) file(s) WITH the .exe (total $totalGb GB):"
  foreach ($s in $slices) { Say ("  {0}   ({1} GB)" -f $s.Name, [math]::Round($s.Length / 1GB, 2)) }
  Say 'The .exe alone will NOT install. Keep every file together in one folder.'
}
Say ''
Say "RECORDED  $artifactKind $appVer -> $ledgerPath"
Say "          $ledgerLine"
Say 'COMMIT THAT LINE. It is what stops the next release being built at the same'
Say 'version - and a release built at an already-shipped version is refused by'
Say 'every hospital silently: the update reports "already up to date" and the new'
Say 'code never runs. The build cannot commit for you.'
Say '    git add installer\SHIPPED_VERSIONS.txt'
Say ("    git commit -m " + [char]34 + "release: $artifactKind $appVer" + [char]34)
Say ''
Say 'The install password was NOT written anywhere by this build - it exists'
Say 'only where you keep it. The hospital never receives it: the engineer'
Say 'types it on site at every install and update. Without it this file'
Say 'cannot be run and its payload cannot be extracted.'
Say '----------------------------------------------------------------------'
exit 0
