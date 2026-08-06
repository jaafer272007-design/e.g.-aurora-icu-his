<#
  AURORA ICU - end-to-end EXIT CODE tests for aurora-update.ps1.

  WHY THIS FILE EXISTS
  --------------------
  installer\test-update-pure.ps1 dot-sources aurora-update.ps1 and calls its pure
  functions IN-PROCESS. That can never observe an exit code, and until 2026-08-06
  the failure helpers lived below the pure-test boundary so it could not even see
  them. Three defects shipped through that blind spot, all found in the field on a
  real hospital-shaped install and all reproduced before being fixed:

    1. $ErrorActionPreference='Stop' made the bare `Write-Error` in Fail /
       FailBetweenStates / FailRolledBack a TERMINATING error, so the following
       `exit N` never ran. Every failure exited 1. Codes 2 and 3 were unreachable
       and the wizard showed "NOT applied ... Nothing needs to be recovered" for a
       swap that had died with the service stopped.
    2. Worse in the other direction: FailRolledBack is called from INSIDE the
       rollback try{}, so its terminating error was caught by that block's catch{}
       and a SUCCESSFUL rollback was reported as "CRITICAL: the automatic rollback
       could not complete" (exit 2) - pushing an operator toward a needless
       database restore on a healthy system.
    3. The install-directory resolution was guarded by
       `if (-not $PSBoundParameters.ContainsKey('InstallDir'))` while
       aurora-update.iss ALWAYS passed -InstallDir, so the AuroraServer service was
       never consulted in the only path that ships.

  Every test below runs the REAL definitions in a REAL child process and asserts
  the REAL process exit code. Each one fails against the pre-fix code - the teeth
  are verifiable, not asserted.

  WINDOWS POWERSHELL 5.1 COMPATIBLE (and runs unchanged on pwsh 7 for local dev):
  no ternary, no ??, no ?., no .NET Core-only APIs.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$here      = Split-Path -Parent $MyInvocation.MyCommand.Path
$updater   = Join-Path $here 'aurora-update.ps1'
$issFile   = Join-Path $here 'aurora-update.iss'
if (-not (Test-Path $updater)) { Write-Host "FATAL: $updater not found"; exit 1 }

# The same engine that is running us - powershell.exe under 5.1, pwsh under 7.
$psExe = (Get-Process -Id $PID).Path
$tmp   = [System.IO.Path]::GetTempPath()

$script:Pass = 0
$script:Fail = 0

function Check([string]$name, $expected, $actual) {
  if ("$expected" -eq "$actual") {
    $script:Pass++
    Write-Host ("  PASS  " + $name + "  (= " + $actual + ")")
  } else {
    $script:Fail++
    Write-Host ("  FAIL  " + $name + "  expected " + $expected + ", got " + $actual)
  }
}

# Run a script body in a child process and return its EXIT CODE.
#
# $ErrorActionPreference = 'Continue' around the call IS LOAD-BEARING, and this
# harness learned it the way everything else in this file was learned - by
# failing on the engine that ships. Windows PowerShell 5.1 turns a NATIVE
# command's stderr into a NativeCommandError ErrorRecord; under EAP='Stop' that
# is TERMINATING. Every child here deliberately writes its failure message to
# stderr, so on 5.1 the FIRST assertion killed the whole harness before
# $LASTEXITCODE could be read, while on pwsh 7 (which does not do this) all 13
# passed locally. Suppressing with 2>$null is NOT enough - the preference fires
# before the redirection can discard it.
function Get-ChildExitCode([string]$body) {
  $f = Join-Path $tmp ("aurora-exitcode-" + [Guid]::NewGuid().ToString('N') + ".ps1")
  Set-Content -Encoding ascii -Path $f -Value $body
  $prev = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    & $psExe -NoProfile -ExecutionPolicy Bypass -File $f 2>$null 1>$null
    return $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prev
    Remove-Item -Force $f -ErrorAction SilentlyContinue
  }
}

