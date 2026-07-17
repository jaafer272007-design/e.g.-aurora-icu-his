#!/usr/bin/env bash
# AURORA appliance — one command up (design §2.2). Linux/macOS/dev.
# Windows 11 (the validator's testbed) uses run.ps1 — same steps.
#
# What this does, in order:
#   1. checks Docker is available
#   2. generates appliance/.env on first run (JWT secret + Postgres
#      password — random, local, never committed, never in an image)
#   3. ensures the model file exists in appliance/models/ — downloads
#      the OFFICIAL Qwen release and sha256-verifies every byte against
#      the pinned upstream digests (refuses on mismatch). For a fully
#      offline install, place the files there from install media first
#      and no network is touched.
#   4. detects an NVIDIA GPU → AI on (llama-server, CUDA build); no GPU
#      → Aurora runs WITHOUT the AI and the AI screen says why (§2.3 —
#      warn and disable, never refuse). AURORA_AI=cpu forces CPU
#      inference for testing (slow — 60–63 s cold was MEASURED).
#   5. compose up + waits for /healthz + prints the origins.
set -euo pipefail
cd "$(dirname "$0")"

MODEL1=qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf
MODEL2=qwen2.5-7b-instruct-q4_k_m-00002-of-00002.gguf
SHA1=dfce12e3862a5283ccfb88221b48480e58745165de856439950d0f22590580db
SHA2=539cf93f78e887edea1c04e2d7d8cdaca9d01dae9c9025bcb8accbe29df3d72a
HF=https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/main

command -v docker >/dev/null || { echo "Docker is required — install Docker (Desktop on Windows/macOS) first."; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Docker Compose v2 is required (ships with Docker Desktop)."; exit 1; }

# ---- 2. secrets (generated locally, once) ----
if [ ! -f .env ]; then
  echo "First run — generating appliance/.env (secrets stay on this machine)"
  {
    echo "JWT_SECRET=$(head -c 48 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    echo "POSTGRES_PASSWORD=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  } > .env
fi

# the packaged commit — /build.txt and /healthz stamp it
AURORA_BUILD_COMMIT=$(git -C .. rev-parse HEAD 2>/dev/null || echo dev)
export AURORA_BUILD_COMMIT

# ---- 3. the model (alongside-as-a-file; offline-capable) ----
mkdir -p models
fetch_verify() { # file sha
  if [ -f "models/$1" ]; then
    echo "model shard present: $1"
  else
    echo "downloading OFFICIAL model shard: $1 (one-time; place files in appliance/models/ for offline installs)"
    curl -fL --retry 3 -o "models/$1.part" "$HF/$1"
    mv "models/$1.part" "models/$1"
  fi
  echo "verifying sha256 of $1 against the pinned official digest…"
  echo "$2  models/$1" | sha256sum -c - >/dev/null \
    || { echo "SHA256 MISMATCH on $1 — refusing to serve an unverified model. Delete the file and retry."; exit 1; }
}
fetch_verify "$MODEL1" "$SHA1"
fetch_verify "$MODEL2" "$SHA2"

# ---- 4. GPU detection → AI mode (§2.3) ----
PROFILES=() ; OVERRIDES=(-f docker-compose.yml)
if docker info 2>/dev/null | grep -qi 'nvidia' || command -v nvidia-smi >/dev/null 2>&1; then
  echo "GPU detected — AI ENABLED (llama-server, CUDA build)"
  export LLAMA_RUNTIME=cuda AI_PROVIDER=openai AI_ENDPOINT=http://llama:8081/v1 AI_UNAVAILABLE_REASON=
  PROFILES=(--profile ai); OVERRIDES+=(-f docker-compose.gpu.yml)
elif [ "${AURORA_AI:-}" = "cpu" ]; then
  echo "AURORA_AI=cpu — AI ENABLED ON CPU (testing only; a cold question can take ~60 s)"
  export LLAMA_RUNTIME=cpu AI_PROVIDER=openai AI_ENDPOINT=http://llama:8081/v1 AI_UNAVAILABLE_REASON=
  export AI_TIMEOUT_SECONDS=${AI_TIMEOUT_SECONDS:-180}
  PROFILES=(--profile ai)
else
  echo "⚠  No NVIDIA GPU visible to Docker — the AI assistant is DISABLED; everything else runs."
  echo "   (The AI screen will say exactly why. The HIS never stops because of the AI.)"
  export AI_PROVIDER=none AI_ENDPOINT= AI_UNAVAILABLE_REASON="no GPU on this server"
fi

# ---- 5. up ----
# AURORA_NO_BUILD=1 skips image builds — for installs where the images
# arrive pre-built (docker load from install media; the offline path)
BUILD_FLAG=--build; [ -n "${AURORA_NO_BUILD:-}" ] && BUILD_FLAG=--no-build
docker compose "${OVERRIDES[@]}" "${PROFILES[@]}" up -d "$BUILD_FLAG"

echo -n "waiting for AURORA"
for _ in $(seq 1 60); do
  curl -sf "http://localhost:${AURORA_PORT:-8080}/healthz" >/dev/null 2>&1 && break
  echo -n "."; sleep 2
done; echo

IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo
echo "AURORA is up:"
echo "  this machine : http://localhost:${AURORA_PORT:-8080}"
[ -n "${IP:-}" ] && echo "  on the LAN   : http://${IP}:${AURORA_PORT:-8080}   (other devices on the network)"
curl -s "http://localhost:${AURORA_PORT:-8080}/build.txt" | sed 's/^/  build: /'
echo
echo "NOT HOSPITAL-READY (design §2.4): this appliance seeds DEMO data — it is the"
echo "validator's testbed in the hospital topology. Demo sign-in: sara.rahman / Aurora2026!"
