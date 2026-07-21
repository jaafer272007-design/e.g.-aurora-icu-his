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

# ---- 2a. install mode: demo testbed (default) vs a real hospital ----
# A hospital install is a PRODUCTION install: APP_ENV=production, which the
# server's seed split turns into "catalogues + config + ONE bootstrap admin,
# ZERO patients, ZERO demo credentials" and the boot tripwires enforce. The
# demo testbed (staging) is the default so nothing changes for validators.
#
#   ./run.sh                        -> demo testbed (staging seed)
#   AURORA_MODE=production ./run.sh -> a real hospital install (once; the
#                                      choice persists in appliance/.env)
#
# In production mode this script COLLECTS the install decisions the server
# refuses to boot without, and writes them to appliance/.env so every later
# `./run.sh` reboots non-interactively. Nothing is guessed and nothing demo
# ever reaches the image.
env_get() { grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2- || true; }
env_set() { # key value — replace-or-append in .env
  [ -f .env ] && grep -qE "^$1=" .env && { grep -vE "^$1=" .env > .env.tmp && mv .env.tmp .env; }
  printf '%s=%s\n' "$1" "$2" >> .env
}
DEMO_PW='Aurora2026!'   # the shared demo password — forbidden in production
# resolve the mode: explicit AURORA_MODE wins; else whatever .env remembers;
# else the demo default
MODE="${AURORA_MODE:-$( [ "$(env_get APPLIANCE_ENV)" = production ] && echo production || echo staging )}"
if [ "$MODE" = "production" ]; then
  echo "PRODUCTION install mode — a real hospital deployment (no demo data)."
  env_set APPLIANCE_ENV production
  # DEMO_PASSWORD must never be in a production environment (T2 refuses it)
  unset DEMO_PASSWORD || true
  # -- formulary install policy (the server refuses an unset/unknown value) --
  FS="$(env_get FORMULARY_SEED)"
  if [ "$FS" != "starter" ] && [ "$FS" != "empty" ]; then
    if [ -t 0 ]; then
      echo "Formulary at install: [starter] seeds a reference drug list DEACTIVATED"
      echo "(pharmacy reactivates each drug after review), or [empty] to build it from scratch."
      read -r -p "  FORMULARY_SEED (starter/empty) [starter]: " FS || true
      FS="${FS:-starter}"
    else
      FS="${FORMULARY_SEED:-}"
    fi
    [ "$FS" = "starter" ] || [ "$FS" = "empty" ] || {
      echo "FORMULARY_SEED must be 'starter' or 'empty'. Set it and re-run."; exit 1; }
  fi
  env_set FORMULARY_SEED "$FS"
  # -- same-origin access origin -> CORS_ORIGINS (the appliance is one origin,
  #    so this is belt-and-suspenders; the server still requires it explicit
  #    and non-local in production) --
  CO="$(env_get CORS_ORIGINS)"
  if [ -z "$CO" ]; then
    GUESS_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
    DEFAULT_CO="http://${GUESS_IP:-your-server}:${AURORA_PORT:-8080}"
    if [ -t 0 ]; then
      echo "The URL clinicians open in their browser (this server's address on the LAN)."
      read -r -p "  Access URL [${DEFAULT_CO}]: " CO || true
      CO="${CO:-$DEFAULT_CO}"
    else
      CO="${CORS_ORIGINS:-$DEFAULT_CO}"
    fi
    case "$CO" in
      *localhost*|*127.0.0.1*) echo "Access URL cannot be localhost in production (the server refuses it). Use the LAN address."; exit 1;;
    esac
    env_set CORS_ORIGINS "$CO"
  fi
  # -- the first administrator's credential (supplied at provision time,
  #    shown once, rotated after first login; never the demo password) --
  if [ -z "$(env_get ADMIN_BOOTSTRAP_PASSWORD)" ]; then
    BP="${ADMIN_BOOTSTRAP_PASSWORD:-}"
    if [ -z "$BP" ] && [ -t 0 ]; then
      echo "Set the first administrator's password (user 'admin'; you MUST change it at first login)."
      read -r -s -p "  Bootstrap admin password: " BP; echo
      read -r -s -p "  Confirm: " BP2; echo
      [ "$BP" = "$BP2" ] || { echo "Passwords did not match. Re-run."; exit 1; }
    fi
    [ -n "$BP" ] || { echo "ADMIN_BOOTSTRAP_PASSWORD is required for a production install (supply it in the environment for an unattended install)."; exit 1; }
    [ "$BP" != "$DEMO_PW" ] || { echo "The bootstrap password cannot be the shared demo password. Choose a real one."; exit 1; }
    env_set ADMIN_BOOTSTRAP_PASSWORD "$BP"
    echo "Recorded the bootstrap admin credential in appliance/.env (delete that line after you rotate it post-login)."
  fi
  echo "Note: a data volume that already holds DEMO data cannot be served in production"
  echo "      (the T1 tripwire refuses the demo credential). Start clean: docker compose down -v."
fi

# ---- 2b. the hospital's timezone (Locale/Timezone design §1.3) ----
# The app stores UTC and DISPLAYS the server's local time; the container
# defaults to UTC, so the HOST's zone must be handed in. Detect the IANA
# id from the OS — never guess one. Written once; correctable any time by
# editing TZ= in appliance/.env.
if ! grep -q '^TZ=' .env; then
  HOST_TZ=""
  if command -v timedatectl >/dev/null 2>&1; then
    HOST_TZ=$(timedatectl show -p Timezone --value 2>/dev/null || true)
  fi
  [ -z "$HOST_TZ" ] && [ -f /etc/timezone ] && HOST_TZ=$(cat /etc/timezone)
  if [ -z "$HOST_TZ" ] && [ -L /etc/localtime ]; then
    HOST_TZ=$(readlink /etc/localtime | sed 's|.*/zoneinfo/||')
  fi
  if [ -n "$HOST_TZ" ]; then
    echo "TZ=$HOST_TZ" >> .env
    echo "timezone: $HOST_TZ (from this machine's OS — edit TZ= in appliance/.env if wrong)"
  else
    echo "WARNING: could not detect this machine's timezone — Aurora will DISPLAY times in UTC."
    echo "         Set it explicitly: add a line like  TZ=Asia/Baghdad  to appliance/.env and re-run."
  fi
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
if [ "$MODE" = "production" ]; then
  echo "PRODUCTION install — NO demo data: catalogues + configuration are seeded, the"
  echo "unit starts with ZERO patients, and there are NO demo credentials."
  echo "Sign in as the bootstrap administrator (user 'admin') with the password you set;"
  echo "you will be required to change it, then create the clinical accounts from Users."
else
  echo "NOT HOSPITAL-READY (design §2.4): this appliance seeds DEMO data — it is the"
  echo "validator's testbed in the hospital topology. Demo sign-in: sara.rahman / Aurora2026!"
  echo "For a real hospital install (no demo data): AURORA_MODE=production ./run.sh"
fi
