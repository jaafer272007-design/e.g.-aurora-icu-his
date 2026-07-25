<#
  AURORA ICU - ON-BOOT AI SELF-WIRING (the "just works" path).

  The case the validator wants: a hospital fits an NVIDIA GPU into their Aurora
  server, powers it on, and the AI just works - no commands, no scripts, nothing
  typed. AuroraServer runs this script on EVERY boot (server/Core/Ai/AiAutoWire.cs
  invokes it, native Windows service only). It probes the machine and, if state
  has drifted, reconciles the AuroraAI service + aurora.env to match the hardware:

    - GPU + AI payload present, but AI is OFF  -> ENABLE  (register AuroraAI, flip
      aurora.env none->openai, drop the stale "no GPU" reason).
    - AI is ON, but the GPU is gone            -> DISABLE (stop/remove AuroraAI,
      flip aurora.env openai->none with an honest reason). Degrade honestly.
    - already correct (on-with-GPU / off-without-GPU) -> NO-OP (touch nothing).

  This is the SAME wiring aurora-enable-ai.ps1 does by hand - it reuses the SAME
  shared helpers (Register-AuroraAI / Update-AiEnvLines / Set-AiDisabledEnvLines).
  The only new thing is that it runs itself, at boot, from a decision instead of
  from an operator.

  IT TOUCHES ZERO DATABASE STATE. No initdb, no role change, no re-seed, no
     schema change, no secret rotation, no forced logout. It only (1) registers or
     removes the AuroraAI *service* and (2) makes a SURGICAL edit to the AI_* lines
     of aurora.env, preserving every other line byte-for-byte (the pure edit is the
     execution-proven Update-AiEnvLines / Set-AiDisabledEnvLines). Patient data
     cannot be affected.

  IT FAILS SAFE - it can NEVER stop the HIS from running. ErrorActionPreference
     is Continue, the whole body is wrapped so nothing propagates, and it ALWAYS
     exits 0. If the GPU probe or the service registration fails for any reason,
     Aurora boots normally with the AI in its previous state and an honest message.
     The C# caller additionally swallows every failure and bounds the runtime.

  CONTRACT WITH THE C# CALLER (server/Core/Ai/AiAutoWire.cs):
    The script prints the managed AI_* environment it wants THIS boot to use, one
    line per key, as:  AUTOWIRE-ENV: KEY=VALUE
    - If it prints >=1 AUTOWIRE-ENV line (ENABLE or DISABLE), the caller reconciles
      ALL managed keys: sets the emitted ones, clears any managed key not emitted.
    - If it prints 0 AUTOWIRE-ENV lines (NO-OP), the caller leaves the process
      environment exactly as aurora.env already loaded it. Silence = "no change".
    Everything else the script prints is diagnostic and is logged, not parsed.

  WINDOWS-ONLY at run time (GPU probe, nssm/sc, the live service). The pure env
     transforms are unit-tested on Linux; the DISABLE/NO-OP decision paths run on
     Linux too (where the GPU probe reads false). The ENABLE path - live GPU + real
     service registration - is code-reviewed and on the second-machine checklist.
#>
[CmdletBinding()]
param(
  [string]$InstallDir = 'C:\Aurora',
  [int]$AiPort     = 8081,
  [int]$AiParallel = 4,
  [int]$AiCtxSize  = 16384,
  [string]$AiModel = 'qwen2.5-7b-instruct-q4_k_m'
)

# FAIL SAFE: never let anything here throw out of the process. Continue on error,
# and wrap the whole engine so a bug can only cost the AI, never the HIS.
$ErrorActionPreference = 'Continue'

# The reconciled managed-key set the caller applies to THIS boot. Empty => NO-OP.
$script:Emit = @()
function EmitEnv([string]$line) {
  $script:Emit += $line
  Write-Output "AUTOWIRE-ENV: $line"
}

# Buffered log - written to {DataDir}\autowire.log at the end (best-effort).
$script:LogBuf = @()
function Log([string]$m) { $script:LogBuf += "[aurora-autowire] $m" }

# Re-assert the aurora.env ACL lock (SYSTEM + Administrators only). BEST-EFFORT and
# never fatal: guarded so a missing/failed icacls can never abort the wiring (icacls
# is Windows-only; the Get-Command guard also makes this a clean no-op off Windows).
function Lock-EnvAcl([string]$path) {
  try {
    if (Get-Command icacls.exe -ErrorAction SilentlyContinue) {
      & icacls.exe $path /inheritance:r /grant:r 'SYSTEM:F' 'Administrators:F' 2>$null | Out-Null
    }
  } catch { Log "note: ACL re-lock skipped ($($_.Exception.Message))." }
}

