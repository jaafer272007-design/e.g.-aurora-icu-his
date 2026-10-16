# Integration (Session 1 assembly) — setup of the combined PRODUCTION-pairing acceptance on a CLEAN
# disposable database booted by session1/tools/prod-boot.sh (APP_ENV=production, starter formulary,
# bootstrap administrator). Synthetic data, local only. Everything goes through the real API:
#   - the bootstrap admin's forced change, then seven individually created synthetic accounts, each
#     through its own forced first-login change: Consultant, two nurses (Staff + Charge), Clinical
#     Pharmacist, Respiratory Therapist, Physiotherapist, Receptionist — their ROLES ARE THE SHIPPED
#     PROFILES (no permission is granted or changed for the test);
#   - the pharmacist reactivates two starter drugs (the production formulary ships deactivated);
#   - the Consultant admits five synthetic patients and writes their orders:
#       P1 Alpha  : vancomycin q12h (MAR) + nursing: one-time (signed now -> late by check time),
#                   every 1 min, every 30 min, every 60 min x2 (refusal-stamp checks), a PENDING
#                   every 2 h (signed during the check), a legacy-style task (no nursing data);
#                   charted INTERVAL fluids + vitals (the doctor's fluid strip / scores baseline)
#       P2 Bravo  : paracetamol q6h + a one-time nursing order (the patient-switch partner)
#       P3 Charlie: the Orders & Medication entry point (session1 ui-check.mjs; legacy-style task)
#       P4 Delta  : I&O admission A -> B (stale form); P5 Echo: discharge refusal of a nursing Done
# Credentials and ids go to the scratchpad only (int-state.json, prod-state.json) — never committed.
import json, os, secrets, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../session1/tools'))
from common import *

INT = os.path.join(SCRATCH, 'int-state.json')
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
check(sql('''select count(*) from "__EFMigrationsHistory" where "MigrationId" = '20261015232419_AddOrderNursingSchedule' ''') == '1',
      'AddOrderNursingSchedule applied from empty by the assembled server')
check(sql('''select count(*) from "ObservationTypes" where "TypeCode" in ('io_current_intake_ml','io_current_output_ml') and "GroupCode"='nursing' ''') == '2',
      'production reference seed carries both I&O snapshot types')
ADMIN = first_login('admin', admin_pw, 'Synthetic-' + secrets.token_hex(8))
ACCOUNTS = [
    ('omar.synthetic', 'Dr. Omar Synthetic', 'Consultant'),
    ('noor.synthetic', 'RN Noor Synthetic', 'Staff Nurse'),
    ('lina.synthetic', 'RN Lina Synthetic', 'Charge Nurse'),
    ('rami.synthetic', 'Rami Synthetic PharmD', 'Clinical Pharmacist'),
    ('huda.synthetic', 'Huda Synthetic RT', 'Respiratory Therapist'),
    ('sami.synthetic', 'Sami Synthetic PT', 'Physiotherapist'),
    ('dana.synthetic', 'Dana Synthetic', 'Receptionist'),
]
creds = {}
for username, name, role in ACCOUNTS:
    initial, final = 'Initial-' + secrets.token_hex(8), 'Synthetic-' + secrets.token_hex(8)
    st, b = call('POST', '/api/icu/users', ADMIN, {'username': username, 'name': name, 'roles': [role], 'initialPassword': initial,
                                              'justification': 'synthetic local verification account (disposable database)'})
    check(st in (200, 201), f'{role} {username} created individually ({st}: {b if st >= 300 else ""})')
    first_login(username, initial, final)
    creds[username] = {'username': username, 'name': name, 'role': role, 'password': final}
tok = lambda u: call('POST', '/api/auth/login', body={'username': u, 'password': creds[u]['password']})[1]['token']
DOC, PHA = tok('omar.synthetic'), tok('rami.synthetic')

for drug in ('vancomycin', 'paracetamol'):
    st, b = call('POST', f'/api/icu/formulary/{drug}/reactivate', PHA)
    check(st == 200, f'pharmacist reactivates starter drug {drug} ({st}: {b if st >= 300 else ""})')

def admit(family, diagnosis):
    free = [x['bedId'] for x in call('GET', '/api/icu/adt/beds', DOC)[1] if not x.get('patientId') and x.get('active', True)]
    st, adm = call('POST', '/api/icu/adt/admissions', DOC, {'nameFirst': 'Synthetic', 'nameSecond': 'Integration', 'nameFamily': family,
        'age': 57, 'sex': 'F', 'allergies': 'None known', 'bedId': free[0], 'diagnosis': diagnosis, 'attending': 'Dr. Omar Synthetic'})
    check(st in (200, 201), f'admitted {family} ({st}: {adm if st >= 300 else adm["patient"]["patientId"]})')
    return adm['patient']['patientId'], adm['encounter']['encounterId'], adm['patient'].get('bedId') or free[0]
def order(draft, sign=True):
    st, o = call('POST', '/api/icu/orders', DOC, {'drafts': [draft], 'sign': sign})
    assert st == 200, (st, o)
    return o[0]
