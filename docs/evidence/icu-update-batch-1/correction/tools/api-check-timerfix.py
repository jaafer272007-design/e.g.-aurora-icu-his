# REAL-API check of the TIMER CORRECTION (MAR design ### C, 2026-09-30):
# after a Held/Refused, a subsequent Given restarts the rolling timer from
# its actual time; a genuinely older backdated Given still never rewinds it.
# The live server (this branch) + local PostgreSQL 16, synthetic patient and
# drugs only. Helpers are api-check-rolling.py's, reused verbatim except that
# the API URL and database are overridable (TIMERFIX_API / TIMERFIX_DB). The DB is
# touched directly for ONE stated synthetic setup: backdating each order's
# "signed" event so round 1 is 4 h overdue (the first administration is
# then documented with an explicit actual time). Every assertion re-reads
# durable state (GET /api/icu/mar, GET /api/icu/orders, or the row itself).
# The client check runs the REAL client modules (Orders next-dose = the
# printed MAR's "next dose due", and the Meds-Due count predicate) over the
# orders and MAR rows this server returned.
import json, subprocess, sys, time, urllib.request, urllib.error
from datetime import datetime, timedelta, timezone
API = __import__('os').environ.get('TIMERFIX_API', 'http://localhost:8080')   # the reviewed-head contrast run uses :8081
PG = ['psql', '-h', 'localhost', '-U', 'aurora', '-d', __import__('os').environ.get('TIMERFIX_DB', 'aurora_rolling'), '-Atq', '-v', 'ON_ERROR_STOP=1']
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
for k in 'ABCDEGJ':
    st, _ = call('POST', '/api/icu/formulary', PHA, {'drugId': f'rol-{k.lower()}-{run}', 'name': f'Timerfix {k} {run}', 'brandNames': [], 'drugClass': f'RolClass{k}{run}',
        'form': 'vial', 'strengths': ['1 mg'], 'doses': ['1 mg'], 'defaultDose': '1 mg', 'routes': ['IV'], 'frequencies': ['q1h', 'q4h', 'q8h', 'once'],
        'prnCapable': k == 'P', 'allergyBlock': [], 'allergyWarn': []})
    assert st in (200, 201), (k, st)
free = [b['bedId'] for b in call('GET', '/api/icu/adt/beds', DOC)[1] if not b.get('patientId')][0]
st, adm = call('POST', '/api/icu/adt/admissions', DOC, {'nameFirst': 'Synthetic', 'nameSecond': 'Rolling', 'nameFamily': f'Timerfix{run}', 'age': 61, 'sex': 'M',
    'allergies': 'None known', 'bedId': free, 'diagnosis': 'synthetic timer-correction check', 'attending': 'Dr. Sara Rahman'})
PID, EID = adm['patient']['patientId'], adm['encounter']['encounterId']
print(f'admitted synthetic {PID} ({EID}) at {free}')

def order(k, freq, first=None, prn=False):
    """create + sign via the REAL endpoint; when `first` is given, backdate ONLY the signed event (DB setup 1) so round 1 is due at `first`"""
    med = {'drugId': f'rol-{k.lower()}-{run}', 'drug': f'Timerfix {k} {run}', 'dose': '1 mg', 'route': 'IV', 'frequency': freq, 'duration': 'ongoing', 'prn': prn}
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
CLIENT_JS = os.environ.get('TIMERFIX_CLIENT_JS', '/tmp/timerfix-client.mjs')   # esbuild bundle of timerfix-client.ts
CLIENT_IN = os.environ.get('TIMERFIX_CLIENT_IN', '/tmp/timerfix-client-in.json')
cases_x = {'A': 55, 'B': 55, 'E': 55, 'C': 120, 'G': 120, 'D': 210, 'J': 210}

M = lambda k: timedelta(minutes=k)
N = now
F = H0 - timedelta(hours=4)   # round 1 due 4 h ago (hour-aligned first dose)
def setup(k, x, skip, skip_reason):
    """round 1 given with actual N-x (documented now, delay reason: 4 h late) -> round 2 due N-x+60; round 2 skipped NOW"""
    oid = order(k, 'q1h', F)
    st, _ = doc(oid, RID(F, 1), reason='synthetic: first dose delayed (setup)', at=N - M(x))
    c = current(oid)
    assert st == 200 and c['scheduledTime'] == S(N - M(x) + M(60)) and c['round'] == 2, (k, st, c)
    st, b = doc(oid, c['adminId'], action=skip, reason=skip_reason)
    assert st == 200, (k, st, b)
    return oid, P(c['scheduledTime'])

