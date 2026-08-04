<#
  AURORA ICU - the release version gate (pure library; dot-source it).

  WHY THIS EXISTS. aurora-update.ps1 refuses any package whose version is
  <= the version already installed (Test-VersionSkew, refusal 2). That is
  correct and deliberate. Its consequence is nasty: if an engineer builds a
  new release but FORGETS to bump AppVer in aurora.iss, the resulting
  AuroraUpdate-<same-ver>.exe is silently refused at every hospital - the
  new code exists, ships, and never runs. Nothing in the build said a word.
  So the bump cannot be left to memory. This file is the check that makes
  a forgotten bump fail at BUILD time, on the build machine, before the
  artifact exists.

  HOW. installer\SHIPPED_VERSIONS.txt is a committed ledger of every
  shipping artifact ever produced by build-protected.ps1. Before compiling,
  build-protected.ps1 asks this library whether the AppVer it is about to
  build is strictly greater than the newest version already recorded for
  that artifact kind. If it is not, the build DIES before ISCC starts. On
  success the build appends its own entry and tells the operator to commit
  it.

  HONEST LIMIT - state it plainly, do not paper over it. The ledger is a
  file in git, so the gate is only as good as the commit that follows the
  build. If an engineer builds, ships, and never commits the appended line,
  a later clone will not know that version shipped. Two things blunt that:
  the same clone DOES know (the appended line is right there, so an
  immediate rebuild at the same version is refused), and CI fails if
  aurora.iss AppVer is behind the newest ledger entry. Neither can see a
  build whose ledger line was never committed. That residue is real.

  PURITY. Nothing here reads the disk, writes anything, or exits. Every
  function takes values and returns values, so the whole file is unit
  testable (installer\test-version-gate.ps1) and safe to dot-source.

  POWERSHELL 5.1 ONLY. No ternaries, no '??', no '?.' - this file is
  loaded by the same 5.1 engine as everything else in installer\ and is
  parsed by the installer-powershell CI job.
#>

# The kinds of shipping artifact the ledger tracks. build.ps1's UNPROTECTED
# smoke builds are NOT shipping artifacts and are deliberately not gated.
$script:AuroraLedgerKinds = @('setup', 'update')
$script:AuroraLedgerFlags = @('new', 'rebuild')

# --- semver -----------------------------------------------------------------
# Deliberately duplicated from aurora-update.ps1 rather than shared: that
# script ships INSIDE the update package and runs alone in {tmp}\pkg on a
# hospital server, where this file does not exist. It must stay
# self-contained. The two copies are covered by two separate test files.
function Split-SemVer {
  param([Parameter(Mandatory)][string]$V)
  $core, $pre = ($V -split '-', 2)
  $nums = @($core -split '\.' | ForEach-Object { [int]($_ -replace '[^\d].*$', '') })
  while ($nums.Count -lt 3) { $nums += 0 }
  if ($null -eq $pre) { $pre = '' }
  return @{ nums = $nums; pre = $pre }
}

function Compare-SemVer {
  param([Parameter(Mandatory)][string]$A, [Parameter(Mandatory)][string]$B)
  $x = Split-SemVer $A
  $y = Split-SemVer $B
  for ($i = 0; $i -lt 3; $i++) {
    if ($x.nums[$i] -gt $y.nums[$i]) { return 1 }
    if ($x.nums[$i] -lt $y.nums[$i]) { return -1 }
  }
  # A release outranks any pre-release of the same core (1.2.0 > 1.2.0-rc1).
  if ($x.pre -eq '' -and $y.pre -ne '') { return 1 }
  if ($x.pre -ne '' -and $y.pre -eq '') { return -1 }
  return [string]::Compare($x.pre, $y.pre, [StringComparison]::Ordinal)
}

# A version string we are willing to SHIP. Deliberately stricter than
# Split-SemVer, which is forgiving because it parses versions that already
# exist in the field. Here we are minting one, so demand three numeric
# components and an optional simple pre-release tag.
function Test-ShippableVersion {
  param([Parameter(Mandatory)][AllowEmptyString()][string]$V)
  return ($V -match '^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?$')
}

# --- the ledger -------------------------------------------------------------
# Line format (whitespace separated; '#' and blank lines ignored):
#
#   <version>  <kind>  <flag>  <utc>  <commit>  [note...]
#
#   version  the AppVer that was compiled          e.g. 1.1.0
#   kind     setup | update                        which artifact
#   flag     new | rebuild                         see Test-ReleaseVersionGate
#   utc      ISO-8601 Z stamp of the build
#   commit   short commit the build came from, or '-' if unknown
#   note     free text to end of line (optional)
function Read-ShippedLedger {
  param([Parameter(Mandatory)][AllowEmptyCollection()][AllowEmptyString()][string[]]$Lines)
  $out = @()
  for ($i = 0; $i -lt $Lines.Count; $i++) {
    $raw = $Lines[$i]
    if ($null -eq $raw) { continue }
    $t = $raw.Trim()
    if ($t -eq '' -or $t.StartsWith('#')) { continue }
    $f = @($t -split '\s+', 6)
    $note = ''
    if ($f.Count -ge 6) { $note = $f[5] }
    $out += [pscustomobject]@{
      version = $f[0]
      kind    = $(if ($f.Count -ge 2) { $f[1] } else { '' })
      flag    = $(if ($f.Count -ge 3) { $f[2] } else { '' })
      utc     = $(if ($f.Count -ge 4) { $f[3] } else { '' })
      commit  = $(if ($f.Count -ge 5) { $f[4] } else { '' })
      note    = $note
      lineNo  = $i + 1
      fields  = $f.Count
      raw     = $t
    }
  }
  return ,$out
}

