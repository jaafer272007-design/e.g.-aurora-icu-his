<#
  AURORA ICU - the SHIP GATE (library; dot-source it).

  THE INVARIANT (environment-separation PR-4):
      WHAT AURORA SHIPS MUST BE WHAT AURORA VERIFIED.

  The protected Windows installer is the real shipping channel. Before this
  gate existed, build-protected.ps1 would compile a hospital-shippable
  artifact from WHATEVER the working tree held - verified or not. The
  verification machinery (ci.yml, the staging deployment, the sixteen
  deployed E2E suites) all existed, but nothing MECHANICAL stood between
  "verified" and "shipped"; the only converged gate lived on the dormant
  production-branch path (scripts/promotion-gate.sh) that nothing uses.
  This file closes that gap: build-protected.ps1 refuses to compile unless
  the exact content being shipped carries all four kinds of evidence:

    A. SOURCE IDENTITY  - a clean tree at a commit on origin/main (an
       artifact built from a dirty tree matches no commit, so no evidence
       can vouch for it; a feature-branch commit never ships).
    B. CI GREEN         - ci.yml (resolved by WORKFLOW IDENTITY, never by
       "some suite reported success") completed green for that exact
       commit, including every required job.
    C. STAGING CONTENT  - staging serves that content NOW: /healthz
       identity says staging and its build's server tree + render.yaml
       equal the shipping commit's; the staging Pages build.txt commit's
       frontend build context equals the shipping commit's. CONTENT
       equality (git trees/blobs), never version-string equality.
    D. SUITES GREEN ON THAT CONTENT - every deployed suite in the
       drift-checked inventory (scripts/ship-requirements.json, asserted
       against .github/workflows on disk - a suite added to the repo but
       not to the list fails LOUDLY) has its latest completed run green
       AND run against equal content. A green run against different bytes
       is not evidence; a green run for another commit with EQUAL trees is
       (content equality cuts both ways).

  FAIL-CLOSED. Every failure - including "verification is unavailable"
  (no network, no GitHub API, staging suspended) - is a REFUSAL, never a
  warning. Refusals are message-discriminated: each carries one class
  (SOURCE-DIRTY-TREE, CI-RED, SUITE-INVENTORY-DRIFT, ...) naming the
  actual failure, so "release validation failed" can never paper over a
  neutered check.

  WHAT THIS GATE DOES NOT DO. It ships nothing, tags nothing, mutates
  nothing - all reads (git plumbing, GET requests). It does not replace
  the VERSION gate (version-gate.ps1 - forgotten-bump protection), which
  runs first; both must pass. UNPROTECTED smoke builds (build.ps1) stay
  ungated: they are structurally non-shippable by filename and never
  leave the build machine. -RebuildVersion re-cuts are gated like any
  other build: whatever is compiled NOW must be verified content NOW.

  SHARED TRUTH. The requirements (workflow identity, required jobs,
  content paths, the suite inventory, endpoints) live in
  scripts/ship-requirements.json, read by BOTH this gate and the dormant
  scripts/promotion-gate.sh - one list, two consumers, no drift.

  PURITY SPLIT (the version-gate.ps1 pattern). Every Test-Ship* function
  is PURE - values in, verdict out (@{ ok; class; reason }), no disk, no
  network, no exit - and is unit-tested in installer/test-ship-gate.ps1
  on fixtures. The Get-Ship* fetchers are thin evidence-gatherers (git +
  HTTPS GETs); Invoke-ShipGate stages them cheapest-first so an offline
  refusal (dirty tree) never touches the network. GITHUB_TOKEN, if set,
  raises API rate limits; it is sent only as a header and never printed.

  POWERSHELL 5.1 ONLY. No ternaries, no '??', no '?.'; native commands
  wrapped against EAP=Stop stderr promotion; TLS12 forced explicitly.
#>

# Every refusal class this gate can emit. Fixed vocabulary - tests assert
# against these exact strings, and a refusal always names exactly one.
$script:ShipGateClasses = @(
  'VERIFY-MALFORMED',        # ship-requirements.json missing/invalid, or repo layout no longer matches it
  'VERIFY-UNAVAILABLE',      # evidence could not be OBTAINED (git broken, API unreachable) - still a refusal
  'SOURCE-DIRTY-TREE',       # uncommitted changes: the artifact would match no commit
  'SOURCE-NOT-ON-MAIN',      # HEAD is not a mainline commit (or origin/main is not resolvable)
  'CI-EVIDENCE-MISSING',     # no completed ci.yml run for this exact commit
  'CI-RED',                  # the ci.yml run for this commit did not conclude success
  'CI-JOB-MISSING',          # a required job did not run (renamed/removed)
  'CI-JOB-RED',              # a required job did not conclude success
  'STAGING-UNAVAILABLE',     # staging API/Pages gave no identity to verify against
  'STAGING-WRONG-ENVIRONMENT', # staging identifies as something other than staging
  'STAGING-CONTENT-MISMATCH',  # staging serves different content than the shipping commit
  'SUITE-INVENTORY-DRIFT',   # ship-requirements.json and .github/workflows disagree about the suite set
  'SUITE-EVIDENCE-MISSING',  # a required suite has no completed run
  'SUITE-RED',               # a required suite's latest completed run failed
  'SUITE-STALE-CONTENT'      # a required suite's green run verified different content
)

