<#
  Pure unit tests for installer\ship-gate.ps1 - the verified-content SHIP
  gate (environment-separation PR-4).

  These run under Windows PowerShell 5.1 in CI (the installer-powershell
  job), the same engine build-protected.ps1 runs on. Nothing here touches
  the network: the pure judges are fed FIXTURE evidence for every refusal
  class and for the authorize path. The only disk reads are the committed
  requirements file, the repo's own workflow files, and the scripts this
  file pins structurally (build-protected.ps1, promotion-gate.sh) - reads,
  never writes. The gate's REAL fetch path (network and all) is exercised
  by the separate ci.yml leg that runs build-protected.ps1 itself and
  asserts the SOURCE-DIRTY-TREE refusal.

  Run:  powershell -ExecutionPolicy Bypass -File .\installer\test-ship-gate.ps1
#>
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'ship-gate.ps1')

$script:pass = 0
$script:fail = 0
function Assert([bool]$cond, [string]$what) {
  if ($cond) { $script:pass++; Write-Host "  ok   $what" }
  else { $script:fail++; Write-Host "  FAIL $what" -ForegroundColor Red }
}
function Section([string]$t) { Write-Host ""; Write-Host "== $t ==" -ForegroundColor Cyan }

$repoRoot = Split-Path -Parent $PSScriptRoot
$reqPath = Join-Path $repoRoot 'scripts\ship-requirements.json'

# ---------------------------------------------------- the refusal alphabet --
Section 'The refusal classes are a fixed vocabulary'
Assert ($script:ShipGateClasses.Count -eq 15) '15 classes exactly (a class added or dropped is a deliberate act)'
foreach ($c in @('SOURCE-DIRTY-TREE', 'SOURCE-NOT-ON-MAIN', 'CI-EVIDENCE-MISSING', 'CI-RED',
                 'CI-JOB-MISSING', 'CI-JOB-RED', 'STAGING-UNAVAILABLE', 'STAGING-WRONG-ENVIRONMENT',
                 'STAGING-CONTENT-MISMATCH', 'SUITE-INVENTORY-DRIFT', 'SUITE-EVIDENCE-MISSING',
                 'SUITE-RED', 'SUITE-STALE-CONTENT', 'VERIFY-UNAVAILABLE', 'VERIFY-MALFORMED')) {
  Assert ($script:ShipGateClasses -contains $c) "class $c exists"
}

# ---------------------------------------------------- requirements parsing --
Section 'Get-ShipRequirementProblems - the COMMITTED requirements file is valid'
Assert (Test-Path $reqPath) 'scripts\ship-requirements.json exists'
$req = Get-Content -Raw $reqPath | ConvertFrom-Json
$p = Get-ShipRequirementProblems -Req $req
foreach ($x in $p) { Write-Host "       $x" -ForegroundColor Red }
Assert ($p.Count -eq 0) 'the committed requirements file has no problems'

Section 'Get-ShipRequirementProblems rejects what it must'
$p = Get-ShipRequirementProblems -Req ('{"schema":"aurora-ship-requirements/1"}' | ConvertFrom-Json)
Assert ($p.Count -ge 1 -and (@($p) -join ' ') -match "missing required field 'deployedSuites'") 'missing fields are named'
$broken = Get-Content -Raw $reqPath | ConvertFrom-Json
$broken.deployedSuites = @()
$p = Get-ShipRequirementProblems -Req $broken
Assert ($p.Count -ge 1 -and (@($p) -join ' ') -match 'vacuous') 'an EMPTY suite list is refused as vacuous, not accepted as trivially green'
$broken = Get-Content -Raw $reqPath | ConvertFrom-Json
$broken.schema = 'aurora-ship-requirements/999'
$p = Get-ShipRequirementProblems -Req $broken
Assert ($p.Count -ge 1 -and (@($p) -join ' ') -match 'unknown schema') 'an unknown schema is refused'
$broken = Get-Content -Raw $reqPath | ConvertFrom-Json
$broken.frontendContextSuites = @('deployed-nonexistent-e2e.yml')
$p = Get-ShipRequirementProblems -Req $broken
Assert ($p.Count -ge 1 -and (@($p) -join ' ') -match 'not in deployedSuites') 'a frontend-context suite outside the inventory is refused'
$p = Get-ShipRequirementProblems -Req $null
Assert ($p.Count -ge 1) 'a null requirements object is refused'

