# REAL-API check of ONE ACTION PER ROUND (owner's correction, 2026-10-05 —
# MAR design ### E): a scheduled dose (a repeating order's current round, a
# 'once' dose) can be documented — Given, Held or Refused — from its exact
# scheduled time, never before; the refusal is a 409 decided inside the
# order lock against the freshly derived round and the server clock, and it
# writes NOTHING (the order row's AdministrationsJson and HistoryJson are
# compared byte-for-byte before/after every refusal). The live server (this
# branch) + local PostgreSQL 16, synthetic patient and drugs only. Helpers
# are api-check-timerfix.py's. The DB is touched directly for ONE stated
# synthetic setup: backdating an order's "signed" event so round 1 is due 4 h
# ago; everything else goes through the API.
import json, os, subprocess, sys, threading, time, urllib.request, urllib.error
from datetime import datetime, timedelta, timezone
API = os.environ.get('ONEACTION_API', 'http://localhost:8080')
PG = ['psql', '-h', 'localhost', '-U', 'aurora', '-d', os.environ.get('ONEACTION_DB', 'aurora_oneaction'), '-Atq', '-v', 'ON_ERROR_STOP=1']
ENV = {'PGPASSWORD': os.environ['AURORA_LOCAL_DB_PASSWORD'], 'PATH': '/usr/bin:/bin'}
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
utcnow = lambda: datetime.now(timezone.utc).replace(tzinfo=None)
def wait_until(t):
    while utcnow() < t: time.sleep(0.1)

DOC, NUR, PHA = login('sara.rahman'), login('maya.chen'), login('samir.qassem')
NUR2 = login('omar.khalil') if call('POST', '/api/auth/login', body={'username': 'omar.khalil', 'password': 'Aurora2026!'})[0] == 200 else NUR
run = utcnow().strftime('%H%M%S')
if utcnow().second > 45: time.sleep(16)
now = utcnow().replace(second=0, microsecond=0)
H0 = now.replace(minute=0)
print(f'clock (server wire, UTC): now={S(now)}  run={run}  (the server runs TZ=Asia/Baghdad; hospital time = UTC+3)')
free = [b['bedId'] for b in call('GET', '/api/icu/adt/beds', DOC)[1] if not b.get('patientId')][0]
st, adm = call('POST', '/api/icu/adt/admissions', DOC, {'nameFirst': 'Synthetic', 'nameSecond': 'Oneaction', 'nameFamily': f'Round{run}', 'age': 58, 'sex': 'F',
    'allergies': 'None known', 'bedId': free, 'diagnosis': 'synthetic one-action-per-round check', 'attending': 'Dr. Sara Rahman'})
PID, EID = adm['patient']['patientId'], adm['encounter']['encounterId']
print(f'admitted synthetic {PID} ({EID}) at {free}')

seq = iter(range(1, 100))
def order(k, freq, first=None, prn=False):
    """create + sign via the REAL endpoint; with `first`, backdate ONLY the signed event (the one DB setup) so round 1 is due at `first`"""
    n = next(seq)   # each order gets its OWN synthetic drug + class (the duplicate-therapy check is real)
    st, _ = call('POST', '/api/icu/formulary', PHA, {'drugId': f'one-{k.lower()}{n}-{run}', 'name': f'Oneaction {k}{n} {run}', 'brandNames': [], 'drugClass': f'OneClass{k}{n}{run}',
        'form': 'vial', 'strengths': ['1 mg'], 'doses': ['1 mg'], 'defaultDose': '1 mg', 'routes': ['IV'], 'frequencies': [freq],
        'prnCapable': prn, 'allergyBlock': [], 'allergyWarn': []})
    assert st in (200, 201), (k, st)
    med = {'drugId': f'one-{k.lower()}{n}-{run}', 'drug': f'Oneaction {k}{n} {run}', 'dose': '1 mg', 'route': 'IV', 'frequency': freq, 'duration': 'ongoing', 'prn': prn}
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
def current(oid):
    p = [r for r in mar(oid) if r['status'] == 'scheduled']; return p[0] if len(p) == 1 else None
def doc(oid, aid, action='given', reason=None, at=None, tok=None):
    body = {'action': action}
    if reason: body['reason'] = reason
    if at: body['administeredAt'] = S(at)
    return call('POST', f'/api/icu/mar/{oid}/administrations/{aid}', tok or NUR, body)
def raw(oid):
    """the stored record, byte-for-byte: facts + audit history"""
    return sql(f"""select coalesce("AdministrationsJson",'') || E'\\n' || "HistoryJson" from "Orders" where "OrderId"='{oid}'""")
