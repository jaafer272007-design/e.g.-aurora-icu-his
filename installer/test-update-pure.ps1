<#
  AURORA ICU - unit tests for the PURE core of aurora-update.ps1
  (Compare-SemVer / Test-VersionSkew / Test-VersionSkipHop / Get-MissingEnvKeys).

  Run by the CI job `installer-powershell` on windows-latest under WINDOWS
  POWERSHELL 5.1 - the same engine aurora-update.iss launches on a hospital
  server. Running these on pwsh 7 only is exactly how the ternary defect shipped
  (PS7 parsed it, 5.1 could not), so the engine matters as much as the assertions.

  Runnable anywhere PowerShell exists (pure functions, no Windows APIs):
      powershell -ExecutionPolicy Bypass -File installer\test-update-pure.ps1
      pwsh -File installer/test-update-pure.ps1

  Dot-sourcing with $AuroraUpdatePureTest = $true loads ONLY the pure functions;
  the live update orchestration returns immediately and touches nothing.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$script:Pass = 0
$script:Fail = 0

function Assert-Equal {
  param([Parameter(Mandatory)][string]$What, $Expected, $Actual)
  # -eq on the scalars used here; arrays are compared by their joined text.
  if ($Expected -is [array] -or $Actual -is [array]) {
    $e = (@($Expected) -join ','); $a = (@($Actual) -join ',')
  } else {
    $e = "$Expected"; $a = "$Actual"
  }
  if ($e -eq $a) {
    $script:Pass++
    Write-Host ("  ok   " + $What)
  } else {
    $script:Fail++
    Write-Host ("  FAIL " + $What + "  expected [" + $e + "] got [" + $a + "]")
  }
}

function New-VerFacts {
  param([string]$Version, [string]$MigrationHead, [string]$Environment = 'production')
  return @{
    version       = $Version
    major         = [int]($Version.Split('.')[0])
    migrationHead = $MigrationHead
    environment   = $Environment
  }
}

# ---- load the pure core (the orchestration self-suppresses) ----
$AuroraUpdatePureTest = $true
. (Join-Path $PSScriptRoot 'aurora-update.ps1')
Write-Host ("running on PowerShell " + $PSVersionTable.PSVersion)

Write-Host 'Compare-SemVer'
Assert-Equal 'equal versions'                  0  (Compare-SemVer '1.2.3' '1.2.3')
Assert-Equal 'patch greater'                   1  (Compare-SemVer '1.2.4' '1.2.3')
Assert-Equal 'minor lesser'                   -1  (Compare-SemVer '1.2.9' '1.3.0')
Assert-Equal 'major greater'                   1  (Compare-SemVer '2.0.0' '1.9.9')
Assert-Equal 'short form padded (1.2 == 1.2.0)' 0 (Compare-SemVer '1.2' '1.2.0')
Assert-Equal 'release beats its pre-release'   1  (Compare-SemVer '1.2.0' '1.2.0-rc1')
Assert-Equal 'pre-release below its release'  -1  (Compare-SemVer '1.2.0-rc1' '1.2.0')
Assert-Equal 'pre-release ordinal compare'    -1  (Compare-SemVer '1.2.0-rc1' '1.2.0-rc2')
Assert-Equal 'equal pre-releases'              0  (Compare-SemVer '1.2.0-rc1' '1.2.0-rc1')

Write-Host 'Test-VersionSkew - the accepted paths'
$r = Test-VersionSkew -Installed (New-VerFacts '4.2.0' '20260101_A') `
                      -Package   (New-VerFacts '4.3.0' '20260201_B') -DbHead '20260101_A'
Assert-Equal 'next release accepted'            $true  $r.ok
Assert-Equal 'next release: migration will run' $true  $r.migrationWillRun

# THE SKIP CASE: a hospital that sat out 4.3 takes 4.4 in one step.
$r = Test-VersionSkew -Installed (New-VerFacts '4.2.0' '20260101_A') `
                      -Package   (New-VerFacts '4.4.0' '20260301_C') -DbHead '20260101_A'
Assert-Equal 'SKIP 4.2 -> 4.4 accepted (no adjacency rule)' $true $r.ok
Assert-Equal 'SKIP: migration will run'                     $true $r.migrationWillRun