function New-ShipVerdict {
  param(
    [Parameter(Mandatory)][bool]$Ok,
    [Parameter(Mandatory)][AllowEmptyString()][string]$Class,
    [Parameter(Mandatory)][AllowEmptyString()][string]$Reason
  )
  return @{ ok = $Ok; class = $Class; reason = $Reason }
}

# ---- requirements validation (pure) ----------------------------------------
# Array of problem strings; empty means valid. The gate REFUSES on any
# problem (VERIFY-MALFORMED) - a requirements file it cannot fully trust
# cannot authorize anything.
function Get-ShipRequirementProblems {
  param([Parameter(Mandatory)][AllowNull()]$Req)
  $problems = @()
  if ($null -eq $Req) { return ,@('the requirements object is null (unparseable JSON?)') }
  $need = @('schema', 'ciWorkflowFile', 'ciRequiredJobs', 'serverContextPaths',
            'frontendContextPaths', 'deployedSuites', 'frontendContextSuites',
            'githubRepo', 'githubApi', 'stagingApi', 'stagingPages', 'mainRef')
  foreach ($k in $need) {
    if ($null -eq $Req.psobject.Properties[$k]) { $problems += "missing required field '$k'" }
  }
  if ($problems.Count -gt 0) { return ,$problems }
  if ($Req.schema -ne 'aurora-ship-requirements/1') {
    $problems += "unknown schema '$($Req.schema)' (want aurora-ship-requirements/1)"
  }
  foreach ($k in @('ciRequiredJobs', 'serverContextPaths', 'frontendContextPaths', 'deployedSuites')) {
    if (@($Req.$k).Count -lt 1) { $problems += "'$k' is empty - an empty requirement list would make the gate vacuous" }
  }
  if ($Req.githubRepo -notmatch '^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$') {
    $problems += "githubRepo '$($Req.githubRepo)' is not owner/name"
  }
  foreach ($k in @('githubApi', 'stagingApi', 'stagingPages')) {
    if ($Req.$k -notmatch '^https://') { $problems += "'$k' must be an https:// URL, got '$($Req.$k)'" }
  }
  foreach ($s in @($Req.frontendContextSuites)) {
    if (@($Req.deployedSuites) -notcontains $s) {
      $problems += "frontendContextSuites entry '$s' is not in deployedSuites"
    }
  }
  foreach ($s in @($Req.deployedSuites)) {
    if ($s -notmatch '^deployed-[a-z0-9-]+-e2e\.yml$') {
      $problems += "deployedSuites entry '$s' does not look like a deployed suite workflow file"
    }
  }
  return ,$problems
}

# ---- rev-list comparison (pure) --------------------------------------------
# $Want/$Got are ordered rev arrays aligned with $Paths (entries are git
# object hashes or 'MISSING:<path>'). Returns the paths whose revs differ.
function Compare-ShipRevList {
  param(
    [Parameter(Mandatory)][AllowEmptyCollection()][string[]]$Paths,
    [Parameter(Mandatory)][AllowEmptyCollection()][string[]]$Want,
    [Parameter(Mandatory)][AllowEmptyCollection()][string[]]$Got
  )
  $diff = @()
  for ($i = 0; $i -lt $Paths.Count; $i++) {
    $w = ''
    $g = ''
    if ($i -lt $Want.Count) { $w = $Want[$i] }
    if ($i -lt $Got.Count) { $g = $Got[$i] }
    if ($w -ne $g) { $diff += $Paths[$i] }
  }
  return ,$diff
}

