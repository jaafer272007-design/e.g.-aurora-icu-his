#!/bin/bash
# Build a SCRATCH source tree = a commit of this repository (arg 1, default HEAD) + the Session-1
# contract stand-ins overlaid at Session 1's paths (+ the harness-only chart placement). The
# repository checkout is never modified. After Session 1's commits are assembled, run the checks on
# the integrated tree instead and skip this overlay (STANDIN=0 copies the commit only).
# Usage: overlay.sh [commit] [dest dir]
set -e
REPO=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
HERE=$(cd "$(dirname "$0")" && pwd)
REV=${1:-HEAD}
DST=${2:?usage: overlay.sh <commit> <dest dir>}
rm -rf "$DST"; mkdir -p "$DST"
git -C "$REPO" archive "$REV" src index.html public package.json tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts scripts | tar -x -C "$DST"
ln -sfn "$REPO/node_modules" "$DST/node_modules"
if [ "${STANDIN:-1}" = 1 ]; then
  S=$HERE/contract-standin
  cp "$S/nursingRounds.standin.ts" "$DST/src/lib/nursingRounds.ts"
  cp "$S/ioSnapshots.standin.ts" "$DST/src/lib/api/ioSnapshots.ts"
  cat "$S/types-append.standin.ts" >> "$DST/src/lib/api/types.ts"
  cat "$S/index-append.standin.ts" >> "$DST/src/lib/api/index.ts"
fi
DST=$DST bash "$HERE/contract-standin/harness-chart-placement.sh"
echo "overlay: $DST = $(git -C "$REPO" rev-parse "$REV") + $( [ "${STANDIN:-1}" = 1 ] && echo 'contract stand-ins + ' )harness chart placement"
