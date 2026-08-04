<#
  Pure unit tests for installer\version-gate.ps1 - the release version gate.

  These run under Windows PowerShell 5.1 in CI (the installer-powershell
  job), which is the same engine build-protected.ps1 runs on. Nothing here
  touches the network, the disk (beyond reading the committed ledger in the
  last block), Postgres, or ISCC.

  Run:  powershell -ExecutionPolicy Bypass -File .\installer\test-version-gate.ps1
#>
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'version-gate.ps1')

$script:pass = 0
$script:fail = 0
function Assert([bool]$cond, [string]$what) {
  if ($cond) { $script:pass++; Write-Host "  ok   $what" }
  else { $script:fail++; Write-Host "  FAIL $what" -ForegroundColor Red }
}
function Section([string]$t) { Write-Host ""; Write-Host "== $t ==" -ForegroundColor Cyan }

# ---------------------------------------------------------------- semver ----
Section 'Compare-SemVer'
Assert ((Compare-SemVer '1.2.0' '1.1.9') -gt 0) '1.2.0 > 1.1.9'
Assert ((Compare-SemVer '1.1.0' '1.1.0') -eq 0) '1.1.0 == 1.1.0'
Assert ((Compare-SemVer '1.0.9' '1.1.0') -lt 0) '1.0.9 < 1.1.0'
Assert ((Compare-SemVer '2.0.0' '1.99.99') -gt 0) '2.0.0 > 1.99.99'
Assert ((Compare-SemVer '1.2.0' '1.2.0-rc1') -gt 0) 'a release outranks its own pre-release'
Assert ((Compare-SemVer '1.2.0-rc2' '1.2.0-rc1') -gt 0) 'rc2 > rc1'

Section 'Test-ShippableVersion'
Assert (Test-ShippableVersion '1.0.0') '1.0.0 is shippable'
Assert (Test-ShippableVersion '10.4.17') '10.4.17 is shippable'
Assert (Test-ShippableVersion '1.2.0-rc1') '1.2.0-rc1 is shippable'
Assert (-not (Test-ShippableVersion '1.0')) 'two components is NOT shippable'
Assert (-not (Test-ShippableVersion '')) 'empty is NOT shippable'
Assert (-not (Test-ShippableVersion 'v1.0.0')) 'a v prefix is NOT shippable'
Assert (-not (Test-ShippableVersion '1.0.0.4')) 'four components is NOT shippable'

# ---------------------------------------------------------------- parsing ---
Section 'Read-ShippedLedger'
$sample = @(
  '# a comment',
  '',
  '1.0.0   setup   new   2026-08-04T00:00:00Z  e00f3c2  first cut',
  '1.1.0   setup   new   2026-08-10T09:30:00Z  abc1234',
  '   # indented comment',
  '1.1.0   update  new   2026-08-10T10:00:00Z  abc1234  same release, update form'
)
$entries = Read-ShippedLedger -Lines $sample
Assert ($entries.Count -eq 3) 'comments and blank lines are skipped (3 entries parsed)'
Assert ($entries[0].version -eq '1.0.0' -and $entries[0].kind -eq 'setup') 'fields land in the right columns'
Assert ($entries[0].note -eq 'first cut') 'the note is captured'
Assert ($entries[1].note -eq '') 'a missing note is empty, not an error'
Assert ($entries[0].lineNo -eq 3) 'line numbers are 1-based on the ORIGINAL text'
Assert ((Read-ShippedLedger -Lines @()).Count -eq 0) 'an empty ledger parses to zero entries'
Assert ((Read-ShippedLedger -Lines @('# only a comment')).Count -eq 0) 'a comment-only ledger parses to zero entries'

# ------------------------------------------------------------- validation ---
Section 'Test-ShippedLedger accepts a good ledger'
Assert ((Test-ShippedLedger -Entries $entries).Count -eq 0) 'the sample ledger is valid'
Assert ((Test-ShippedLedger -Entries (Read-ShippedLedger -Lines @())).Count -eq 0) 'an empty ledger is valid'

Section 'Test-ShippedLedger rejects what it must'
# The leading comma is load-bearing: without it PowerShell unrolls a
# one-element array back to a bare string on the way out of this function,
# and $p[0] would then index a CHARACTER instead of a problem message.
function Problems([string[]]$lines) { return ,(Test-ShippedLedger -Entries (Read-ShippedLedger -Lines $lines)) }

$p = Problems @('1.0.0 setup new 2026-08-04T00:00:00Z')
Assert ($p.Count -eq 1 -and $p[0] -match 'at least 5 fields') 'a short line is rejected'

$p = Problems @('1.0 setup new 2026-08-04T00:00:00Z abc1234')
Assert ($p.Count -eq 1 -and $p[0] -match 'not a shippable version') 'a malformed version is rejected'

$p = Problems @('1.0.0 patch new 2026-08-04T00:00:00Z abc1234')
Assert ($p.Count -eq 1 -and $p[0] -match "unknown kind") 'an unknown kind is rejected'

$p = Problems @('1.0.0 setup maybe 2026-08-04T00:00:00Z abc1234')
Assert ($p.Count -eq 1 -and $p[0] -match 'unknown flag') 'an unknown flag is rejected'

