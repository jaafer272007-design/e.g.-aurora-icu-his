<#
  AURORA ICU - build the hospital installer (run on a BUILD machine with the
  .NET 8 SDK, Node, Inno Setup, and internet; the HOSPITAL machine needs none
  of these). Produces installer\Output\AuroraSetup-<ver>-UNPROTECTED.exe -
  the PLAIN build, for build-machine smoke tests ONLY; it never ships.
  Shipping builds are made by build-protected.ps1 (single company install
  password - the configured path) or, dormant for scale, build-hospitals.ps1.

  Steps:
    1. build the React app (production bundle, same-origin by construction)
    2. dotnet publish the server SELF-CONTAINED for win-x64 (no .NET install
       on the hospital box) - the wwwroot (SPA) ships inside it
    3. stage a PRIVATE PostgreSQL (Windows binaries) into payload\pgsql
    4. stage the AI model file(s) into payload\model
    5. compile aurora.iss with ISCC -> AuroraSetup-<ver>-UNPROTECTED.exe

  WINDOWS-ONLY build (dotnet publish win-x64 can cross-build, but ISCC and
     the Postgres Windows binaries are Windows). CODE-REVIEWED here.
#>
[CmdletBinding()]
param(
  [string]$PgZip   = '',   # path to a PostgreSQL Windows binaries zip (EDB "binaries only"); required (full installer)
  [string]$ModelDir = '',  # folder with the .gguf model file(s); needed for the AI (else AI ships disabled)
  [string]$LlamaDir = '',  # folder with the Windows llama-server build (llama-server.exe + its DLLs, CUDA);
                           # needed for the AI (else AI ships disabled). See installer/README.md for the build.
  [switch]$UpdateOnly,     # build the small app-only update package (AuroraUpdate-<ver>.exe) instead of the full installer
  [switch]$SkipCompile,    # stage the payload but skip ISCC - build-hospitals.ps1 then compiles one ENCRYPTED installer per hospital
  [string]$Iscc = 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe'
)
$ErrorActionPreference = 'Stop'
$root    = Split-Path -Parent $PSScriptRoot           # repo root
$here    = $PSScriptRoot                              # installer\
$payload = Join-Path $here 'payload'
Remove-Item -Recurse -Force $payload -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $payload | Out-Null

Write-Host '== 1. React production bundle =='
Push-Location $root
try {
  & npm ci
  $env:VITE_APP_ENV = 'production'
  & npx vite build --base=/
  # the .NET server serves the SPA from wwwroot; ship the production bundle there
  Remove-Item -Recurse -Force (Join-Path $root 'server\wwwroot\assets') -ErrorAction SilentlyContinue
  Copy-Item -Recurse -Force (Join-Path $root 'dist\*') (Join-Path $root 'server\wwwroot')
} finally { Pop-Location }

Write-Host '== 2. self-contained server publish (win-x64) =='
# Stamp the commit INTO the assembly (-p:SourceRevisionId lands in
# InformationalVersion as "<version>+<sha>"). /healthz reports it back, which
# is what aurora-update compares against the package commit to prove the new
# build is really SERVING. Without it healthz says "dev" on Windows and every
# update rolls itself back. A checkout with no git available still builds -
# the value is simply absent and healthz falls back to "dev".
# [string] cast + relaxed preference, for two independent reasons. (a) If git
# emits nothing the subexpression is $null and .Trim() throws on it. (b) Under
# EAP=Stop, 5.1 turns git's stderr into a TERMINATING NativeCommandError and the
# 2>$null does NOT prevent it. Either way $commit stayed '' and the package built
# ANYWAY with healthz reporting "dev" - a package whose health check can never
# pass, so every update made from it would roll itself back with no stated cause.
$commit = ''
$prevEapC = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try { $commit = ([string](& git -C $root rev-parse HEAD 2>$null)).Trim() } catch { }
$ErrorActionPreference = $prevEapC
$revArgs = @()
if ($commit) { $revArgs = @("-p:SourceRevisionId=$commit") } else { Write-Host '   (no git commit available - the build will report itself as "dev")' }
# A full installer with build="dev" is merely unlabelled. An UPDATE package with
# build="dev" is broken by construction: aurora-update.ps1 proves the new build is
# really serving by polling /healthz until build == package.commit, and "dev" can
# never equal the commit in version.json. Every update made from such a package
# would time out and roll itself back, with the operator told only that the new
# build "did not become healthy". Refuse to produce it.
if ($UpdateOnly -and -not $commit) {
  throw 'refusing to build an update package with no git commit: /healthz would report "dev", the updater health check could never pass, and every update from this package would roll itself back. Run from a git checkout with git on PATH.'
}
# AppVer is read HERE, before the publish, because it is stamped INTO the
# assembly. Until 2026-08-06 nothing set a version at all: AuroraIcu.Api.csproj
# declares none and the build passed only SourceRevisionId, so .NET fell back to
# its default and every build of every release stamped FileVersion 1.0.0.0. An
# owner checking the running exe in Task Manager after a successful 1.2.0 update
# saw "1.0.0" and reasonably concluded the update had not applied. Hospital IT
# will look in exactly the same place.
$appVer = ([regex]::Match((Get-Content -Raw (Join-Path $here 'aurora.iss')),
  '#define\s+AppVer\s+"([^"]+)"').Groups[1].Value)
