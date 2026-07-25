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

  USAGE (Windows build machine, after the usual build inputs exist):

    powershell -ExecutionPolicy Bypass -File .\installer\build-protected.ps1 `
      -PgZip C:\aurora-build\postgresql-16.4-1-windows-x64-binaries.zip `
      -ModelDir C:\aurora-ai\model -LlamaDir C:\aurora-ai\llama

    # payload already staged today (skip the slow steps 1-4):
    ... -SkipStage ...

  WINDOWS-ONLY (ISCC). CODE-REVIEWED here; verify on the build machine.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$PgZip,
  [string]$ModelDir = '',
  [string]$LlamaDir = '',
  [string]$Iscc = 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe',
  [switch]$SkipStage            # the payload is already staged (a previous run of this or build.ps1)
)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
function Say([string]$m) { Write-Host "[build-protected] $m" -ForegroundColor Cyan }
function Die([string]$m) { Write-Host "[build-protected] $m" -ForegroundColor Red; exit 1 }

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

# ---- 2. stage the payload (React bundle, server publish, pgsql, model) ----
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

# ---- 3. compile the ENCRYPTED installer (password via ISCC's environment) ----
Say 'compiling the PROTECTED installer (full LZMA2 pass - 20-60 min on an AI build)'
$started = Get-Date
$env:AURORA_INSTALL_PASSWORD = $pw
try {
  & $Iscc (Join-Path $here 'aurora.iss')
  if ($LASTEXITCODE -ne 0) { Die 'ISCC failed (see the compiler output above)' }
} finally {
  Remove-Item Env:\AURORA_INSTALL_PASSWORD -ErrorAction SilentlyContinue
}

# ---- 4. prove the output really is the protected build ----
$exe = Get-ChildItem (Join-Path $here 'Output') -Filter 'AuroraSetup-*-PROTECTED.exe' -ErrorAction SilentlyContinue |
       Where-Object { $_.LastWriteTime -ge $started } | Sort-Object LastWriteTime | Select-Object -Last 1
if (-not $exe) {
  Die 'ISCC succeeded but produced no fresh AuroraSetup-*-PROTECTED.exe - the password did NOT reach the compiler (is aurora.iss current?). Whatever it built is NOT protected; do not ship it.'
}
$sha = (Get-FileHash -Algorithm SHA256 -Path $exe.FullName).Hash.ToLowerInvariant()
Say '----------------------------------------------------------------------'
Say ("DONE  ->  {0}   ({1} GB)" -f $exe.FullName, [math]::Round($exe.Length / 1GB, 2))
Say "sha256: $sha"
Say 'The install password was NOT written anywhere by this build - it exists'
Say 'only where you keep it. The hospital never receives it: the engineer'
Say 'types it on site at every install. Without it this file cannot be'
Say 'installed and its payload cannot be extracted.'
Say '----------------------------------------------------------------------'
exit 0
