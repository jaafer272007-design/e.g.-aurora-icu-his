#!/bin/bash
# The combined PRODUCTION-pairing acceptance, one pass: the assembled server publish + its own
# production bundle in wwwroot (same origin) on a FRESH disposable database -> integration-setup.py
# -> integration-check.mjs main -> session1 ui-check.mjs (the Orders & Medication Done entry point,
# on its own patient) -> a server restart on the same database -> integration-check.mjs post.
#   run-integration.sh <server publish dir> <production bundle dir> <source commit>
set -u
S=${SCRATCH:?}; APP=$1; UI=$2; C=$3
T=$(cd "$(dirname "$0")" && pwd); S1=$(cd "$T/../../session1/tools" && pwd)
L=${LOGS:-$T/../logs}; SH=${SHOTS:-$T/../screenshots}
rm -rf $S/app-int-ui && cp -r "$APP" $S/app-int-ui && rm -rf $S/app-int-ui/wwwroot && cp -r "$UI" $S/app-int-ui/wwwroot
(cd $S1 && SCRATCH=$S ./prod-boot.sh $S/app-int-ui $C) 2>&1 | tee $L/03-prod-boot-and-setup.log
(cd $T && SCRATCH=$S NURSING_DB=aurora_nursing_prod python3 integration-setup.py) 2>&1 | tee -a $L/03-prod-boot-and-setup.log
rm -rf $SH && mkdir -p $SH
(cd $T && SCRATCH=$S SHOTS=$SH node integration-check.mjs main) 2>&1 | tee $L/04-integration-check-main.log
(cd $S1 && SCRATCH=$S SHOTS=$SH/orders-medication node ui-check.mjs) 2>&1 | tee $L/05-orders-medication-ui-check.log
(cd $T && SCRATCH=$S ./restart-prod.sh $S/app-int-ui $C) 2>&1 | tee $L/06-restart.log
(cd $T && SCRATCH=$S SHOTS=$SH node integration-check.mjs post) 2>&1 | tee $L/07-integration-check-post-restart.log
grep -H "^RESULT" $L/03-prod-boot-and-setup.log $L/04-integration-check-main.log $L/05-orders-medication-ui-check.log $L/07-integration-check-post-restart.log