print(f'N = {S(N)} (server wire, UTC; the server runs TZ=Asia/Baghdad)')
print('\n[phase 1] round 1 given (actual N-x, documented N); round 2 Held/Refused at N')
cases = {}
for k, x, skip, label in (('A', 55, 'held', 'Held EARLY (the reproduced case)'), ('B', 55, 'refused', 'Refused EARLY (the reproduced case)'),
                          ('E', 55, 'held', 'Held EARLY, then a genuinely older backdated Given'),
                          ('C', 120, 'held', 'Held LATE, then Given ON TIME'), ('G', 120, 'refused', 'Refused LATE, then Given ON TIME'),
                          ('D', 210, 'held', 'Held LATE, then Given LATE'), ('J', 210, 'refused', 'Refused LATE, then Given LATE')):
    oid, due2 = setup(k, x, skip, f'synthetic: {skip} ({label})')
    c = current(oid)
    check(c['round'] == 3 and c['scheduledTime'] == S(due2 + M(60)) and c['timerRule'] == 'skipped' and c['timerFrom'] == S(due2),
          f'{k} {label}: round 2 due {S(due2)} {skip} at {S(N)} -> round 3 due {c["scheduledTime"]} = skipped due + 1 h (rule {c["timerRule"]}, from {c["timerFrom"]})')
    cases[k] = (oid, due2, skip, label)
h = hist(cases['A'][0])[-1]
check("from the skipped dose's scheduled time" in h['detail'] and f'next round due {S(cases["A"][1] + M(60))}' in h['detail'], f'A audit (held): "{h["detail"]}"')

# phase 2 needs a later documenting minute than the Held/Refused (N+2), so the actual time can differ from both
while datetime.now(timezone.utc).replace(tzinfo=None) < N + M(2) + timedelta(seconds=3): time.sleep(1)
N2 = N + M(2)
print(f'\n[phase 2] documenting minute N2 = {S(N2)}')

oid, due2, _, _ = cases['A']
pre = current(oid)
st, b = doc(oid, pre['adminId'], at=N + M(1))
c = current(oid)
check(st == 200 and c['round'] == 4 and c['scheduledTime'] == S(N + M(61)) and c['timerRule'] == 'given' and c['timerFrom'] == S(N + M(1)),
      f'A round 3 (due {pre["scheduledTime"]}) given EARLY, actual {S(N + M(1))} documented {S(N2)} -> round 4 due {c["scheduledTime"]} = ACTUAL + 1 h (the defect kept {pre["scheduledTime"][:11]}{S(due2 + M(60))[11:]}; rule {c["timerRule"]}, from {c["timerFrom"]})')
h = hist(oid)[-1]
check(f'dose given at {S(N + M(1))} (documented {S(N2)})' in h['detail'] and f'next round due {S(N + M(61))} (q1h from the actual administration time)' in h['detail'],
      f'A audit: actual and documenting times separate, next due from the actual time: "{h["detail"]}"')
reads = [current(oid) for _ in range(3)]
check(all(r == reads[0] for r in reads) and reads[0]['adminId'] == RID(N + M(61), 4), f'A repeated refresh x3: identical current round {reads[0]["adminId"]}')
st, b = doc(oid, pre['adminId'])
check(st == 409 and 'already documented as given' in b['error'], f'A stale round-3 identity after the Given -> 409 ({b["error"][:80]})')

oid, due2, _, _ = cases['B']
pre = current(oid)
st, b = doc(oid, pre['adminId'])
c = current(oid)
check(st == 200 and c['round'] == 4 and c['scheduledTime'] == S(N2 + M(60)) and c['timerRule'] == 'given' and c['timerFrom'] == S(N2),
      f'B (refused) round 3 (due {pre["scheduledTime"]}) given EARLY at {S(N2)} -> round 4 due {c["scheduledTime"]} = actual + 1 h (rule {c["timerRule"]})')

oid, due2, _, _ = cases['E']
pre = current(oid)
st, b = doc(oid, pre['adminId'], at=N - M(10))
c = current(oid)
check(st == 200 and c['round'] == 4 and c['scheduledTime'] == pre['scheduledTime'] and c['adminId'] == RID(P(pre['scheduledTime']), 4) and c['adminId'] != pre['adminId']
      and c['timerRule'] == 'skipped' and c['timerFrom'] == S(due2),
      f'E round 3 given BACKDATED to {S(N - M(10))} (older than the Held action {S(N)}): timer NOT rewound, round 4 due {c["scheduledTime"]} (same minute as round 3, distinct identity {c["adminId"]})')
h = hist(oid)[-1]
check(f'timer unchanged — the skipped dose due {S(due2)} already set it' in h['detail'], f'E audit names the timer kept: "{h["detail"][-130:]}"')
st, b = doc(oid, c['adminId'])
c2 = current(oid)
check(st == 200 and c2['round'] == 5 and c2['scheduledTime'] == S(N2 + M(60)) and c2['timerRule'] == 'given', f'E round 4 then given at {S(N2)} (a subsequent Given) -> round 5 due {c2["scheduledTime"]}')

