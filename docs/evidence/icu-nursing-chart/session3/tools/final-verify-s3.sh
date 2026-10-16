#!/bin/bash
# Session 3 — every focused check, run ONCE on a committed source (arg 1, default HEAD). Each step's
# command and exit code -> $WORK/logs/SUMMARY.txt; logs + screenshots under $WORK.
# Needs: node_modules installed in the checkout; a published server dir (S3_APP) built from the same
# server source (this branch does not change server/); local PostgreSQL with the synthetic DB
# (S3_DB, default aurora_s3) and AURORA_LOCAL_DB_PASSWORD; JWT secret file (S3_JWT_FILE).
# Synthetic data only. Port 8093 and DB aurora_s3 keep it apart from Sessions 1/2.
set -u
REPO=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
T=$(cd "$(dirname "$0")" && pwd)
REV=$(git -C "$REPO" rev-parse "${1:-HEAD}")
WORK=${S3_WORK:?scratch directory}; APP=${S3_APP:?published server dir}
: "${AURORA_LOCAL_DB_PASSWORD:?the local synthetic DB password (never committed)}"
: "${S3_JWT_FILE:?a local JWT secret file (never committed)}"
export S3_BASE=${S3_BASE:-http://localhost:8093} SAFERETRY_DB=${S3_DB:-aurora_s3}
L=$WORK/logs; SH=$WORK/shots; TREE=$WORK/tree; BARE=$WORK/bare
rm -rf "$L" "$SH"; mkdir -p "$L" "$SH/saferetry" "$SH/s3"
S=$L/SUMMARY.txt
echo "Session 3 final verification — source $REV — $(date -u '+%F %T') UTC" > "$S"
echo "uncommitted paths under src/ in the checkout (not used: the source comes from git archive): $(git -C "$REPO" status --porcelain -- src | wc -l)" >> "$S"
step() { local name=$1; shift; ( "$@" ) > "$L/$name.log" 2>&1; local rc=$?; echo "exit=$rc  $name :: $*" >> "$S"; return 0; }
P=$REPO/docs/evidence/icu-update-batch-1
# --- the branch on its own: what is missing is exactly Session 1's contract ---
step 01-bare-overlay       env STANDIN=0 bash "$T/overlay.sh" "$REV" "$BARE"
step 02-bare-tsc           bash -c "cd '$BARE' && npx tsc -b --force"
# --- the branch + the contract stand-ins ---
step 03-overlay            bash "$T/overlay.sh" "$REV" "$TREE"
step 04-tsc                bash -c "cd '$TREE' && npx tsc -b --force"
step 05-vite-build         bash -c "cd '$TREE' && npx vite build --outDir '$WORK/fe-dev' --emptyOutDir"
step 06-controller-harness bash "$T/run-controller-harness.sh" "$TREE" "$WORK/harness"
step 06b-mutation-check    bash "$T/mutation-check.sh" "$TREE" "$WORK/mutated"
# --- the previous rounds' fake-clock harnesses on the MOVED marDays.ts (only the import paths rewritten) ---
for h in sidebar-mar-cards/tools/mardays-harness.ts safe-retry-first-dose/tools/mirror-harness.ts; do
  b=$(basename "$h" .ts)
  sed -e "s#/home/user/e.g.-aurora-icu-his/src/pages/NurseWorkspace/marDays.ts#$TREE/src/features/nurse-care/marDays.ts#" \
      -e "s#/home/user/e.g.-aurora-icu-his/src/#$TREE/src/#g" "$P/$h" > "$WORK/$b.ts"
  step "07-$b-build" bash -c "cd '$TREE' && ./node_modules/.bin/esbuild '$WORK/$b.ts' --bundle --platform=node --format=esm --outfile='$WORK/$b.mjs' '--define:import.meta.env={\"VITE_APP_ENV\":\"development\"}' --log-level=warning"
  step "08-$b-UTC"          bash -c "TZ=UTC node '$WORK/$b.mjs'"
  step "08-$b-LosAngeles"   bash -c "TZ=America/Los_Angeles node '$WORK/$b.mjs'"
done
# --- the live local stack: staging bundle of the tree in the published server, restart ---
step 09-vite-staging       bash -c "cd '$TREE' && VITE_APP_ENV=staging npx vite build --outDir '$WORK/fe-staging' --emptyOutDir && rm -rf '$APP/wwwroot' && cp -r '$WORK/fe-staging' '$APP/wwwroot'"
for p in /proc/[0-9]*; do c=$(readlink "$p/cwd" 2>/dev/null || true); if [ "$c" = "$APP" ]; then kill "${p#/proc/}" 2>/dev/null || true; fi; done; sleep 2
( export DOTNET_ROOT=/root/.dotnet PATH=/root/.dotnet:$PATH PORT=${S3_BASE##*:} APP_ENV=staging TZ=Asia/Baghdad AURORA_EDITION=icu AI_PROVIDER=none AI_UNAVAILABLE_REASON="no AI in the ICU product" \
    DATABASE_URL="postgres://aurora:${AURORA_LOCAL_DB_PASSWORD}@localhost:5432/${SAFERETRY_DB}" JWT_SECRET="$(cat "$S3_JWT_FILE")" CORS_ORIGINS=https://jaafer272007-design.github.io RENDER_GIT_COMMIT="$REV-local"
  cd "$APP" && nohup dotnet AuroraIcu.Api.dll > "$L/server.log" 2>&1 & )
step 10-healthz            bash -c "for i in \$(seq 1 60); do curl -sf $S3_BASE/healthz && exit 0; sleep 1; done; exit 1"
# --- the previous round's MAR safe-retry / first-dose browser suite, unchanged but for base/DB (v2 copies) ---
step 11-saferetry-setup    python3 "$T/saferetry-setup.v2.py" "$L/saferetry-setup.json"
step 12-saferetry-browser  node "$T/browser/saferetry-browser.v2.cjs" "$SH/saferetry" "$L/saferetry-setup.json"
step 13-saferetry-cleanup  python3 "$T/saferetry-cleanup.v2.py" "$L/saferetry-setup.json"
# --- Session 3's browser suite (real server + contract simulator for Session 1's endpoints) ---
step 14-s3-browser         node "$T/browser/s3-browser.cjs" "$SH/s3"
cat "$S"
