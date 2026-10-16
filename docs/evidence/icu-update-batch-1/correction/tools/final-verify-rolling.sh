#!/bin/bash
# Final verification of the correction on the committed source. Every step's command + exit code -> logs/rolling/final/SUMMARY.txt
SP=/tmp/claude-0/-home-user-e-g--aurora-icu-his/c677fc5a-2628-5760-a6c5-a453bbda3723/scratchpad; REPO=/home/user/e.g.-aurora-icu-his; L=$SP/logs/rolling/final; mkdir -p $L
export DOTNET_ROOT=/root/.dotnet PATH=/root/.dotnet:$PATH DOTNET_CLI_TELEMETRY_OPTOUT=1
S=$L/SUMMARY.txt; echo "final verification (correction) — HEAD $(git -C $REPO rev-parse HEAD) — $(date -u '+%F %T') UTC" > $S
echo "working tree: $(git -C $REPO status --porcelain | wc -l) uncommitted paths" >> $S
step() { local name=$1; shift; ( "$@" ) > $L/$name.log 2>&1; local rc=$?; echo "exit=$rc  $name :: $*" >> $S; return 0; }
cd $REPO
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
step 12-harness-cs-build      dotnet build $SP/rollharness/RollHarness.csproj -c Release -o $SP/rollharness/out
step 13-harness-cs-run        bash -c "dotnet $SP/rollharness/out/RollHarness.dll $SP/rollharness/scenarios.json > $L/harness-cs.json"
step 14-harness-ts-build      $REPO/node_modules/.bin/esbuild $SP/rollts/harness.ts --bundle --platform=node --format=esm --outfile=$SP/rollts/harness.mjs "--define:import.meta.env={\"VITE_APP_ENV\":\"development\"}" --log-level=warning
step 15-harness-ts-run        bash -c "TZ=UTC node $SP/rollts/harness.mjs $SP/rollharness/scenarios.json > $L/harness-ts.json"
step 16-expectations+parity   python3 $SP/rollts/check.py $SP/rollharness/scenarios.json $L/harness-cs.json $L/harness-ts.json
cat $S
