#!/bin/bash
# The affected MAR browser suite, once, on the corrected source: Session 3's safe-retry / first-dose
# scenarios (saferetry-*.v2, UNCHANGED: F, S1, S1b, S2, S3, S4 — each ending with an intentional later
# PRN / continuous documentation) against the corrected STAGING bundle served same-origin by the server
# publish, real ASP.NET + PostgreSQL on a FRESH demo-seeded disposable database; the server is stopped after.
#   run-saferetry-replay.sh <server publish dir> <corrected staging bundle dir> <source commit>
set -u
S=${SCRATCH:?}; APP=$1; UI=$2; C=$3
T=$(cd "$(dirname "$0")" && pwd); S1=$(cd "$T/../../session1/tools" && pwd); S3=$(cd "$T/../../session3/tools" && pwd)
L=${LOGS:-$T/../logs}; SH=${SHOTS:-$T/../screenshots}/saferetry-replay
DB=aurora_saferetry_appr
rm -rf $S/app-sr && cp -r "$APP" $S/app-sr && rm -rf $S/app-sr/wwwroot && cp -r "$UI" $S/app-sr/wwwroot
pkill -f "dotnet AuroraIcu[.]Api"; sleep 2
PGPASSWORD=$(cat $S/db.pw) dropdb -h localhost -U aurora --if-exists $DB
PGPASSWORD=$(cat $S/db.pw) createdb -h localhost -U aurora $DB
( BUILD_COMMIT=$C APP_ENV=staging nohup bash "$S1/run-server.sh" $S/app-sr $DB > $S/server-saferetry.log 2>&1 & )
for i in $(seq 1 120); do curl -sf localhost:8080/healthz >/dev/null && break; sleep 0.5; done
rm -rf $SH && mkdir -p $SH
{ echo "# Session 3's MAR safe-retry / first-dose browser suite (saferetry-*.v2, unchanged; scenarios F, S1, S1b, S2, S3, S4) replayed against the CORRECTED source $C: staging bundle served same-origin by the server publish, real ASP.NET + PostgreSQL (fresh demo-seeded DB $DB)"
  curl -s localhost:8080/healthz; echo
  export S3_BASE=http://localhost:8080 SAFERETRY_DB=$DB AURORA_LOCAL_DB_PASSWORD=$(cat $S/db.pw)
  python3 "$S3/saferetry-setup.v2.py" $S/saferetry-appr-setup.json && cat $S/saferetry-appr-setup.json
  node "$S3/browser/saferetry-browser.v2.cjs" "$SH" $S/saferetry-appr-setup.json
  python3 "$S3/saferetry-cleanup.v2.py" $S/saferetry-appr-setup.json; } 2>&1 | tee $L/08-mar-saferetry-replay-corrected.log
pkill -f "dotnet AuroraIcu[.]Api"; sleep 2
curl -sf localhost:8080/healthz >/dev/null && echo "SERVER STILL UP" || echo "disposable server stopped" | tee -a $L/08-mar-saferetry-replay-corrected.log