try {
  . (Join-Path $PSScriptRoot 'aurora-ai-service.ps1')   # shared helpers (dot-source is pure - no top-level exec)

  $server   = Join-Path $InstallDir 'server'
  $envFile  = Join-Path $server 'aurora.env'
  $exe      = Join-Path $server 'AuroraIcu.Api.exe'
  $llamaExe = Join-Path $InstallDir 'llama\llama-server.exe'
  $nssmExe  = Join-Path $InstallDir 'llama\nssm.exe'

  if (-not (Test-Path $envFile)) {
    Log "no aurora.env at $envFile - nothing to reconcile (NO-OP)."
    return
  }
  $envLines = @(Get-Content -Path $envFile)

  # current AI provider + data dir (for the AI log), read from aurora.env
  $curProvider = (($envLines | Where-Object { $_ -match '^AI_PROVIDER=' } | Select-Object -First 1) -replace '^AI_PROVIDER=', '').Trim()
  $backupDir   = (($envLines | Where-Object { $_ -match '^BACKUP_DIR=' }  | Select-Object -First 1) -replace '^BACKUP_DIR=', '')
  $dataDir     = if ($backupDir) { Split-Path -Parent $backupDir } else { Join-Path $InstallDir 'data' }
  $aiIsOn      = ($curProvider -eq 'openai')

  # ---- probe the machine ----
  $gpu       = Test-NvidiaGpu
  $modelGguf = Find-AiModelGguf (Join-Path $InstallDir 'model')
  $payload   = ($modelGguf -and (Test-Path $llamaExe) -and (Test-Path $nssmExe))
  $canRunAi  = ($gpu -and $payload)
  Log "probe: gpu=$gpu payload=$payload  aurora.env AI_PROVIDER='$curProvider' (aiIsOn=$aiIsOn)"

  if ($canRunAi -and -not $aiIsOn) {
    # ---- ENABLE: hardware is ready but the AI is off. Wire it up. ----
    Log "ENABLE: GPU + AI payload present and AI is off - self-wiring the AuroraAI service."
    try {
      # Register FIRST. If it throws, aurora.env is UNTOUCHED and we emit nothing -
      # the boot proceeds with the AI still off (fail safe), to retry next boot.
      Register-AuroraAI -NssmExe $nssmExe -LlamaExe $llamaExe -ModelGguf $modelGguf.FullName `
        -Port $AiPort -Parallel $AiParallel -CtxSize $AiCtxSize -LogFile (Join-Path $dataDir 'ai.log')

      Copy-Item $envFile "$envFile.bak" -Force -ErrorAction SilentlyContinue
      $newLines = Update-AiEnvLines -lines $envLines -port $AiPort -model $AiModel
      Set-Content -Encoding ascii -Path $envFile -Value $newLines
      Lock-EnvAcl $envFile   # re-assert the ACL lock (best-effort; never aborts the wiring)

      EmitEnv 'AI_PROVIDER=openai'
      EmitEnv "AI_ENDPOINT=http://127.0.0.1:$AiPort/v1"
      EmitEnv "AI_MODEL=$AiModel"
      EmitEnv 'AI_TIMEOUT_SECONDS=120'
      Log "ENABLE done: AuroraAI registered, aurora.env flipped to openai, stale reason cleared."
      try { & $exe audit ai-autowire-enabled success --actor "autowire" 2>$null | Out-Null } catch { }
    } catch {
      Log "ENABLE failed ($($_.Exception.Message)) - AI stays off this boot (fail safe). Will retry next boot."
      $script:Emit = @()   # emit nothing: leave this boot exactly as aurora.env loaded it
    }
  }
  elseif ($aiIsOn -and -not $canRunAi) {
    # ---- DISABLE: the AI was on but the hardware is gone. Degrade honestly. ----
    $why = if (-not $gpu) { 'the NVIDIA GPU is no longer detected' } else { 'the on-disk AI runtime is no longer present' }
    Log "DISABLE: AI was on but $why - turning the AI off honestly."
    try {
      if (Get-Service AuroraAI -ErrorAction SilentlyContinue) {
        & $nssmExe stop AuroraAI 2>$null | Out-Null
        & $nssmExe remove AuroraAI confirm 2>$null | Out-Null
      }
    } catch { Log "note: could not remove the AuroraAI service ($($_.Exception.Message)) - continuing to flip the config." }
    try {
      $reason = "AI is turned off on this install - $why. It turns back on by itself once the GPU and AI files are present at boot."
      Copy-Item $envFile "$envFile.bak" -Force -ErrorAction SilentlyContinue
      $newLines = Set-AiDisabledEnvLines -lines $envLines -reason $reason
      Set-Content -Encoding ascii -Path $envFile -Value $newLines
      Lock-EnvAcl $envFile   # re-assert the ACL lock (best-effort; never aborts the wiring)
      EmitEnv 'AI_PROVIDER=none'
      EmitEnv "AI_UNAVAILABLE_REASON=$reason"
      Log "DISABLE done: AuroraAI removed, aurora.env flipped to none with an honest reason."
      try { & $exe audit ai-autowire-disabled success --actor "autowire" 2>$null | Out-Null } catch { }
    } catch {
      Log "DISABLE config edit failed ($($_.Exception.Message)) - leaving aurora.env as-is (fail safe)."
      $script:Emit = @()
    }
  }
  else {
    Log "NO-OP: state already matches the hardware (canRunAi=$canRunAi, aiIsOn=$aiIsOn). Nothing to do."
  }
}
catch {
  # Absolute backstop - a failure anywhere above can only reach here, never the HIS.
  Log "unexpected error ($($_.Exception.Message)) - taking no action this boot (fail safe)."
  $script:Emit = @()
}
finally {
  # best-effort log write; never fatal
  try {
    $backupDir2 = $null
    if ($envFile -and (Test-Path $envFile)) {
      $backupDir2 = ((Get-Content $envFile | Where-Object { $_ -match '^BACKUP_DIR=' } | Select-Object -First 1) -replace '^BACKUP_DIR=', '')
    }
    $logDir = if ($backupDir2) { Split-Path -Parent $backupDir2 } else { Join-Path $InstallDir 'data' }
    if (Test-Path $logDir) {
      $stamp = (Get-Date).ToString('s')
      Add-Content -Path (Join-Path $logDir 'autowire.log') -Value (@("--- $stamp ---") + $script:LogBuf) -ErrorAction SilentlyContinue
    }
  } catch { }
}

exit 0   # ALWAYS. The AI turning itself on must never stop the hospital system.
