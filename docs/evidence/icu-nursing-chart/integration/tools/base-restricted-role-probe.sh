#!/bin/bash
# Attribution probe for the one restricted-role finding of the combined acceptance: does the
# PRE-INTEGRATION head (2fc317c = main f0bf464 + the first ICU batch) make the same forbidden chart
# reads for a Physiotherapist and a Receptionist? Its own server publish + its own production
# bundle, same origin, on port 8081 and a separate disposable database (aurora_base_probe).
#   base-restricted-role-probe.sh <base server publish dir> <base production bundle dir> <base commit>
set -u
S=${SCRATCH:?}; APP=$1; UI=$2; C=$3
T=$(cd "$(dirname "$0")" && pwd); S1=$(cd "$T/../../session1/tools" && pwd)
rm -rf $S/app-base-ui && cp -r "$APP" $S/app-base-ui && rm -rf $S/app-base-ui/wwwroot && cp -r "$UI" $S/app-base-ui/wwwroot
PGPASSWORD=$(cat $S/db.pw) dropdb -h localhost -U aurora --if-exists aurora_base_probe
PGPASSWORD=$(cat $S/db.pw) createdb -h localhost -U aurora aurora_base_probe
python3 -c "import secrets; print('Boot-' + secrets.token_hex(12))" > $S/admin-base.pw
PORT=8081 BUILD_COMMIT=$C APP_ENV=production CORS_ORIGINS=https://aurora-icu.hospital.invalid FORMULARY_SEED=starter \
  ADMIN_BOOTSTRAP_PASSWORD=$(cat $S/admin-base.pw) nohup bash "$S1/run-server.sh" $S/app-base-ui aurora_base_probe > $S/server-base-probe.log 2>&1 &
echo $! > $S/base-probe.pid   # run-server.sh execs dotnet: this pid is the probe server (port 8081) only
for i in $(seq 1 120); do curl -sf localhost:8081/healthz >/dev/null && break; sleep 0.5; done
curl -s localhost:8081/healthz; echo
cd $T && SCRATCH=$S NURSING_API=http://localhost:8081 NURSING_DB=aurora_base_probe python3 - <<'EOF'
import json, os, secrets, sys
sys.path.insert(0, os.path.abspath('../../session1/tools'))
from common import *
admin_pw = open(os.path.join(SCRATCH, 'admin-base.pw')).read().strip()
def first_login(user, initial, final):
    st, b = call('POST', '/api/auth/login', body={'username': user, 'password': initial}); assert st == 200, (st, b)
    st, b = call('POST', '/api/auth/change-password', body={'token': b['changeToken'], 'newPassword': final}); assert st == 200, (st, b)
    return b['token']
ADMIN = first_login('admin', admin_pw, 'Synthetic-' + secrets.token_hex(8))
creds = {}
for u, name, role in [('omar.base', 'Dr. Omar Base', 'Consultant'), ('sami.base', 'Sami Base PT', 'Physiotherapist'), ('dana.base', 'Dana Base', 'Receptionist')]:
    i, f = 'Initial-' + secrets.token_hex(8), 'Synthetic-' + secrets.token_hex(8)
    st, b = call('POST', '/api/icu/users', ADMIN, {'username': u, 'name': name, 'roles': [role], 'initialPassword': i, 'justification': 'synthetic local attribution probe'})
    assert st in (200, 201), (st, b); first_login(u, i, f); creds[u] = {'username': u, 'role': role, 'password': f}
DOC = call('POST', '/api/auth/login', body={'username': 'omar.base', 'password': creds['omar.base']['password']})[1]['token']
bed = [x['bedId'] for x in call('GET', '/api/icu/adt/beds', DOC)[1] if not x.get('patientId') and x.get('active', True)][0]
st, adm = call('POST', '/api/icu/adt/admissions', DOC, {'nameFirst': 'Synthetic', 'nameSecond': 'Base', 'nameFamily': 'Probe', 'age': 50, 'sex': 'M',
    'allergies': 'None known', 'bedId': bed, 'diagnosis': 'synthetic attribution probe', 'attending': 'Dr. Omar Base'}); assert st in (200, 201), (st, adm)
json.dump({'pid': adm['patient']['patientId'], 'accounts': creds}, open(os.path.join(SCRATCH, 'base-probe-state.json'), 'w'))
print('base probe setup done:', adm['patient']['patientId'])
EOF
cd $T && SCRATCH=$S node --input-type=module - <<'EOF'
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs'
import fs from 'node:fs'
const st = JSON.parse(fs.readFileSync(process.env.SCRATCH + '/base-probe-state.json', 'utf8'))
const B = 'http://localhost:8081'
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
for (const u of ['sami.base', 'dana.base']) {
  const a = st.accounts[u], ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), p = await ctx.newPage(), f = []
  p.on('response', r => { if (r.status() === 403) f.push(`${r.request().method()} ${new URL(r.url()).pathname}${new URL(r.url()).search}`) })
  await p.goto(B + '/login'); await p.fill('#lguser', a.username); await p.fill('#lgpass', a.password); await p.click('button.lgsubmit')
  await p.waitForURL(x => !x.pathname.startsWith('/login'))
  await p.goto(`${B}/patients/${st.pid}`); await p.waitForTimeout(5000)
  const ov = (await p.locator('.envrefusal h1').allTextContents()).join(' | ')
  console.log(`  BASE ${a.role}: 403 responses on the chart: ${f.join(', ') || 'none'}; overlay: "${ov}"`)
  await ctx.close()
}
await browser.close()
EOF
kill $(cat $S/base-probe.pid) && echo "probe server (8081) stopped"
