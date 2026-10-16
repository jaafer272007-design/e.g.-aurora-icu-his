# SYNCHRONIZED OVERLAPPING-REQUEST CHECK — the order write lock on the real
# server + local PostgreSQL 16, synthetic data only.
#
# How the overlap is made deterministic (not a stress loop): a separate
# psql session holds the target order's row lock (BEGIN; SELECT … FOR
# UPDATE). Two requests are then released together by a threading.Barrier;
# the check asserts BOTH are still in flight after 1.5 s (they are parked on
# the database lock, i.e. genuinely overlapping), then commits the psql
# session. What happens next is decided only by the server's own locking:
#   - this branch: each request takes the row lock BEFORE reading, so the
#     second one reads the first one's committed facts and validates
#     against them (409, or a second durable fact where two are valid);
#   - the reviewed head 2d14aa0 (no lock, --expect-old): both requests read
#     the same facts before either writes, both return 200, and the later
#     save overwrites the earlier — the lost-write defect Codex reported.
# Every outcome is checked on the DURABLE state after a fresh read (the row
# itself + GET /api/icu/mar). DB touches: the psql lock session, and
# backdating one order's "signed" event (stated in order()).
import json, subprocess, sys, threading, time, urllib.request, urllib.error
from datetime import datetime, timedelta, timezone
API = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1].startswith('http') else 'http://localhost:8080'
DB = next((a.split('=', 1)[1] for a in sys.argv if a.startswith('--db=')), 'aurora_rolling')
OLD = '--expect-old' in sys.argv
PG = ['psql', '-h', 'localhost', '-U', 'aurora', '-d', DB, '-Atq', '-v', 'ON_ERROR_STOP=1']
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
        with urllib.request.urlopen(req, timeout=60) as r: return r.status, json.loads(r.read() or 'null')
    except urllib.error.HTTPError as e:
        raw = e.read(); return e.code, (json.loads(raw) if raw else None)
def login(u): return call('POST', '/api/auth/login', body={'username': u, 'password': 'Aurora2026!'})[1]['token']
def sql(q): return subprocess.run(PG + ['-c', q], env=ENV, capture_output=True, text=True, check=True).stdout.strip()
S = lambda t: t.strftime('%Y-%m-%d %H:%M')