def nursing(pid, summary, interval=None, sign=True, priority='Routine'):
    return order({'patientId': pid, 'category': 'Nursing', 'summary': summary, 'priority': priority, 'requiresImplementation': True,
                  'nursing': {} if interval is None else {'intervalMinutes': interval}}, sign)
def legacy(pid, summary):
    return order({'patientId': pid, 'category': 'Nursing', 'summary': summary, 'priority': 'Routine', 'requiresImplementation': True})
def med(pid, drug_id, drug, dose, route, freq):
    return order({'patientId': pid, 'category': 'Medication', 'priority': 'Routine', 'medication': {'drugId': drug_id, 'drug': drug,
                  'dose': dose, 'route': route, 'frequency': freq, 'duration': '5 days', 'prn': False}})

P = {}
for key, family, dx in [('p1', 'Alpha', 'synthetic integration: MAR + nursing rounds + I&O'), ('p2', 'Bravo', 'synthetic integration: switch partner'),
                        ('p3', 'Charlie', 'synthetic integration: Orders & Medication entry point'), ('p4', 'Delta', 'synthetic integration: I&O admission A -> B'),
                        ('p5', 'Echo', 'synthetic integration: discharge refusal')]:
    pid, eid, bed = admit(family, dx)
    P[key] = {'pid': pid, 'eid': eid, 'bed': bed, 'name': f'Synthetic Integration {family}'}
p1, p2, p3, p4, p5 = (P[k]['pid'] for k in ('p1', 'p2', 'p3', 'p4', 'p5'))

O = {}
O['vanc'] = med(p1, 'vancomycin', 'Vancomycin', '1 g', 'IV over 60 min', 'q12h')
O['para'] = med(p2, 'paracetamol', 'Paracetamol', '1 g', 'IV', 'q6h')
check(O['vanc']['status'] == 'active' and O['para']['status'] == 'active', f'medication orders signed ({O["vanc"]["orderId"]}, {O["para"]["orderId"]})')
O['n_once'] = nursing(p1, 'Alpha: check pressure areas (one-time)', priority='Urgent')
O['n_1m'] = nursing(p1, 'Alpha: reposition (every 1 min)', 1)
O['n_30m'] = nursing(p1, 'Alpha: suction check (every 30 min)', 30)
O['n_60a'] = nursing(p1, 'Alpha: eye care (every 60 min, 24h stamp)', 60)
O['n_60b'] = nursing(p1, 'Alpha: mouth care (every 60 min, 12h stamp)', 60)
O['n_pend'] = nursing(p1, 'Alpha: limb physio prompt (every 2 h, pending)', 120, sign=False)
O['n_leg'] = legacy(p1, 'Alpha: legacy-style task - change dressing')
O['n_bravo'] = nursing(p2, 'Bravo: check drain site (one-time)')
O['n_charlie_leg'] = legacy(p3, 'Charlie: legacy-style task - check pressure areas')
O['n_echo'] = nursing(p5, 'Echo: wound check (one-time)')
check(O['n_pend']['status'] == 'pending' and 'currentRound' not in O['n_pend']['nursing'], 'pending repeating order has no current round')
check(all('nursing' not in O[k] for k in ('n_leg', 'n_charlie_leg')), 'legacy-style task orders carry no nursing data')
check(all(O[k]['nursing']['currentRound']['number'] == 1 for k in ('n_once', 'n_1m', 'n_30m', 'n_60a', 'n_60b', 'n_bravo', 'n_echo')),
      'every signed nursing order opens round 1 on signing')

# the doctor's baseline: charted INTERVAL fluids and vitals (the fluid strip and the scores read these, never I&O snapshots)
st, b = call('POST', '/api/icu/observations', DOC, {'patientId': p1, 'entries': [
    {'typeCode': 'iv_fluids', 'value': 800}, {'typeCode': 'oral_intake', 'value': 150}, {'typeCode': 'urine_output', 'value': 300},
    {'typeCode': 'hr', 'value': 96}, {'typeCode': 'map', 'value': 71}, {'typeCode': 'spo2', 'value': 95}, {'typeCode': 'rr', 'value': 22},
    {'typeCode': 'temp', 'value': 37.9}, {'typeCode': 'sbp', 'value': 108}]})
check(st == 200, f'doctor charted interval fluids + vitals for P1 ({st}: {b if st >= 300 else len(b)})')

json.dump({'accounts': creds, 'patients': P, 'orders': {k: v['orderId'] for k, v in O.items()},
           'signedAt': {k: v.get('nursing', {}).get('currentRound', {}).get('dueTime') for k, v in O.items()}}, open(INT, 'w'), indent=1)
# session1/tools/ui-check.mjs (the Orders & Medication entry point) runs on P3 with the same accounts
json.dump({'pid': p3, 'eid': P['p3']['eid'], 'legacyPid': p3, 'legacyOrder': O['n_charlie_leg']['orderId'],
           'doctor': {k: creds['omar.synthetic'][k] for k in ('username', 'name', 'password')},
           'nurse': {k: creds['noor.synthetic'][k] for k in ('username', 'name', 'password')}},
          open(os.path.join(SCRATCH, 'prod-state.json'), 'w'), indent=1)
raise SystemExit(summary())
