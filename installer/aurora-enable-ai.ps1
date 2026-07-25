<#
  AURORA ICU - turn the AI ON after a GPU is added later.

  The case: a site installed on a machine with NO GPU (AI stayed off), then fits
  an NVIDIA GPU months later. GPU is detected only once, at install, and the
  server reads AI_PROVIDER once at boot - so adding a GPU does nothing on its
  own. This one command wires it up.

  IT TOUCHES ZERO DATABASE STATE. No initdb, no role change, no re-seed, no
  schema change. It (1) registers the AuroraAI service, (2) makes a SURGICAL edit
  to aurora.env (flip AI_PROVIDER none->openai, add the endpoint/model/timeout,
  drop the now-false "no GPU" reason) preserving every other line - NO secret is
  rotated, NO clinician is logged out - and (3) restarts AuroraServer so it
  re-reads the config. Because the server BINARY is unchanged, the boot-time
  Migrate() is a no-op. Patient data cannot be affected. (See
  installer/UPDATE_AND_ENABLE_AI_DESIGN.md sec 3.)

  USAGE (as Administrator):
    powershell -ExecutionPolicy Bypass -File aurora-enable-ai.ps1
    # add -InstallDir if Aurora is not at C:\Aurora

  Works on any Aurora install that has the AI PAYLOAD on disk (llama\ + model\ -
  the full AI-capable installer lays these down even on a no-GPU box). If the
  payload is absent (a no-AI build), it says so and stops - no data is touched.

  WINDOWS-ONLY - CODE-REVIEWED (needs a real GPU + the services). The pure
     aurora.env edit is unit-tested on Linux.
#>
[CmdletBinding()]
param(
  [string]$InstallDir = 'C:\Aurora',
  [int]$AiPort     = 8081,
  [int]$AiParallel = 4,
  [int]$AiCtxSize  = 16384,
  [string]$AiModel = 'qwen2.5-7b-instruct-q4_k_m',
  [switch]$SkipRestart          # advanced: register + edit env but leave the restart to the operator
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'aurora-ai-service.ps1')     # shared helpers (Register-AuroraAI, Update-AiEnvLines, ...)
function Say([string]$m)  { Write-Host "[aurora-enable-ai] $m" }
function Fail([string]$m) { Write-Error "[aurora-enable-ai] $m"; exit 1 }

$server   = Join-Path $InstallDir 'server'
$envFile  = Join-Path $server 'aurora.env'
$exe      = Join-Path $server 'AuroraIcu.Api.exe'
$llamaExe = Join-Path $InstallDir 'llama\llama-server.exe'
$nssmExe  = Join-Path $InstallDir 'llama\nssm.exe'

# ---- 1. confirm this is an Aurora install ----
if (-not (Test-Path $envFile)) { Fail "no aurora.env at $envFile - is -InstallDir right? (default C:\Aurora)" }
if (-not (Get-Service AuroraServer -ErrorAction SilentlyContinue)) {
  Fail "the AuroraServer service is not installed at this location - run the full installer first."
}
$envLines = @(Get-Content -Path $envFile)

# server port (for the health check) + data dir (for the AI log), read from aurora.env
$srvPort = (($envLines | Where-Object { $_ -match '^PORT=' }      | Select-Object -First 1) -replace '^PORT=', '')
if (-not $srvPort) { $srvPort = '8080' }
$backupDir = (($envLines | Where-Object { $_ -match '^BACKUP_DIR=' } | Select-Object -First 1) -replace '^BACKUP_DIR=', '')
$dataDir = if ($backupDir) { Split-Path -Parent $backupDir } else { Join-Path $InstallDir 'data' }

# ---- 2. already enabled? (idempotent) ----
if ($envLines | Where-Object { $_ -match '^AI_PROVIDER=openai\s*$' }) {
  if (Get-Service AuroraAI -ErrorAction SilentlyContinue) {
    Say "AI is already enabled (AI_PROVIDER=openai and the AuroraAI service exists). Nothing to do."; exit 0
  }
  Say "aurora.env already says openai but the AuroraAI service is missing - re-registering it."
}

# ---- 3. is a GPU present NOW? ----
if (-not (Test-NvidiaGpu)) {
  Fail "no NVIDIA GPU detected on this machine. Fit a supported GPU, then re-run. (Aurora keeps running fully without the AI.)"
}

# ---- 4. is the AI payload on disk? ----
$modelGguf = Find-AiModelGguf (Join-Path $InstallDir 'model')
$missing = @()
if (-not (Test-Path $llamaExe)) { $missing += 'llama\llama-server.exe' }
if (-not (Test-Path $nssmExe))  { $missing += 'llama\nssm.exe' }
if (-not $modelGguf)            { $missing += 'model\*.gguf' }
if ($missing.Count -gt 0) {
  Fail ("the AI runtime is not on this machine (missing: " + ($missing -join ', ') +
        "). This install shipped WITHOUT the AI payload - lay it down first (an add-AI package, or re-run a full AI-capable installer), then run this again. No data is touched either way.")
}

# ---- 5. register the AuroraAI service (shared helper - same as first install) ----
Say "registering the AuroraAI service (llama-server, --parallel $AiParallel, 127.0.0.1:$AiPort)"
Register-AuroraAI -NssmExe $nssmExe -LlamaExe $llamaExe -ModelGguf $modelGguf.FullName `
  -Port $AiPort -Parallel $AiParallel -CtxSize $AiCtxSize -LogFile (Join-Path $dataDir 'ai.log')

# ---- 6. SURGICAL aurora.env edit - flip to openai, drop the stale reason; every
#         other line (secrets included) stays byte-for-byte. Keep a one-file backup. ----
Copy-Item $envFile "$envFile.bak" -Force
$newLines = Update-AiEnvLines -lines $envLines -port $AiPort -model $AiModel
Set-Content -Encoding ascii -Path $envFile -Value $newLines
& icacls.exe $envFile /inheritance:r /grant:r 'SYSTEM:F' 'Administrators:F' | Out-Null   # re-assert the ACL lock
Say "aurora.env updated (AI_PROVIDER=openai; the stale 'no GPU' message removed). No secret was changed."

# ---- 7. restart AuroraServer so it re-reads aurora.env (AI_PROVIDER is read once at boot) ----
if ($SkipRestart) { Say "-SkipRestart set - run 'Restart-Service AuroraServer' to apply the change."; exit 0 }
Say "restarting AuroraServer to apply the config..."
Restart-Service AuroraServer
$healthy = $false
for ($i = 0; $i -lt 60; $i++) {
  try { Invoke-RestMethod "http://127.0.0.1:$srvPort/healthz" -TimeoutSec 2 | Out-Null; $healthy = $true; break } catch {}
  Start-Sleep 2
}
if (-not $healthy) {
  Fail "AuroraServer did not come back healthy after the restart - check the Windows Event Log. The pre-change config is at $envFile.bak."
}

# best-effort: is AuroraAI answering yet? (the model loads in the background)
try { Invoke-RestMethod "http://127.0.0.1:$AiPort/health" -TimeoutSec 2 | Out-Null; Say "AuroraAI is answering." }
catch { Say "AuroraAI is still loading the model - normal; the AI screen stays honest until it is ready." }

try { & $exe audit ai-enabled success --actor "enable-ai" | Out-Null } catch { }   # best-effort audit
Say "DONE - the AI is enabled. Open the AI Assistant screen; it answers once the model finishes loading."
exit 0
