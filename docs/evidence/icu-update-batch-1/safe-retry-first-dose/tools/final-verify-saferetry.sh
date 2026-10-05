#!/bin/bash
# Final verification of FIRST DOSE + SAFE RETRY on the committed source, run once. Every step's command + exit code -> logs/final/SUMMARY.txt
# (one-action-per-round's final-verify-oneaction.sh, with this change's checks; not edited while it runs)
SP=/tmp/claude-0/-home-user-e-g--aurora-icu-his/c677fc5a-2628-5760-a6c5-a453bbda3723/scratchpad; REPO=/home/user/e.g.-aurora-icu-his; L=$SP/logs/saferetry/final; mkdir -p $L
E=$REPO/docs/evidence/icu-update-batch-1/safe-retry-first-dose; OA=$REPO/docs/evidence/icu-update-batch-1/one-action-per-round; T=$REPO/docs/evidence/icu-update-batch-1/correction/tools
export DOTNET_ROOT=/root/.dotnet PATH=/root/.dotnet:$PATH DOTNET_CLI_TELEMETRY_OPTOUT=1
: "${AURORA_LOCAL_DB_PASSWORD:?the local synthetic DB password (never committed)}"
S=$L/SUMMARY.txt; echo "final verification (first dose + safe retry) — HEAD $(git -C $REPO rev-parse HEAD) — $(date -u '+%F %T') UTC" > $S
echo "working tree: $(git -C $REPO status --porcelain -- src server .github | wc -l) uncommitted paths under src/ server/ .github/" >> $S
step() { local name=$1; shift; ( "$@" ) > $L/$name.log 2>&1; local rc=$?; echo "exit=$rc  $name :: $*" >> $S; return 0; }
cd $REPO
mkdir -p $SP/rollharness $SP/rollts; cp $T/rollharness/{Harness.cs,RollHarness.csproj,scenarios.json} $SP/rollharness/; cp $T/rollts/* $SP/rollts/
# --- builds + the ci.yml frontend/server steps ---
step 01-npm-build             npm run build
step 02-dotnet-build-release  dotnet build server/AuroraIcu.Api.csproj -c Release
step 03-ci-tsc-force          npx tsc -b --force
step 04-ci-vite-build         npx vite build
step 05-ci-reception-gate     node scripts/reception-required-fields-gate.mjs
step 06-ci-awaiting-bed-gate  node scripts/awaiting-bed-gate.mjs
step 07-ci-ai-section-gate    node scripts/ai-section-gate.mjs
step 08-ci-edition-gate       node scripts/edition-gate.mjs
step 09-ci-vite-env-allowlist bash $SP/ci-viteenv-gate.sh
step 10-ci-dotnet-build       dotnet build server --nologo
step 11-ci-vocab-gate         node scripts/vocab-registration-gate.mjs
# --- the rolling timer (unchanged): server sources vs client modules, one-action-per-round's superseding replay harness ---
step 12-harness-cs-build      dotnet build $SP/rollharness/RollHarness.csproj -c Release -o $SP/rollharness/out
step 13-harness-cs-run        bash -c "dotnet $SP/rollharness/out/RollHarness.dll $SP/rollharness/scenarios.json > $L/harness-cs.json"
step 14-harness-ts-build      $REPO/node_modules/.bin/esbuild $OA/tools/rollreplay/harness.ts --bundle --platform=node --format=esm --outfile=$SP/rollts/harness.mjs "--define:import.meta.env={\"VITE_APP_ENV\":\"development\"}" --log-level=warning
step 15-harness-ts-run        bash -c "TZ=UTC node $SP/rollts/harness.mjs $SP/rollharness/scenarios.json > $L/harness-ts.json"
step 16-expectations+parity   python3 $SP/rollts/check.py $SP/rollharness/scenarios.json $L/harness-cs.json $L/harness-ts.json
# --- daily cards (marDays.ts changed) + the client/mock mirror under a fake clock ---
step 17-mardays-build         $REPO/node_modules/.bin/esbuild $REPO/docs/evidence/icu-update-batch-1/sidebar-mar-cards/tools/mardays-harness.ts --bundle --platform=node --format=esm --outfile=$SP/mardays-harness.mjs "--define:import.meta.env={\"VITE_APP_ENV\":\"development\"}" --log-level=warning
step 18-mardays-run-UTC       bash -c "TZ=UTC node $SP/mardays-harness.mjs"
step 19-mirror-build          $REPO/node_modules/.bin/esbuild $E/tools/mirror-harness.ts --bundle --platform=node --format=esm --outfile=$SP/mirror-harness.mjs "--define:import.meta.env={\"VITE_APP_ENV\":\"development\"}" --log-level=warning
step 20-mirror-run-UTC        bash -c "TZ=UTC node $SP/mirror-harness.mjs"
step 21-mirror-run-LA         bash -c "TZ=America/Los_Angeles node $SP/mirror-harness.mjs"
# (the previous round's oneaction-harness.ts is not re-run: its first scenario documents a NEW order's round 1 and
#  its once scenario a new once dose, both expected LOCKED — exactly what the owner's first-dose decision opened —
#  and every later step of that timeline cascades from it. mirror-harness.ts [2] re-runs its owner's example as a
#  subsequent round, and [5] its midnight case.)
# --- the live stack on the committed source: publish, staging bundle, restart ---
step 22-publish-server        dotnet publish server/AuroraIcu.Api.csproj -c Release -o $SP/app-saferetry --nologo
step 23-vite-staging          bash -c "VITE_APP_ENV=staging npx vite build --outDir $SP/fe-dist-saferetry --emptyOutDir && rm -rf $SP/app-saferetry/wwwroot && cp -r $SP/fe-dist-saferetry $SP/app-saferetry/wwwroot"
for p in /proc/[0-9]*; do c=$(readlink $p/cwd 2>/dev/null); case "$c" in $SP/app-*) kill ${p#/proc/};; esac; done; sleep 2
nohup bash $E/tools/run-server-saferetry.sh $SP/app-saferetry > $L/server.log 2>&1 &
step 24-healthz               bash -c "for i in \$(seq 1 60); do curl -sf http://localhost:8080/healthz && exit 0; sleep 1; done; exit 1"
# --- real API + PostgreSQL ---
step 25-api-check-saferetry   python3 $E/tools/api-check-saferetry.py
step 26-api-check-oneaction-v2 env ONEACTION_DB=aurora_saferetry python3 $E/tools/api-check-oneaction.v2.py
step 27-suite-mar             python3 $T/run-suite.py .github/workflows/deployed-mar-e2e.yml
step 28-suite-assignments     python3 $T/run-suite.py .github/workflows/deployed-assignments-e2e.yml
step 29-suite-encounter-scope python3 $T/run-suite.py .github/workflows/deployed-encounter-scope-e2e.yml --skip=4
# --- browser (controlled transport against the real page) ---
mkdir -p $SP/shots-saferetry-final; rm -f $SP/shots-saferetry-final/*
step 30-browser-setup         python3 $E/tools/saferetry-setup.py $L/saferetry-setup.json
step 31-browser-check         node $E/tools/browser/saferetry-browser.cjs $SP/shots-saferetry-final $L/saferetry-setup.json
step 32-browser-cleanup       python3 $E/tools/saferetry-cleanup.py $L/saferetry-setup.json
cat $S