if (-not $appVer) { throw 'could not read AppVer from aurora.iss' }
# -p:Version sets AssemblyVersion/FileVersion/InformationalVersion together.
# SourceRevisionId still appends "+<sha>" to InformationalVersion, which is what
# Program.cs ResolveRunningBuild parses and /healthz reports - and what
# aurora-update.ps1 compares against the package commit to prove the new build is
# really serving. If that suffix were ever lost, EVERY update would fail its
# health check and roll back, so ci.yml asserts both halves on the real publish.
& dotnet publish (Join-Path $root 'server\AuroraIcu.Api.csproj') `
  -c Release -r win-x64 --self-contained true -p:PublishSingleFile=false `
  "-p:Version=$appVer" @revArgs -o (Join-Path $payload 'server')
if ($LASTEXITCODE -ne 0) { throw 'dotnet publish failed' }

Write-Host '== 2b. version identity (server\version.json - for aurora-update) =='
# A real version + migration-set identity the app-only updater reasons about (see
# installer/UPDATE_AND_ENABLE_AI_DESIGN.md sec 1). Nothing reads it at RUNTIME; it is
# consumed by aurora-update.ps1. Single source of the version: aurora.iss AppVer.
# $appVer was read above, before the publish, so it could be stamped into the
# assembly as well as into version.json. One read, one source of truth.
# migrationHead = the NEWEST EF migration compiled into this build. The ids are
# timestamp-prefixed, so the lexical max is the head.
$migHead = (Get-ChildItem (Join-Path $root 'server\Core\Persistence\Migrations') -Filter '*.cs' |
  Where-Object { $_.Name -notmatch '\.Designer\.cs$' -and $_.Name -notmatch 'ModelSnapshot\.cs$' } |
  ForEach-Object { [IO.Path]::GetFileNameWithoutExtension($_.Name) } | Sort-Object | Select-Object -Last 1)
if (-not $migHead) { throw 'no EF migrations found - cannot stamp migrationHead' }
# requiredEnvKeys = the aurora.env keys THIS build's provisioner always writes.
# aurora-update.ps1 carries a hospital's aurora.env across UNCHANGED, so a key
# introduced by a release a hospital skipped is simply absent; the updater
# compares this list against the live file and warns. Derived from the marked
# region of aurora-provision.ps1 so a NEW key cannot be forgotten here - the
# only hand-maintained part is the optional list below (keys that are written
# CONDITIONALLY, or deliberately removed later; treating those as required
# would warn on every healthy install).
$optionalEnvKeys = @(
  'ADMIN_BOOTSTRAP_PASSWORD',   # removed by the admin's first password change - absence is CORRECT
  'BACKUP_USB',                 # only when an off-site copy was configured
  'TZ',                         # only when a hospital clock was chosen
  'AI_PROVIDER', 'AI_ENDPOINT', 'AI_MODEL', 'AI_TIMEOUT_SECONDS', 'AI_UNAVAILABLE_REASON'
)
$provisionSrc = Get-Content -Raw (Join-Path $here 'aurora-provision.ps1')
$envRegion = [regex]::Match($provisionSrc,
  '(?s)# AURORA-ENV-KEYS-BEGIN(.*?)# AURORA-ENV-KEYS-END')
if (-not $envRegion.Success) {
  throw 'the AURORA-ENV-KEYS-BEGIN/END markers are missing from aurora-provision.ps1 - cannot derive requiredEnvKeys (did a refactor drop them?)'
}
$envKeyPattern = '[' + [char]39 + [char]34 + ']([A-Z][A-Z0-9_]{2,})='   # a quoted UPPER_KEY= literal
$requiredEnvKeys = @([regex]::Matches($envRegion.Groups[1].Value, $envKeyPattern) |
  ForEach-Object { $_.Groups[1].Value } |
  Sort-Object -Unique |
  Where-Object { $optionalEnvKeys -notcontains $_ })