# ---- A. source identity (pure) ---------------------------------------------
function Test-ShipSource {
  param([Parameter(Mandatory)]$Src)
  if (-not $Src.gitOk -or $Src.sha -notmatch '^[0-9a-f]{40}$') {
    return New-ShipVerdict $false 'VERIFY-UNAVAILABLE' ("cannot establish the source commit: $($Src.gitError) - the gate refuses when it cannot identify what would ship")
  }
  if (@($Src.dirty).Count -gt 0) {
    $sample = @($Src.dirty | Select-Object -First 3) -join '; '
    $more = ''
    if (@($Src.dirty).Count -gt 3) { $more = " (+$(@($Src.dirty).Count - 3) more)" }
    return New-ShipVerdict $false 'SOURCE-DIRTY-TREE' ("the working tree has $(@($Src.dirty).Count) uncommitted change(s): $sample$more. An artifact built from a dirty tree matches NO commit, so no CI, staging, or suite evidence can vouch for its content. Commit (and verify) or stash, then rebuild.")
  }
  if (-not $Src.mainRefResolved) {
    return New-ShipVerdict $false 'SOURCE-NOT-ON-MAIN' ("'$($Src.mainRef)' is not resolvable in this clone, so commit $($Src.sha.Substring(0,8)) cannot be proven to be a mainline commit. Run: git fetch origin main - then rebuild.")
  }
  if (-not $Src.onMain) {
    return New-ShipVerdict $false 'SOURCE-NOT-ON-MAIN' ("commit $($Src.sha) is NOT on $($Src.mainRef). The protected installer ships mainline commits only - no feature branches, no local-only commits, no cherry-picks.")
  }
  return New-ShipVerdict $true '' ("commit $($Src.sha) - clean tree, on $($Src.mainRef)")
}

# ---- B. ci.yml green, by workflow identity (pure) --------------------------
function Test-ShipCi {
  param(
    [Parameter(Mandatory)]$Req,
    [Parameter(Mandatory)]$Ci,
    [Parameter(Mandatory)][string]$Sha
  )
  $wf = $Req.ciWorkflowFile
  if (-not $Ci.queried) {
    return New-ShipVerdict $false 'VERIFY-UNAVAILABLE' ("could not query GitHub Actions for $wf runs on $($Sha.Substring(0,8)): $($Ci.error). Verification being unavailable is a refusal, never a warning.")
  }
  if (-not $Ci.found) {
    return New-ShipVerdict $false 'CI-EVIDENCE-MISSING' ("no $wf run exists for commit $Sha (resolved by workflow identity, head_sha match). Push the commit and let $wf complete before shipping.")
  }
  if ($Ci.headSha -ne $Sha) {
    return New-ShipVerdict $false 'CI-EVIDENCE-MISSING' ("the $wf run found (id $($Ci.runId)) is for commit $($Ci.headSha), not $Sha - evidence that cannot be mapped to the shipping commit authorizes nothing.")
  }
  if ($Ci.status -ne 'completed') {
    return New-ShipVerdict $false 'CI-EVIDENCE-MISSING' ("$wf run $($Ci.runId) for $($Sha.Substring(0,8)) is still '$($Ci.status)' - wait for it to complete.")
  }
  if ($Ci.conclusion -ne 'success') {
    return New-ShipVerdict $false 'CI-RED' ("$wf run $($Ci.runId) for commit $($Sha.Substring(0,8)) concluded '$($Ci.conclusion)' - nothing ships on a red $wf.")
  }
  if (-not $Ci.jobsQueried) {
    return New-ShipVerdict $false 'VERIFY-UNAVAILABLE' ("could not list the jobs of $wf run $($Ci.runId): $($Ci.jobsError). Verification being unavailable is a refusal, never a warning.")
  }
  foreach ($needJob in @($Req.ciRequiredJobs)) {
    $found = $null
    foreach ($j in @($Ci.jobs)) { if ($j.name -eq $needJob) { $found = $j; break } }
    if ($null -eq $found) {
      $present = @($Ci.jobs | ForEach-Object { $_.name }) -join ', '
      return New-ShipVerdict $false 'CI-JOB-MISSING' ("required job '$needJob' did not run in $wf run $($Ci.runId) (present: $present). If the job was renamed, update ciRequiredJobs in scripts/ship-requirements.json deliberately - the gate never guesses.")
    }
    if ($found.conclusion -ne 'success') {
      return New-ShipVerdict $false 'CI-JOB-RED' ("required job '$needJob' concluded '$($found.conclusion)' in $wf run $($Ci.runId).")
    }
  }
  return New-ShipVerdict $true '' ("$wf run $($Ci.runId) green for $($Sha.Substring(0,8)); required jobs all green: $(@($Req.ciRequiredJobs) -join ', ')")
}