$r = Test-VersionSkew -Installed (New-VerFacts '4.2.0' '20260101_A') `
                      -Package   (New-VerFacts '4.2.1' '20260101_A') -DbHead '20260101_A'
Assert-Equal 'no-migration update accepted'      $true  $r.ok
Assert-Equal 'no-migration: migrationWillRun off' $false $r.migrationWillRun

Write-Host 'Test-VersionSkew - the refusals'
$r = Test-VersionSkew -Installed (New-VerFacts '4.3.0' '20260201_B') `
                      -Package   (New-VerFacts '4.2.0' '20260101_A') -DbHead '20260201_B'
Assert-Equal 'downgrade refused' $false $r.ok

$r = Test-VersionSkew -Installed (New-VerFacts '4.3.0' '20260201_B') `
                      -Package   (New-VerFacts '4.3.0' '20260201_B') -DbHead '20260201_B'
Assert-Equal 'same version refused' $false $r.ok

$r = Test-VersionSkew -Installed (New-VerFacts '4.2.0' '20260101_A') `
                      -Package   (New-VerFacts '4.3.0' '20260201_B' 'staging') -DbHead '20260101_A'
Assert-Equal 'staging package refused' $false $r.ok

# the DB carries a migration newer than anything in the package
$r = Test-VersionSkew -Installed (New-VerFacts '4.2.0' '20260101_A') `
                      -Package   (New-VerFacts '4.3.0' '20260201_B') -DbHead '20260301_C'
Assert-Equal 'DB-ahead refused' $false $r.ok

$r = Test-VersionSkew -Installed (New-VerFacts '4.9.0' '20260101_A') `
                      -Package   (New-VerFacts '5.0.0' '20260301_C') -DbHead '20260101_A'
Assert-Equal 'cross-major refused by default' $false $r.ok
$r = Test-VersionSkew -Installed (New-VerFacts '4.9.0' '20260101_A') `
                      -Package   (New-VerFacts '5.0.0' '20260301_C') -DbHead '20260101_A' -AllowMajor
Assert-Equal 'cross-major allowed with -AllowMajor' $true $r.ok

Write-Host 'Test-VersionSkipHop'
Assert-Equal 'next minor is NOT a skip'      $false (Test-VersionSkipHop -InstalledVersion '4.2.0' -PackageVersion '4.3.0')
Assert-Equal 'next patch is NOT a skip'      $false (Test-VersionSkipHop -InstalledVersion '4.2.1' -PackageVersion '4.2.2')
Assert-Equal 'one minor skipped IS a skip'   $true  (Test-VersionSkipHop -InstalledVersion '4.2.0' -PackageVersion '4.4.0')
Assert-Equal 'two minors skipped IS a skip'  $true  (Test-VersionSkipHop -InstalledVersion '4.2.0' -PackageVersion '4.5.0')
Assert-Equal 'one patch skipped IS a skip'   $true  (Test-VersionSkipHop -InstalledVersion '4.2.1' -PackageVersion '4.2.3')
Assert-Equal 'cross-major IS a skip'         $true  (Test-VersionSkipHop -InstalledVersion '4.9.0' -PackageVersion '5.0.0')
# the documented blind spot: the updater cannot know 4.2.6..4.2.9 ever existed
Assert-Equal 'minor rollover reads as adjacent (known limit)' $false (Test-VersionSkipHop -InstalledVersion '4.2.5' -PackageVersion '4.3.0')

Write-Host 'Get-MissingEnvKeys'
$envSample = @(
  '# Aurora ICU machine config (written by the installer). ACL-locked.',
  '',
  'APP_ENV=production',
  'PORT=8080',
  'DATABASE_URL=Host=127.0.0.1;Port=5432;Database=aurora;Username=aurora;Password=p=a=s=s',
  '   BACKUP_DIR=D:\AuroraBackups   '
)
Assert-Equal 'nothing missing when all present' @() `
  (Get-MissingEnvKeys -EnvLines $envSample -RequiredKeys @('APP_ENV','PORT','DATABASE_URL','BACKUP_DIR'))
Assert-Equal 'missing key reported' @('PG_BIN') `
  (Get-MissingEnvKeys -EnvLines $envSample -RequiredKeys @('APP_ENV','PG_BIN'))
Assert-Equal 'several missing keys reported in order' @('JWT_SECRET','PG_BIN') `
  (Get-MissingEnvKeys -EnvLines $envSample -RequiredKeys @('JWT_SECRET','PORT','PG_BIN'))