# ------------------------------------------------------------ fixtures ------
# Two distinct commits: A is the shipping commit; B is a DIFFERENT commit
# whose content trees are EQUAL to A's (the content-equality rule: equal
# bytes are evidence, equal version strings are not, unequal bytes never are).
$SHA_A = 'a' * 40
$SHA_B = 'b' * 40
$srvPaths = @($req.serverContextPaths | ForEach-Object { [string]$_ })
$ctxPaths = @($req.frontendContextPaths | ForEach-Object { [string]$_ })
$wantSrv = @(); for ($i = 0; $i -lt $srvPaths.Count; $i++) { $wantSrv += ('1{0:d3}' -f $i).PadRight(40, '1') }
$wantCtx = @(); for ($i = 0; $i -lt $ctxPaths.Count; $i++) { $wantCtx += ('2{0:d3}' -f $i).PadRight(40, '2') }

function New-GoodSource {
  return @{ gitOk = $true; gitError = ''; sha = $SHA_A; dirty = @()
            mainRef = 'origin/main'; mainRefResolved = $true; onMain = $true }
}
function New-GoodCi {
  $jobs = @()
  foreach ($j in @($req.ciRequiredJobs)) { $jobs += @{ name = [string]$j; conclusion = 'success' } }
  return @{ queried = $true; error = ''; found = $true; runId = 99000111222; headSha = $SHA_A
            status = 'completed'; conclusion = 'success'; jobsQueried = $true; jobsError = ''; jobs = $jobs }
}
function New-GoodStaging {
  # .Clone() everywhere an array lands in a fixture: @($arr) does NOT copy
  # an existing array in PowerShell, and a test that mutates a shared array
  # would silently corrupt every later fixture.
  return @{
    serverPaths = $srvPaths; serverWant = $wantSrv.Clone(); serverGot = $wantSrv.Clone()
    ctxPaths = $ctxPaths; ctxWant = $wantCtx.Clone(); ctxGot = $wantCtx.Clone()
    api = @{ reachable = $true; error = ''; environment = 'staging'; build = $SHA_B }
    buildResolvable = $true
    pages = @{ reachable = $true; error = ''; build = $SHA_B; environment = 'staging' }
    pagesBuildResolvable = $true
  }
}
function New-GoodSuites {
  $runs = @{}
  foreach ($s in @($req.deployedSuites)) {
    $ctxGot = @()
    if (@($req.frontendContextSuites) -contains $s) { $ctxGot = $wantCtx.Clone() }
    $runs[[string]$s] = @{ queried = $true; error = ''; found = $true; runId = 88000111222
                           headSha = $SHA_B; conclusion = 'success'; headResolvable = $true
                           serverGot = $wantSrv.Clone(); ctxGot = $ctxGot }
  }
  return @{ serverPaths = $srvPaths; serverWant = $wantSrv.Clone()
            ctxPaths = $ctxPaths; ctxWant = $wantCtx.Clone()
            diskSuites = @($req.deployedSuites | ForEach-Object { [string]$_ }); runs = $runs }
}

# ------------------------------------------------------------- A. source ----
Section 'Test-ShipSource'
$v = Test-ShipSource -Src (New-GoodSource)
Assert ($v.ok) 'a clean tree on origin/main is eligible'
Assert ($v.reason -match $SHA_A) 'and the reason names the commit'

$e = New-GoodSource; $e.dirty = @(' M installer/aurora.iss', '?? notes.txt')
$v = Test-ShipSource -Src $e
Assert (-not $v.ok -and $v.class -eq 'SOURCE-DIRTY-TREE') 'a dirty tree is refused as SOURCE-DIRTY-TREE'
Assert ($v.reason -match 'matches NO commit') 'the refusal explains WHY a dirty tree cannot be authorized'
Assert ($v.reason -match 'aurora\.iss') 'and names what is dirty'

$e = New-GoodSource; $e.onMain = $false
$v = Test-ShipSource -Src $e
Assert (-not $v.ok -and $v.class -eq 'SOURCE-NOT-ON-MAIN') 'a commit off main is refused as SOURCE-NOT-ON-MAIN'
Assert ($v.reason -match 'feature branch') 'the refusal names the feature-branch rule'