$p = Problems @('1.0.0 setup new 04/08/2026 abc1234')
Assert ($p.Count -eq 1 -and $p[0] -match 'ISO-8601') 'a non-ISO timestamp is rejected'

$p = Problems @(
  '1.0.0 setup new 2026-08-04T00:00:00Z abc1234',
  '1.0.0 setup new 2026-08-05T00:00:00Z def5678')
Assert ($p.Count -ge 1 -and $p[0] -match 'duplicate entry') 'the same version shipped twice as new is rejected'

$p = Problems @(
  '1.2.0 setup new 2026-08-04T00:00:00Z abc1234',
  '1.1.0 setup new 2026-08-05T00:00:00Z def5678')
Assert ($p.Count -eq 1 -and $p[0] -match 'strictly increase') 'going BACKWARDS is rejected'

$p = Problems @('1.0.0 setup rebuild 2026-08-04T00:00:00Z abc1234')
Assert ($p.Count -eq 1 -and $p[0] -match 'no setup release has been recorded') 'a rebuild with nothing to rebuild is rejected'

$p = Problems @(
  '1.0.0 setup new     2026-08-04T00:00:00Z abc1234',
  '1.1.0 setup new     2026-08-05T00:00:00Z def5678',
  '1.0.0 setup rebuild 2026-08-06T00:00:00Z abc1234')
Assert ($p.Count -eq 1 -and $p[0] -match 'only the newest release may be rebuilt') 'rebuilding a superseded release is rejected'

$p = Problems @(
  '1.0.0 setup new     2026-08-04T00:00:00Z abc1234',
  '1.0.0 setup rebuild 2026-08-06T00:00:00Z abc1234')
Assert ($p.Count -eq 0) 'rebuilding the NEWEST release is fine'

# setup and update are independent chains - the same release ships in both
# forms, and an update-only release must not be blocked by the setup chain.
$p = Problems @(
  '1.0.0 setup  new 2026-08-04T00:00:00Z abc1234',
  '1.0.0 update new 2026-08-04T01:00:00Z abc1234',
  '1.1.0 update new 2026-08-09T01:00:00Z def5678',
  '1.2.0 setup  new 2026-08-20T01:00:00Z 9999999')
Assert ($p.Count -eq 0) 'setup and update chains are independent'

# ...independent, but both forward-only against the same high-water mark.
$p = Problems @(
  '1.1.0 setup  new 2026-08-09T00:00:00Z def5678',
  '1.0.0 update new 2026-08-09T01:00:00Z abc1234')
Assert ($p.Count -eq 1 -and $p[0] -match 'below 1.1.0') 'an update BELOW the newest setup is rejected'

# ------------------------------------------------------------- the gate -----
Section 'Test-ReleaseVersionGate'
$led = Read-ShippedLedger -Lines @(
  '1.0.0 setup  new 2026-08-04T00:00:00Z abc1234',
  '1.1.0 setup  new 2026-08-09T00:00:00Z def5678',
  '1.1.0 update new 2026-08-09T01:00:00Z def5678')

Assert ((Get-NewestShippedVersion -Entries $led -Kind 'setup') -eq '1.1.0') 'newest setup is 1.1.0'
Assert ((Get-NewestShippedVersion -Entries $led -Kind 'update') -eq '1.1.0') 'newest update is 1.1.0'

$g = Test-ReleaseVersionGate -Entries $led -Kind 'setup' -Version '1.2.0'
Assert ($g.ok) 'a bumped version passes'

# THE case this whole file exists for.
$g = Test-ReleaseVersionGate -Entries $led -Kind 'setup' -Version '1.1.0'
Assert (-not $g.ok) 'the FORGOTTEN BUMP (same version) is refused'
Assert ($g.reason -match 'ALREADY SHIPPED') 'the refusal names the actual failure'
Assert ($g.reason -match 'would REFUSE') 'the refusal explains the silent field consequence'

$g = Test-ReleaseVersionGate -Entries $led -Kind 'setup' -Version '1.0.5'
Assert (-not $g.ok -and $g.reason -match 'BELOW 1.1.0') 'an older version is refused'
Assert ($g.reason -match 'last setup shipped was 1.1.0') 'and the refusal names the last shipped setup too'

$g = Test-ReleaseVersionGate -Entries $led -Kind 'setup' -Version '1.1'
Assert (-not $g.ok -and $g.reason -match 'not a shippable version') 'a malformed AppVer is refused'

$g = Test-ReleaseVersionGate -Entries $led -Kind 'setup' -Version ''
Assert (-not $g.ok) 'an empty AppVer is refused (aurora.iss regex found nothing)'

$g = Test-ReleaseVersionGate -Entries $led -Kind 'update' -Version '1.2.0'
Assert ($g.ok) 'the update chain accepts its own bump'

