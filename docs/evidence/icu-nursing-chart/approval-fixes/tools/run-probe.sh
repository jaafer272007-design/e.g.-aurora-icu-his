#!/bin/bash
# Build + run mar-refused-retry-probe.ts over a source TREE (arg 1, with node_modules): the REAL
# src/features/nurse-care/marController.ts and the shipped mock store of that tree (esbuild alias
# @app -> <tree>/src). Run unchanged against the published controller and the corrected one.
set -e
TREE=${1:?usage: run-probe.sh <source tree with node_modules> [out dir]}
OUT=${2:-$(mktemp -d)}
HERE=$(cd "$(dirname "$0")" && pwd)
cd "$TREE"
./node_modules/.bin/esbuild "$HERE/mar-refused-retry-probe.ts" --bundle --platform=node --format=esm \
  --outfile="$OUT/mar-refused-retry-probe.mjs" --alias:@app=./src --jsx=automatic --loader:.css=empty \
  "--define:import.meta.env={\"VITE_APP_ENV\":\"development\",\"BASE_URL\":\"/\"}" --log-level=warning
echo "probe over $(git -C "$TREE" rev-parse HEAD) (worktree $(git -C "$TREE" diff --quiet -- src && echo clean || echo MODIFIED))"
TZ=UTC node "$OUT/mar-refused-retry-probe.mjs"
