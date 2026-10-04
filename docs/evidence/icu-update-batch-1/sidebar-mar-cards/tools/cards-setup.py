# SYNTHETIC SETUP for the daily MAR card browser check — the live server +
# local PostgreSQL 16, one new synthetic patient, orders created, signed,
# documented and discontinued ONLY through the real endpoints. The DB is
# touched directly for two stated synthetic setups, as in the earlier
# checks: (1) backdating an order's "signed" event (therapy start) so its
# first round falls before/after hospital midnight; (2) appending two
# UNDATED legacy facts ("08:00", "D-1 20:00") to a discontinued order.
# Times are planned on the HOSPITAL clock (Asia/Baghdad, UTC+3 — the
# server's zone); every stamp sent and stored is UTC. Writes setup JSON
# for cards-browser.cjs. Helpers: api-check-rolling.py's, reused.
import json, subprocess, sys, time, urllib.request, urllib.error
from datetime import datetime, timedelta, timezone
API = 'http://localhost:8080'
PG = ['psql', '-h', 'localhost', '-U', 'aurora', '-d', 'aurora_rolling', '-Atq', '-v', 'ON_ERROR_STOP=1']
ENV = {'PGPASSWORD': __import__('os').environ['AURORA_LOCAL_DB_PASSWORD'], 'PATH': '/usr/bin:/bin'}
fails = 0; passes = 0
def check(cond, msg):
    global fails, passes
    print(('  PASS ' if cond else '  FAIL ') + msg)
    if cond: passes += 1
    else: fails += 1
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
P = lambda s: datetime.strptime(s, '%Y-%m-%d %H:%M')
RID = lambda due, n: f"{due.strftime('%Y-%m-%dT%H:%M')}~r{n}"

DOC, NUR, PHA = login('sara.rahman'), login('maya.chen'), login('samir.qassem')
run = datetime.now(timezone.utc).strftime('%H%M%S')
now = datetime.now(timezone.utc).replace(second=0, microsecond=0, tzinfo=None)
if datetime.now(timezone.utc).second > 50: time.sleep(12); now = datetime.now(timezone.utc).replace(second=0, microsecond=0, tzinfo=None)
H0 = now.replace(minute=0)   # therapy-start backdating needs whole hours: round 1 = the next full hour after signing
print(f'clock (server wire, UTC): now={S(now)}  run={run}')
for k in 'ABCDEFP':
    st, _ = call('POST', '/api/icu/formulary', PHA, {'drugId': f'rol-{k.lower()}-{run}', 'name': f'Cards {k} {run}', 'brandNames': [], 'drugClass': f'RolClass{k}{run}',
        'form': 'vial', 'strengths': ['1 mg'], 'doses': ['1 mg'], 'defaultDose': '1 mg', 'routes': ['IV'], 'frequencies': ['q1h', 'q4h', 'q6h', 'daily', 'once', 'continuous'],
        'prnCapable': k == 'P', 'allergyBlock': [], 'allergyWarn': []})
    assert st in (200, 201), (k, st)
free = [b['bedId'] for b in call('GET', '/api/icu/adt/beds', DOC)[1] if not b.get('patientId')][0]
st, adm = call('POST', '/api/icu/adt/admissions', DOC, {'nameFirst': 'Synthetic', 'nameSecond': 'Rolling', 'nameFamily': f'Cards{run}', 'age': 61, 'sex': 'M',
    'allergies': 'None known', 'bedId': free, 'diagnosis': 'synthetic daily-MAR-card check', 'attending': 'Dr. Sara Rahman'})
PID, EID = adm['patient']['patientId'], adm['encounter']['encounterId']
print(f'admitted synthetic {PID} ({EID}) at {free}')