$e = New-GoodSource; $e.mainRefResolved = $false; $e.onMain = $false
$v = Test-ShipSource -Src $e
Assert (-not $v.ok -and $v.class -eq 'SOURCE-NOT-ON-MAIN') 'an unresolvable origin/main refuses (fail closed)'
Assert ($v.reason -match 'git fetch origin main') 'and says how to fix it'

$e = New-GoodSource; $e.gitOk = $false; $e.sha = ''; $e.gitError = 'git rev-parse HEAD failed'
$v = Test-ShipSource -Src $e
Assert (-not $v.ok -and $v.class -eq 'VERIFY-UNAVAILABLE') 'no git identity at all is VERIFY-UNAVAILABLE'

# ------------------------------------------------------------- B. ci --------
Section 'Test-ShipCi'
$v = Test-ShipCi -Req $req -Ci (New-GoodCi) -Sha $SHA_A
Assert ($v.ok) 'a green ci.yml run with all required jobs green authorizes'
Assert ($v.reason -match '99000111222') 'and the reason names the run id'
Assert ($v.reason -match 'installer-powershell') 'and lists the required jobs'

$e = New-GoodCi; $e.queried = $false; $e.error = 'api.github.com unreachable'
$v = Test-ShipCi -Req $req -Ci $e -Sha $SHA_A
Assert (-not $v.ok -and $v.class -eq 'VERIFY-UNAVAILABLE') 'an unreachable API is VERIFY-UNAVAILABLE'
Assert ($v.reason -match 'never a warning') 'and states the fail-closed rule in words'

$e = New-GoodCi; $e.found = $false
$v = Test-ShipCi -Req $req -Ci $e -Sha $SHA_A
Assert (-not $v.ok -and $v.class -eq 'CI-EVIDENCE-MISSING') 'no run for the commit is CI-EVIDENCE-MISSING'
Assert ($v.reason -match [regex]::Escape($SHA_A)) 'and names the commit that lacks evidence'

# THE no-false-authorization case: a run for commit B can never vouch for A.
$e = New-GoodCi; $e.headSha = $SHA_B
$v = Test-ShipCi -Req $req -Ci $e -Sha $SHA_A
Assert (-not $v.ok -and $v.class -eq 'CI-EVIDENCE-MISSING') "a run for a DIFFERENT commit authorizes nothing"
Assert ($v.reason -match 'cannot be mapped') 'and the refusal says the evidence is unmappable'

$e = New-GoodCi; $e.status = 'in_progress'; $e.conclusion = ''
$v = Test-ShipCi -Req $req -Ci $e -Sha $SHA_A
Assert (-not $v.ok -and $v.class -eq 'CI-EVIDENCE-MISSING' -and $v.reason -match 'wait') 'an in-flight run is not evidence yet'

$e = New-GoodCi; $e.conclusion = 'failure'
$v = Test-ShipCi -Req $req -Ci $e -Sha $SHA_A
Assert (-not $v.ok -and $v.class -eq 'CI-RED') 'a red run is CI-RED'

$e = New-GoodCi; $e.jobs = @($e.jobs | Where-Object { $_.name -ne 'installer-powershell' })
$v = Test-ShipCi -Req $req -Ci $e -Sha $SHA_A
Assert (-not $v.ok -and $v.class -eq 'CI-JOB-MISSING') 'a missing required job is CI-JOB-MISSING'
Assert ($v.reason -match "installer-powershell") 'and names the missing job'
Assert ($v.reason -match 'ship-requirements\.json') 'and points at the deliberate-update path'

$e = New-GoodCi
foreach ($j in $e.jobs) { if ($j.name -eq 'server') { $j.conclusion = 'failure' } }
$v = Test-ShipCi -Req $req -Ci $e -Sha $SHA_A
Assert (-not $v.ok -and $v.class -eq 'CI-JOB-RED' -and $v.reason -match "'server'") 'a red required job is CI-JOB-RED and named'