# Preamble every harness shares: load the REAL definitions, then reproduce the
# live script's error preference exactly (aurora-update.ps1 sets it right after
# the pure-test boundary).
$preamble = @"
`$AuroraUpdatePureTest = `$true
. '$updater'
`$ErrorActionPreference = 'Stop'
"@

Write-Host ''
Write-Host '=== aurora-update.ps1 EXIT CODES (real definitions, real processes) ==='

# ---- 1-3. each helper must produce its own documented code --------------------
Check 'Fail exits 1 (refused, nothing changed)' `
  1 (Get-ChildExitCode ($preamble + "`nFail 'refused'"))

Check 'FailBetweenStates exits 2 (manual recovery)' `
  2 (Get-ChildExitCode ($preamble + "`nFailBetweenStates 'between states'"))

Check 'FailRolledBack exits 3 (rolled back, healthy)' `
  3 (Get-ChildExitCode ($preamble + "`nFailRolledBack 'rolled back'"))

# ---- 4. the rollback block's shape: FailRolledBack is called INSIDE a try{} ----
# whose catch{} reports the CRITICAL between-states message. `exit` is not an
# exception and must pass straight through. 99 = the catch ran (the old bug);
# 98 = execution continued past the call (also wrong).
Check 'FailRolledBack inside try/catch still exits 3, catch does NOT run' `
  3 (Get-ChildExitCode ($preamble + @"

try { FailRolledBack 'rolled back cleanly' } catch { exit 99 }
exit 98
"@))

# ---- 5. a Fail must still be a Fail when the caller wrapped it ----------------
Check 'Fail inside try/catch still exits 1, catch does NOT run' `
  1 (Get-ChildExitCode ($preamble + @"

try { Fail 'refused inside a try' } catch { exit 99 }
exit 98
"@))

# ---- 6. the transcript must still receive the message -------------------------
# -ErrorAction Continue was chosen over [Console]::Error.WriteLine precisely
# because Start-Transcript captures error records but not direct console writes,
# and update.log is the file the wizard tells the operator to read.
$logProbe = Join-Path $tmp ("aurora-exitcode-log-" + [Guid]::NewGuid().ToString('N') + ".log")
$rc = Get-ChildExitCode ($preamble + @"

Start-Transcript -Path '$logProbe' -Force | Out-Null
`$script:TranscriptOn = `$true
FailBetweenStates 'SENTINEL-IN-TRANSCRIPT'
"@)
$captured = $false
if (Test-Path $logProbe) {
  if (Select-String -Path $logProbe -Pattern 'SENTINEL-IN-TRANSCRIPT' -Quiet) { $captured = $true }
}
Remove-Item -Force $logProbe -ErrorAction SilentlyContinue
Check 'failure message reaches the transcript (update.log)' 'True' $captured
Check 'transcript run still exits 2' 2 $rc

Write-Host ''
Write-Host '=== install-directory resolution ORDER ==='

# ---- 7-9. Select-AuroraInstallDir is the pure ranking; test it in-process -----
$AuroraUpdatePureTest = $true
. $updater

Check 'explicit -InstallDir outranks service and fallback' `
  'X:\Explicit' (Select-AuroraInstallDir -Explicit 'X:\Explicit' -FromService 'S:\Svc' -Fallback 'F:\Fb')

Check 'service outranks the wizard fallback' `
  'S:\Svc' (Select-AuroraInstallDir -Explicit '' -FromService 'S:\Svc' -Fallback 'F:\Fb')

Check 'fallback used only when nothing else is known' `
  'F:\Fb' (Select-AuroraInstallDir -Explicit '' -FromService '' -Fallback 'F:\Fb')

Write-Host ''
Write-Host '=== the wizard must not defeat the resolution ==='

# ---- 10-11. The defect was a CONTRACT mismatch between two files, so assert the
# contract itself. A future edit that reintroduces -InstallDir in the .iss fails
# here even though both files parse and every unit test passes.
# Match the exact Pascal string literals the args concatenation uses, so prose in
# the surrounding comments (which necessarily names -InstallDir when explaining
# the defect) cannot make this pass or fail by accident.
$iss = Get-Content -Raw $issFile
Check 'aurora-update.iss builds args with -FallbackInstallDir' `
  'True' ($iss.Contains("' -FallbackInstallDir """))
Check 'aurora-update.iss no longer builds args with -InstallDir' `
  'True' (-not $iss.Contains("' -InstallDir """))
Check 'aurora-update.iss reads the real log path back from the relay' `
  'True' ($iss.Contains('aurora-update-log.txt'))

# ---- 12-15. The FINISHED PAGE must be derived from the exit code -------------
# It used to assert "The Aurora update has been applied." unconditionally - after
# a refusal, after a rollback, after a crash - and it is the last thing the
# operator reads. It also pointed at installer\update.log, which does not exist
# on an installed machine. Both are contract facts between the two files, so
# assert them here rather than trusting a future reader to notice.
Check 'the finished page records the updater exit code' `
  'True' ($iss.Contains('UpdateRc := rc'))
Check 'the finished page distinguishes "never ran" from "succeeded"' `
  'True' ($iss.Contains('UpdateRan'))
Check 'the finished page branches on the code, not one fixed sentence' `
  'True' ((([regex]::Matches($iss, 'FinishedLabel\.Caption')).Count) -ge 4)
Check 'the finished page no longer cites the non-existent installer\update.log' `
  'True' (-not $iss.Contains('installer\update.log'))

Write-Host ''
Write-Host '=== [Code] brace comments must not name an Inno constant ==='

# Pascal's { ... } comments do NOT nest. A brace comment in an [Code] section that
# mentions {app} or {tmp} therefore ENDS at that constant's closing brace, and the
# rest of the sentence is parsed as code. This shipped on 2026-08-06 and ISCC died
# with "'BEGIN' expected" on the first real compile - the .iss has no off-Windows
# syntax gate (no Linux Inno compiler exists), so review was the only check, and
# review does not see brace nesting. Cheap static rule: inside [Code], a line that
# opens or continues a brace comment must not contain '{'. Use // instead.
$issConstPattern = '\{(app|tmp|commondesktop|commonpf|sys|win|userdocs|group)\}'
$braceLeaks = @()
$inCode = $false
$inBrace = $false
$issLines = Get-Content $issFile
for ($i = 0; $i -lt $issLines.Count; $i++) {
  $l = $issLines[$i]
  if ($l -match '^\s*\[Code\]') { $inCode = $true; continue }
  if ($l -match '^\s*\[[A-Za-z]+\]') { $inCode = $false; continue }
  if (-not $inCode) { continue }
  $t = $l.TrimStart()
  # a line that STARTS a brace comment, or continues one already open
  $starts = $t.StartsWith('{') -and (-not $t.StartsWith('{$'))   # {$ is a compiler directive
  if ($starts) { $inBrace = $true }
  if ($inBrace) {
    if ($l -match $issConstPattern) { $braceLeaks += ("line " + ($i + 1) + ": " + $t) }
    # the comment closes on the first '}' AFTER the opening brace
    $afterOpen = if ($starts) { $t.Substring(1) } else { $t }
    if ($afterOpen.Contains('}')) { $inBrace = $false }
  }
}
if ($braceLeaks.Count -gt 0) { $braceLeaks | ForEach-Object { Write-Host ("        " + $_) } }
Check 'no [Code] brace comment names an Inno constant' 0 $braceLeaks.Count

Write-Host ''
Write-Host '=== no native command may leak stderr under EAP=Stop ==='

# Windows PowerShell 5.1 turns a NATIVE command's stderr into a
# NativeCommandError ErrorRecord, and aurora-update.ps1 runs under
# $ErrorActionPreference='Stop' - so ONE chatty line from psql, pg_restore or the
# backup engine becomes a terminating error thrown from wherever that call sits.
# On the rollback path that meant a SUCCESSFUL restore being reported as
# "CRITICAL: the automatic rollback could not complete".
#
# REDIRECTION IS NOT THE MITIGATION. This repo has measured, twice, on real
# installs, that it does not help: aurora-provision.ps1:544-547 ("2>&1 on a
# native command turns those stderr lines into TERMINATING errors") and
# aurora-ai-service.ps1:87-89 ("2>$null does NOT prevent that", 2026-07-26).
# Both were closed by RELAXING $ErrorActionPreference around the call. An
# earlier draft of this gate accepted a bare 2>&1 and would therefore have
# certified the unfixed rollback restore as safe - a false green in the repo
# whose own rule is that a skipped check and a passed check look identical.
#
# So: every native call must sit inside a try{}catch{} that absorbs the throw,
# or be preceded within 5 lines by an explicit relaxation of the preference.
$updaterLines = Get-Content $updater
$leaky = @()
$nativeSeen = 0
for ($i = 0; $i -lt $updaterLines.Count; $i++) {
  $line = $updaterLines[$i]
  # Skip comments. This file deliberately QUOTES the old broken psql invocation
  # in a comment to explain the hang it caused; linting that would be a false
  # positive on the very documentation that prevents the defect recurring.
  if ($line.TrimStart().StartsWith('#')) { continue }
  if ($line -match '&\s+\$(psql|exe|pkgExe)\b') {
    $nativeSeen++
    $guarded = ($line -match 'try\s*\{')
    if (-not $guarded) {
      $from = $i - 5; if ($from -lt 0) { $from = 0 }
      for ($j = $from; $j -lt $i; $j++) {
        if ($updaterLines[$j] -match "ErrorActionPreference\s*=\s*'Continue'") { $guarded = $true }
      }
    }
    if (-not $guarded) { $leaky += ("line " + ($i + 1) + ": " + $line.Trim()) }
  }
}
# Vacuity guard: a regex that matches nothing would "pass" silently.
Check 'the native-call scan actually found calls to check' 'True' ($nativeSeen -ge 5)
if ($leaky.Count -gt 0) { $leaky | ForEach-Object { Write-Host ("        " + $_) } }
Check 'every native invocation redirects stderr or is wrapped' 0 $leaky.Count

Write-Host ''
Write-Host '=== -replace on a command that emitted NOTHING (the AutomationNull trap) ==='

# THE DEFECT THAT BROKE THE FIRST REAL FIELD RUN (2026-08-06).
#
# aurora-update.ps1 formatted psql's stderr with an inline
#     ((Get-Content -Raw $headErr) -replace '\s+', ' ').Trim()
# A SUCCESSFUL psql writes nothing to stderr, so 2>$headErr leaves a ZERO-BYTE
# file, Get-Content -Raw emits NO OBJECTS AT ALL (AutomationNull, not $null), and
# PowerShell's -replace on that returns an EMPTY System.Object[] - which has no
# .Trim(). Under EAP=Stop that killed the updater at the precise moment every
# preceding step had succeeded, and the wizard reported exit 1: "the update was
# NOT applied". No update could ever have completed.
#
# WHY THIS GATE IS STATIC AND NOT A UNIT TEST. AutomationNull cannot survive
# being bound to a parameter - PowerShell converts it to a plain $null, and
# `$null -replace` is harmless. So calling any helper with the offending value
# CANNOT reproduce the defect; test-update-pure.ps1's ConvertTo-SingleLine
# assertions stay green even with the fix reverted (verified, which is why they
# are labelled as contract tests there). The hazard only exists at the SYNTAX
# level - -replace applied directly to the result of a command - so that is what
# is checked here.

# 1. Prove the hazard is real, in a real process, before trusting a lint about it.
$hazardBody = @"
`$ErrorActionPreference = 'Stop'
`$f = Join-Path '$tmp' ('aurora-an-' + [Guid]::NewGuid().ToString('N') + '.err')
Set-Content -Path `$f -Value '' -NoNewline
try {
  `$x = ((Get-Content -Raw `$f) -replace '\s+', ' ').Trim()
  Remove-Item -Force `$f -ErrorAction SilentlyContinue
  exit 0
} catch {
  Remove-Item -Force `$f -ErrorAction SilentlyContinue
  exit 42
}
"@
Check 'the inline -replace form really does throw on a 0-byte file' 42 (Get-ChildExitCode $hazardBody)

# 2. And that the shipped helper survives exactly that input.
$safeBody = $preamble + @"

`$f = Join-Path '$tmp' ('aurora-an-' + [Guid]::NewGuid().ToString('N') + '.err')
Set-Content -Path `$f -Value '' -NoNewline
try {
  `$x = ConvertTo-SingleLine (Get-Content -Raw `$f)
  Remove-Item -Force `$f -ErrorAction SilentlyContinue
  if (`$x -ne '') { exit 43 }
  exit 0
} catch {
  Remove-Item -Force `$f -ErrorAction SilentlyContinue
  exit 44
}
"@
Check 'ConvertTo-SingleLine returns empty for a 0-byte file' 0 (Get-ChildExitCode $safeBody)

# 3. The lint. A method may not be called on a -replace result unless the
#    left-hand side was cast to [string] first ([string]$null is '', and
#    '' -replace ... is a String, so .Trim() is safe).
$badReplace = '-replace[^)]*\)\s*\.\w+\('

# NON-VACUITY, PROVEN AGAINST THE TWO REAL HISTORICAL LINES. A lint whose regex
# silently stops matching is indistinguishable from a clean repo - the same
# failure mode as a skipped CI check. These four assertions pin it permanently.
$histUpdater = "  if (Test-Path `$headErr) { `$headErrText = ((Get-Content -Raw `$headErr) -replace '\s+', ' ').Trim() }"
$histAutowire = "  `$curProvider = ((`$envLines | Where-Object { `$_ -match '^AI_PROVIDER=' } | Select-Object -First 1) -replace '^AI_PROVIDER=', '').Trim()"
$fixedUpdater = "  if (Test-Path `$headErr) { `$headErrText = ConvertTo-SingleLine (Get-Content -Raw `$headErr) }"
$fixedAutowire = "  `$curProvider = ([string]((`$envLines | Where-Object { `$_ -match '^AI_PROVIDER=' } | Select-Object -First 1)) -replace '^AI_PROVIDER=', '').Trim()"
Check 'lint catches the historical aurora-update.ps1 line'  'True'  ($histUpdater  -match $badReplace)
Check 'lint catches the historical aurora-autowire.ps1 line' 'True' ($histAutowire -match $badReplace)
Check 'lint clears the fixed aurora-update.ps1 line'        'False' ($fixedUpdater -match $badReplace)
Check 'lint clears the fixed aurora-autowire.ps1 line (cast)' 'True' (($fixedAutowire -match $badReplace) -and ($fixedAutowire -match '\[string\]'))

# Scan every SHIPPING installer script (test-*.ps1 are excluded: this file quotes
# the broken forms above on purpose, and linting the documentation that prevents
# the defect would be a false positive on itself).
$offenders = @()
$scanned   = 0
foreach ($f in (Get-ChildItem -Path $here -Filter '*.ps1' | Where-Object { $_.Name -notlike 'test-*' })) {
  $scanned++
  $ls = Get-Content $f.FullName
  for ($i = 0; $i -lt $ls.Count; $i++) {
    $l = $ls[$i]
    if ($l.TrimStart().StartsWith('#')) { continue }
    if ($l -notmatch $badReplace) { continue }
    if ($l -match '\[string\]') { continue }        # the cast IS the fix
    $offenders += ($f.Name + ":" + ($i + 1) + ": " + $l.Trim())
  }
}
Check 'the -replace scan actually read the installer scripts' 'True' ($scanned -ge 4)
if ($offenders.Count -gt 0) { $offenders | ForEach-Object { Write-Host ("        " + $_) } }
Check 'no method is called on an uncast -replace result' 0 $offenders.Count

Write-Host ''
Write-Host ("RESULT: " + $script:Pass + " passed, " + $script:Fail + " failed")
if ($script:Fail -gt 0) { exit 1 }
exit 0
