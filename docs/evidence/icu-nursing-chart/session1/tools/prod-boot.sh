#!/bin/bash
# (Re)create the disposable PRODUCTION-mode database and boot the appliance-style app dir on it.
#   prod-boot.sh <app dir with wwwroot> <build commit>   (SCRATCH set; secrets from the scratchpad)
S=${SCRATCH:?}; APP=${1:?app dir}; COMMIT=${2:?build commit}
pkill -f "dotnet AuroraIcu[.]Api"; sleep 2
PGPASSWORD=$(cat $S/db.pw) dropdb -h localhost -U aurora --if-exists aurora_nursing_prod
PGPASSWORD=$(cat $S/db.pw) createdb -h localhost -U aurora aurora_nursing_prod
python3 -c "import secrets; print('Boot-' + secrets.token_hex(12))" > $S/admin.pw
( BUILD_COMMIT=$COMMIT APP_ENV=production CORS_ORIGINS=https://aurora-icu.hospital.invalid FORMULARY_SEED=starter \
  ADMIN_BOOTSTRAP_PASSWORD=$(cat $S/admin.pw) nohup bash "$(dirname "$0")/run-server.sh" "$APP" aurora_nursing_prod > $S/server-prod.log 2>&1 & )
for i in $(seq 1 120); do curl -sf localhost:8080/healthz >/dev/null && break; sleep 0.5; done
curl -s localhost:8080/healthz; echo