def order(k, freq, first=None, prn=False):
    """create + sign via the REAL endpoint; when `first` is given, backdate ONLY the signed event (DB setup 1) so round 1 is due at `first`"""
    med = {'drugId': f'rol-{k.lower()}-{run}', 'drug': f'Cards {k} {run}', 'dose': '1 mg', 'route': 'IV', 'frequency': freq, 'duration': 'ongoing', 'prn': prn}
    if prn: med['prnIndication'] = 'pain'
    st, o = call('POST', '/api/icu/orders', DOC, {'drafts': [{'patientId': PID, 'category': 'Medication', 'priority': 'Routine', 'medication': med}], 'sign': True})
    assert st == 200, (st, o)
    oid = o[0]['orderId']
    if first is not None:
        h = json.loads(sql(f"""select "HistoryJson" from "Orders" where "OrderId"='{oid}'"""))
        for e in h:
            if e['action'] == 'signed': e['time'] = S(first - timedelta(minutes=30))
        sql(f"""update "Orders" set "HistoryJson"=$h${json.dumps(h, separators=(',', ':'), ensure_ascii=False)}$h$ where "OrderId"='{oid}'""")
    return oid
def mar(oid): return [r for r in call('GET', '/api/icu/mar', NUR)[1] if r['orderId'] == oid]
def pending(oid): return [r for r in mar(oid) if r['status'] == 'scheduled']
def current(oid):
    p = pending(oid); return p[0] if len(p) == 1 else None
def doc(oid, aid, action='given', reason=None, at=None, tok=None):
    body = {'action': action}
    if reason: body['reason'] = reason
    if at: body['administeredAt'] = S(at)
    return call('POST', f'/api/icu/mar/{oid}/administrations/{aid}', tok or NUR, body)
def facts(oid): return json.loads(sql(f"""select coalesce("AdministrationsJson",'[]') from "Orders" where "OrderId"='{oid}'"""))
def hist(oid): return json.loads(sql(f"""select "HistoryJson" from "Orders" where "OrderId"='{oid}'"""))

import os
OUT = os.environ.get('CARDS_SETUP_OUT', '/tmp/cards-setup.json')
HOSP = timedelta(hours=3)
local_now = now + HOSP
M = local_now.replace(hour=0, minute=0) - HOSP          # hospital midnight today, as UTC
assert now - M >= timedelta(minutes=45), 'run at least 45 min after hospital midnight'
L = lambda t: S(t + HOSP)                               # a UTC instant on the hospital clock
print(f'hospital now {L(now)} · hospital midnight = {S(M)} UTC (UTC date {S(M)[:10]}, hospital date {L(M)[:10]})')
plan = {'pid': PID, 'eid': EID, 'nowUtc': S(now), 'midnightUtc': S(M), 'today': L(now)[:10], 'yesterday': L(M - timedelta(hours=1))[:10], 'tomorrow': L(M + timedelta(hours=25))[:10], 'orders': {}}
def ok(st, b, what):
    assert st == 200, (what, st, b)
def drafted(k, freq, first=None, prn=False, justification=None):
    if justification is None: return order(k, freq, first, prn)
    med = {'drugId': f'rol-{k.lower()}-{run}', 'drug': f'Cards {k} {run}', 'dose': '1 mg', 'route': 'IV', 'frequency': freq, 'duration': 'ongoing', 'prn': prn}
    st, o = call('POST', '/api/icu/orders', DOC, {'drafts': [{'patientId': PID, 'category': 'Medication', 'priority': 'Routine', 'medication': med}], 'sign': True, 'overrideJustification': justification})
    assert st == 200, (st, o)
    oid = o[0]['orderId']
    if first is not None:
        h = json.loads(sql(f"""select "HistoryJson" from "Orders" where "OrderId"='{oid}'"""))
        for e in h:
            if e['action'] == 'signed': e['time'] = S(first - timedelta(minutes=30))
        sql(f"""update "Orders" set "HistoryJson"=$h${json.dumps(h, separators=(',', ':'), ensure_ascii=False)}$h$ where "OrderId"='{oid}'""")
    return oid

