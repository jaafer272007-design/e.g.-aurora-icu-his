# Synthetic setup for the SAFE RETRY + FIRST DOSE browser check (saferetry-browser.cjs).
# One synthetic patient on the local stack, eight orders, each with its own synthetic
# formulary drug except the continuous insulin (the formulary's insulin-actrapid,
# 2.5 U/h IV infusion — the owner's screenshot):
#   PRNDELAY / PRNOOO / PRNLOST / PRNSKEW   PRN orders — the delayed-commit, out-of-order, lost-original
#             and device-clock-ahead cases
#   CONT      continuous insulin — the ON DEMAND row (no round)
#   FIRST     q1h signed NOW — round 1 is the first dose (open on signing under ### F)
#   ONCE      'once' signed NOW — the single dose, also the first
#   LOCK2     q1h whose round 1 is documented (setup, backdated like one-action-per-round's
#             oneaction-setup.py) so round 2 is due in ~30 min — a SUBSEQUENT round, locked
#   LEGACY    q1h carrying one injected LEGACY fact (no round — written before the rolling
#             timer) so round 1 is its LegacyEntry slot, in the future — not a first dose, locked
# The only direct DB writes: LOCK2's backdated signing event and LEGACY's legacy fact.
# Sends no attemptId (works against the build before this change too).
# Usage: python3 saferetry-setup.py <out.json>
import json, os, subprocess, sys, time, urllib.request, urllib.error
from datetime import datetime, timedelta, timezone
API = 'http://localhost:8080'
PG = ['psql', '-h', 'localhost', '-U', 'aurora', '-d', os.environ.get('SAFERETRY_DB', 'aurora_saferetry'), '-Atq', '-v', 'ON_ERROR_STOP=1']
ENV = {'PGPASSWORD': os.environ['AURORA_LOCAL_DB_PASSWORD'], 'PATH': '/usr/bin:/bin'}
def call(method, path, tok=None, body=None):
    req = urllib.request.Request(API + path, method=method, data=None if body is None else json.dumps(body).encode(),
                                 headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + tok} if tok else {})})
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read() or 'null')
    except urllib.error.HTTPError as e:
        raw = e.read(); return e.code, (json.loads(raw) if raw else None)
def login(u): return call('POST', '/api/auth/login', body={'username': u, 'password': 'Aurora2026!'})[1]['token']
def sql(q): return subprocess.run(PG + ['-c', q], env=ENV, capture_output=True, text=True, check=True).stdout.strip()
S = lambda t: t.strftime('%Y-%m-%d %H:%M')
utcnow = lambda: datetime.now(timezone.utc).replace(tzinfo=None)
DOC, NUR, PHA = login('sara.rahman'), login('maya.chen'), login('samir.qassem')
# FIRST / ONCE are due at the next full hour: keep >= 5 min between now and it
while utcnow().minute >= 55 or utcnow().second > 40: time.sleep(20)
now = utcnow().replace(second=0, microsecond=0)
F = now.replace(minute=0) - timedelta(hours=4)
run = utcnow().strftime('%H%M%S')
free = [b['bedId'] for b in call('GET', '/api/icu/adt/beds', DOC)[1] if not b.get('patientId')][0]
st, adm = call('POST', '/api/icu/adt/admissions', DOC, {'nameFirst': 'Synthetic', 'nameSecond': 'Saferetry', 'nameFamily': f'Browser{run}', 'age': 58, 'sex': 'F',
    'allergies': 'None known', 'bedId': free, 'diagnosis': 'synthetic safe-retry browser check', 'attending': 'Dr. Sara Rahman'})
assert st == 200, (st, adm)
PID, EID = adm['patient']['patientId'], adm['encounter']['encounterId']
def drug(k, prn):
    d = f'sr-{k.lower()}-{run}'
    st, _ = call('POST', '/api/icu/formulary', PHA, {'drugId': d, 'name': f'Syn {k.title()} {run}', 'brandNames': [], 'drugClass': f'SynSR{k}{run}',
        'form': 'vial', 'strengths': ['1 mg'], 'doses': ['1 mg'], 'defaultDose': '1 mg', 'routes': ['IV'], 'frequencies': ['q1h', 'q6h', 'once'],
        'prnCapable': prn, 'allergyBlock': [], 'allergyWarn': []})
    assert st in (200, 201), (k, st)
    return d