def facts(oid): return json.loads(sql(f"""select coalesce("AdministrationsJson",'[]') from "Orders" where "OrderId"='{oid}'"""))
def hist(oid): return json.loads(sql(f"""select "HistoryJson" from "Orders" where "OrderId"='{oid}'"""))
def refused_early(oid, aid, due, label, attempts=None):
    """every attempt -> 409 'not due until <due>' and the stored record unchanged"""
    before, mar_before = raw(oid), current(oid)
    attempts = attempts or [('given', None, None), ('held', 'synthetic: hold probe', None), ('refused', 'synthetic: refuse probe', None)]
    codes = []
    for action, reason, at in attempts:
        st, b = doc(oid, aid, action, reason, at)
        codes.append((action, st, (b or {}).get('error', '')))
    ok = all(st == 409 and f'is not due until {S(due)}' in e and 'one action per dose round' in e for _, st, e in codes)
    check(ok, f'{label}: {", ".join(f"{a}->{st}" for a, st, _ in codes)} (error: "{codes[0][2][:110]}")')
    check(raw(oid) == before, f'{label}: stored facts + audit history byte-identical after the refusals')
    check(current(oid) == mar_before, f'{label}: GET /api/icu/mar still serves the same current round {mar_before["adminId"]}')
def burst(oid, reqs):
    """fire requests at once (threads released together) -> [(action, status, error)]"""
    out = [None] * len(reqs); gate = threading.Barrier(len(reqs))
    def go(i, r):
        gate.wait(); st, b = doc(oid, *r); out[i] = (r[1], st, (b or {}).get('error', ''))
    ts = [threading.Thread(target=go, args=(i, r)) for i, r in enumerate(reqs)]
    for t in ts: t.start()
    for t in ts: t.join()
    return out

M = lambda k: timedelta(minutes=k)
F = H0 - timedelta(hours=4)   # round 1 due 4 h ago (an hour-aligned first dose)
REASON = 'synthetic: first dose delayed (setup)'

print('\n[1] the owner\'s example, on the server clock: Given now -> the next round opens an interval later; every action before it is refused')
q1 = order('Q', 'q1h', F)
st, _ = doc(q1, RID(F, 1), reason=REASON)
N1 = P(facts(q1)[-1]['documentedTime'])   # the server's documenting minute
c = current(q1)
check(st == 200 and c['round'] == 2 and c['scheduledTime'] == S(N1 + M(60)) and c['timerRule'] == 'given' and c['timerFrom'] == S(N1),
      f'q1h round 1 Given at {S(N1)} -> round 2 due {c["scheduledTime"]} = actual + 1 h (rule {c["timerRule"]})')
refused_early(q1, c['adminId'], N1 + M(60), 'round 2 before its time: Given / Held / Refused')
refused_early(q1, c['adminId'], N1 + M(60), 'round 2 before its time: Given with a delay reason + an actual time',
              [('given', 'synthetic: probe', N1)])
h = hist(q1)[-1]
check(f'next round due {S(N1 + M(60))}' in h['detail'], f'the only audit entry is the Given\'s: "{h["detail"][:120]}"')

print('\n[2] direct early API burst: 6 concurrent early requests (mixed actions) -> all 409, nothing written')
before = raw(q1)
res = burst(q1, [(c['adminId'], a, r) for a, r in (('given', None), ('held', 'x'), ('refused', 'x'), ('given', None), ('held', 'x'), ('given', None))])
check(all(st == 409 and 'is not due until' in e for _, st, e in res), f'statuses {[st for _, st, _ in res]}')
check(raw(q1) == before, 'stored facts + audit history byte-identical after the burst')

print('\n[3] the exact boundary on the server clock, then ONE action at due (concurrent mixed requests)')
q2 = order('Q', 'q1h', F)
st, _ = doc(q2, RID(F, 1), reason=REASON, at=utcnow().replace(second=0, microsecond=0) - M(58))
c = current(q2)
D = P(c['scheduledTime'])
check(st == 200 and c['round'] == 2 and D > utcnow(), f'round 2 due {S(D)} (in {int((D - utcnow()).total_seconds())} s) — set by a Given with actual time 58 min ago')
wait_until(D - timedelta(seconds=4))
before = raw(q2)
st, b = doc(q2, c['adminId'])
t_early = utcnow()
check(st == 409 and f'is not due until {S(D)}' in b['error'] and t_early < D, f'{(D - t_early).total_seconds():.1f} s before due: Given -> {st}')
check(raw(q2) == before, 'stored record unchanged by the boundary refusal')
wait_until(D + timedelta(seconds=1))
res = burst(q2, [(c['adminId'], 'given', None), (c['adminId'], 'held', 'synthetic: held at due'), (c['adminId'], 'refused', 'synthetic: refused at due'),
                 (c['adminId'], 'given', None), (c['adminId'], 'given', None)])
wins = [r for r in res if r[1] == 200]
check(len(wins) == 1 and all(st == 409 and 'already documented' in e for _, st, e in res if st != 200),
      f'at due + 1 s, 5 concurrent mixed requests -> exactly one 200 ({wins[0][0] if wins else "none"}); the rest 409 already-documented: {[st for _, st, _ in res]}')
f2 = [a for a in facts(q2) if a.get('round') == 2]
check(len(f2) == 1 and len(facts(q2)) == 2 and len(hist(q2)) == len(json.loads(before.split('\n', 1)[1])) + 1,
      f'exactly one round-2 fact ({f2[0]["status"] if f2 else "-"}) and exactly one new audit entry')
