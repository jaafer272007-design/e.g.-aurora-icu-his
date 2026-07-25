<#
  AURORA ICU - per-hospital ENCRYPTED installer builds.

  *** DORMANT (owner's decision, 2026-07-25). The configured shipping path
  is build-protected.ps1: ONE company install password, held by the
  vendor's engineer alone and typed on site at every install - the hospital
  never receives it, and reinstalls happen with the vendor present. This
  per-hospital script is kept working for a future at-scale switch (many
  hospitals, no engineer on site); nothing calls it today. ***

  WHY (the at-scale rationale): one shared AuroraSetup.exe means anyone who gets a copy can install a
  hospital system. A single baked-in password is no better - it ships inside
  every copy and the first leak burns the whole product with no way to tell
  WHICH hospital leaked it. So: ONE installer PER hospital, each encrypted
  with its own random install password (Inno Setup 6.4+ Encryption=yes:
  XChaCha20 over the whole payload, key PBKDF2-HMAC-SHA256-derived from the
  password). A copied installer without its password cannot be installed and
  its payload cannot be extracted; a leak identifies the hospital and burns
  exactly one build. (Honest limit: setup METADATA - names, paths, wizard
  code - is not encrypted; only the file data is.)

  The install password is a DIFFERENT SECRET from the backup encryption key.
  They live in the same sealed envelope but on separate, clearly labelled
  lines: a lost install password is reissued by re-running this script; a
  lost backup key is unrecoverable and takes every backup with it. Never
  merge or confuse the two.

  USAGE (on the Windows build machine, after the usual build inputs exist):

    # two hospitals, passwords generated for you:
    powershell -ExecutionPolicy Bypass -File .\installer\build-hospitals.ps1 `
      -Hospitals alnoor,city-icu `
      -PgZip C:\aurora-build\postgresql-16.4-1-windows-x64-binaries.zip `
      -ModelDir C:\aurora-ai\model -LlamaDir C:\aurora-ai\llama

    # or from a CSV with columns HospitalId[,Password] (Password blank = generate):
    ... -Csv C:\aurora-build\hospitals.csv ...

    # payload already staged by a previous run (skip the slow steps 1-4):
    ... -SkipStage ...

  The payload is staged ONCE (build.ps1 -SkipCompile), then ISCC runs once per
  hospital - expect the full LZMA2 compression time (20-60 min on an AI build)
  PER HOSPITAL. Output: installer\Output\AuroraSetup-<ver>-<hospital>.exe, plus
  a password ledger CSV beside them. TRANSCRIBE the ledger into the per-hospital
  sealed envelopes and the vendor's own record, then DELETE it - it holds real
  hospital secrets and is gitignored, never committed.

  WINDOWS-ONLY (ISCC). CODE-REVIEWED here; verify on the build machine.
#>
[CmdletBinding()]
param(
  [string[]]$Hospitals = @(),   # hospital ids: a-z 0-9 and dashes (e.g. alnoor,city-icu)
  [string]$Csv = '',            # optional CSV with HospitalId[,Password] rows (Password blank = generate)
  [Parameter(Mandatory)][string]$PgZip,
  [string]$ModelDir = '',
  [string]$LlamaDir = '',
  [string]$Iscc = 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe',
  [switch]$SkipStage            # the payload is already staged (a previous run of this script or build.ps1)
)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
function Say([string]$m) { Write-Host "[build-hospitals] $m" -ForegroundColor Cyan }
function Die([string]$m) { Write-Host "[build-hospitals] $m" -ForegroundColor Red; exit 1 }

# Crypto-random install password: 20 chars from an unambiguous set (no I L O U
# 0 1 - it gets typed once, by hospital IT, from paper), grouped for readability
# (XXXXX-XXXXX-XXXXX-XXXXX, ~98 bits). Rejection sampling kills the modulo bias.
# Letters+digits+dashes only, so the value is safe on the ISCC command line.
function New-InstallPassword {
  $chars = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $limit = [int]([Math]::Floor(256 / $chars.Length) * $chars.Length)
  $one = New-Object byte[] 1
  $pw = ''
  try {
    for ($i = 0; $i -lt 20; $i++) {
      do { $rng.GetBytes($one) } while ($one[0] -ge $limit)
      if (($i -gt 0) -and ($i % 5 -eq 0)) { $pw += '-' }
      $pw += $chars[$one[0] % $chars.Length]
    }
  } finally { $rng.Dispose() }
  $pw
}

# ---- 1. the hospital list (CSV rows first, then -Hospitals ids) ----
$list = New-Object System.Collections.Generic.List[object]
if ($Csv) {
  if (-not (Test-Path $Csv)) { Die "-Csv not found: $Csv" }
  foreach ($row in (Import-Csv $Csv)) {
    $list.Add([pscustomobject]@{ Id = "$($row.HospitalId)"; Password = "$($row.Password)" })
  }
}
foreach ($h in $Hospitals) { $list.Add([pscustomobject]@{ Id = "$h"; Password = '' }) }
if ($list.Count -eq 0) { Die 'no hospitals given - pass -Hospitals id1,id2 or -Csv <file with HospitalId[,Password]>' }

$seen = @{}
foreach ($h in $list) {
  $h.Id = $h.Id.Trim().ToLowerInvariant()
  if ($h.Id -notmatch '^[a-z0-9][a-z0-9-]{0,30}$') {
    Die "hospital id '$($h.Id)' is invalid - a-z, 0-9 and dashes, up to 31 chars, starting with a letter or digit (it becomes part of the installer filename)"
  }
  # 'protected'/'unprotected' are the filename markers of the OTHER build
  # paths (AuroraSetup-<ver>-PROTECTED / -UNPROTECTED); a hospital id equal
  # to either would make those files indistinguishable on disk.
  if (@('protected','unprotected') -contains $h.Id) {
    Die "hospital id '$($h.Id)' is reserved - it is the filename marker of the company-password/plain build paths"
  }
  if ($seen.ContainsKey($h.Id)) { Die "duplicate hospital id '$($h.Id)'" }
  $seen[$h.Id] = $true
  if (-not $h.Password) { $h.Password = New-InstallPassword }
  # ISCC gets the password as /DInstallPassword=<value> - refuse anything that
  # could break out of that argument (quotes, spaces, ISPP-significant chars)
  if ($h.Password -notmatch '^[A-Za-z0-9-]{12,64}$') {
    Die "the password for '$($h.Id)' must be 12-64 letters, digits and dashes only (a supplied CSV password with other characters cannot be passed to ISCC safely)"
  }
}

# ---- 2. stage the payload ONCE (React bundle, server publish, pgsql, model) ----
if (-not $SkipStage) {
  $buildArgs = @{ PgZip = $PgZip; Iscc = $Iscc; SkipCompile = $true }
  if ($ModelDir) { $buildArgs.ModelDir = $ModelDir }
  if ($LlamaDir) { $buildArgs.LlamaDir = $LlamaDir }
  & (Join-Path $here 'build.ps1') @buildArgs
} else {
  Say 'payload staging SKIPPED (-SkipStage)'
}
if (-not (Test-Path (Join-Path $here 'payload\server\AuroraIcu.Api.exe'))) {
  Die 'the payload is not staged - run once without -SkipStage first'
}
if (-not (Test-Path $Iscc)) { Die "Inno Setup compiler not found at $Iscc (install Inno Setup 6, or pass -Iscc)" }

# ---- 3. one ENCRYPTED installer per hospital ----
$built = New-Object System.Collections.Generic.List[object]
foreach ($h in $list) {
  Say "compiling the ENCRYPTED installer for '$($h.Id)' (full LZMA2 pass - 20-60 min on an AI build)"
  & $Iscc "/DHospitalId=$($h.Id)" "/DInstallPassword=$($h.Password)" (Join-Path $here 'aurora.iss')
  if ($LASTEXITCODE -ne 0) { Die "ISCC failed for '$($h.Id)' (see the compiler output above)" }
  $exe = Get-ChildItem (Join-Path $here 'Output') -Filter ('AuroraSetup-*-' + $h.Id + '.exe') -ErrorAction SilentlyContinue |
         Sort-Object LastWriteTime | Select-Object -Last 1
  if (-not $exe) { Die "ISCC reported success for '$($h.Id)' but no AuroraSetup-*-$($h.Id).exe is in Output" }
  $built.Add([pscustomobject]@{
    HospitalId      = $h.Id
    Installer       = $exe.Name
    SizeGB          = [math]::Round($exe.Length / 1GB, 2)
    Sha256          = (Get-FileHash -Algorithm SHA256 -Path $exe.FullName).Hash.ToLowerInvariant()
    InstallPassword = $h.Password
  })
}

# ---- 4. the ledger: print ONCE + a local CSV to transcribe from ----
$ledger = Join-Path $here 'Output\hospital-install-passwords.csv'
$built | Export-Csv -NoTypeInformation -Encoding ascii -Path $ledger
Say '----------------------------------------------------------------------'
Say 'PER-HOSPITAL INSTALL PASSWORDS - record each one NOW:'
Say '  1. its own labelled line in that hospital''s sealed envelope'
Say '     (the SAME envelope as the backup key, but a SEPARATE line -'
Say '      install password: reissuable; backup key: unrecoverable)'
Say '  2. the vendor''s own ledger'
Say "Then DELETE $ledger - it holds real hospital secrets."
Say '----------------------------------------------------------------------'
$built | Format-Table HospitalId, Installer, SizeGB, InstallPassword -AutoSize | Out-Host
Say "DONE - $($built.Count) encrypted installer(s) in $(Join-Path $here 'Output')"
Say 'Ship each hospital ONLY its own installer. The password goes by a separate channel (phone/in person), never in the same email as the file.'
exit 0
