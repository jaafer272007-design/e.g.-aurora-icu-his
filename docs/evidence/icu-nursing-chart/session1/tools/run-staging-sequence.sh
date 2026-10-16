#!/bin/bash
# The single final run, STAGING pairing (demo seed; synthetic data; local disposable PostgreSQL 16):
#   base build (2fc317c) on a fresh DB -> pre-upgrade setup -> new build -> upgrade check ->
#   the deployed orders + observations suites replayed verbatim -> nursing API check -> I&O API check
#   -> restart persistence (pre, restart, post). Logs to ../logs/.
#   run-staging-sequence.sh <base app dir> <base commit> <new app dir> <new commit> <checkout of new commit>
set -u
S=${SCRATCH:?}; BASE_APP=$1; BASE_C=$2; NEW_APP=$3; NEW_C=$4; WT=$5
T=$(cd "$(dirname "$0")" && pwd); L=$T/../logs; DB=aurora_nursing_final
export NURSING_DB=$DB IO_MODULE=$S/iojs-final/ioSnapshots.js
up() { for i in $(seq 1 120); do curl -sf localhost:8080/healthz >/dev/null && break; sleep 0.5; done; curl -s localhost:8080/healthz; echo; }
start() { pkill -f "dotnet AuroraIcu[.]Api"; sleep 2; ( BUILD_COMMIT=$2 CORS_ORIGINS="https://jaafer272007-design.github.io;http://localhost:5173" nohup bash $T/run-server.sh "$1" $DB > $S/server-$3.log 2>&1 & ); up; }
rm -f $S/nursing-state.json
pkill -f "dotnet AuroraIcu[.]Api"; sleep 2
PGPASSWORD=$(cat $S/db.pw) dropdb -h localhost -U aurora --if-exists $DB
PGPASSWORD=$(cat $S/db.pw) createdb -h localhost -U aurora $DB
(cd $WT && rm -rf $S/iojs-final && ln -sfn /home/user/e.g.-aurora-icu-his/node_modules node_modules && npx tsc --outDir $S/iojs-final --module es2022 --target es2022 --moduleResolution bundler --skipLibCheck src/lib/api/ioSnapshots.ts; rm -f node_modules)
cd $T
echo "== base build $BASE_C on fresh $DB"; start "$BASE_APP" $BASE_C final-base
python3 pre-upgrade-setup.py 2>&1 | tee $L/01-pre-upgrade-setup.log
echo "== new build $NEW_C (upgrade in place)"; start "$NEW_APP" $NEW_C final-new-1
python3 upgrade-check.py 2>&1 | tee $L/02-upgrade-check.log
(cd $WT && python3 $T/replay-deployed-suite.py .github/workflows/deployed-orders-e2e.yml $NEW_C) 2>&1 | tee $L/02a-replay-deployed-orders-e2e.log
(cd $WT && python3 $T/replay-deployed-suite.py .github/workflows/deployed-observations-e2e.yml $NEW_C) 2>&1 | tee $L/02b-replay-deployed-observations-e2e.log
python3 api-check-nursing.py 2>&1 | tee $L/03-api-check-nursing.log
python3 api-check-io.py 2>&1 | tee $L/04-api-check-io.log
python3 restart-check.py pre 2>&1 | tee $L/05-restart-check-pre.log
echo "== restart"; start "$NEW_APP" $NEW_C final-new-2
python3 restart-check.py post 2>&1 | tee $L/06-restart-check-post.log
grep -H "^RESULT" $L/0[1-6]*.log