# ------------------------------------------------------------- C. staging ---
Section 'Test-ShipStaging'
$v = Test-ShipStaging -Req $req -Stg (New-GoodStaging) -Sha $SHA_A
Assert ($v.ok) 'staging serving EQUAL content authorizes'
# $SHA_B here is deliberate: staging runs a different COMMIT whose trees are
# equal - content equality is the rule, commit vanity is not.
Assert ($v.reason -match $SHA_B.Substring(0, 8)) 'the reason names the staging build'

$e = New-GoodStaging; $e.api = @{ reachable = $false; error = 'suspended HTML page'; environment = ''; build = '' }; $e.buildResolvable = $false; $e.serverGot = @()
$v = Test-ShipStaging -Req $req -Stg $e -Sha $SHA_A
Assert (-not $v.ok -and $v.class -eq 'STAGING-UNAVAILABLE') 'an unreachable staging API is STAGING-UNAVAILABLE'
Assert ($v.reason -match 'suspended or sleeping') 'and the refusal covers the suspended-service case in words'

$e = New-GoodStaging; $e.api.environment = 'production'
$v = Test-ShipStaging -Req $req -Stg $e -Sha $SHA_A
Assert (-not $v.ok -and $v.class -eq 'STAGING-WRONG-ENVIRONMENT') 'a wrong healthz environment is STAGING-WRONG-ENVIRONMENT'
Assert ($v.reason -match "'production'") 'and names what it actually said'

$e = New-GoodStaging; $e.buildResolvable = $false; $e.serverGot = @()
$v = Test-ShipStaging -Req $req -Stg $e -Sha $SHA_A
Assert (-not $v.ok -and $v.class -eq 'STAGING-CONTENT-MISMATCH') 'an unresolvable staging build sha is a content mismatch (fail closed)'

$e = New-GoodStaging; $e.serverGot = $wantSrv.Clone(); $e.serverGot[0] = 'f' * 40
$v = Test-ShipStaging -Req $req -Stg $e -Sha $SHA_A
Assert (-not $v.ok -and $v.class -eq 'STAGING-CONTENT-MISMATCH') 'a differing server tree is STAGING-CONTENT-MISMATCH'
Assert ($v.reason -match 'server') 'and names the differing path'
Assert ($v.reason -match 'never version strings') 'and states the trees-not-version-strings rule'

# VACUITY GUARD: if the SHIPPING COMMIT itself lacks a context path, MISSING
# would equal MISSING and the comparison would pass while checking nothing.
$e = New-GoodStaging
$e.serverWant = $wantSrv.Clone(); $e.serverWant[0] = 'MISSING:server'
$e.serverGot = $wantSrv.Clone(); $e.serverGot[0] = 'MISSING:server'
$v = Test-ShipStaging -Req $req -Stg $e -Sha $SHA_A
Assert (-not $v.ok -and $v.class -eq 'VERIFY-MALFORMED') 'MISSING==MISSING is refused as malformed, never passed as equal'

$e = New-GoodStaging; $e.pages = @{ reachable = $false; error = 'no build.txt'; build = ''; environment = '' }; $e.pagesBuildResolvable = $false; $e.ctxGot = @()
$v = Test-ShipStaging -Req $req -Stg $e -Sha $SHA_A
Assert (-not $v.ok -and $v.class -eq 'STAGING-UNAVAILABLE') 'missing Pages build.txt is STAGING-UNAVAILABLE'

$e = New-GoodStaging; $e.pages.environment = ''
$v = Test-ShipStaging -Req $req -Stg $e -Sha $SHA_A
Assert (-not $v.ok -and $v.class -eq 'STAGING-WRONG-ENVIRONMENT') 'a one-line (pre-identity) build.txt refuses on the environment line'

$e = New-GoodStaging; $e.ctxGot = $wantCtx.Clone(); $e.ctxGot[3] = 'e' * 40
$v = Test-ShipStaging -Req $req -Stg $e -Sha $SHA_A
Assert (-not $v.ok -and $v.class -eq 'STAGING-CONTENT-MISMATCH') 'a differing frontend context is STAGING-CONTENT-MISMATCH'
Assert ($v.reason -match 'vite\.config\.ts') 'and names the differing frontend path'

# ------------------------------------------------------------- D. suites ----
Section 'Test-ShipSuites'
$v = Test-ShipSuites -Req $req -Ste (New-GoodSuites) -Sha $SHA_A
Assert ($v.ok) 'all suites green on equal content authorizes'
Assert ($v.reason -match "$(@($req.deployedSuites).Count) deployed suites") 'and the reason counts the full inventory'