# ---- C. staging serves this content (pure) ---------------------------------
function Test-ShipStaging {
  param(
    [Parameter(Mandatory)]$Req,
    [Parameter(Mandatory)]$Stg,
    [Parameter(Mandatory)][string]$Sha
  )
  # want-side sanity FIRST: if the shipping commit itself lacks a context
  # path, MISSING would equal MISSING on the got side and the comparison
  # would pass vacuously. That is a requirements/layout drift, not a match.
  $wantBroken = @(@($Stg.serverWant) + @($Stg.ctxWant) | Where-Object { $_ -like 'MISSING:*' })
  if ($wantBroken.Count -gt 0) {
    return New-ShipVerdict $false 'VERIFY-MALFORMED' ("commit $($Sha.Substring(0,8)) has no $($wantBroken -join ', ') - the context paths in scripts/ship-requirements.json no longer match the repository layout; fix the list deliberately.")
  }
  if (-not $Stg.api.reachable) {
    return New-ShipVerdict $false 'STAGING-UNAVAILABLE' ("staging API $($Req.stagingApi)/healthz gave no identity JSON: $($Stg.api.error). Without a live staging there is no verified content to ship - this includes a suspended or sleeping staging service. Fail closed.")
  }
  if ($Stg.api.environment -ne 'staging') {
    return New-ShipVerdict $false 'STAGING-WRONG-ENVIRONMENT' ("$($Req.stagingApi)/healthz reports environment '$($Stg.api.environment)', not 'staging' - a mis-wired staging cannot vouch for anything.")
  }
  if (-not $Stg.buildResolvable) {
    return New-ShipVerdict $false 'STAGING-CONTENT-MISMATCH' ("staging reports build '$($Stg.api.build)', which this clone cannot resolve to a commit - git fetch origin main and retry; if it persists, staging serves content this repository does not contain.")
  }
  $srvDiff = Compare-ShipRevList -Paths @($Stg.serverPaths) -Want @($Stg.serverWant) -Got @($Stg.serverGot)
  if ($srvDiff.Count -gt 0) {
    return New-ShipVerdict $false 'STAGING-CONTENT-MISMATCH' ("staging serves build $($Stg.api.build.Substring(0,8)) whose $($srvDiff -join ', ') differ(s) from commit $($Sha.Substring(0,8))'s. What ships must be what staging verified - deploy staging to this content first. (Trees are compared, never version strings.)")
  }
  if (-not $Stg.pages.reachable -or -not $Stg.pages.build) {
    return New-ShipVerdict $false 'STAGING-UNAVAILABLE' ("staging Pages $($Req.stagingPages)/build.txt is missing or empty: $($Stg.pages.error). The frontend half of staging cannot vouch for anything. Fail closed.")
  }
  if ($Stg.pages.environment -ne 'staging') {
    return New-ShipVerdict $false 'STAGING-WRONG-ENVIRONMENT' ("the staging Pages build.txt declares environment '$($Stg.pages.environment)', not 'staging' - deploy-pages is mis-wired; it cannot vouch for anything.")
  }
  if (-not $Stg.pagesBuildResolvable) {
    return New-ShipVerdict $false 'STAGING-CONTENT-MISMATCH' ("staging Pages reports build '$($Stg.pages.build)', which this clone cannot resolve to a commit - git fetch origin main and retry.")
  }
  $ctxDiff = Compare-ShipRevList -Paths @($Stg.ctxPaths) -Want @($Stg.ctxWant) -Got @($Stg.ctxGot)
  if ($ctxDiff.Count -gt 0) {
    return New-ShipVerdict $false 'STAGING-CONTENT-MISMATCH' ("the staging Pages frontend (build $($Stg.pages.build.Substring(0,8))) was built from a different frontend context than commit $($Sha.Substring(0,8)): differing path(s): $($ctxDiff -join ', '). Redeploy Pages on this content first.")
  }
  return New-ShipVerdict $true '' ("staging serves the shipping content (API build $($Stg.api.build.Substring(0,8)), Pages build $($Stg.pages.build.Substring(0,8)))")
}

