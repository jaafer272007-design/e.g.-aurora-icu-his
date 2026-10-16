#!/bin/bash
# Final verification of ONE ACTION PER ROUND on the committed source, run once. Every step's command + exit code -> logs/final/SUMMARY.txt
SP=/tmp/claude-0/-home-user-e-g--aurora-icu-his/c677fc5a-2628-5760-a6c5-a453bbda3723/scratchpad; REPO=/home/user/e.g.-aurora-icu-his; L=$SP/logs/oneaction/final; mkdir -p $L
E=$REPO/docs/evidence/icu-update-batch-1/one-action-per-round; T=$REPO/docs/evidence/icu-update-batch-1/correction/tools
export DOTNET_ROOT=/root/.dotnet PATH=/root/.dotnet:$PATH DOTNET_CLI_TELEMETRY_OPTOUT=1
: "${AURORA_LOCAL_DB_PASSWORD:?the local synthetic DB password (never committed)}"
S=$L/SUMMARY.txt; echo "final verification (one action per round) — HEAD $(git -C $REPO rev-parse HEAD) — $(date -u '+%F %T') UTC" > $S
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
# --- the rolling-timer replay (unchanged rule): server sources vs client modules ---
step 12-harness-cs-build      dotnet build $SP/rollharness/RollHarness.csproj -c Release -o $SP/rollharness/out
step 13-harness-cs-run        bash -c "dotnet $SP/rollharness/out/RollHarness.dll $SP/rollharness/scenarios.json > $L/harness-cs.json"
# [the first final run used correction/tools/rollts/harness.ts here: 122 mismatches, all on the CLIENT side — that harness read the
#  mock's new refusal (a string) as success, and drove 12 pre-gate early steps through the new gate. Superseded by the copy
#  one-action-per-round/tools/rollreplay/harness.ts (see its header); steps 14b-16b re-run only these three with it.]
step 14-harness-ts-build      $REPO/node_modules/.bin/esbuild $E/tools/rollreplay/harness.ts --bundle --platform=node --format=esm --outfile=$SP/rollts/harness.mjs "--define:import.meta.env={\"VITE_APP_ENV\":\"development\"}" --log-level=warning
step 15-harness-ts-run        bash -c "TZ=UTC node $SP/rollts/harness.mjs $SP/rollharness/scenarios.json > $L/harness-ts.json"
step 16-expectations+parity   python3 $SP/rollts/check.py $SP/rollharness/scenarios.json $L/harness-cs.json $L/harness-ts.json
# --- the daily cards (marDays.ts changed) and the one-action client mirror, fake clock ---
step 17-mardays-build         $REPO/node_modules/.bin/esbuild $REPO/docs/evidence/icu-update-batch-1/sidebar-mar-cards/tools/mardays-harness.ts --bundle --platform=node --format=esm --outfile=$SP/mardays-harness.mjs "--define:import.meta.env={\"VITE_APP_ENV\":\"development\"}" --log-level=warning
step 18-mardays-run-UTC       bash -c "TZ=UTC node $SP/mardays-harness.mjs"
step 19-oneaction-build       $REPO/node_modules/.bin/esbuild $E/tools/oneaction-harness.ts --bundle --platform=node --format=esm --outfile=$SP/oneaction-harness.mjs "--define:import.meta.env={\"VITE_APP_ENV\":\"development\"}" --log-level=warning
step 20-oneaction-run-UTC     bash -c "TZ=UTC node $SP/oneaction-harness.mjs"
step 21-oneaction-run-LA      bash -c "TZ=America/Los_Angeles node $SP/oneaction-harness.mjs"
# --- the live stack on the committed source: publish, staging bundle, restart ---
step 22-publish-server        dotnet publish server/AuroraIcu.Api.csproj -c Release -o $SP/app-oneaction --nologo
step 23-vite-staging          bash -c "VITE_APP_ENV=staging npx vite build --outDir $SP/fe-dist-oneaction --emptyOutDir && rm -rf $SP/app-oneaction/wwwroot && cp -r $SP/fe-dist-oneaction $SP/app-oneaction/wwwroot"
for p in /proc/[0-9]*; do c=$(readlink $p/cwd 2>/dev/null); [ "$c" = "$SP/app-oneaction" ] && kill ${p#/proc/}; done; sleep 2
nohup bash $E/tools/run-server-oneaction.sh > $L/server.log 2>&1 &
step 24-healthz               bash -c "for i in \$(seq 1 60); do curl -sf http://localhost:8080/healthz && exit 0; sleep 1; done; exit 1"
# --- real API + PostgreSQL ---
step 25-api-check-oneaction   python3 $E/tools/api-check-oneaction.py
step 26-suite-mar             python3 $T/run-suite.py .github/workflows/deployed-mar-e2e.yml
step 27-suite-assignments     python3 $T/run-suite.py .github/workflows/deployed-assignments-e2e.yml
step 28-suite-encounter-scope python3 $T/run-suite.py .github/workflows/deployed-encounter-scope-e2e.yml --skip=4
# --- browser ---
mkdir -p $SP/shots-oneaction-final; rm -f $SP/shots-oneaction-final/*
step 29-browser-setup         python3 $E/tools/oneaction-setup.py $L/oneaction-setup.json
step 30-browser-check         node $E/tools/browser/oneaction-browser.cjs $SP/shots-oneaction-final $L/oneaction-setup.json
cat $S