c3 = current(q2)
check(c3['round'] == 3 and P(c3['scheduledTime']) > utcnow(), f'round 3 due {c3["scheduledTime"]} — documenting round 2 did not open another round')
refused_early(q2, c3['adminId'], P(c3['scheduledTime']), 'round 3 straight after: Given / Held / Refused')

print('\n[4] stale page: a view loaded before another station documented the round')
q3 = order('Q', 'q4h', F)
stale = current(q3)
st, _ = doc(q3, stale['adminId'], reason=REASON, tok=NUR2)   # the other station
before = raw(q3)
st, b = doc(q3, stale['adminId'], 'held', 'synthetic: stale page')
check(st == 409 and 'already documented as given' in b['error'], f'the stale page\'s Held on the resolved round -> {st} ("{b["error"][:90]}")')
c = current(q3)
st, b = doc(q3, c['adminId'])
check(st == 409 and 'is not due until' in b['error'], f'the refreshed page\'s next round (due {c["scheduledTime"]}) -> {st} not due yet')
check(raw(q3) == before, 'stored record unchanged by both refusals')

print('\n[5] an already-due next round stays eligible (no cooldown); a round that ends in the future locks')
q4 = order('Q', 'q1h', F)
st, _ = doc(q4, RID(F, 1), reason=REASON, at=utcnow().replace(second=0, microsecond=0) - timedelta(hours=3))
c = current(q4)
check(st == 200 and P(c['scheduledTime']) < utcnow(), f'round 2 due {c["scheduledTime"]} (2 h ago) — open')
st, _ = doc(q4, c['adminId'], 'held', 'synthetic: held (already due)')
c = current(q4)
check(st == 200 and c['round'] == 3 and P(c['scheduledTime']) < utcnow() and c['timerRule'] == 'skipped',
      f'round 2 Held -> round 3 due {c["scheduledTime"]} = skipped due + 1 h, already past -> open')
st, _ = doc(q4, c['adminId'], 'refused', 'synthetic: refused (already due)')
c = current(q4)
check(st == 200 and c['round'] == 4, f'round 3 Refused -> round 4 due {c["scheduledTime"]}')
if P(c['scheduledTime']) <= utcnow():
    st, _ = doc(q4, c['adminId'])
    c = current(q4)
    check(st == 200 and c['round'] == 5, f'round 4 (due {facts(q4)[-1]["scheduledTime"]}, past) Given now -> round 5 due {c["scheduledTime"]}')
refused_early(q4, c['adminId'], P(c['scheduledTime']), f'round {c["round"]} (due {c["scheduledTime"]}, future)')

print('\n[6] once orders')
o1 = order('O', 'once')
c = current(o1)
due = P(c['scheduledTime'])
refused_early(o1, c['adminId'], due, f'a new once order\'s dose (due {S(due)}, the next full hour)')
o2 = order('O', 'once', F)
c = current(o2)
before_n = len(hist(o2))
st, _ = doc(o2, c['adminId'], reason=REASON)
check(st == 200 and current(o2) is None, f'a due once dose ({c["scheduledTime"]}) Given -> 200, nothing further is expected')
st, b = doc(o2, c['adminId'], 'held', 'x')
check(st == 409 and 'already documented' in b['error'], f'the once dose again -> {st}')

print('\n[7] PRN and continuous (on demand): NOT gated — no prescription field defines a next documentation round (recorded, unresolved)')
cc = order('C', 'continuous')
c = current(cc)
check(c['adminId'] == 'ondemand' and 'no derivable dose schedule' in c.get('scheduleNote', ''), f'continuous order -> {c["adminId"]} row: "{c.get("scheduleNote")}"')
codes = [doc(cc, 'ondemand')[0] for _ in range(3)]
same_minute = len({a['documentedTime'] for a in facts(cc)}) == 1
check(codes == [200, 200, 200] and len(facts(cc)) == 3,
      f'three sequential Given on the continuous order -> {codes}; {len(facts(cc))} facts{" in the same minute" if same_minute else ""} (the screenshot\'s pattern: the SERVER has no rule for it — the client\'s submission guard stops double clicks, nothing stops deliberate repeats)')
pp = order('P', 'q6h', prn=True)
c = current(pp)
codes = [doc(pp, 'prn')[0] for _ in range(2)]
check(c['adminId'] == 'prn' and codes == [200, 200], f'PRN order (stored frequency q6h, not shown or used) -> two Given {codes} (unresolved: whether q6h on a PRN order is a minimum interval)')

print('\n[8] audit discipline: every 409 above wrote nothing; the successful documentations wrote one fact + one audit entry each')
for oid, n_f in ((q1, 1), (q2, 2), (q3, 1), (o2, 1)):
    check(len(facts(oid)) == n_f, f'{oid}: {len(facts(oid))} stored facts (expected {n_f})')

st, _ = call('POST', f'/api/icu/adt/encounters/{EID}/discharge', DOC)
print(f'\ncleanup: discharged {EID} -> {st}')
print(f'\nRESULT {passes} passed, {fails} failed')
sys.exit(1 if fails else 0)