# ---- D. every suite green on this content (pure) ---------------------------
function Test-ShipSuites {
  param(
    [Parameter(Mandatory)]$Req,
    [Parameter(Mandatory)]$Ste,
    [Parameter(Mandatory)][string]$Sha
  )
  # THE INVENTORY IS DRIFT-CHECKED. The old hardcoded list in
  # promotion-gate.sh silently shrank to 13 of 16 suites as new suites were
  # added; this comparison makes that class of omission impossible to miss.
  $required = @(@($Req.deployedSuites) | Sort-Object)
  $disk = @(@($Ste.diskSuites) | Sort-Object)
  $notRequired = @($disk | Where-Object { $required -notcontains $_ })
  $notOnDisk = @($required | Where-Object { $disk -notcontains $_ })
  if ($notRequired.Count -gt 0 -or $notOnDisk.Count -gt 0) {
    $parts = @()
    if ($notRequired.Count -gt 0) { $parts += "on disk but NOT required: $($notRequired -join ', ')" }
    if ($notOnDisk.Count -gt 0) { $parts += "required but NOT on disk: $($notOnDisk -join ', ')" }
    return New-ShipVerdict $false 'SUITE-INVENTORY-DRIFT' ("scripts/ship-requirements.json and .github/workflows disagree about the deployed-suite set - $($parts -join '; '). A suite the list does not know is a suite the gate does not demand; update deployedSuites deliberately.")
  }
  foreach ($s in $required) {
    $r = $Ste.runs[$s]
    if ($null -eq $r) {
      return New-ShipVerdict $false 'VERIFY-UNAVAILABLE' ("no run evidence was gathered for suite $s - the gate cannot judge what it did not fetch.")
    }
    if (-not $r.queried) {
      return New-ShipVerdict $false 'VERIFY-UNAVAILABLE' ("could not query GitHub Actions for $s runs: $($r.error). Verification being unavailable is a refusal, never a warning.")
    }
    if (-not $r.found) {
      return New-ShipVerdict $false 'SUITE-EVIDENCE-MISSING' ("suite $s has no completed run at all - dispatch it against staging and let it finish before shipping.")
    }
    if ($r.conclusion -ne 'success') {
      return New-ShipVerdict $false 'SUITE-RED' ("suite $s`: the latest completed run (id $($r.runId), head $($r.headSha.Substring(0,8))) concluded '$($r.conclusion)' - every deployed suite must be green.")
    }
    if (-not $r.headResolvable) {
      return New-ShipVerdict $false 'SUITE-STALE-CONTENT' ("suite $s`: the latest green run's head $($r.headSha) is unknown to this clone - its content cannot be proven equal to the shipping commit's. git fetch origin main and retry.")
    }
    $srvDiff = Compare-ShipRevList -Paths @($Ste.serverPaths) -Want @($Ste.serverWant) -Got @($r.serverGot)
    if ($srvDiff.Count -gt 0) {
      return New-ShipVerdict $false 'SUITE-STALE-CONTENT' ("suite $s`: the latest green run (head $($r.headSha.Substring(0,8))) verified DIFFERENT server content than commit $($Sha.Substring(0,8)) ($($srvDiff -join ', ') differ). A green run against different bytes is not evidence - re-run the suite on the shipping content.")
    }
    if (@($Req.frontendContextSuites) -contains $s) {
      $ctxDiff = Compare-ShipRevList -Paths @($Ste.ctxPaths) -Want @($Ste.ctxWant) -Got @($r.ctxGot)
      if ($ctxDiff.Count -gt 0) {
        return New-ShipVerdict $false 'SUITE-STALE-CONTENT' ("suite $s`: the latest green run (head $($r.headSha.Substring(0,8))) verified a DIFFERENT frontend context than commit $($Sha.Substring(0,8)) ($($ctxDiff -join ', ') differ) - re-run it on the shipping content.")
      }
    }
  }
  return New-ShipVerdict $true '' ("all $($required.Count) deployed suites green on the shipping content")
}

# ============================================================================
# Fetchers (impure). Thin, read-only, no retries: shipping is a deliberate
# act against a steady state, not a warm-up condition (the promotion-gate
# rule). Every network/git failure lands in the evidence for the pure
# judges to refuse on - nothing here exits or throws past its boundary.
# ============================================================================

function Invoke-ShipGit {
  param(
    [Parameter(Mandatory)][string]$RepoRoot,
    [Parameter(Mandatory)][string[]]$GitArgs
  )
  # Under EAP=Stop, 5.1 promotes native stderr to a TERMINATING error and
  # 2>$null does not prevent it (the build.ps1 commit-read lesson). Relax,
  # wrap, restore.
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $out = @()
  $code = 1
  try {
    $out = @(& git -C $RepoRoot @GitArgs 2>$null | ForEach-Object { [string]$_ })
    $code = $LASTEXITCODE
  } catch {
    $out = @()
    $code = 1
  } finally {
    $ErrorActionPreference = $prev
  }
  return @{ code = $code; out = $out }
}

# Ordered revs for $Commit`s content at each path ('MISSING:<path>' when the
# path does not exist at that commit) - the promotion-gate ctx rule, kept as
# a comparable LIST so refusals can name the differing path.
function Get-ShipTreeRevs {
  param(
    [Parameter(Mandatory)][string]$RepoRoot,
    [Parameter(Mandatory)][string]$Commit,
    [Parameter(Mandatory)][string[]]$Paths
  )
  $revs = @()
  foreach ($p in $Paths) {
    $r = Invoke-ShipGit -RepoRoot $RepoRoot -GitArgs @('rev-parse', '-q', '--verify', "${Commit}:${p}")
    $v = ''
    if ($r.code -eq 0 -and $r.out.Count -ge 1) { $v = ([string]$r.out[0]).Trim() }
    if ($v -match '^[0-9a-f]{40}$') { $revs += $v } else { $revs += "MISSING:$p" }
  }
  return ,$revs
}

function Test-ShipCommitResolvable {
  param(
    [Parameter(Mandatory)][string]$RepoRoot,
    [Parameter(Mandatory)][AllowEmptyString()][string]$Commit
  )
  if ($Commit -notmatch '^[0-9a-f]{40}$') { return $false }
  $r = Invoke-ShipGit -RepoRoot $RepoRoot -GitArgs @('cat-file', '-e', "$Commit^{commit}")
  return ($r.code -eq 0)
}

