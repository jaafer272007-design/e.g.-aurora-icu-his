#!/bin/bash
# Restart the production-mode server on the SAME disposable database (no drop, no bootstrap): the
# persistence leg of the combined acceptance.   restart-prod.sh <app dir with wwwroot> <build commit>
S=${SCRATCH:?}; APP=${1:?app dir}; COMMIT=${2:?build commit}
S1=$(cd "$(dirname "$0")/../../session1/tools" && pwd)
pkill -f "dotnet AuroraIcu[.]Api"; sleep 2
curl -sf localhost:8080/healthz >/dev/null && { echo "server still up after kill"; exit 1; }
echo "server stopped; restarting on aurora_nursing_prod"
( BUILD_COMMIT=$COMMIT APP_ENV=production CORS_ORIGINS=https://aurora-icu.hospital.invalid FORMULARY_SEED=starter \
  nohup bash "$S1/run-server.sh" "$APP" aurora_nursing_prod > $S/server-prod-restart.log 2>&1 & )
for i in $(seq 1 120); do curl -sf localhost:8080/healthz >/dev/null && break; sleep 0.5; done
curl -s localhost:8080/healthz; echo
