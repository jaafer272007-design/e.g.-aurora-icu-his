# First production boot of a CLEAN disposable database (APP_ENV=production; synthetic data, local
# only): the new migration applied from empty, the production reference seed (incl. the two I&O
# snapshot types), the bootstrap administrator's forced password change, two individually created
# synthetic clinicians (Consultant + Staff Nurse, each through the forced first-login change), and
# one synthetic admission with a LEGACY-style task order (no nursing data — what an order set or an
# older client creates). Credentials are generated into the scratchpad only, never committed.
import json, os, secrets
from common import *
PROD = os.path.join(SCRATCH, 'prod-state.json')
admin_pw = open(os.path.join(SCRATCH, 'admin.pw')).read().strip()
def first_login(user, initial, final):
    st, b = call('POST', '/api/auth/login', body={'username': user, 'password': initial})
    assert st == 200 and b.get('mustChangePassword'), (st, b)
    st, b = call('POST', '/api/auth/change-password', body={'token': b['changeToken'], 'newPassword': final})
    assert st == 200 and b.get('token'), (st, b)
    return b['token']
st, h = call('GET', '/healthz'); check(st == 200 and h['environment'] == 'production', f'server reports environment=production ({h.get("build")})')
check(sql('''select count(*) from "Patients"''') == '0' and sql('''select count(*) from "__EFMigrationsHistory" where "MigrationId" = '20261015232419_AddOrderNursingSchedule' ''') == '1',
      'clean production DB: no patients; AddOrderNursingSchedule applied from empty')
check(sql('''select count(*) from "ObservationTypes" where "TypeCode" in ('io_current_intake_ml','io_current_output_ml') and "GroupCode"='nursing' ''') == '2',
      'production reference seed carries both I&O snapshot types')
ADMIN = first_login('admin', admin_pw, 'Synthetic-' + secrets.token_hex(8))
creds = {}
for username, name, role in [('omar.synthetic', 'Dr. Omar Synthetic', 'Consultant'), ('noor.synthetic', 'RN Noor Synthetic', 'Staff Nurse')]:
    initial, final = 'Initial-' + secrets.token_hex(8), 'Synthetic-' + secrets.token_hex(8)
    st, b = call('POST', '/api/icu/users', ADMIN, {'username': username, 'name': name, 'roles': [role], 'initialPassword': initial,
                                              'justification': 'synthetic local verification account (disposable database)'})
    check(st in (200, 201), f'{role} {username} created individually ({st}: {b if st >= 300 else ""})')
    first_login(username, initial, final)
    creds[username] = {'name': name, 'password': final}
DOC = call('POST', '/api/auth/login', body={'username': 'omar.synthetic', 'password': creds['omar.synthetic']['password']})[1]['token']
free = [x['bedId'] for x in call('GET', '/api/icu/adt/beds', DOC)[1] if not x.get('patientId') and x.get('active', True)]
st, adm = call('POST', '/api/icu/adt/admissions', DOC, {'nameFirst': 'Synthetic', 'nameSecond': 'Browser', 'nameFamily': 'Check', 'age': 61, 'sex': 'M',
    'allergies': 'None known', 'bedId': free[0], 'diagnosis': 'synthetic nursing-order browser check', 'attending': 'Dr. Omar Synthetic'})
check(st in (200, 201), f'synthetic admission ({st})')
pid, eid = adm['patient']['patientId'], adm['encounter']['encounterId']
st, o = call('POST', '/api/icu/orders', DOC, {'drafts': [{'patientId': pid, 'category': 'Nursing', 'summary': 'Legacy-style task: check pressure areas',
    'priority': 'Routine', 'requiresImplementation': True}], 'sign': True})
check(st == 200 and 'nursing' not in o[0], f'legacy-style task order (no nursing data) created ({o[0]["orderId"] if st == 200 else st})')
json.dump({'pid': pid, 'eid': eid, 'legacyPid': pid, 'legacyOrder': o[0]['orderId'],
           'doctor': {'username': 'omar.synthetic', **creds['omar.synthetic']}, 'nurse': {'username': 'noor.synthetic', **creds['noor.synthetic']}},
          open(PROD, 'w'), indent=1)
raise SystemExit(summary())