function Get-ShipWebHeaders {
  param([Parameter(Mandatory)][bool]$GitHub)
  $h = @{ 'User-Agent' = 'aurora-ship-gate' }
  if ($GitHub) {
    $h['Accept'] = 'application/vnd.github+json'
    # Raises rate limits only. Sent as a header, NEVER printed, never in a URL.
    if ($env:GITHUB_TOKEN) { $h['Authorization'] = "Bearer $($env:GITHUB_TOKEN)" }
  }
  return $h
}

function Invoke-ShipHttps {
  param(
    [Parameter(Mandatory)][string]$Url,
    [Parameter(Mandatory)][bool]$GitHub
  )
  # 5.1 defaults can exclude TLS 1.2; api.github.com requires it.
  [Net.ServicePointManager]::SecurityProtocol =
    [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  return Invoke-RestMethod -Uri $Url -Headers (Get-ShipWebHeaders -GitHub $GitHub) `
    -TimeoutSec 30 -UseBasicParsing
}

function Get-ShipSourceEvidence {
  param([Parameter(Mandatory)][string]$RepoRoot, [Parameter(Mandatory)]$Req)
  $ev = @{ gitOk = $false; gitError = ''; sha = ''; dirty = @()
           mainRef = [string]$Req.mainRef; mainRefResolved = $false; onMain = $false }
  $head = Invoke-ShipGit -RepoRoot $RepoRoot -GitArgs @('rev-parse', 'HEAD')
  if ($head.code -ne 0 -or $head.out.Count -lt 1) {
    $ev.gitError = 'git rev-parse HEAD failed (is this a git checkout with git on PATH?)'
    return $ev
  }
  $ev.sha = ([string]$head.out[0]).Trim()
  $st = Invoke-ShipGit -RepoRoot $RepoRoot -GitArgs @('status', '--porcelain')
  if ($st.code -ne 0) {
    $ev.gitError = 'git status --porcelain failed'
    return $ev
  }
  $ev.gitOk = $true
  $ev.dirty = @($st.out | Where-Object { $_ -and $_.Trim() -ne '' })
  $mr = Invoke-ShipGit -RepoRoot $RepoRoot -GitArgs @('rev-parse', '-q', '--verify', "$($ev.mainRef)^{commit}")
  $ev.mainRefResolved = ($mr.code -eq 0)
  if ($ev.mainRefResolved) {
    $anc = Invoke-ShipGit -RepoRoot $RepoRoot -GitArgs @('merge-base', '--is-ancestor', $ev.sha, $ev.mainRef)
    $ev.onMain = ($anc.code -eq 0)
  }
  return $ev
}

function Get-ShipCiEvidence {
  param(
    [Parameter(Mandatory)]$Req,
    [Parameter(Mandatory)][string]$Sha
  )
  $ev = @{ queried = $false; error = ''; found = $false; runId = 0; headSha = ''
           status = ''; conclusion = ''; jobsQueried = $false; jobsError = ''; jobs = @() }
  $base = "$($Req.githubApi)/repos/$($Req.githubRepo)"
  try {
    # BY WORKFLOW IDENTITY: /actions/workflows/<file>/runs can only return
    # runs of that workflow file - another suite's success cannot leak in.
    $resp = Invoke-ShipHttps -Url "$base/actions/workflows/$($Req.ciWorkflowFile)/runs?head_sha=$Sha&per_page=20" -GitHub $true
  } catch {
    $ev.error = $_.Exception.Message
    return $ev
  }
  if ($null -eq $resp -or $null -eq $resp.psobject.Properties['workflow_runs']) {
    $ev.error = 'the response carried no workflow_runs field'
    return $ev
  }
  $ev.queried = $true
  $runs = @($resp.workflow_runs)
  if ($runs.Count -lt 1) { return $ev }
  # newest first from the API; prefer the newest COMPLETED run, else report
  # the newest run's in-flight status so the refusal says "wait", not "absent".
  $run = $null
  foreach ($r in $runs) { if ($r.status -eq 'completed') { $run = $r; break } }
  if ($null -eq $run) { $run = $runs[0] }
  $ev.found = $true
  $ev.runId = $run.id
  $ev.headSha = [string]$run.head_sha
  $ev.status = [string]$run.status
  $ev.conclusion = [string]$run.conclusion
  if ($ev.status -ne 'completed' -or $ev.conclusion -ne 'success') { return $ev }
  try {
    $jresp = Invoke-ShipHttps -Url "$base/actions/runs/$($run.id)/jobs?per_page=100" -GitHub $true
  } catch {
    $ev.jobsError = $_.Exception.Message
    return $ev
  }
  if ($null -eq $jresp -or $null -eq $jresp.psobject.Properties['jobs']) {
    $ev.jobsError = 'the response carried no jobs field'
    return $ev
  }
  $ev.jobsQueried = $true
  $list = @()
  foreach ($j in @($jresp.jobs)) {
    $list += @{ name = [string]$j.name; conclusion = [string]$j.conclusion }
  }
  $ev.jobs = $list
  return $ev
}

function Get-ShipStagingEvidence {
  param(
    [Parameter(Mandatory)][string]$RepoRoot,
    [Parameter(Mandatory)]$Req,
    [Parameter(Mandatory)][string]$Sha
  )
  $srvPaths = @($Req.serverContextPaths | ForEach-Object { [string]$_ })
  $ctxPaths = @($Req.frontendContextPaths | ForEach-Object { [string]$_ })
  $ev = @{
    serverPaths = $srvPaths
    serverWant = (Get-ShipTreeRevs -RepoRoot $RepoRoot -Commit $Sha -Paths $srvPaths)
    serverGot = @()
    ctxPaths = $ctxPaths
    ctxWant = (Get-ShipTreeRevs -RepoRoot $RepoRoot -Commit $Sha -Paths $ctxPaths)
    ctxGot = @()
    api = @{ reachable = $false; error = ''; environment = ''; build = '' }
    buildResolvable = $false
    pages = @{ reachable = $false; error = ''; build = ''; environment = '' }
    pagesBuildResolvable = $false
  }
  try {
    $hz = Invoke-ShipHttps -Url "$($Req.stagingApi)/healthz" -GitHub $false
    if ($null -ne $hz -and $null -ne $hz.psobject.Properties['environment'] -and $null -ne $hz.psobject.Properties['build']) {
      $ev.api.reachable = $true
      $ev.api.environment = [string]$hz.environment
      $ev.api.build = [string]$hz.build
    } else {
      $ev.api.error = 'the response was not the /healthz identity JSON (a suspended service answers with an HTML page)'
    }
  } catch {
    $ev.api.error = $_.Exception.Message
  }
  if ($ev.api.reachable -and (Test-ShipCommitResolvable -RepoRoot $RepoRoot -Commit $ev.api.build)) {
    $ev.buildResolvable = $true
    $ev.serverGot = Get-ShipTreeRevs -RepoRoot $RepoRoot -Commit $ev.api.build -Paths $srvPaths
  }
  try {
    $body = [string](Invoke-ShipHttps -Url "$($Req.stagingPages)/build.txt" -GitHub $false)
    # two-line stamp since the environment-identity PR: sha, then environment
    $lines = @($body -split "\r?\n")
    $ev.pages.reachable = $true
    if ($lines.Count -ge 1) { $ev.pages.build = ([string]$lines[0]).Trim() }
    if ($lines.Count -ge 2) { $ev.pages.environment = ([string]$lines[1]).Trim() }
    if (-not $ev.pages.build) { $ev.pages.error = 'build.txt was served but its first line is empty' }
  } catch {
    $ev.pages.error = $_.Exception.Message
  }
  if ($ev.pages.reachable -and (Test-ShipCommitResolvable -RepoRoot $RepoRoot -Commit $ev.pages.build)) {
    $ev.pagesBuildResolvable = $true
    $ev.ctxGot = Get-ShipTreeRevs -RepoRoot $RepoRoot -Commit $ev.pages.build -Paths $ctxPaths
  }
  return $ev
}

function Get-ShipSuiteEvidence {
  param(
    [Parameter(Mandatory)][string]$RepoRoot,
    [Parameter(Mandatory)]$Req,
    [Parameter(Mandatory)][string]$Sha
  )
  $srvPaths = @($Req.serverContextPaths | ForEach-Object { [string]$_ })
  $ctxPaths = @($Req.frontendContextPaths | ForEach-Object { [string]$_ })
  $ev = @{
    serverPaths = $srvPaths
    serverWant = (Get-ShipTreeRevs -RepoRoot $RepoRoot -Commit $Sha -Paths $srvPaths)
    ctxPaths = $ctxPaths
    ctxWant = (Get-ShipTreeRevs -RepoRoot $RepoRoot -Commit $Sha -Paths $ctxPaths)
    diskSuites = @()
    runs = @{}
  }
  $wfDir = Join-Path $RepoRoot '.github/workflows'
  $ev.diskSuites = @(Get-ChildItem -Path $wfDir -Filter 'deployed-*-e2e.yml' -File |
    ForEach-Object { $_.Name } | Sort-Object)
  $base = "$($Req.githubApi)/repos/$($Req.githubRepo)"
  foreach ($s in @($Req.deployedSuites | ForEach-Object { [string]$_ })) {
    $r = @{ queried = $false; error = ''; found = $false; runId = 0; headSha = ''
            conclusion = ''; headResolvable = $false; serverGot = @(); ctxGot = @() }
    try {
      # the promotion-gate rule, verbatim: the LATEST COMPLETED run is the
      # suite's verdict - no scanning back for an older green.
      $resp = Invoke-ShipHttps -Url "$base/actions/workflows/$s/runs?status=completed&per_page=1" -GitHub $true
    } catch {
      $r.error = $_.Exception.Message
      $ev.runs[$s] = $r
      continue
    }
    if ($null -eq $resp -or $null -eq $resp.psobject.Properties['workflow_runs']) {
      $r.error = 'the response carried no workflow_runs field'
      $ev.runs[$s] = $r
      continue
    }
    $r.queried = $true
    $runs = @($resp.workflow_runs)
    if ($runs.Count -ge 1) {
      $r.found = $true
      $r.runId = $runs[0].id
      $r.headSha = [string]$runs[0].head_sha
      $r.conclusion = [string]$runs[0].conclusion
      if (Test-ShipCommitResolvable -RepoRoot $RepoRoot -Commit $r.headSha) {
        $r.headResolvable = $true
        $r.serverGot = Get-ShipTreeRevs -RepoRoot $RepoRoot -Commit $r.headSha -Paths $srvPaths
        if (@($Req.frontendContextSuites) -contains $s) {
          $r.ctxGot = Get-ShipTreeRevs -RepoRoot $RepoRoot -Commit $r.headSha -Paths $ctxPaths
        }
      }
    }
    $ev.runs[$s] = $r
  }
  return $ev
}

# ---- the orchestrator ------------------------------------------------------
# Stages the fetchers CHEAPEST-FIRST and stops at the first refusal, so a
# dirty tree refuses OFFLINE, before any network evidence is even requested
# (the CI leg asserts exactly that ordering). Returns the final verdict
# hashtable; on success it carries sha = the authorized commit. Prints
# progress; never prints secrets; NEVER skippable - there is no parameter,
# variable, or environment switch that bypasses a check.
function Invoke-ShipGate {
  param(
    [Parameter(Mandatory)][string]$RepoRoot,
    [Parameter(Mandatory)][string]$RequirementsPath
  )
  function SayGate([string]$m) { Write-Host "[ship-gate] $m" }

  if (-not (Test-Path $RequirementsPath)) {
    return New-ShipVerdict $false 'VERIFY-MALFORMED' ("the requirements file is missing: $RequirementsPath (it is committed to the repo - restore it rather than shipping blind)")
  }
  $req = $null
  try {
    $req = Get-Content -Raw -Path $RequirementsPath | ConvertFrom-Json
  } catch {
    return New-ShipVerdict $false 'VERIFY-MALFORMED' ("$RequirementsPath is not parseable JSON: $($_.Exception.Message)")
  }
  $problems = Get-ShipRequirementProblems -Req $req
  if ($problems.Count -gt 0) {
    return New-ShipVerdict $false 'VERIFY-MALFORMED' ("$RequirementsPath is invalid: $($problems -join '; ')")
  }
  SayGate "requirements: $RequirementsPath (schema $($req.schema), $(@($req.deployedSuites).Count) suites)"

  # A. source identity - OFFLINE; every later stage keys on this sha.
  $src = Get-ShipSourceEvidence -RepoRoot $RepoRoot -Req $req
  $v = Test-ShipSource -Src $src
  if (-not $v.ok) { return $v }
  SayGate "source identity: $($v.reason)"
  $sha = $src.sha

  # B. ci.yml green for this exact commit, by workflow identity.
  SayGate "ci evidence: querying $($req.ciWorkflowFile) runs for $($sha.Substring(0,8))..."
  $ci = Get-ShipCiEvidence -Req $req -Sha $sha
  $v = Test-ShipCi -Req $req -Ci $ci -Sha $sha
  if (-not $v.ok) { return $v }
  SayGate "ci evidence: $($v.reason)"

  # C. staging serves this content now.
  SayGate "staging content: querying $($req.stagingApi) and $($req.stagingPages)..."
  $stg = Get-ShipStagingEvidence -RepoRoot $RepoRoot -Req $req -Sha $sha
  $v = Test-ShipStaging -Req $req -Stg $stg -Sha $sha
  if (-not $v.ok) { return $v }
  SayGate "staging content: $($v.reason)"

  # D. every deployed suite green on this content (inventory drift-checked).
  SayGate "deployed suites: querying $(@($req.deployedSuites).Count) suites..."
  $ste = Get-ShipSuiteEvidence -RepoRoot $RepoRoot -Req $req -Sha $sha
  foreach ($s in @($ste.diskSuites)) {
    $r = $ste.runs[$s]
    if ($null -ne $r -and $r.found) {
      SayGate ("  {0}: {1} @ {2}" -f $s, $r.conclusion, $r.headSha.Substring(0, 8))
    } elseif ($null -ne $r) {
      SayGate ("  {0}: no completed run" -f $s)
    }
  }
  $v = Test-ShipSuites -Req $req -Ste $ste -Sha $sha
  if (-not $v.ok) { return $v }
  SayGate "deployed suites: $($v.reason)"

  $final = New-ShipVerdict $true '' ("verified content - ci.yml green, staging serves it, all $(@($req.deployedSuites).Count) suites green on it")
  $final.sha = $sha
  return $final
}