# An update built for a release whose setup already shipped: same version,
# different kind - allowed, because they are the same release in two forms.
$ledSetupOnly = Read-ShippedLedger -Lines @('1.3.0 setup new 2026-08-21T00:00:00Z abc1234')
$g = Test-ReleaseVersionGate -Entries $ledSetupOnly -Kind 'update' -Version '1.3.0'
Assert ($g.ok) 'the update form of an already-built setup release is allowed'
Assert ($g.reason -match 'paired with') 'and the reason says WHY it is allowed at an equal version'

# ...but an empty chain of its own kind is NOT a blank cheque. The first-ever
# update package still may not come out below what the setup already shipped:
# no hospital is on a version low enough to apply it.
$g = Test-ReleaseVersionGate -Entries $ledSetupOnly -Kind 'update' -Version '1.2.0'
Assert (-not $g.ok -and $g.reason -match 'BELOW 1.3.0') 'the FIRST update may not be below the newest setup'
$g = Test-ReleaseVersionGate -Entries $ledSetupOnly -Kind 'update' -Version '1.4.0'
Assert ($g.ok) 'the first update ABOVE the newest setup is allowed'

$g = Test-ReleaseVersionGate -Entries (Read-ShippedLedger -Lines @()) -Kind 'setup' -Version '1.0.0'
Assert ($g.ok -and $g.reason -match 'first setup release') 'the first ever release passes with nothing to compare'

Section 'Test-ReleaseVersionGate -Rebuild'
$g = Test-ReleaseVersionGate -Entries $led -Kind 'setup' -Version '1.1.0' -Rebuild
Assert ($g.ok) 'a rebuild of the newest release is allowed'
$g = Test-ReleaseVersionGate -Entries $led -Kind 'setup' -Version '1.0.0' -Rebuild
Assert (-not $g.ok -and $g.reason -match 'you last shipped') 'a rebuild of a superseded release is refused'
$g = Test-ReleaseVersionGate -Entries $led -Kind 'setup' -Version '1.2.0' -Rebuild
Assert (-not $g.ok) 'a rebuild at a NEW version is refused (that is not a rebuild)'
$g = Test-ReleaseVersionGate -Entries (Read-ShippedLedger -Lines @()) -Kind 'setup' -Version '1.0.0' -Rebuild
Assert (-not $g.ok -and $g.reason -match 'first one') 'a rebuild with an empty ledger is refused'

# ------------------------------------------------------- line formatting ----
Section 'New-ShippedLedgerLine round-trips'
$line = New-ShippedLedgerLine -Version '1.4.0' -Kind 'update' -Flag 'new' `
  -Utc '2026-09-01T12:00:00Z' -Commit 'deadbee' -Note 'a note'
$back = Read-ShippedLedger -Lines @($line)
Assert ($back.Count -eq 1) 'the emitted line parses back'
Assert ($back[0].version -eq '1.4.0' -and $back[0].kind -eq 'update' -and $back[0].flag -eq 'new') 'round-trip keeps version/kind/flag'
Assert ($back[0].utc -eq '2026-09-01T12:00:00Z' -and $back[0].commit -eq 'deadbee') 'round-trip keeps utc/commit'
Assert ($back[0].note -eq 'a note') 'round-trip keeps the note'
Assert ((Test-ShippedLedger -Entries $back).Count -eq 0) 'the emitted line is a VALID ledger entry'
$blank = Read-ShippedLedger -Lines @((New-ShippedLedgerLine -Version '1.4.0' -Kind 'setup' -Flag 'new' -Utc '2026-09-01T12:00:00Z' -Commit ''))
Assert ($blank[0].commit -eq '-') 'an unknown commit is written as -'

# ------------------------------------------- the ledger that actually ships --
Section 'The COMMITTED ledger must be valid (this is the CI gate, on real data)'
$ledgerPath = Join-Path $PSScriptRoot 'SHIPPED_VERSIONS.txt'
Assert (Test-Path $ledgerPath) 'installer\SHIPPED_VERSIONS.txt exists'
$real = Read-ShippedLedger -Lines (Get-Content -Path $ledgerPath)
$realProblems = Test-ShippedLedger -Entries $real
foreach ($rp in $realProblems) { Write-Host "       $rp" -ForegroundColor Red }
Assert ($realProblems.Count -eq 0) 'the committed ledger has no problems'

# aurora.iss must never be BEHIND what has already shipped: a tree at an
# already-shipped version is a tree whose next build would be refused.
$issPath = Join-Path $PSScriptRoot 'aurora.iss'
$appVer = ([regex]::Match((Get-Content -Raw $issPath), '#define\s+AppVer\s+"([^"]+)"').Groups[1].Value)
Assert (Test-ShippableVersion $appVer) "aurora.iss AppVer '$appVer' is a shippable version"
$newestSetup = Get-NewestShippedVersion -Entries $real -Kind 'setup'
if ($null -eq $newestSetup) {
  Assert $true 'no setup release recorded yet - nothing for AppVer to be behind'
} else {
  Assert ((Compare-SemVer $appVer $newestSetup) -ge 0) "aurora.iss AppVer $appVer is not behind the last shipped setup ($newestSetup)"
}

Write-Host ""
Write-Host "passed $script:pass, failed $script:fail"
if ($script:fail -gt 0) { exit 1 }
exit 0
