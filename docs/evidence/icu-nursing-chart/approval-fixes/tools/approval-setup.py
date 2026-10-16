# Approval fixes (Codex review of 72a7894) — setup of the ONE disposable PRODUCTION pairing for the two
# focused browser legs, on a CLEAN database booted by session1/tools/prod-boot.sh (APP_ENV=production,
# starter formulary, bootstrap administrator). Synthetic data, local only, everything through the real API:
#   - the bootstrap admin's forced change, then four individually created synthetic accounts, each through
#     its own forced first-login change, with the SHIPPED role profiles (nothing granted or changed):
#       omar.approval  Consultant           — writes the orders; the New Nursing Order leg
#       noor.approval  Staff Nurse          — the MAR leg
#       rami.approval  Clinical Pharmacist  — reactivates paracetamol (the production formulary ships deactivated)
#       dana.approval  Receptionist         — DISPOSABLE, no clinical permission: its token is used only to
#                                             obtain the real server's 403 (RBAC, before the order lock) on a retry
#   - two synthetic patients, A (Alpha) and B (Bravo), each with one signed baseline nursing order whose text
#     names its patient (so a list shown under the wrong patient is visible).
# Credentials and ids go to the scratchpad only (approval-state.json) — never committed.
import json, os, secrets, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../session1/tools'))
from common import *

admin_pw = open(os.path.join(SCRATCH, 'admin.pw')).read().strip()
def first_login(user, initial, final):
    st, b = call('POST', '/api/auth/login', body={'username': user, 'password': initial})
    assert st == 200 and b.get('mustChangePassword'), (st, b)
    st, b = call('POST', '/api/auth/change-password', body={'token': b['changeToken'], 'newPassword': final})
    assert st == 200 and b.get('token'), (st, b)
    return b['token']

st, h = call('GET', '/healthz')
check(st == 200 and h['environment'] == 'production', f'server reports environment=production ({h.get("build")})')
check(sql('''select count(*) from "Patients"''') == '0', 'clean production database (no patients)')
ADMIN = first_login('admin', admin_pw, 'Synthetic-' + secrets.token_hex(8))
creds = {}
for username, name, role in [('omar.approval', 'Dr. Omar Approval', 'Consultant'), ('noor.approval', 'RN Noor Approval', 'Staff Nurse'),
                             ('rami.approval', 'Rami Approval PharmD', 'Clinical Pharmacist'), ('dana.approval', 'Dana Approval', 'Receptionist')]:
    initial, final = 'Initial-' + secrets.token_hex(8), 'Synthetic-' + secrets.token_hex(8)
    st, b = call('POST', '/api/icu/users', ADMIN, {'username': username, 'name': name, 'roles': [role], 'initialPassword': initial,
                                              'justification': 'synthetic local verification account (disposable database)'})
    check(st in (200, 201), f'{role} {username} created individually ({st}: {b if st >= 300 else ""})')
    first_login(username, initial, final)
    creds[username] = {'username': username, 'name': name, 'role': role, 'password': final}
tok = lambda u: call('POST', '/api/auth/login', body={'username': u, 'password': creds[u]['password']})[1]['token']
DOC = tok('omar.approval')
st, b = call('POST', '/api/icu/formulary/paracetamol/reactivate', tok('rami.approval'))
check(st == 200, f'pharmacist reactivates starter drug paracetamol ({st})')

P = {}
for key, family in [('a', 'Alpha'), ('b', 'Bravo')]:
    free = [x['bedId'] for x in call('GET', '/api/icu/adt/beds', DOC)[1] if not x.get('patientId') and x.get('active', True)]
    st, adm = call('POST', '/api/icu/adt/admissions', DOC, {'nameFirst': 'Synthetic', 'nameSecond': 'Approval', 'nameFamily': family,
        'age': 61, 'sex': 'M', 'allergies': 'None known', 'bedId': free[0], 'diagnosis': f'synthetic approval-fix check ({family})', 'attending': 'Dr. Omar Approval'})
    check(st in (200, 201), f'admitted {family} ({st}: {adm if st >= 300 else adm["patient"]["patientId"]})')
    pid = adm['patient']['patientId']
    st, o = call('POST', '/api/icu/orders', DOC, {'drafts': [{'patientId': pid, 'category': 'Nursing', 'priority': 'Routine', 'requiresImplementation': True,
        'summary': f'{family} baseline: this order belongs to {family} only', 'nursing': {}}], 'sign': True})
    check(st == 200 and o[0]['patientId'] == pid, f'{family} baseline nursing order ({st})')
    P[key] = {'pid': pid, 'name': f'Synthetic Approval {family}', 'family': family, 'baseline': o[0]['orderId']}

json.dump({'accounts': creds, 'patients': P}, open(os.path.join(SCRATCH, 'approval-state.json'), 'w'), indent=1)
raise SystemExit(summary())