Assert-Equal 'a value containing = does not break key parsing' @() `
  (Get-MissingEnvKeys -EnvLines $envSample -RequiredKeys @('DATABASE_URL'))
Assert-Equal 'surrounding whitespace tolerated' @() `
  (Get-MissingEnvKeys -EnvLines $envSample -RequiredKeys @('BACKUP_DIR'))
# a commented-out key is NOT present - this is the case that matters: an operator
# who comments a key out has removed it as far as the server is concerned.
Assert-Equal 'commented-out key counts as missing' @('APP_ENV') `
  (Get-MissingEnvKeys -EnvLines @('# APP_ENV=production', 'PORT=8080') -RequiredKeys @('APP_ENV'))
Assert-Equal 'empty required list is trivially satisfied' @() `
  (Get-MissingEnvKeys -EnvLines $envSample -RequiredKeys @())
Assert-Equal 'empty env file misses everything' @('APP_ENV') `
  (Get-MissingEnvKeys -EnvLines @() -RequiredKeys @('APP_ENV'))

# ---------------------------------------------------------------------------
# ConvertTo-SingleLine - the $null -replace trap.
#
# The helper exists because of a defect that reached a hospital server: the
# updater formatted psql's stderr with an inline
#     ((Get-Content -Raw $errFile) -replace '\s+',' ').Trim()
# and a SUCCESSFUL psql writes nothing, so that file is zero bytes,
# Get-Content -Raw emits NOTHING, and -replace on nothing yields an empty
# Object[] with no .Trim(). The update died at the moment everything had worked.
#
# READ THIS BEFORE TRUSTING THESE ASSERTIONS. They test the helper's CONTRACT.
# They do NOT and CANNOT reproduce the field defect, and it would be dishonest to
# label them as if they did: the hazard is AutomationNull (the "no objects at
# all" value a command yields), and PowerShell converts AutomationNull to a plain
# $null when it is bound to a parameter. So the defect is laundered by the
# function boundary - measured, not assumed (installer\test-update-exitcodes.ps1
# proves both halves in a real process). Reverting the [string] cast leaves every
# assertion below GREEN.
#
# The teeth for the actual defect are therefore in test-update-exitcodes.ps1:
# a static lint that forbids the inline form anywhere in installer\*.ps1, plus a
# child-process proof that the inline form really does throw. What these
# assertions buy is that the helper each call site now uses is itself correct.
# ---------------------------------------------------------------------------
Write-Host 'ConvertTo-SingleLine (contract only - see the note above)'
Assert-Equal 'null becomes empty string'                     '' (ConvertTo-SingleLine $null)
Assert-Equal 'empty array becomes empty string'              '' (ConvertTo-SingleLine @())
Assert-Equal 'empty string stays empty'                      '' (ConvertTo-SingleLine '')
Assert-Equal 'whitespace-only collapses to empty'            '' (ConvertTo-SingleLine "  `r`n `t ")
Assert-Equal 'plain text passes through'          'psql: FATAL' (ConvertTo-SingleLine 'psql: FATAL')
Assert-Equal 'leading/trailing whitespace trimmed'       'oops' (ConvertTo-SingleLine "  oops`r`n")
Assert-Equal 'internal newlines collapse to one space' 'a b c' (ConvertTo-SingleLine "a`r`nb`n`nc")
Assert-Equal 'multi-line array joins to one line'      'a b c' (ConvertTo-SingleLine @('a', 'b', 'c'))
Assert-Equal 'array with blank elements does not double-space' 'a b' (ConvertTo-SingleLine @('a', '', 'b'))
# and the real shape: a zero-byte file, read exactly as the updater reads it.
$zeroByte = Join-Path ([IO.Path]::GetTempPath()) ('aurora-zero-' + [Guid]::NewGuid().ToString('N') + '.err')
Set-Content -Path $zeroByte -Value '' -NoNewline
try {
  Assert-Equal 'zero-byte file length is really 0' 0 (Get-Item $zeroByte).Length
  Assert-Equal 'zero-byte file via Get-Content -Raw' '' `
    (ConvertTo-SingleLine (Get-Content -Raw $zeroByte))
} finally { Remove-Item -Force $zeroByte -ErrorAction SilentlyContinue }

Write-Host ''
Write-Host ("RESULT: " + $script:Pass + " passed, " + $script:Fail + " failed")
if ($script:Fail -gt 0) { exit 1 }
exit 0
