#!/bin/bash
# Final verification on the committed source. Every step's command + exit code -> logs/final/SUMMARY.txt
SP=/tmp/claude-0/-home-user-e-g--aurora-icu-his/c677fc5a-2628-5760-a6c5-a453bbda3723/scratchpad; REPO=/home/user/e.g.-aurora-icu-his; L=$SP/logs/final; mkdir -p $L $SP/shots-final
export DOTNET_ROOT=/root/.dotnet PATH=/root/.dotnet:$PATH DOTNET_CLI_TELEMETRY_OPTOUT=1
S=$L/SUMMARY.txt; echo "final verification — HEAD $(git -C $REPO rev-parse HEAD) — $(date -u '+%F %T') UTC" > $S
git -C $REPO status --porcelain >> $S
step() { local name=$1; shift; ( "$@" ) > $L/$name.log 2>&1; local rc=$?; echo "exit=$rc  $name :: $*" >> $S; return 0; }
cd $REPO
step 01-npm-build          npm run build
step 02-dotnet-build       dotnet build server/AuroraIcu.Api.csproj -c Release
step 03-harness-cs-build   dotnet build $SP/marharness/MarHarness.csproj -c Release -o $SP/marharness/out
step 04-harness-cs-run     bash -c "dotnet $SP/marharness/out/MarHarness.dll $SP/marharness/scenarios.json > $L/harness-cs.json"
step 05-harness-ts-build   $REPO/node_modules/.bin/esbuild $SP/tsharness/harness.ts --bundle --platform=node --format=esm --outfile=$SP/tsharness/harness.mjs "--define:import.meta.env={\"VITE_APP_ENV\":\"development\"}" --log-level=warning
step 06-harness-ts-run     bash -c "TZ=UTC node $SP/tsharness/harness.mjs $SP/marharness/scenarios.json > $L/harness-ts.json"
step 07-parity             python3 $SP/tsharness/compare.py $L/harness-cs.json $L/harness-ts.json
step 08-before-after       bash -c "dotnet $SP/marharness-before/out/MarHarnessBefore.dll $SP/marharness/scenarios.json > $L/harness-before.json && python3 $SP/tsharness/beforeafter.py $L/harness-before.json $L/harness-cs.json > $L/schedule-before-after.txt"
step 09-vite-staging       bash -c "rm -rf $SP/fe-dist && VITE_APP_ENV=staging npx vite build --outDir $SP/fe-dist"
step 10-dotnet-publish     bash -c "rm -rf $SP/app && cd server && dotnet publish -c Release -o $SP/app /p:UseAppHost=false && cp -r $SP/fe-dist $SP/app/wwwroot"
