# AURORA appliance — one command up (design §2.2).
# The validator's testbed: Windows 11 Pro + NVIDIA RTX 4060.
# Run from PowerShell:  .\run.ps1     (in the appliance\ folder)
#
# Same steps as run.sh: Docker check → generate local secrets →
# fetch + sha256-verify the OFFICIAL model → detect the GPU →
# compose up → print the origins. Without a GPU, Aurora runs fully
# and the AI screen says exactly why it is unavailable (§2.3).
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$MODEL1 = "qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf"
$MODEL2 = "qwen2.5-7b-instruct-q4_k_m-00002-of-00002.gguf"
$SHA1 = "dfce12e3862a5283ccfb88221b48480e58745165de856439950d0f22590580db"
$SHA2 = "539cf93f78e887edea1c04e2d7d8cdaca9d01dae9c9025bcb8accbe29df3d72a"
$HF = "https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/main"

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Error "Docker Desktop is required (WSL2 backend). Install it, then re-run."
}

# ---- secrets (generated locally, once; never committed, never baked) ----
if (-not (Test-Path ".env")) {
  Write-Host "First run - generating appliance\.env (secrets stay on this machine)"
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  function New-Hex([int]$bytes) {
    $b = New-Object byte[] $bytes; $rng.GetBytes($b)
    -join ($b | ForEach-Object { $_.ToString("x2") })
  }
  @(
    "JWT_SECRET=$(New-Hex 48)"
    "POSTGRES_PASSWORD=$(New-Hex 24)"
  ) | Set-Content -Encoding ascii ".env"
}

# the packaged commit — /build.txt and /healthz stamp it.
# Native stderr goes through cmd.exe: under $ErrorActionPreference=Stop,
# Windows PowerShell 5.1 turns a redirected stderr write from a native
# command into a TERMINATING error — git printing "not a git repository"
# (a zip-download install) would kill the whole script otherwise.
$env:AURORA_BUILD_COMMIT = (cmd /c "git -C .. rev-parse HEAD 2>nul"); if (-not $env:AURORA_BUILD_COMMIT) { $env:AURORA_BUILD_COMMIT = "dev" }

# ---- the model (alongside-as-a-file; offline-capable) ----
New-Item -ItemType Directory -Force -Path models | Out-Null
function Get-Model([string]$file, [string]$sha) {
  $path = "models\$file"
  if (-not (Test-Path $path)) {
    Write-Host "downloading OFFICIAL model shard: $file (one-time; place files in appliance\models\ for offline installs)"
    Invoke-WebRequest -Uri "$HF/$file" -OutFile "$path.part"
    Move-Item "$path.part" $path
  } else { Write-Host "model shard present: $file" }
  Write-Host "verifying sha256 of $file against the pinned official digest..."
  $actual = (Get-FileHash -Algorithm SHA256 $path).Hash.ToLower()
  if ($actual -ne $sha) {
    Write-Error "SHA256 MISMATCH on $file - refusing to serve an unverified model. Delete the file and retry."
  }
}
Get-Model $MODEL1 $SHA1
Get-Model $MODEL2 $SHA2

# ---- GPU detection → AI mode (§2.3: warn and disable, never refuse) ----
$composeArgs = @("-f", "docker-compose.yml")
# The probe runs through cmd.exe for the same 5.1 stderr rule as above:
# docker's FIRST-EVER pull of ubuntu:24.04 reports progress on stderr, so
# `docker ... 2>$null` inside this script threw mid-pull and the probe
# reported "no GPU" on a machine whose GPU was fine (the validator's
# first Windows run hit exactly this). cmd.exe swallows stderr before
# PowerShell ever sees it; $LASTEXITCODE still carries docker's verdict.
cmd /c "docker run --rm --gpus all ubuntu:24.04 true >nul 2>nul" | Out-Null
$gpu = ($LASTEXITCODE -eq 0)
if ($gpu) {
  Write-Host "GPU detected - AI ENABLED (llama-server, CUDA build)"
  $env:LLAMA_RUNTIME = "cuda"; $env:AI_PROVIDER = "openai"
  $env:AI_ENDPOINT = "http://llama:8081/v1"; $env:AI_UNAVAILABLE_REASON = ""
  $composeArgs += @("-f", "docker-compose.gpu.yml", "--profile", "ai")
} elseif ($env:AURORA_AI -eq "cpu") {
  Write-Host "AURORA_AI=cpu - AI ENABLED ON CPU (testing only; a cold question can take ~60 s)"
  $env:LLAMA_RUNTIME = "cpu"; $env:AI_PROVIDER = "openai"
  $env:AI_ENDPOINT = "http://llama:8081/v1"; $env:AI_UNAVAILABLE_REASON = ""
  if (-not $env:AI_TIMEOUT_SECONDS) { $env:AI_TIMEOUT_SECONDS = "180" }
  $composeArgs += @("--profile", "ai")
} else {
  Write-Host "WARNING: no NVIDIA GPU visible to Docker - the AI assistant is DISABLED; everything else runs."
  Write-Host "         (The AI screen will say exactly why. The HIS never stops because of the AI.)"
  $env:AI_PROVIDER = "none"; $env:AI_ENDPOINT = ""
  $env:AI_UNAVAILABLE_REASON = "no GPU on this server"
}

# ---- up ----
# AURORA_NO_BUILD=1 skips image builds — for installs where the images
# arrive pre-built (docker load from install media; the offline path)
$buildFlag = if ($env:AURORA_NO_BUILD) { "--no-build" } else { "--build" }
docker compose @composeArgs up -d $buildFlag
if ($LASTEXITCODE -ne 0) { Write-Error "docker compose up failed" }

$port = if ($env:AURORA_PORT) { $env:AURORA_PORT } else { "8080" }
Write-Host -NoNewline "waiting for AURORA"
for ($i = 0; $i -lt 60; $i++) {
  try { Invoke-RestMethod "http://localhost:$port/healthz" -TimeoutSec 2 | Out-Null; break } catch {}
  Write-Host -NoNewline "."; Start-Sleep 2
}
Write-Host ""

# The LAN address other devices can reach is the one on the adapter that
# carries the DEFAULT ROUTE — "first non-loopback IPv4" is wrong on
# Docker-Desktop machines, where it lands on the WSL/Hyper-V virtual
# switch (a 172.x address no iPad can reach). Fall back to the old pick
# only if no default route is readable.
$ip = $null
$route = Get-NetRoute -DestinationPrefix "0.0.0.0/0" -ErrorAction SilentlyContinue |
  Sort-Object -Property RouteMetric, ifMetric | Select-Object -First 1
if ($route) {
  $ip = (Get-NetIPAddress -InterfaceIndex $route.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Select-Object -First 1).IPAddress
}
if (-not $ip) {
  $ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } | Select-Object -First 1).IPAddress
}
Write-Host ""
Write-Host "AURORA is up:"
Write-Host "  this machine : http://localhost:$port"
if ($ip) { Write-Host "  on the LAN   : http://${ip}:$port   (other devices on the network - iPad included)" }
Write-Host ""
Write-Host "NOT HOSPITAL-READY (design 2.4): this appliance seeds DEMO data - it is the"
Write-Host "validator's testbed in the hospital topology. Demo sign-in: sara.rahman / Aurora2026!"
