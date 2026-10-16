#!/bin/bash
# The single final run, PRODUCTION pairing (the appliance topology): the new build + its production
# bundle in wwwroot, APP_ENV=production on a fresh DB -> production seed + bootstrap admin ->
# synthetic accounts + admission (prod-setup.py) -> the browser check (ui-check.mjs). Logs + screenshots.
#   run-production-ui.sh <server publish dir> <production bundle dir> <commit>
set -u
S=${SCRATCH:?}; APP=$1; UI=$2; C=$3
T=$(cd "$(dirname "$0")" && pwd); L=$T/../logs
rm -rf $S/app-ui-final && cp -r "$APP" $S/app-ui-final && cp -r "$UI" $S/app-ui-final/wwwroot
cd $T && SCRATCH=$S ./prod-boot.sh $S/app-ui-final $C | tee $L/07-prod-setup.log
NURSING_DB=aurora_nursing_prod python3 prod-setup.py 2>&1 | tee -a $L/07-prod-setup.log
rm -rf $T/../screenshots && SHOTS=$T/../screenshots node ui-check.mjs 2>&1 | tee $L/08-ui-check.log
grep -H "^RESULT" $L/07-prod-setup.log $L/08-ui-check.log
