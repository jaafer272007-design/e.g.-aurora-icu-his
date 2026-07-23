<#
  AURORA ICU — one-shot Windows build wrapper.

  Run this ONCE with your paths and it does the whole job: (optionally) install
  the build toolchain via winget, preflight-check everything, then run build.ps1
  (React bundle -> self-contained server -> private Postgres -> AI model +
  llama-server -> compile the Inno installer) and report the finished
  AuroraSetup.exe. See installer/BUILD_WINDOWS.md for the full walkthrough.

  TYPICAL USE (from the repo root, one line — no need to change ExecutionPolicy):

    # AI-enabled build, installing the toolchain first:
    powershell -ExecutionPolicy Bypass -File .\installer\build-all.ps1 `
      -InstallPrereqs `
      -PgZip   C:\aurora-build\postgresql-16.4-1-windows-x64-binaries.zip `
      -ModelDir C:\aurora-ai\model `
      -LlamaDir C:\aurora-ai\llama

    # smaller AI-DISABLED build (proves the toolchain), toolchain already installed:
    powershell -ExecutionPolicy Bypass -File .\installer\build-all.ps1 `
      -PgZip C:\aurora-build\postgresql-16.4-1-windows-x64-binaries.zip

  🔎 WINDOWS-ONLY (needs the .NET 8 SDK, Node, Inno Setup 6). CODE-REVIEWED
     here; it just orchestrates build.ps1, which is itself Windows-only.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$PgZip,     # the EDB "binaries only" PostgreSQL 16 zip
  [string]$ModelDir = '',                    # folder with the .gguf model file(s)   } give BOTH for the AI,
  [string]$LlamaDir = '',                    # folder with llama-server.exe + DLLs + nssm.exe } or NEITHER
  [string]$Iscc = 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe',
  [switch]$InstallPrereqs                     # winget-install .NET 8 SDK, Node LTS, Inno Setup, Git first
)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
function Say ([string]$m) { Write-Host "[build-all] $m" -ForegroundColor Cyan }
function Warn([string]$m) { Write-Host "[build-all] $m" -ForegroundColor Yellow }
function Die ([string]$m) { Write-Host "[build-all] $m" -ForegroundColor Red; exit 1 }

# ---- 0. optional: install the toolchain via winget ----
if ($InstallPrereqs) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Die "winget not found. Install 'App Installer' from the Microsoft Store, or install the tools by hand (BUILD_WINDOWS.md, section 1)."
  }
  Say "installing the build toolchain via winget (a few minutes; approve any UAC prompt)..."
  foreach ($id in @('Microsoft.DotNet.SDK.8','OpenJS.NodeJS.LTS','JRSoftware.InnoSetup','Git.Git')) {
    Say "winget install $id"
    winget install --id $id -e --accept-source-agreements --accept-package-agreements --silent
  }
  # make the freshly-installed tools visible in THIS session (no reopen needed)
  $env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
              [System.Environment]::GetEnvironmentVariable('Path','User')
}

# ---- 1. preflight — fail early with a clear message ----
Say "checking the toolchain..."
if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
  Die "dotnet not found. Install the .NET 8 SDK (or re-run with -InstallPrereqs), then open a NEW terminal."
}
$dv = (& dotnet --version)
if ($dv -notlike '8.*') { Warn "dotnet $dv is selected — the server publishes for .NET 8 (win-x64); make sure an 8.0 SDK is installed." }
foreach ($t in @('node','npm','npx')) {
  if (-not (Get-Command $t -ErrorAction SilentlyContinue)) {
    Die "$t not found. Install Node.js 20 LTS or newer (or -InstallPrereqs), then open a NEW terminal."
  }
}
if (-not (Test-Path $Iscc))  { Die "Inno Setup compiler not found at $Iscc. Install Inno Setup 6 (or -InstallPrereqs), or pass -Iscc <path to ISCC.exe>." }
if (-not (Test-Path $PgZip)) { Die "-PgZip not found: $PgZip  (download the EDB 'binaries only' PostgreSQL 16 zip — NOT the .exe installer)." }

# ---- 2. AI inputs: BOTH or NEITHER ----
$ai = $false
if ($ModelDir -and $LlamaDir) {
  if (-not (Test-Path $ModelDir)) { Die "-ModelDir not found: $ModelDir" }
  if (-not (Test-Path $LlamaDir)) { Die "-LlamaDir not found: $LlamaDir" }
  foreach ($need in @('llama-server.exe','nssm.exe')) {
    if (-not (Test-Path (Join-Path $LlamaDir $need))) {
      Die "-LlamaDir is missing $need. It needs llama-server.exe + its CUDA DLLs AND nssm.exe (BUILD_WINDOWS.md, section 2C)."
    }
  }
  $ai = $true
  Say "AI-ENABLED build: model=$ModelDir  llama=$LlamaDir"
} elseif ($ModelDir -or $LlamaDir) {
  Die "the AI needs BOTH -ModelDir and -LlamaDir (or NEITHER, for an AI-disabled build). You gave only one."
} else {
  Warn "no -ModelDir/-LlamaDir -> building with the AI DISABLED (a smaller installer; the AI screen will say 'no GPU/disabled')."
}

# ---- 3. disk-space heads-up (the model makes an ~5 GB installer) ----
$sizeHint = if ($ai) { '~5 GB' } else { '~150 MB' }
try {
  $qual = Split-Path -Qualifier $here            # e.g. 'C:'
  $free = [math]::Round((Get-PSDrive $qual.TrimEnd(':')).Free / 1GB, 1)
  $need = if ($ai) { 20 } else { 3 }
  Say "free space on $qual = $free GB (recommended >= $need GB for the $sizeHint build)"
  if ($free -lt $need) { Warn "low disk — the compression step may run out of room." }
} catch { }

# ---- 4. run the real build ----
$buildArgs = @{ PgZip = $PgZip; Iscc = $Iscc }
if ($ai) { $buildArgs.ModelDir = $ModelDir; $buildArgs.LlamaDir = $LlamaDir }
Say "starting build.ps1 -- step 5 compresses the payload at max LZMA2, so an AI build takes 20-60 min. Be patient; it is not stuck."
try {
  & (Join-Path $here 'build.ps1') @buildArgs
} catch {
  Die "build failed: $($_.Exception.Message)  (see the output above; BUILD_WINDOWS.md section 5 lists likely causes)."
}

# ---- 5. report the artifact ----
$out = Get-ChildItem (Join-Path $here 'Output') -Filter 'AuroraSetup-*.exe' -ErrorAction SilentlyContinue |
       Sort-Object LastWriteTime | Select-Object -Last 1
if (-not $out) { Die "build finished but no AuroraSetup-*.exe is in $here\Output -- check the output above." }
$gb = [math]::Round($out.Length / 1GB, 2)
Say "DONE  ->  $($out.FullName)   ($gb GB)"
Say "Copy that ONE .exe to the hospital server and double-click it (next -> next -> finish)."
exit 0