# Returns an ARRAY OF PROBLEM STRINGS. Empty array means the ledger is
# valid. Never throws, never writes - the caller decides how loud to be.
function Test-ShippedLedger {
  param([Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Entries)
  $problems = @()
  $seen = @{}
  $newestNew = @{}
  foreach ($e in $Entries) {
    $where = "line $($e.lineNo)"
    if ($e.fields -lt 5) {
      $problems += "$where - expected at least 5 fields (version kind flag utc commit), got $($e.fields): $($e.raw)"
      continue
    }
    if (-not (Test-ShippableVersion $e.version)) {
      $problems += "$where - '$($e.version)' is not a shippable version (want N.N.N or N.N.N-tag)"
      continue
    }
    if ($script:AuroraLedgerKinds -notcontains $e.kind) {
      $problems += "$where - unknown kind '$($e.kind)' (want one of: $($script:AuroraLedgerKinds -join ', '))"
      continue
    }
    if ($script:AuroraLedgerFlags -notcontains $e.flag) {
      $problems += "$where - unknown flag '$($e.flag)' (want one of: $($script:AuroraLedgerFlags -join ', '))"
      continue
    }
    if ($e.utc -notmatch '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$') {
      $problems += "$where - '$($e.utc)' is not an ISO-8601 UTC stamp (want YYYY-MM-DDTHH:MM:SSZ)"
      continue
    }
    $key = "$($e.kind)/$($e.version)/$($e.flag)"
    if ($seen.ContainsKey($key)) {
      $problems += "$where - duplicate entry: $($e.kind) $($e.version) ($($e.flag)) already recorded on line $($seen[$key])"
      continue
    }
    $seen[$key] = $e.lineNo

    if ($e.flag -eq 'new') {
      # The whole point: shipped versions of one kind only ever go UP.
      if ($newestNew.ContainsKey($e.kind)) {
        $prev = $newestNew[$e.kind]
        if ((Compare-SemVer $e.version $prev.version) -le 0) {
          $problems += "$where - $($e.kind) $($e.version) is not greater than $($prev.version) recorded on line $($prev.lineNo); shipped versions must strictly increase"
          continue
        }
      }
      # ...and no artifact of ANY kind may come out below the newest version
      # already shipped in any form. Releases are forward-only; a package
      # below the high-water mark is one no hospital on that mark can apply.
      # Equal is allowed - that is the setup/update PAIR of one release.
      $floor = $null
      foreach ($k in $newestNew.Keys) {
        $v = $newestNew[$k].version
        if ($null -eq $floor -or (Compare-SemVer $v $floor) -gt 0) { $floor = $v }
      }
      if ($null -ne $floor -and (Compare-SemVer $e.version $floor) -lt 0) {
        $problems += "$where - $($e.kind) $($e.version) is below $floor, which has already shipped; releases are forward-only"
        continue
      }
      $newestNew[$e.kind] = $e
    } else {
      # A rebuild re-cuts the release that is already the newest one of its
      # kind. Rebuilding anything older would produce an artifact that the
      # field would refuse anyway, so it is a ledger error, not a choice.
      if (-not $newestNew.ContainsKey($e.kind)) {
        $problems += "$where - rebuild of $($e.kind) $($e.version) but no $($e.kind) release has been recorded yet"
        continue
      }
      if ($e.version -ne $newestNew[$e.kind].version) {
        $problems += "$where - rebuild of $($e.kind) $($e.version) but the newest $($e.kind) release is $($newestNew[$e.kind].version); only the newest release may be rebuilt"
        continue
      }
    }
  }
  return ,$problems
}

# Newest version recorded as a NEW release of this kind, or $null.
# -Kind '*' answers across every kind - the forward-only high-water mark.
function Get-NewestShippedVersion {
  param(
    [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Entries,
    [Parameter(Mandatory)][string]$Kind
  )
  $newest = $null
  foreach ($e in $Entries) {
    if ($Kind -ne '*' -and $e.kind -ne $Kind) { continue }
    if ($e.flag -ne 'new') { continue }
    if (-not (Test-ShippableVersion $e.version)) { continue }
    if ($null -eq $newest) { $newest = $e.version; continue }
    if ((Compare-SemVer $e.version $newest) -gt 0) { $newest = $e.version }
  }
  return $newest
}

# THE GATE. Returns @{ ok = <bool>; reason = <string>; newest = <string> }.
#
#   normal build (-Rebuild absent): $Version must be STRICTLY GREATER than
#     the newest recorded release of this kind. Equal is the forgotten-bump
#     case and is exactly what we refuse.
#   rebuild (-Rebuild present): $Version must EQUAL the newest recorded
#     release of this kind - re-cutting the artifact you last shipped
#     (a corrupted burn, a re-slice, a rebuilt payload). Deliberate,
#     recorded, and never silent.
function Test-ReleaseVersionGate {
  param(
    [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Entries,
    [Parameter(Mandatory)][string]$Kind,
    [Parameter(Mandatory)][AllowEmptyString()][string]$Version,
    [switch]$Rebuild
  )
  if ($script:AuroraLedgerKinds -notcontains $Kind) {
    return @{ ok = $false; newest = $null; reason = "unknown artifact kind '$Kind'" }
  }
  if (-not (Test-ShippableVersion $Version)) {
    return @{ ok = $false; newest = $null; reason = "AppVer '$Version' is not a shippable version - aurora.iss must read like `"1.2.0`" (three numeric components, optional -tag)" }
  }
  $newest = Get-NewestShippedVersion -Entries $Entries -Kind $Kind

  if ($Rebuild) {
    if ($null -eq $newest) {
      return @{ ok = $false; newest = $null; reason = "-RebuildVersion was given but no $Kind release has ever been recorded; this build IS the first one - drop -RebuildVersion" }
    }
    if ($Version -ne $newest) {
      return @{ ok = $false; newest = $newest; reason = "-RebuildVersion re-cuts the release you last shipped, which is $Kind $newest, but aurora.iss says $Version" }
    }
    return @{ ok = $true; newest = $newest; reason = "rebuild of $Kind $Version (the newest recorded release)" }
  }

  # Forward-only across BOTH kinds. Without this floor the first update
  # package would sail through at whatever version the setup last shipped at
  # minus anything - "no update has ever been recorded" is not a licence to
  # build one below the version hospitals are already running.
  $floor = Get-NewestShippedVersion -Entries $Entries -Kind '*'
  if ($null -ne $floor -and (Compare-SemVer $Version $floor) -lt 0) {
    $also = ''
    if ($null -ne $newest) { $also = " The last $Kind shipped was $newest." }
    return @{ ok = $false; newest = $newest; reason = "$Kind $Version is BELOW $floor, which has already shipped.$also Releases are forward-only: no hospital on $floor could apply it. Check out the right commit, or bump #define AppVer in installer\aurora.iss." }
  }

  if ($null -eq $newest) {
    $why = "first $Kind release recorded - nothing to compare against"
    if ($null -ne $floor -and (Compare-SemVer $Version $floor) -eq 0) {
      $why = "first $Kind release recorded, paired with the already-built $floor release (a hospital already ON $floor cannot apply it - that is expected for a pair)"
    }
    return @{ ok = $true; newest = $null; reason = $why }
  }
  $cmp = Compare-SemVer $Version $newest
  if ($cmp -gt 0) {
    return @{ ok = $true; newest = $newest; reason = "$Version is greater than the last shipped $Kind ($newest)" }
  }
  if ($cmp -eq 0) {
    return @{ ok = $false; newest = $newest; reason = "$Kind $Version HAS ALREADY SHIPPED. Every hospital already running $newest would REFUSE this package (aurora-update: 'not newer than installed') - the new code would ship and never run. Bump #define AppVer in installer\aurora.iss, or pass -RebuildVersion if you really are re-cutting the same release." }
  }
  # Unreachable by construction: $floor is the max over every kind, so it is
  # never below $newest, and anything under $newest was already refused by the
  # floor check. Left as an explicit refusal rather than a fall-through, so a
  # future change to the ordering above cannot turn this into a silent pass.
  return @{ ok = $false; newest = $newest; reason = "$Kind $Version is not greater than the last shipped $Kind ($newest)" }
}

# The line build-protected.ps1 appends. Pure - the caller does the writing.
function New-ShippedLedgerLine {
  param(
    [Parameter(Mandatory)][string]$Version,
    [Parameter(Mandatory)][string]$Kind,
    [Parameter(Mandatory)][string]$Flag,
    [Parameter(Mandatory)][string]$Utc,
    [Parameter(Mandatory)][AllowEmptyString()][string]$Commit,
    [AllowEmptyString()][string]$Note = ''
  )
  $c = $Commit
  if ([string]::IsNullOrWhiteSpace($c)) { $c = '-' }
  $n = $Note -replace '[\r\n]+', ' '
  return ('{0,-10} {1,-7} {2,-8} {3} {4,-10} {5}' -f $Version, $Kind, $Flag, $Utc, $c, $n).TrimEnd()
}