def order(med):
    st, o = call('POST', '/api/icu/orders', DOC, {'drafts': [{'patientId': PID, 'category': 'Medication', 'priority': 'Routine', 'medication': med}], 'sign': True})
    assert st == 200, (st, o)
    return o[0]['orderId']
def med(k, freq, prn=False):
    return {'drugId': drug(k, prn), 'drug': f'Syn {k.title()} {run}', 'dose': '1 mg', 'route': 'IV', 'frequency': freq, 'duration': 'ongoing', 'prn': prn,
            **({'prnIndication': 'synthetic pain score ≥ 4'} if prn else {})}
def history(oid): return json.loads(sql(f"""select "HistoryJson" from "Orders" where "OrderId"='{oid}'"""))
def set_json(oid, col, v): sql(f"""update "Orders" set "{col}"=$h${json.dumps(v, separators=(',', ':'), ensure_ascii=False)}$h$ where "OrderId"='{oid}'""")
def scheduled_row(oid): return [r for r in call('GET', '/api/icu/mar', NUR)[1] if r['orderId'] == oid and r['status'] == 'scheduled'][0]
orders = {}
for k in ('PRNDELAY', 'PRNOOO', 'PRNLOST', 'PRNSKEW'):
    oid = order(med(k, 'q6h', prn=True)); orders[k] = {'oid': oid, 'adminId': 'prn'}
oid = order({'drugId': 'insulin-actrapid', 'drug': 'Insulin (Actrapid)', 'dose': '2.5 U/h', 'route': 'IV infusion', 'frequency': 'continuous', 'duration': 'ongoing', 'prn': False})
orders['CONT'] = {'oid': oid, 'adminId': 'ondemand'}
for k, freq in (('FIRST', 'q1h'), ('ONCE', 'once')):
    oid = order(med(k, freq)); r = scheduled_row(oid)
    orders[k] = {'oid': oid, 'adminId': r['adminId'], 'due': r['scheduledTime'], 'firstDose': r.get('firstDose')}
# LOCK2: signed 4.5 h ago, round 1 Given (late, with its reason) at round2 - 1 h -> round 2 due in 30 min
oid = order(med('LOCK2', 'q1h'))
h = history(oid)
for e in h:
    if e['action'] == 'signed': e['time'] = S(F - timedelta(minutes=30))
set_json(oid, 'HistoryJson', h)
round2 = now + timedelta(minutes=30)
st, b = call('POST', f'/api/icu/mar/{oid}/administrations/{F.strftime("%Y-%m-%dT%H:%M")}~r1', NUR,
             {'action': 'given', 'reason': 'synthetic: first dose delayed (setup)', 'administeredAt': S(round2 - timedelta(hours=1))})
assert st == 200, (st, b)
r = scheduled_row(oid); assert r['scheduledTime'] == S(round2) and r['round'] == 2, r
orders['LOCK2'] = {'oid': oid, 'adminId': r['adminId'], 'due': r['scheduledTime'], 'firstDose': r.get('firstDose')}
# LEGACY: signed 30 min ago; one legacy fact (no round) on its first slot, documented now
oid = order(med('LEGACY', 'q1h'))
h = history(oid)
for e in h:
    if e['action'] == 'signed': e['time'] = S(now - timedelta(minutes=30))
set_json(oid, 'HistoryJson', h)
anchor = now - timedelta(minutes=30)
first = anchor.replace(minute=0) + timedelta(hours=1)
set_json(oid, 'AdministrationsJson', [{'adminId': f'ADM-L{run}', 'scheduledTime': S(first), 'status': 'given', 'documentedTime': S(now), 'documentedBy': 'RN Synthetic Legacy'}])
r = scheduled_row(oid)
orders['LEGACY'] = {'oid': oid, 'adminId': r['adminId'], 'due': r['scheduledTime'], 'firstDose': r.get('firstDose'), 'legacySlot': S(first)}
out = {'pid': PID, 'eid': EID, 'run': run, 'setupAtUtc': S(now), 'orders': orders}
json.dump(out, open(sys.argv[1], 'w'), indent=1)
print(json.dumps(out, indent=1))