class RowLock:
    """a separate PostgreSQL session holding FOR UPDATE on the given orders' rows"""
    def __init__(self, *oids):
        self.p = subprocess.Popen(PG, env=ENV, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
        ids = ','.join(f"'{o}'" for o in oids)
        self.p.stdin.write(f'BEGIN;\nSELECT "OrderId" FROM "Orders" WHERE "OrderId" IN ({ids}) FOR UPDATE;\n\\echo LOCKED\n'); self.p.stdin.flush()
        got = []
        while not got or got[-1] != 'LOCKED':
            line = self.p.stdout.readline()
            assert line, got
            got.append(line.strip())
        assert sorted(got[:-1]) == sorted(oids), got
    def release(self):
        self.p.stdin.write('COMMIT;\n\\q\n'); self.p.stdin.flush(); self.p.wait(timeout=10)

def overlap(label, requests, lock_oids, expect_blocked=None, delays=None):
    """fire `requests` (callables) together under a held row lock; return their (status, body) in order"""
    lock = RowLock(*lock_oids)
    barrier = threading.Barrier(len(requests))
    results = [None] * len(requests); done = [None] * len(requests)
    def run(i, f):
        barrier.wait()
        if delays and delays[i]: time.sleep(delays[i])   # queue order on the lock (both still park on it)
        results[i] = f(); done[i] = time.monotonic()
    ts = [threading.Thread(target=run, args=(i, f)) for i, f in enumerate(requests)]
    t0 = time.monotonic()
    for t in ts: t.start()
    time.sleep(1.5)
    in_flight = [d is None for d in done]
    blocked = expect_blocked if expect_blocked is not None else [True] * len(requests)
    check(in_flight == blocked, f'{label}: while the row lock is held, requests in flight = {in_flight} (expected {blocked})')
    lock.release()
    for t in ts: t.join(timeout=30)
    print(f'    responses: ' + ' | '.join(f'{r[0]} {(r[1] or {}).get("error", "")[:80] if isinstance(r[1], dict) else ""}'.strip() for r in results))
    return results

DOC, NUR, NUR2, PHA = login('sara.rahman'), login('maya.chen'), login('priya.patel'), login('samir.qassem')
run = datetime.now(timezone.utc).strftime('%H%M%S')
now = datetime.now(timezone.utc).replace(second=0, microsecond=0, tzinfo=None); H0 = now.replace(minute=0)
MODE = 'reviewed head 2d14aa0, no lock: expect the defect' if OLD else 'this branch: expect atomic writes'
print(f'server {API} · db {DB} · {MODE} · now {S(now)}')
for k in 'QRSTUVWXYZP':
    st, _ = call('POST', '/api/icu/formulary', PHA, {'drugId': f'cc-{k.lower()}-{run}', 'name': f'Concur {k} {run}', 'brandNames': [], 'drugClass': f'CcClass{k}{run}',
        'form': 'vial', 'strengths': ['1 mg'], 'doses': ['1 mg'], 'defaultDose': '1 mg', 'routes': ['IV'], 'frequencies': ['q1h', 'q4h', 'q8h', 'once'],
        'prnCapable': k == 'P', 'allergyBlock': [], 'allergyWarn': []})
    assert st in (200, 201), (k, st)
def admit(tag):
    free = [b['bedId'] for b in call('GET', '/api/icu/adt/beds', DOC)[1] if not b.get('patientId')][0]
    st, adm = call('POST', '/api/icu/adt/admissions', DOC, {'nameFirst': 'Synthetic', 'nameSecond': 'Concurrency', 'nameFamily': f'{tag}{run}', 'age': 58, 'sex': 'F',
        'allergies': 'None known', 'bedId': free, 'diagnosis': 'synthetic concurrency check', 'attending': 'Dr. Sara Rahman'})
    assert st in (200, 201), adm
    return adm['patient']['patientId'], adm['encounter']['encounterId']
PID, EID = admit('Lock')
print(f'admitted synthetic {PID} ({EID})')
def order(k, freq, pid=PID, prn=False, backdate=True):
    med = {'drugId': f'cc-{k.lower()}-{run}', 'drug': f'Concur {k} {run}', 'dose': '1 mg', 'route': 'IV', 'frequency': freq, 'duration': 'ongoing', 'prn': prn}
    if prn: med['prnIndication'] = 'pain'
    st, o = call('POST', '/api/icu/orders', DOC, {'drafts': [{'patientId': pid, 'category': 'Medication', 'priority': 'Routine', 'medication': med}], 'sign': True})
    assert st == 200, (st, o)
    oid = o[0]['orderId']
    if backdate:   # DB setup: backdate the signed event so the first dose is due at H0 (already due)
        h = json.loads(sql(f"""select "HistoryJson" from "Orders" where "OrderId"='{oid}'"""))
        for e in h:
            if e['action'] == 'signed': e['time'] = S(H0 - timedelta(minutes=30))
        sql(f"""update "Orders" set "HistoryJson"=$h${json.dumps(h, separators=(',', ':'), ensure_ascii=False)}$h$ where "OrderId"='{oid}'""")
    return oid
def pending(oid): return [r for r in call('GET', '/api/icu/mar', NUR)[1] if r['orderId'] == oid and r['status'] == 'scheduled']
def facts(oid): return json.loads(sql(f"""select coalesce("AdministrationsJson",'[]') from "Orders" where "OrderId"='{oid}'"""))
def hist(oid): return json.loads(sql(f"""select "HistoryJson" from "Orders" where "OrderId"='{oid}'"""))
def doc(oid, aid, tok, action='given', reason=None):
    body = {'action': action, **({'reason': reason} if reason else {})}
    return lambda: call('POST', f'/api/icu/mar/{oid}/administrations/{aid}', tok, body)
def administered(oid): return [e for e in hist(oid) if e['action'] in ('administered', 'held', 'refused')]
cur = lambda oid: pending(oid)[0]['adminId']

print('\n[1] the SAME current round: two nurses document Given at the same moment')
X = order('Q', 'q1h')
r1 = cur(X)
res = overlap('same round', [doc(X, r1, NUR), doc(X, r1, NUR2)], [X])
codes = sorted(r[0] for r in res); f = facts(X); ad = administered(X)
if OLD:
    check(codes == [200, 200], f'OLD: both nurses were told success: {codes}')
    check(len(f) == 1 and len(ad) == 1, f'OLD: DEFECT reproduced — 2 successes but {len(f)} durable fact and {len(ad)} audit entry (one nurse\'s documentation silently lost)')
else:
    check(codes == [200, 409], f'exactly one success, one 409: {codes}')
    loser = [r for r in res if r[0] == 409][0][1]['error']
    check('already documented as given' in loser, f'the 409 names the winner: {loser[:110]}')
    check(len(f) == 1 and f[0].get('round') == 1 and len(ad) == 1, f'durable: {len(f)} fact (round {f[0].get("round")}) and {len(ad)} audit entry — consistent')
    p = pending(X)
    g = datetime.strptime(f[0]['documentedTime'], '%Y-%m-%d %H:%M')
    check(len(p) == 1 and p[0]['round'] == 2 and p[0]['scheduledTime'] == S(g + timedelta(hours=1)) and p[0]['timerFrom'] == f[0]['documentedTime'],
          f'fresh read: one current round 2 due {p[0]["scheduledTime"]}, timed from the winner\'s actual time {f[0]["documentedTime"]}')

print('\n[2] PRN: two valid distinct facts documented at the same moment — BOTH must stay durable')
Pn = order('P', 'q6h', prn=True, backdate=False)
res = overlap('PRN pair', [doc(Pn, 'prn', NUR), doc(Pn, 'prn', NUR2)], [Pn])
codes = sorted(r[0] for r in res); f = facts(Pn); ad = administered(Pn)
if OLD:
    check(codes == [200, 200] and (len(f) < 2 or len(ad) < 2), f'OLD: DEFECT reproduced — 2 successes, durable facts {len(f)}, audit entries {len(ad)}')
else:
    check(codes == [200, 200] and len(f) == 2 and len(ad) == 2 and {x['documentedBy'] for x in f} == {'RN Maya Chen', 'RN Priya Patel'},
          f'both 200 and both durable: facts {len(f)} by {sorted(x["documentedBy"] for x in f)}, audit entries {len(ad)}')

if OLD:
    print(f'\nRESULT (reviewed head, no lock): {passes} passed, {fails} failed')
    sys.exit(1 if fails else 0)

print('\n[3] a second action made stale by a competing Given that starts a new round (Given vs Held on the same round)')
Y = order('R', 'q1h')
ry = cur(Y)
res = overlap('given vs held', [doc(Y, ry, NUR), doc(Y, ry, NUR2, 'held', 'synthetic: SBP 82')], [Y])
codes = [r[0] for r in res]; f = facts(Y)
check(sorted(codes) == [200, 409] and len(f) == 1, f'one wins, the other 409 (it no longer addresses the current round): {codes}; durable facts {len(f)} ({f[0]["status"]})')
p = pending(Y)[0]
exp = (datetime.strptime(f[0]['documentedTime'], '%Y-%m-%d %H:%M') if f[0]['status'] == 'given' else H0) + timedelta(hours=1)
check(p['round'] == 2 and p['scheduledTime'] == S(exp), f'timer consistent with the WINNER ({f[0]["status"]}): round 2 due {p["scheduledTime"]}')

print('\n[4] a relevant order-state change: Given vs discontinue at the same moment')
Z = order('S', 'q1h')
rz = cur(Z)
res = overlap('given vs discontinue', [doc(Z, rz, NUR), lambda: call('POST', f'/api/icu/orders/{Z}/discontinue', DOC, {'reason': 'synthetic: course complete'})], [Z], delays=[0, 0.4])
g, d = res; f = facts(Z); h = [e['action'] for e in hist(Z)]
o = [x for x in call('GET', '/api/icu/orders', DOC)[1] if x['orderId'] == Z][0]
check(d[0] == 200 and o['status'] == 'discontinued', f'discontinue 200, order discontinued (fresh read)')
if g[0] == 200:
    check(len(f) == 1 and h[-2:] == ['administered', 'discontinued'], f'Given committed first: fact durable AND discontinue audited after it: {h}')
else:
    check(g[0] == 409 and 'discontinued' in g[1]['error'] and not f and h[-1] == 'discontinued', f'discontinue committed first: Given 409 on fresh state ({g[1]["error"][:70]}), no fact')
check(not pending(Z), 'no current round on the stopped order')

print('\n[5] a schedule change: Given (round 2) vs frequency modification q1h -> q4h at the same moment')
M = order('T', 'q1h')
st, _ = call('POST', f'/api/icu/mar/{M}/administrations/{cur(M)}', NUR, {'action': 'given'})
r2 = cur(M); g1 = facts(M)[0]['documentedTime']
res = overlap('given vs modify', [doc(M, r2, NUR), lambda: call('PUT', f'/api/icu/orders/{M}', DOC, {'changes': {'frequency': 'q4h'}, 'reason': 'synthetic: de-escalate'})], [M], delays=[0, 0.4])
g, m = res; f = facts(M); p = pending(M)[0]
check(m[0] == 200, 'modify 200')
if g[0] == 200:
    exp = datetime.strptime(f[-1]['documentedTime'], '%Y-%m-%d %H:%M') + timedelta(hours=4)
    check(len(f) == 2 and p['round'] == 3 and p['scheduledTime'] == S(exp), f'Given first: round 3 due its actual + the NEW interval (q4h) = {p["scheduledTime"]}')
else:
    exp = datetime.strptime(g1, '%Y-%m-%d %H:%M') + timedelta(hours=4)
    check(g[0] == 409 and 'is now due' in g[1]['error'] and len(f) == 1 and p['round'] == 2 and p['scheduledTime'] == S(exp),
          f'modify first: the Given\'s round moved (409 "{g[1]["error"][:60]}"); round 2 now due {p["scheduledTime"]}')

print('\n[4b] the same race, the discontinue queued FIRST on the lock (Given 0.4 s later, both still parked)')
Z2 = order('X', 'q1h')
res = overlap('discontinue first', [doc(Z2, cur(Z2), NUR), lambda: call('POST', f'/api/icu/orders/{Z2}/discontinue', DOC, {'reason': 'synthetic: course complete'})], [Z2], delays=[0.4, 0])
g, d = res
check(d[0] == 200 and g[0] == 409 and 'discontinued' in g[1]['error'] and not facts(Z2) and [e['action'] for e in hist(Z2)][-1] == 'discontinued',
      f'discontinue committed first -> the Given revalidated against the fresh state: 409 ({g[1]["error"][:60]}), no fact')

print('\n[5b] the same race, the frequency change queued FIRST')
M2 = order('Y', 'q1h')
st, _ = call('POST', f'/api/icu/mar/{M2}/administrations/{cur(M2)}', NUR, {'action': 'given'})
r2b = cur(M2); g1b = facts(M2)[0]['documentedTime']
res = overlap('modify first', [doc(M2, r2b, NUR), lambda: call('PUT', f'/api/icu/orders/{M2}', DOC, {'changes': {'frequency': 'q4h'}, 'reason': 'synthetic: de-escalate'})], [M2], delays=[0.4, 0])
g, m = res; p = pending(M2)[0]
check(m[0] == 200 and g[0] == 409 and 'is now due' in g[1]['error'] and len(facts(M2)) == 1
      and p['round'] == 2 and p['scheduledTime'] == S(datetime.strptime(g1b, '%Y-%m-%d %H:%M') + timedelta(hours=4)),
      f'modify committed first -> the Given\'s round had moved: 409 ("{g[1]["error"][:50]}"); round 2 now due {p["scheduledTime"]}')

print('\n[6] independent orders proceed: order B is not blocked while order A\'s row is locked')
A1 = order('U', 'q1h'); B1 = order('V', 'q1h')
res = overlap('independent', [doc(A1, cur(A1), NUR), doc(B1, cur(B1), NUR2)], [A1], expect_blocked=[True, False])
check([r[0] for r in res] == [200, 200] and len(facts(A1)) == 1 and len(facts(B1)) == 1, f'both 200 and durable: {[r[0] for r in res]}')

print('\n[7] the discharge cascade vs a Given on the same encounter at the same moment')
PID2, EID2 = admit('Dis')
W = order('W', 'q1h', pid=PID2)
rw = cur(W)
res = overlap('given vs discharge', [doc(W, rw, NUR), lambda: call('POST', f'/api/icu/adt/encounters/{EID2}/discharge', DOC)], [W], delays=[0, 0.4])
g, d = res; f = facts(W); h = [e['action'] for e in hist(W)]
o = [x for x in call('GET', '/api/icu/orders', DOC)[1] if x['orderId'] == W][0]
check(d[0] == 200 and o['status'] in ('discontinued', 'completed'), f'discharge 200; order terminal ({o["status"]})')
if g[0] == 200:
    check(len(f) == 1 and h[-2:] == ['administered', 'discontinued'], f'Given committed first: fact durable, then the cascade discontinued it: {h}')
else:
    check(g[0] == 409 and 'is not open' in g[1]['error'] and not f, f'discharge committed first: Given 409 on the closed encounter, no fact ({g[1]["error"][:60]})')

print('\n[7b] the same race, the discharge queued FIRST')
PID3, EID3 = admit('Dis2')
W2 = order('Z', 'q1h', pid=PID3)
res = overlap('discharge first', [doc(W2, cur(W2), NUR), lambda: call('POST', f'/api/icu/adt/encounters/{EID3}/discharge', DOC)], [W2], delays=[0.4, 0])
g, d = res
check(d[0] == 200 and g[0] == 409 and 'is not open' in g[1]['error'] and not facts(W2), f'discharge committed first: Given 409 on the closed encounter, no fact ({g[1]["error"][:60]})')

st, _ = call('POST', f'/api/icu/adt/encounters/{EID}/discharge', DOC)
print(f'\ncleanup: discharged {PID} -> {st}')
print(f'\nRESULT: {passes} passed, {fails} failed')
sys.exit(1 if fails else 0)