$e = New-GoodSuites; $e.diskSuites = @($e.diskSuites | Where-Object { $_ -ne 'deployed-handoff-e2e.yml' })
$v = Test-ShipSuites -Req $req -Ste $e -Sha $SHA_A
Assert (-not $v.ok -and $v.class -eq 'SUITE-INVENTORY-DRIFT') 'a required suite missing from disk is SUITE-INVENTORY-DRIFT'
Assert ($v.reason -match 'deployed-handoff-e2e\.yml') 'and names it'

$e = New-GoodSuites; $e.diskSuites = @($e.diskSuites) + @('deployed-brandnew-e2e.yml')
$v = Test-ShipSuites -Req $req -Ste $e -Sha $SHA_A
Assert (-not $v.ok -and $v.class -eq 'SUITE-INVENTORY-DRIFT') 'a NEW suite on disk the list does not know is SUITE-INVENTORY-DRIFT'
Assert ($v.reason -match 'deployed-brandnew-e2e\.yml') 'and names it (the old 13-of-16 silent omission is now impossible)'

$e = New-GoodSuites; $e.runs['deployed-mar-e2e.yml'].found = $false
$v = Test-ShipSuites -Req $req -Ste $e -Sha $SHA_A
Assert (-not $v.ok -and $v.class -eq 'SUITE-EVIDENCE-MISSING' -and $v.reason -match 'deployed-mar-e2e\.yml') 'a suite with no completed run is SUITE-EVIDENCE-MISSING and named'

$e = New-GoodSuites; $e.runs['deployed-labs-e2e.yml'].conclusion = 'failure'
$v = Test-ShipSuites -Req $req -Ste $e -Sha $SHA_A
Assert (-not $v.ok -and $v.class -eq 'SUITE-RED' -and $v.reason -match 'deployed-labs-e2e\.yml') 'a red suite is SUITE-RED and named'

$e = New-GoodSuites; $e.runs['deployed-adt-e2e.yml'].serverGot = $wantSrv.Clone(); $e.runs['deployed-adt-e2e.yml'].serverGot[0] = 'd' * 40
$v = Test-ShipSuites -Req $req -Ste $e -Sha $SHA_A
Assert (-not $v.ok -and $v.class -eq 'SUITE-STALE-CONTENT') 'a green run against different server bytes is SUITE-STALE-CONTENT'
Assert ($v.reason -match 'different bytes is not evidence') 'and states the rule: a green run against different bytes is not evidence'

$e = New-GoodSuites; $e.runs['deployed-print-e2e.yml'].ctxGot = $wantCtx.Clone(); $e.runs['deployed-print-e2e.yml'].ctxGot[0] = 'c' * 40
$v = Test-ShipSuites -Req $req -Ste $e -Sha $SHA_A
Assert (-not $v.ok -and $v.class -eq 'SUITE-STALE-CONTENT' -and $v.reason -match 'frontend context') 'the print suite is additionally held to the FRONTEND context'

$e = New-GoodSuites; $e.runs['deployed-auth-e2e.yml'].ctxGot = @('9' * 40)
$v = Test-ShipSuites -Req $req -Ste $e -Sha $SHA_A
Assert ($v.ok) 'a non-frontend suite is NOT held to the frontend context (exactly the promotion-gate rule)'

$e = New-GoodSuites; $e.runs['deployed-users-e2e.yml'].queried = $false; $e.runs['deployed-users-e2e.yml'].error = 'timeout'
$v = Test-ShipSuites -Req $req -Ste $e -Sha $SHA_A
Assert (-not $v.ok -and $v.class -eq 'VERIFY-UNAVAILABLE') 'an unqueryable suite is VERIFY-UNAVAILABLE (fail closed)'

$e = New-GoodSuites; $e.runs['deployed-orders-e2e.yml'].headResolvable = $false
$v = Test-ShipSuites -Req $req -Ste $e -Sha $SHA_A
Assert (-not $v.ok -and $v.class -eq 'SUITE-STALE-CONTENT' -and $v.reason -match 'unknown to this clone') 'an unresolvable run head cannot prove content equality'