for k in ('C', 'G'):
    oid, due2, skip, label = cases[k]
    pre = current(oid)
    st, b = doc(oid, pre['adminId'], at=P(pre['scheduledTime']))
    c = current(oid)
    check(st == 200 and pre['scheduledTime'] == S(N) and c['scheduledTime'] == S(N + M(60)) and c['timerFrom'] == S(N) and c['timerRule'] == 'given',
          f'{k} ({skip} late) round 3 due {pre["scheduledTime"]} given ON TIME (actual {pre["scheduledTime"][11:]}, documented {S(N2)[11:]}) -> round 4 due {c["scheduledTime"]}')
for k in ('D', 'J'):
    oid, due2, skip, label = cases[k]
    pre = current(oid)
    st, b = doc(oid, pre['adminId'])
    c = current(oid)
    check(st == 200 and pre['scheduledTime'] == S(N - M(90)) and c['scheduledTime'] == S(N2 + M(60)) and c['timerRule'] == 'given',
          f'{k} ({skip} late) round 3 due {pre["scheduledTime"]} given LATE at {S(N2)} (1 h 32 m, under the 2 h reason rule) -> round 4 due {c["scheduledTime"]}')

print('\n[fresh read of the stored facts + history]')
for k, (oid, due2, skip, label) in cases.items():
    fa = facts(oid)
    want_rounds = [1, 2, 3, 4] if k == 'E' else [1, 2, 3]
    want_status = ['given', skip, 'given', 'given'] if k == 'E' else ['given', skip, 'given']
    ok = [a.get('round') for a in fa] == want_rounds and [a['status'] for a in fa] == want_status and fa[1].get('reason', '').startswith('synthetic:') \
         and fa[1]['scheduledTime'] == S(due2) and fa[1]['documentedTime'] == S(N) and fa[0]['documentedTime'] == S(N - M(cases_x[k]))
    check(ok, f'{k} facts: rounds {[a.get("round") for a in fa]} statuses {[a["status"] for a in fa]}; {skip} keeps slot {fa[1]["scheduledTime"]}, documented {fa[1]["documentedTime"]}, reason kept')
    hs = [e for e in hist(oid) if e['action'] in ('administered', 'held', 'refused')]
    check(len(hs) == len(fa) and all(' — round ' in e['detail'] and 'next round due' in e['detail'] for e in hs), f'{k} history: {len(hs)} documentation events, each stating its round and next due')

print('\n[Orders next-dose / printed MAR next-due / Meds-Due count: the real client modules over this server\'s data]')
st, orders = call('GET', f'/api/icu/orders?patientId={PID}', DOC)
mine = [o for o in orders if o['orderId'] in {v[0] for v in cases.values()}]
marrows = [r for r in call('GET', '/api/icu/mar', NUR)[1] if r['orderId'] in {v[0] for v in cases.values()}]
nowms = int(datetime.now(timezone.utc).timestamp() * 1000)
json.dump({'orders': mine, 'mar': marrows, 'nowMs': nowms}, open(CLIENT_IN, 'w'))
res = json.loads(subprocess.run(['node', CLIENT_JS, CLIENT_IN], capture_output=True, text=True, check=True, env={**__import__('os').environ, 'TZ': 'UTC'}).stdout)
for k, (oid, *_ ) in cases.items():
    rows = [r for r in marrows if r['orderId'] == oid and r['status'] == 'scheduled']
    nd = res['next'][oid]
    check(len(rows) == 1 and nd == rows[0]['scheduledTime'], f'{k} Orders next-dose / print "next dose due" {nd} == MAR current round {rows[0]["scheduledTime"] if rows else None}')
    check(res['printRounds'][oid] == [a.get('round') for a in facts(oid)], f'{k} print cells carry the stored rounds {res["printRounds"][oid]}')
exp_due = sum(1 for r in marrows if r['status'] == 'scheduled' and datetime.strptime(r['scheduledTime'], '%Y-%m-%d %H:%M') - datetime.now(timezone.utc).replace(tzinfo=None) <= timedelta(minutes=30))
check(res['dueCount'] == exp_due and len(res['dueRows']) == res['dueCount'], f'Meds-Due count over these orders = {res["dueCount"]} (one row per order at most; rows {res["dueRows"]})')

st, b = call('POST', f'/api/icu/adt/encounters/{EID}/discharge', DOC)
print(f'\ncleanup: synthetic {PID} discharged -> {st}')
print(f'\nRESULT: {passes} passed, {fails} failed')
sys.exit(1 if fails else 0)
