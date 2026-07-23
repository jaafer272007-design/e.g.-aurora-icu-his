<#
  AURORA ICU — shared AI helpers (installer). Dot-sourced by BOTH
  aurora-provision.ps1 (first install) and aurora-enable-ai.ps1 (turn the AI on
  after a GPU is added later), so the AuroraAI service is registered and
  aurora.env is edited the SAME way from either path.

  This file is PURE FUNCTION DEFINITIONS — no top-level execution — so it is safe
  to dot-source anywhere (including a non-Windows test host that only exercises
  the pure `Update-AiEnvLines`; the Windows-only cmdlets live inside function
  bodies and are never touched until called on Windows).

  See installer/UPDATE_AND_ENABLE_AI_DESIGN.md and
  HOSPITAL_INSTALLER_RUNTIME_DESIGN.md §5.

  🔎 WINDOWS-ONLY at run time (nssm/sc/CIM) except Update-AiEnvLines, which is
     pure string work and is unit-tested on Linux.
#>

function Test-NvidiaGpu {
  # True iff an NVIDIA video controller is present — the SAME probe the installer
  # wizard uses. Best-effort: any failure reads as "no GPU".
  try {
    return [bool](Get-CimInstance Win32_VideoController -ErrorAction Stop |
      Where-Object { $_.Name -match 'NVIDIA' })
  } catch { return $false }
}

function Find-AiModelGguf([string]$modelDir) {
  # The model ships as a (possibly split) GGUF; llama-server wants the FIRST
  # split part ('*-00001-of-*'), else the single file. Returns a FileInfo or $null.
  $gguf = Get-ChildItem $modelDir -Filter '*.gguf' -ErrorAction SilentlyContinue | Sort-Object Name
  $first = $gguf | Where-Object { $_.Name -like '*-00001-of-*' } | Select-Object -First 1
  if (-not $first) { $first = $gguf | Select-Object -First 1 }
  return $first
}

function Update-AiEnvLines {
  # SURGICAL aurora.env edit (the data-safe core). Returns $lines with the AI_*
  # keys this installer manages REMOVED and the ENABLED wiring appended. Every
  # other line — DATABASE_URL, JWT_SECRET, backup config, comments, blanks — is
  # preserved verbatim and in order. Removing AI_UNAVAILABLE_REASON is how the
  # stale "no GPU on this server" message disappears once the AI is on. PURE: no
  # I/O, no side effects — unit-tested against a sample aurora.env on Linux.
  param([Parameter(Mandatory)][string[]]$lines, [int]$port = 8081, [string]$model = 'qwen2.5-7b-instruct-q4_k_m')
  $managed = @('AI_PROVIDER','AI_ENDPOINT','AI_MODEL','AI_TIMEOUT_SECONDS','AI_UNAVAILABLE_REASON')
  $kept = @($lines | Where-Object {
    $key = (($_ -split '=', 2)[0]).Trim()
    -not ($managed -contains $key)
  })
  return $kept + @(
    'AI_PROVIDER=openai',
    "AI_ENDPOINT=http://127.0.0.1:$port/v1",   # 127.0.0.1 only — never on the LAN
    "AI_MODEL=$model",
    'AI_TIMEOUT_SECONDS=120'
  )
}

function Register-AuroraAI {
  # Register + start the AuroraAI Windows service = llama-server run under NSSM
  # (a thin service host, since llama-server is a console exe): Automatic start
  # (BEFORE login) + SCM restart-on-crash, bound to 127.0.0.1 ONLY. Idempotent —
  # drops any prior registration first. Windows-only. §5.4 knobs are parameters.
  param(
    [Parameter(Mandatory)][string]$NssmExe,
    [Parameter(Mandatory)][string]$LlamaExe,
    [Parameter(Mandatory)][string]$ModelGguf,
    [int]$Port = 8081, [int]$Parallel = 4, [int]$CtxSize = 16384,
    [string]$LogFile = ''
  )
  $aiArgs = "--model `"$ModelGguf`" --host 127.0.0.1 --port $Port " +
            "--parallel $Parallel --ctx-size $CtxSize --temp 0 --jinja"
  & $NssmExe stop AuroraAI 2>$null | Out-Null                  # idempotent: drop any prior registration
  & $NssmExe remove AuroraAI confirm 2>$null | Out-Null
  & $NssmExe install AuroraAI $LlamaExe | Out-Null
  & $NssmExe set AuroraAI AppParameters $aiArgs | Out-Null
  & $NssmExe set AuroraAI AppDirectory (Split-Path $LlamaExe) | Out-Null   # DLLs load beside the exe
  & $NssmExe set AuroraAI DisplayName 'Aurora ICU AI (llama-server)' | Out-Null
  & $NssmExe set AuroraAI Description 'Aurora ICU local AI model runtime (llama.cpp llama-server, GPU). Serves 127.0.0.1 only; the HIS runs without it.' | Out-Null
  & $NssmExe set AuroraAI Start SERVICE_AUTO_START | Out-Null
  if ($LogFile) {
    & $NssmExe set AuroraAI AppStdout $LogFile | Out-Null
    & $NssmExe set AuroraAI AppStderr $LogFile | Out-Null
  }
  & $NssmExe set AuroraAI AppRestartDelay 5000 | Out-Null
  & sc.exe failure AuroraAI reset= 300 actions= restart/5000/restart/10000/restart/30000 | Out-Null
  & $NssmExe start AuroraAI 2>$null | Out-Null
}