# --------------------------------------- the chokepoint is STRUCTURAL -------
Section 'build-protected.ps1 cannot bypass the ship gate (AST pins)'
$bpPath = Join-Path $PSScriptRoot 'build-protected.ps1'
$tokens = $null; $errors = $null
$bpAst = [System.Management.Automation.Language.Parser]::ParseFile($bpPath, [ref]$tokens, [ref]$errors)
Assert ($errors.Count -eq 0) 'build-protected.ps1 parses (the pins below are meaningless otherwise)'

$cmds = $bpAst.FindAll({ $args[0] -is [System.Management.Automation.Language.CommandAst] }, $true)
$invokeGate = @($cmds | Where-Object { $_.GetCommandName() -eq 'Invoke-ShipGate' })
Assert ($invokeGate.Count -ge 1) 'build-protected.ps1 CALLS Invoke-ShipGate (the chokepoint exists - vacuity guard)'

$pwPrompt = @($cmds | Where-Object { $_.GetCommandName() -eq 'Read-Masked' -and $_.Extent.Text -match 'Company install password' })
Assert ($pwPrompt.Count -ge 1) 'the password prompt was found (the ordering pin below is meaningless otherwise)'
if ($invokeGate.Count -ge 1 -and $pwPrompt.Count -ge 1) {
  Assert ($invokeGate[0].Extent.StartOffset -lt $pwPrompt[0].Extent.StartOffset) 'the ship gate runs BEFORE the password prompt (a refusal never costs a typed secret)'
}
$verGate = @($cmds | Where-Object { $_.GetCommandName() -eq 'Test-ReleaseVersionGate' })
Assert ($verGate.Count -ge 1) 'the VERSION gate call is still present (the ship gate replaced nothing)'
if ($verGate.Count -ge 1 -and $invokeGate.Count -ge 1) {
  Assert ($verGate[0].Extent.StartOffset -lt $invokeGate[0].Extent.StartOffset) 'the version gate still runs FIRST (its CI refusal proof stays valid)'
}

# The parameter list is PINNED. A new parameter on the shipping script is
# how a bypass would arrive (-SkipShipGate); adding one must fail here until
# a human proves it cannot bypass the gate and updates this list.
$pinnedParams = @('PgZip', 'ModelDir', 'LlamaDir', 'UpdateOnly', 'Iscc', 'SkipStage', 'OutputDir', 'RebuildVersion', 'RebuildReason')
$actualParams = @($bpAst.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath })
Assert ($actualParams.Count -eq $pinnedParams.Count) "build-protected.ps1 has exactly $($pinnedParams.Count) parameters (a NEW one must prove it cannot bypass the ship gate, then update this pin)"
foreach ($pp in $pinnedParams) { Assert ($actualParams -contains $pp) "parameter -$pp is still present" }

$bpText = Get-Content -Raw $bpPath
Assert ($bpText -notmatch '(?i)skipship|noship|SKIP_SHIP') 'no skip-the-ship-gate switch exists in any spelling'
$sgText = Get-Content -Raw (Join-Path $PSScriptRoot 'ship-gate.ps1')
Assert ($sgText -notmatch '(?i)skipship|noship|SKIP_SHIP') 'ship-gate.ps1 itself carries no bypass switch'

# ------------------------------- shared truth stays in sync with the repo ---
Section 'ship-requirements.json <-> the repository (drift fails loudly)'
$wfDir = Join-Path $repoRoot '.github\workflows'
$diskSuites = @(Get-ChildItem -Path $wfDir -Filter 'deployed-*-e2e.yml' -File | ForEach-Object { $_.Name } | Sort-Object)
Assert ($diskSuites.Count -ge 10) "found $($diskSuites.Count) deployed suites on disk (vacuity guard)"
$jsonSuites = @($req.deployedSuites | ForEach-Object { [string]$_ } | Sort-Object)
$missingFromJson = @($diskSuites | Where-Object { $jsonSuites -notcontains $_ })
$missingFromDisk = @($jsonSuites | Where-Object { $diskSuites -notcontains $_ })
foreach ($x in $missingFromJson) { Write-Host "       on disk, not in JSON: $x" -ForegroundColor Red }
foreach ($x in $missingFromDisk) { Write-Host "       in JSON, not on disk: $x" -ForegroundColor Red }
Assert ($missingFromJson.Count -eq 0 -and $missingFromDisk.Count -eq 0) 'deployedSuites EXACTLY equals the deployed-*-e2e.yml files on disk'

