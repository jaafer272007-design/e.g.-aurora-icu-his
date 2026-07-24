<#
  AURORA ICU - build the hospital installer (run on a BUILD machine with the
  .NET 8 SDK, Node, Inno Setup, and internet; the HOSPITAL machine needs none
  of these). Produces installer\Output\AuroraSetup-<ver>.exe.

  Steps:
    1. build the React app (production bundle, same-origin by construction)
    2. dotnet publish the server SELF-CONTAINED for win-x64 (no .NET install
       on the hospital box) - the wwwroot (SPA) ships inside it
    3. stage a PRIVATE PostgreSQL (Windows binaries) into payload\pgsql
    4. stage the AI model file(s) into payload\model
    5. compile aurora.iss with ISCC -> the single AuroraSetup.exe

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
& dotnet publish (Join-Path $root 'server\AuroraIcu.Api.csproj') `
  -c Release -r win-x64 --self-contained true -p:PublishSingleFile=false `
  -o (Join-Path $payload 'server')
if ($LASTEXITCODE -ne 0) { throw 'dotnet publish failed' }

Write-Host '== 2b. version identity (server\version.json - for aurora-update) =='
# A real version + migration-set identity the app-only updater reasons about (see
# installer/UPDATE_AND_ENABLE_AI_DESIGN.md sec 1). Nothing reads it at RUNTIME; it is
# consumed by aurora-update.ps1. Single source of the version: aurora.iss AppVer.
$appVer = ([regex]::Match((Get-Content -Raw (Join-Path $here 'aurora.iss')),
  '#define\s+AppVer\s+"([^"]+)"').Groups[1].Value)
if (-not $appVer) { throw 'could not read AppVer from aurora.iss' }
# migrationHead = the NEWEST EF migration compiled into this build. The ids are
# timestamp-prefixed, so the lexical max is the head.
$migHead = (Get-ChildItem (Join-Path $root 'server\Core\Persistence\Migrations') -Filter '*.cs' |
  Where-Object { $_.Name -notmatch '\.Designer\.cs$' -and $_.Name -notmatch 'ModelSnapshot\.cs$' } |
  ForEach-Object { [IO.Path]::GetFileNameWithoutExtension($_.Name) } | Sort-Object | Select-Object -Last 1)
if (-not $migHead) { throw 'no EF migrations found - cannot stamp migrationHead' }
$commit = ''
try { $commit = (& git -C $root rev-parse HEAD 2>$null).Trim() } catch { }
$version = [ordered]@{
  schema        = 'aurora-app-version/1'
  version       = $appVer
  major         = [int]($appVer.Split('.')[0])
  commit        = $commit
  migrationHead = $migHead
  environment   = 'production'
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
  Push-Location $payload
  try {
    Get-ChildItem -Recurse -File 'server' | ForEach-Object {
      $rel = [IO.Path]::GetRelativePath($payload, $_.FullName)
      "$((Get-FileHash -Algorithm SHA256 -Path $_.FullName).Hash.ToLowerInvariant())  $rel"
    } | Set-Content -Encoding ascii $sums
  } finally { Pop-Location }
  Copy-Item -Force (Join-Path $here 'aurora-update.ps1') (Join-Path $payload 'aurora-update.ps1')
  @{ schema='aurora-update-bundle/1'; version=$appVer; builtAt=$version.builtAt
     files=(Get-Content $sums | Measure-Object -Line).Lines } |
    ConvertTo-Json | Set-Content -Encoding ascii (Join-Path $payload 'manifest.json')
  Write-Host "== 4u. compile AuroraUpdate-$appVer.exe =="
  if (-not (Test-Path $Iscc)) { throw "Inno Setup compiler not found at $Iscc (install Inno Setup 6, or pass -Iscc)." }
  & $Iscc "/DAppVer=$appVer" (Join-Path $here 'aurora-update.iss')
  if ($LASTEXITCODE -ne 0) { throw 'ISCC (update) failed' }
  Write-Host "DONE - update package at $(Join-Path $here 'Output')"
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
if (-not (Test-Path $Iscc)) { throw "Inno Setup compiler not found at $Iscc (install Inno Setup 6, or pass -Iscc)." }
& $Iscc (Join-Path $here 'aurora.iss')
if ($LASTEXITCODE -ne 0) { throw 'ISCC failed' }
Write-Host "DONE - installer at $(Join-Path $here 'Output')"