# A — q1h, several rounds on ONE hospital day whose UTC date is the previous day
A = order('A', 'q1h', M + timedelta(hours=1))
ok(*doc(A, RID(M + timedelta(hours=1), 1), at=M + timedelta(hours=1, minutes=5)), 'A r1')
c = current(A); ok(*doc(A, c['adminId'], action='held', reason='synthetic: MAP above target'), 'A r2 held')
plan['orders']['A'] = {'oid': A, 'what': 'q1h: round 1 given, round 2 held, round 3 current — one card today'}
# A2 — the SAME medication (same drugId/name) as a second prescription, q4h (duplicate therapy acknowledged)
A2 = drafted('A', 'q4h', M + timedelta(hours=1), justification='synthetic: second prescription of the same drug for the grouping check')
ok(*doc(A2, RID(M + timedelta(hours=1), 1), at=M + timedelta(hours=1, minutes=10)), 'A2 r1')
plan['orders']['A2'] = {'oid': A2, 'what': 'same medication name, separate prescription'}
# B — yesterday's OUTSTANDING round (q4h, round 1 due 21:00 hospital yesterday, never documented)
B = order('B', 'q4h', M - timedelta(hours=3))
plan['orders']['B'] = {'oid': B, 'what': 'round 1 due yesterday 21:00 hospital, outstanding', 'roundId': RID(M - timedelta(hours=3), 1)}
# C — daily: round 1 due hospital midnight, given now -> round 2 due TOMORROW
C = order('C', 'daily', M)
ok(*doc(C, RID(M, 1), reason='synthetic: first dose delayed (setup)'), 'C r1')
plan['orders']['C'] = {'oid': C, 'what': 'daily: given today -> current round tomorrow'}
# D — q6h: round 1 due 23:00 hospital YESTERDAY, given at 00:20 hospital TODAY (late, reason)
D = order('D', 'q6h', M - timedelta(hours=1))
ok(*doc(D, RID(M - timedelta(hours=1), 1), reason='synthetic: patient in CT at the scheduled time', at=M + timedelta(minutes=20)), 'D r1')
plan['orders']['D'] = {'oid': D, 'what': 'scheduled 23:00 yesterday, given 00:20 today -> yesterday card shows the actual date'}
# P — PRN: a dose yesterday 22:00 hospital (actual time entered), a dose now; availability today
P = order('P', 'q4h', prn=True)
ok(*doc(P, 'prn', at=M - timedelta(hours=2)), 'P yesterday')
ok(*doc(P, 'prn'), 'P today')
plan['orders']['P'] = {'oid': P, 'what': 'PRN: yesterday dose, today dose, today availability'}
# E — continuous / on-demand: a dose yesterday 21:30 hospital; availability today
E = order('E', 'continuous')
ok(*doc(E, 'ondemand', at=M - timedelta(hours=2, minutes=30)), 'E yesterday')
plan['orders']['E'] = {'oid': E, 'what': 'on-demand (continuous): yesterday dose, today availability'}
# F — discontinued order whose only history is UNDATED legacy facts
F = order('F', 'q8h')
st, b = call('POST', f'/api/icu/orders/{F}/discontinue', DOC, {'reason': 'synthetic: course complete'})
ok(st, b, 'F discontinue')
legacy = [{'adminId': f'ADM-LEG{run}1', 'scheduledTime': '08:00', 'status': 'given', 'documentedTime': '08:05', 'documentedBy': 'RN Legacy Synthetic'},
          {'adminId': f'ADM-LEG{run}2', 'scheduledTime': 'D-1 20:00', 'status': 'refused', 'documentedTime': 'D-1 20:10', 'documentedBy': 'RN Legacy Synthetic', 'reason': 'synthetic: declined (legacy record)'}]
sql(f"""update "Orders" set "AdministrationsJson"=$j${json.dumps(legacy, separators=(',', ':'))}$j$ where "OrderId"='{F}'""")
plan['orders']['F'] = {'oid': F, 'what': 'discontinued; undated legacy history only'}
rows = [r for r in call('GET', '/api/icu/mar', NUR)[1] if r['patientId'] == PID]
plan['marRows'] = rows
json.dump(plan, open(OUT, 'w'), indent=1)
print(f'synthetic patient {PID} ({EID}); {len(rows)} MAR rows:')
for r in rows: print(f"  {r['orderId']} {r['adminId']:<22} sched={r['scheduledTime'] or '—':<17} {r['status']:<9} doc={r.get('documentedTime') or '—'} round={r.get('round')}")