# sentinels: if the extraction ever silently stops working, fail the BUILD rather
# than ship a version.json whose check is vacuous.
foreach ($must in @('DATABASE_URL', 'BACKUP_DIR', 'JWT_SECRET')) {
  if ($requiredEnvKeys -notcontains $must) {
    throw "requiredEnvKeys extraction is broken - '$must' not found in the marked aurora.env region of aurora-provision.ps1"
  }
}
$version = [ordered]@{
  schema        = 'aurora-app-version/1'
  version       = $appVer
  major         = [int]($appVer.Split('.')[0])
  commit        = $commit
  migrationHead = $migHead
  environment   = 'production'
  requiredEnvKeys = $requiredEnvKeys
  builtAt       = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
}
$version | ConvertTo-Json | Set-Content -Encoding ascii -Path (Join-Path $payload 'server\version.json')
Write-Host "   version.json: $appVer (major $($version.major)), migrationHead $migHead, commit $($commit.Substring(0,[Math]::Min(8,$commit.Length)))"

if ($UpdateOnly) {
  # ---- APP-ONLY UPDATE PACKAGE (aurora-update, design sec 2). Just the server\ payload
  #      (+ its version.json) + the updater + a SHA256SUMS the updater verifies, wrapped
  #      into a self-extracting AuroraUpdate-<ver>.exe. No pgsql/model/llama - those are
  #      untouched on the hospital box. ----
  Write-Host '== 3u. SHA256SUMS over the server payload =='
  $sums = Join-Path $payload 'SHA256SUMS'
  if (Test-Path $sums) { Remove-Item -Force $sums }
  # 5.1-COMPATIBLE relative path. [IO.Path]::GetRelativePath is .NET Core 2.1+
  # ONLY: it PARSES on Windows PowerShell 5.1 and then throws MethodNotFound at
  # RUNTIME, which is what every build machine actually runs. It broke the
  # update-package build outright (found 2026-08-05 on a real 5.1 build box).
  # This is the same class as the #184 ternary defect - a 5.1 incompatibility -
  # but a runtime one, so the CI parse gate could not see it. The substring is
  # exact, not an approximation: every file here is enumerated from under
  # $payload, and the guard below refuses rather than emitting a wrong path.
  # The emitted form must stay 'server\<...>' with backslashes - aurora-update.ps1
  # parses these lines with '^\s*([0-9a-fA-F]{64})\s+(.+?)\s*$' and resolves each
  # via Join-Path against the package root.
  $payloadFull = (Resolve-Path -LiteralPath $payload).ProviderPath.TrimEnd('\')
  Push-Location $payload
  try {
    Get-ChildItem -Recurse -File 'server' | ForEach-Object {
      $full = $_.FullName
      if (-not $full.StartsWith(($payloadFull + '\'), [StringComparison]::OrdinalIgnoreCase)) {
        throw "cannot compute a package-relative path: '$full' is not under '$payloadFull'. Refusing to write a SHA256SUMS the updater could not resolve."
      }
      $rel = $full.Substring($payloadFull.Length + 1)
      "$((Get-FileHash -Algorithm SHA256 -Path $full).Hash.ToLowerInvariant())  $rel"
    } | Set-Content -Encoding ascii $sums
  } finally { Pop-Location }
  Copy-Item -Force (Join-Path $here 'aurora-update.ps1') (Join-Path $payload 'aurora-update.ps1')
  @{ schema='aurora-update-bundle/1'; version=$appVer; builtAt=$version.builtAt
     files=(Get-Content $sums | Measure-Object -Line).Lines } |
    ConvertTo-Json | Set-Content -Encoding ascii (Join-Path $payload 'manifest.json')
  Write-Host "== 4u. compile AuroraUpdate-$appVer.exe =="
  if ($SkipCompile) {
    Write-Host '  SKIPPED (-SkipCompile): the update payload is staged; build-protected.ps1 -UpdateOnly compiles the ENCRYPTED update package.'
    return
  }
  # same refuse-guard as the full-installer compile: a lingering password
  # must not silently turn this "plain" update build into an encrypted one.
  if ($env:AURORA_INSTALL_PASSWORD) {
    throw 'AURORA_INSTALL_PASSWORD is set. For a shipping update package run build-protected.ps1 -UpdateOnly; for a plain UNPROTECTED smoke-test build first run: Remove-Item Env:\AURORA_INSTALL_PASSWORD'
  }
  if (-not (Test-Path $Iscc)) { throw "Inno Setup compiler not found at $Iscc (install Inno Setup 6, or pass -Iscc)." }
  & $Iscc "/DAppVer=$appVer" (Join-Path $here 'aurora-update.iss')
  if ($LASTEXITCODE -ne 0) { throw 'ISCC (update) failed' }
  Write-Host "DONE - UNPROTECTED (plain) update package at $(Join-Path $here 'Output') - smoke tests only, never ship this file."
  return
}

Write-Host '== 3. private PostgreSQL binaries =='
if (-not $PgZip -or -not (Test-Path $PgZip)) {
  throw 'Provide -PgZip <postgresql-16-windows-x64-binaries.zip> (EDB "binaries only" download). The hospital never installs Postgres - it is bundled.'
}
$pgTmp = Join-Path $env:TEMP ('aurora-pg-' + [Guid]::NewGuid().ToString('N'))
Expand-Archive -Path $PgZip -DestinationPath $pgTmp -Force
# the zip contains a top-level pgsql\ ; copy bin\ share\ lib\ into payload\pgsql
$pgRoot = Join-Path $pgTmp 'pgsql'
if (-not (Test-Path $pgRoot)) { $pgRoot = $pgTmp }
New-Item -ItemType Directory -Force -Path (Join-Path $payload 'pgsql') | Out-Null
foreach ($d in @('bin','share','lib')) {
  if (Test-Path (Join-Path $pgRoot $d)) { Copy-Item -Recurse -Force (Join-Path $pgRoot $d) (Join-Path $payload 'pgsql') }
}
Remove-Item -Recurse -Force $pgTmp -ErrorAction SilentlyContinue

Write-Host '== 4. AI model + llama-server (the native AI service - PR C) =='
# The AI is the native AuroraAI Windows service: llama-server serving the
# OpenAI-compatible endpoint AiApi.cs already speaks to. Both the model (GGUF)
# and the llama-server Windows build ship ALONGSIDE the payload; the installer
# registers the service only when the target machine has an NVIDIA GPU.
New-Item -ItemType Directory -Force -Path (Join-Path $payload 'model') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $payload 'llama') | Out-Null
$aiModel = $ModelDir -and (Test-Path $ModelDir)
$aiLlama = $LlamaDir -and (Test-Path $LlamaDir)
if ($aiModel) { Copy-Item -Recurse -Force (Join-Path $ModelDir '*') (Join-Path $payload 'model') }
else { Write-Host '  (no -ModelDir - the model is not bundled; AI ships DISABLED)' }
if ($aiLlama) {
  Copy-Item -Recurse -Force (Join-Path $LlamaDir '*') (Join-Path $payload 'llama')
  foreach ($need in @('llama-server.exe','nssm.exe')) {
    if (-not (Test-Path (Join-Path $payload "llama\$need"))) {
      throw "-LlamaDir must contain $need. It needs the Windows llama.cpp server build (llama-server.exe + its CUDA DLLs) AND nssm.exe (the service host). See installer/README.md."
    }
  }
} else { Write-Host '  (no -LlamaDir - llama-server is not bundled; AI ships DISABLED)' }
if ($aiModel -xor $aiLlama) {
  Write-Host '  WARNING: only one of -ModelDir / -LlamaDir was given. The AI needs BOTH - it will ship DISABLED.'
}

Write-Host '== 5. compile the installer =='
if ($SkipCompile) {
  Write-Host '  SKIPPED (-SkipCompile): the payload is staged; the caller (build-protected.ps1 or build-hospitals.ps1) compiles the ENCRYPTED installer.'
  return
}
# A password lingering in the environment (e.g. a protected build that was
# killed before its cleanup ran) would silently turn this "plain" compile
# into an encrypted one nobody knows the intent of. Refuse - be explicit.
if ($env:AURORA_INSTALL_PASSWORD) {
  throw 'AURORA_INSTALL_PASSWORD is set. For a shipping build run build-protected.ps1; for a plain UNPROTECTED smoke-test build first run: Remove-Item Env:\AURORA_INSTALL_PASSWORD'
}
if (-not (Test-Path $Iscc)) { throw "Inno Setup compiler not found at $Iscc (install Inno Setup 6, or pass -Iscc)." }
& $Iscc (Join-Path $here 'aurora.iss')
if ($LASTEXITCODE -ne 0) { throw 'ISCC failed' }
Write-Host "DONE - UNPROTECTED (plain) installer at $(Join-Path $here 'Output') - smoke tests only, never ship this file."
