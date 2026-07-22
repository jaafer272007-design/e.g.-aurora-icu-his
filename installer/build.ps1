<#
  AURORA ICU — build the hospital installer (run on a BUILD machine with the
  .NET 8 SDK, Node, Inno Setup, and internet; the HOSPITAL machine needs none
  of these). Produces installer\Output\AuroraSetup-<ver>.exe.

  Steps:
    1. build the React app (production bundle, same-origin by construction)
    2. dotnet publish the server SELF-CONTAINED for win-x64 (no .NET install
       on the hospital box) — the wwwroot (SPA) ships inside it
    3. stage a PRIVATE PostgreSQL (Windows binaries) into payload\pgsql
    4. stage the AI model file(s) into payload\model
    5. compile aurora.iss with ISCC → the single AuroraSetup.exe

  🔎 WINDOWS-ONLY build (dotnet publish win-x64 can cross-build, but ISCC and
     the Postgres Windows binaries are Windows). CODE-REVIEWED here.
#>
[CmdletBinding()]
param(
  [string]$PgZip   = '',   # path to a PostgreSQL Windows binaries zip (EDB "binaries only"); required
  [string]$ModelDir = '',  # folder containing the .gguf model file(s); optional (AI is PR C)
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

Write-Host '== 3. private PostgreSQL binaries =='
if (-not $PgZip -or -not (Test-Path $PgZip)) {
  throw 'Provide -PgZip <postgresql-16-windows-x64-binaries.zip> (EDB "binaries only" download). The hospital never installs Postgres — it is bundled.'
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

Write-Host '== 4. AI model (optional; the AI service itself is PR C) =='
New-Item -ItemType Directory -Force -Path (Join-Path $payload 'model') | Out-Null
if ($ModelDir -and (Test-Path $ModelDir)) {
  Copy-Item -Recurse -Force (Join-Path $ModelDir '*') (Join-Path $payload 'model')
} else {
  Write-Host '  (no -ModelDir given — AI stays disabled; PR C bundles the model + native llama-server service)'
}

Write-Host '== 5. compile the installer =='
if (-not (Test-Path $Iscc)) { throw "Inno Setup compiler not found at $Iscc (install Inno Setup 6, or pass -Iscc)." }
& $Iscc (Join-Path $here 'aurora.iss')
if ($LASTEXITCODE -ne 0) { throw 'ISCC failed' }
Write-Host "DONE — installer at $(Join-Path $here 'Output')"
