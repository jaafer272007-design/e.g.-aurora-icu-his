#!/bin/bash
# ONE disposable production pairing for both focused legs: the server publish of the corrected source
# (server source identical to the reviewed head 72a7894) on a FRESH disposable database ->
# approval-setup.py -> approval-legs.mjs pre-fix (the reviewed head's PRODUCTION bundle in wwwroot: the
# reproduction) -> the corrected production bundle swapped into wwwroot + a restart on the SAME database ->
# approval-legs.mjs fixed -> the server stopped.
#   run-approval-legs.sh <server publish dir> <pre-fix bundle dir> <corrected bundle dir> <source commit>
set -u
S=${SCRATCH:?}; APP=$1; OLDUI=$2; NEWUI=$3; C=$4
T=$(cd "$(dirname "$0")" && pwd); S1=$(cd "$T/../../session1/tools" && pwd); I=$(cd "$T/../../integration/tools" && pwd)
L=${LOGS:-$T/../logs}; SH=${SHOTS:-$T/../screenshots}
rm -rf $S/app-approval && cp -r "$APP" $S/app-approval && rm -rf $S/app-approval/wwwroot && cp -r "$OLDUI" $S/app-approval/wwwroot
{ echo "# boot: server publish of $C, wwwroot = PRE-FIX production bundle ($OLDUI)"; (cd $S1 && SCRATCH=$S ./prod-boot.sh $S/app-approval $C); \
  (cd $T && SCRATCH=$S NURSING_DB=aurora_nursing_prod python3 approval-setup.py); } 2>&1 | tee $L/04-approval-boot-and-setup.log
rm -rf $SH && mkdir -p $SH
(cd $T && SCRATCH=$S SHOTS=$SH node approval-legs.mjs pre-fix) 2>&1 | tee $L/05-legs-pre-fix-reproduction.log
rm -rf $S/app-approval/wwwroot && cp -r "$NEWUI" $S/app-approval/wwwroot
{ echo "# wwwroot swapped to the CORRECTED production bundle ($NEWUI); restart on the same database"; (cd $I && SCRATCH=$S ./restart-prod.sh $S/app-approval $C); } 2>&1 | tee $L/06-swap-and-restart.log
(cd $T && SCRATCH=$S SHOTS=$SH node approval-legs.mjs fixed) 2>&1 | tee $L/07-legs-fixed.log
pkill -f "dotnet AuroraIcu[.]Api"; sleep 2
curl -sf localhost:8080/healthz >/dev/null && echo "SERVER STILL UP" || echo "disposable server stopped" | tee -a $L/07-legs-fixed.log
grep -H "^RESULT" $L/04-approval-boot-and-setup.log $L/05-legs-pre-fix-reproduction.log $L/07-legs-fixed.log