$ciText = Get-Content -Raw (Join-Path $wfDir 'ci.yml')
foreach ($j in @($req.ciRequiredJobs)) {
  Assert ($ciText -match "(?m)^  $([regex]::Escape([string]$j)):") "required job '$j' exists in ci.yml (a rename breaks this test, not the gate silently)"
}

# frontendContextPaths must equal the print suite's ctx_hash list - SAME
# paths, SAME order (order changes the bash hash even when the set is equal).
$printText = Get-Content -Raw (Join-Path $wfDir 'deployed-print-e2e.yml')
$m = [regex]::Match($printText, 'for p in\s+(.+?);\s*do')
Assert ($m.Success) "found the ctx_hash path list in deployed-print-e2e.yml (vacuity guard)"
$printPaths = @($m.Groups[1].Value -split '\s+' | Where-Object { $_ })
Assert ($printPaths.Count -eq $ctxPaths.Count) "same ctx path COUNT as deployed-print-e2e.yml ($($printPaths.Count) vs $($ctxPaths.Count))"
$orderOk = $true
for ($i = 0; $i -lt [Math]::Min($printPaths.Count, $ctxPaths.Count); $i++) {
  if ($printPaths[$i] -ne $ctxPaths[$i]) { $orderOk = $false; Write-Host "       position $i`: print='$($printPaths[$i])' json='$($ctxPaths[$i])'" -ForegroundColor Red }
}
Assert $orderOk 'frontendContextPaths matches deployed-print-e2e.yml ctx_hash - same paths, same ORDER'

# the staging endpoints must be the ones the suites actually run against
$feText = Get-Content -Raw (Join-Path $wfDir 'deployed-frontend-e2e.yml')
$mApi = [regex]::Match($feText, '(?m)^\s*API:\s*(\S+)')
$mPages = [regex]::Match($feText, '(?m)^\s*PAGES:\s*(\S+)')
Assert ($mApi.Success -and $mApi.Groups[1].Value -eq [string]$req.stagingApi) "stagingApi matches the suites' API ($($mApi.Groups[1].Value))"
Assert ($mPages.Success -and $mPages.Groups[1].Value -eq [string]$req.stagingPages) "stagingPages matches the suites' PAGES ($($mPages.Groups[1].Value))"

# promotion-gate.sh must READ the shared truth, not carry its own copy - the
# stale hardcoded 13-suite list is exactly the defect PR-4 removes.
$pgText = Get-Content -Raw (Join-Path $repoRoot 'scripts\promotion-gate.sh')
Assert ($pgText -match 'ship-requirements\.json') 'promotion-gate.sh reads ship-requirements.json'
Assert ($pgText -notmatch 'deployed-auth-e2e\.yml') 'promotion-gate.sh no longer hardcodes its own suite list'
Assert ($pgText -notmatch 'for p in src index\.html') 'promotion-gate.sh no longer hardcodes its own ctx path list'
Assert ($pgText -match 'INVENTORY') 'promotion-gate.sh gained the suite-inventory drift check'

# ------------------------------------------------ token handling ------------
Section 'GITHUB_TOKEN is a header, never anything else'
$hadToken = $null -ne $env:GITHUB_TOKEN
$savedToken = $env:GITHUB_TOKEN
$env:GITHUB_TOKEN = 'test-token-do-not-print'
try {
  $h = Get-ShipWebHeaders -GitHub $true
  Assert ($h['Authorization'] -eq 'Bearer test-token-do-not-print') 'a set GITHUB_TOKEN reaches the Authorization header'
  $h2 = Get-ShipWebHeaders -GitHub $false
  Assert ($null -eq $h2['Authorization']) 'staging requests never carry the GitHub token'
} finally {
  if ($hadToken) { $env:GITHUB_TOKEN = $savedToken } else { Remove-Item Env:\GITHUB_TOKEN -ErrorAction SilentlyContinue }
}

Write-Host ""
Write-Host "passed $script:pass, failed $script:fail"
if ($script:fail -gt 0) { exit 1 }
exit 0
