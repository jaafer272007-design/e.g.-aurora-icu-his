#!/bin/bash
# Build + run controller-harness.ts over a source TREE (arg 1): a scratch overlay of this branch with
# the contract stand-ins, or the integrated source after Session 1 assembles (no stand-ins needed).
# The harness bundles the REAL src/features/nurse-care modules (esbuild alias @app -> <tree>/src).
set -e
TREE=${1:?usage: run-controller-harness.sh <source tree with node_modules> [out dir]}
OUT=${2:-$(mktemp -d)}
HERE=$(cd "$(dirname "$0")" && pwd)
cd "$TREE"
./node_modules/.bin/esbuild "$HERE/controller-harness.ts" --bundle --platform=node --format=esm \
  --outfile="$OUT/controller-harness.mjs" --alias:@app=./src --jsx=automatic --loader:.css=empty \
  "--define:import.meta.env={\"VITE_APP_ENV\":\"development\",\"BASE_URL\":\"/\"}" --log-level=warning
TZ=UTC node "$OUT/controller-harness.mjs"
