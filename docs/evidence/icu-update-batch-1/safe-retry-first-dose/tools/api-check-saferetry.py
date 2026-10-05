# REAL-API check of the owner's decisions + SAFE RETRY (2026-10-05 — MAR design ### F) on the
# live server (this branch) + local PostgreSQL 16, synthetic patient and drugs only:
#  - the FIRST dose (round 1 / a once dose of an order with no documented administration) is
#    open on signing; the next round keeps the scheduled-time lock and the rolling timer;
#  - a LEGACY order (a fact recorded before the rolling timer) is not at its first dose: its
#    round 1 (LegacyEntry slot) is unchanged and stays locked;
#  - attemptId: a resend of a recorded attempt is answered with the existing record — no fact,
#    no audit entry (the order row is compared BYTE-FOR-BYTE) — for PRN, on-demand, round and
#    once doses, concurrently, after the order was discontinued; a different documentation
#    under the same id is 409; a new attempt documents again; malformed ids are 400; a request
#    without attemptId behaves exactly as before.
# Helpers are one-action-per-round's api-check-oneaction.py's. Direct DB writes: LEGACY's
# signing time and its legacy fact (stated setup), and the byte-for-byte reads.
import json, os, subprocess, sys, threading, time, urllib.request, urllib.error
from datetime import datetime, timedelta, timezone
API = os.environ.get('SAFERETRY_API', 'http://localhost:8080')
PG = ['psql', '-h', 'localhost', '-U', 'aurora', '-d', os.environ.get('SAFERETRY_DB', 'aurora_saferetry'), '-Atq', '-v', 'ON_ERROR_STOP=1']
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
M = lambda k: timedelta(minutes=k)
utcnow = lambda: datetime.now(timezone.utc).replace(tzinfo=None)

DOC, NUR, PHA = login('sara.rahman'), login('maya.chen'), login('samir.qassem')
while utcnow().minute >= 55 or utcnow().second > 45: time.sleep(10)   # first doses due at the next full hour stay in the future
run = utcnow().strftime('%H%M%S')
now = utcnow().replace(second=0, microsecond=0)
print(f'clock (server wire, UTC): now={S(now)}  run={run}  (the server runs TZ=Asia/Baghdad; hospital time = UTC+3)')
free = [b['bedId'] for b in call('GET', '/api/icu/adt/beds', DOC)[1] if not b.get('patientId')][0]
st, adm = call('POST', '/api/icu/adt/admissions', DOC, {'nameFirst': 'Synthetic', 'nameSecond': 'Saferetry', 'nameFamily': f'Api{run}', 'age': 61, 'sex': 'M',
    'allergies': 'None known', 'bedId': free, 'diagnosis': 'synthetic safe-retry / first-dose API check', 'attending': 'Dr. Sara Rahman'})
PID, EID = adm['patient']['patientId'], adm['encounter']['encounterId']
print(f'admitted synthetic {PID} ({EID}) at {free}')
seq = iter(range(1, 100))
def order(k, freq, prn=False):
    n = next(seq)   # each order gets its OWN synthetic drug + class (the duplicate-therapy check is real)
    st, _ = call('POST', '/api/icu/formulary', PHA, {'drugId': f'sra-{k.lower()}{n}-{run}', 'name': f'Saferetry {k}{n} {run}', 'brandNames': [], 'drugClass': f'SraClass{k}{n}{run}',
        'form': 'vial', 'strengths': ['1 mg'], 'doses': ['1 mg'], 'defaultDose': '1 mg', 'routes': ['IV'], 'frequencies': [freq],
        'prnCapable': prn, 'allergyBlock': [], 'allergyWarn': []})
    assert st in (200, 201), (k, st)
    med = {'drugId': f'sra-{k.lower()}{n}-{run}', 'drug': f'Saferetry {k}{n} {run}', 'dose': '1 mg', 'route': 'IV', 'frequency': freq, 'duration': 'ongoing', 'prn': prn}
    if prn: med['prnIndication'] = 'synthetic pain'
    st, o = call('POST', '/api/icu/orders', DOC, {'drafts': [{'patientId': PID, 'category': 'Medication', 'priority': 'Routine', 'medication': med}], 'sign': True})
    assert st == 200, (st, o)
    return o[0]['orderId']
def mar(oid): return [r for r in call('GET', '/api/icu/mar', NUR)[1] if r['orderId'] == oid]
def current(oid):
    p = [r for r in mar(oid) if r['status'] == 'scheduled']; return p[0] if len(p) == 1 else None
def doc(oid, aid, action='given', reason=None, at=None, attempt=None, tok=None):
    body = {'action': action}
    if reason: body['reason'] = reason
    if at: body['administeredAt'] = S(at)
    if attempt: body['attemptId'] = attempt
    return call('POST', f'/api/icu/mar/{oid}/administrations/{aid}', tok or NUR, body)
def raw(oid):
    """the stored record, byte-for-byte: facts + audit history + status"""
    return sql(f"""select coalesce("AdministrationsJson",'') || E'\\n' || "HistoryJson" || E'\\n' || "Status" from "Orders" where "OrderId"='{oid}'""")
def facts(oid): return json.loads(sql(f"""select coalesce("AdministrationsJson",'[]') from "Orders" where "OrderId"='{oid}'"""))
def hist(oid): return json.loads(sql(f"""select "HistoryJson" from "Orders" where "OrderId"='{oid}'"""))
def set_json(oid, col, v): sql(f"""update "Orders" set "{col}"=$h${json.dumps(v, separators=(',', ':'), ensure_ascii=False)}$h$ where "OrderId"='{oid}'""")
def replay(oid, aid, label, action='given', reason=None, attempt=None, at=None):
    """a resend of a recorded attempt -> 200 with the record; the row byte-identical"""
    before = raw(oid)
    st, b = doc(oid, aid, action, reason, at, attempt)
    check(st == 200 and raw(oid) == before and b['administrations'] == facts(oid),
          f'{label}: resend -> {st}, the existing record returned; facts + audit byte-identical')
def burst(oid, aid, n, attempt):
    out = [None] * n; gate = threading.Barrier(n)
    def go(i):
        gate.wait(); out[i] = doc(oid, aid, attempt=attempt)[0]
    ts = [threading.Thread(target=go, args=(i,)) for i in range(n)]
    for t in ts: t.start()
    for t in ts: t.join()
    return out
A = lambda tag: f'{tag}-{run}-{next(seq):02d}-synthetic'   # a synthetic attempt id (the page uses 32 random hex chars)

print('\n[1] FIRST DOSE — q1h signed now: round 1 open on signing; round 2 keeps the lock and the rolling timer')
f1 = order('F', 'q1h')
c = current(f1)
due1 = P(c['scheduledTime'])
check(c['round'] == 1 and c.get('firstDose') is True and due1 > utcnow() and due1 == now.replace(minute=0) + M(60),
      f'the MAR row: round 1 due {c["scheduledTime"]} (the next full hour, unchanged), firstDose={c.get("firstDose")}')
att = A('first')
st, b = doc(f1, c['adminId'], attempt=att)
N1 = P(facts(f1)[-1]['documentedTime'])
check(st == 200 and facts(f1)[-1]['round'] == 1 and facts(f1)[-1]['attemptId'] == att,
      f'Given at {S(N1)}, {int((due1 - utcnow()).total_seconds() // 60)} min BEFORE its scheduled time -> {st}; the fact carries round 1 + attemptId')
c2 = current(f1)
check(c2['round'] == 2 and c2['scheduledTime'] == S(N1 + M(60)) and c2['timerRule'] == 'given' and 'firstDose' not in c2,
      f'round 2 due {c2["scheduledTime"]} = actual + 1 h (rule {c2["timerRule"]}); no firstDose flag')
fr = [r for r in mar(f1) if r['status'] == 'given']
check(len(fr) == 1 and fr[0].get('attemptId') == att, 'GET /api/icu/mar: the fact row carries its attemptId')
before = raw(f1)
codes = [doc(f1, c2['adminId'], a, r)[0:2] for a, r in (('given', None), ('held', 'synthetic probe'), ('refused', 'synthetic probe'))]
check(all(st == 409 and f'is not due until {S(N1 + M(60))}' in b['error'] for st, b in codes) and raw(f1) == before,
      f'round 2 before its time: Given/Held/Refused -> {[st for st, _ in codes]}; nothing written')
replay(f1, c['adminId'], 'the first dose\'s attempt resent after round 2 exists (a late original)', attempt=att)
st, b = doc(f1, c['adminId'], attempt=A('other'))
check(st == 409 and 'already documented' in b['error'], f'a DIFFERENT attempt on resolved round 1 -> {st} "{b["error"][:80]}…"')

f2 = order('F', 'q1h')
c = current(f2)
st, _ = doc(f2, c['adminId'], 'held', 'synthetic: NPO')
c2 = current(f2)
check(st == 200 and c2['scheduledTime'] == S(P(c['scheduledTime']) + M(60)) and c2['timerRule'] == 'skipped',
      f'first dose HELD before its time -> {st}; round 2 due {c2["scheduledTime"]} = round 1\'s scheduled {c["scheduledTime"]} + 1 h (skipped rule)')

print('\n[2] FIRST DOSE — a once order signed now')
o1 = order('O', 'once')
c = current(o1)
att = A('once')
st, _ = doc(o1, c['adminId'], 'refused', 'synthetic: declined', attempt=att)
check(c.get('firstDose') is True and st == 200 and current(o1) is None, f'once dose due {c["scheduledTime"]}: Refused before its time -> {st}; nothing further expected')
replay(o1, c['adminId'], 'the once attempt resent', 'refused', 'synthetic: declined', att)
st, b = doc(o1, c['adminId'], 'given', attempt=A('once2'))
check(st == 409 and 'already documented' in b['error'], f'a different attempt on the once dose -> {st}')

print('\n[3] LEGACY order: a fact recorded before the rolling timer -> not a first dose; round 1 unchanged and locked')
lg = order('L', 'q1h')
h = hist(lg)
for e in h:
    if e['action'] == 'signed': e['time'] = S(now - M(30))
set_json(lg, 'HistoryJson', h)
first = (now - M(30)).replace(minute=0) + M(60)
set_json(lg, 'AdministrationsJson', [{'adminId': f'ADM-L{run}', 'scheduledTime': S(first), 'status': 'given', 'documentedTime': S(now), 'documentedBy': 'RN Synthetic Legacy'}])
c = current(lg)
check(c['round'] == 1 and c['scheduledTime'] == S(first + M(60)) and 'firstDose' not in c,
      f'round 1 = the LegacyEntry slot {c["scheduledTime"]} (the slot after the legacy fact\'s {S(first)}); no firstDose flag')
before = raw(lg)
st, b = doc(lg, c['adminId'], attempt=A('legacy'))
check(st == 409 and f'is not due until {S(first + M(60))}' in b['error'] and raw(lg) == before, f'Given before that slot -> {st}; nothing written')
check(current(lg) == c, 'its schedule is not reset: the same round 1 is still served')

print('\n[4] SAFE RETRY — PRN: replay, a different documentation under the same id, a new attempt')
p1 = order('P', 'q6h', prn=True)
att = A('prn')
st, b = doc(p1, 'prn', attempt=att)
check(st == 200 and len(facts(p1)) == 1 and facts(p1)[0]['attemptId'] == att, f'PRN Given with attemptId -> {st}; one fact carrying it')
replay(p1, 'prn', 'the same attempt resent (a retry / the late original)', attempt=att)
before = raw(p1)
st, b = doc(p1, 'prn', 'held', 'synthetic probe', attempt=att)
check(st == 409 and 'already recorded a different documentation' in b['error'] and raw(p1) == before, f'the same id with a different action -> {st} "{b["error"][:90]}…"; nothing written')
st, _ = doc(p1, 'prn', attempt=A('prn-later'))
check(st == 200 and len(facts(p1)) == 2, f'a NEW attempt (a later intentional dose) -> {st}; 2 facts')
p9 = order('P', 'q6h', prn=True)
st, _ = doc(p9, 'prn', attempt=att)
check(st == 200 and len(facts(p9)) == 1, f'the same attempt id on ANOTHER order is a different attempt (deduplication is per order) -> {st}')

print('\n[5] SAFE RETRY — 6 concurrent copies of one attempt (PRN): exactly one fact, one audit entry')
p2 = order('P', 'q6h', prn=True)
h0 = len(hist(p2))
codes = burst(p2, 'prn', 6, A('burst'))
check(codes == [200] * 6 and len(facts(p2)) == 1 and len(hist(p2)) == h0 + 1, f'6 concurrent copies -> {codes}; {len(facts(p2))} fact, {len(hist(p2)) - h0} audit entry')

print('\n[6] SAFE RETRY — continuous (on demand)')
cc = order('C', 'continuous')
att = A('cont')
st, _ = doc(cc, 'ondemand', attempt=att)
check(st == 200 and len(facts(cc)) == 1, f'on-demand Given with attemptId -> {st}')
replay(cc, 'ondemand', 'the same attempt resent', attempt=att)
st, _ = doc(cc, 'ondemand', attempt=A('cont-later'))
check(st == 200 and len(facts(cc)) == 2, f'a new attempt -> {st}; 2 facts (continuous stays available when needed)')

print('\n[7] SAFE RETRY — after the order was discontinued, a recorded attempt still reads as recorded')
p3 = order('P', 'q6h', prn=True)
att = A('disc')
doc(p3, 'prn', attempt=att)
st, _ = call('POST', f'/api/icu/orders/{p3}/discontinue', DOC, {'reason': 'synthetic: course complete'})
check(st == 200, f'the order is discontinued -> {st}')
replay(p3, 'prn', 'the recorded attempt resent', attempt=att)
st, b = doc(p3, 'prn', attempt=A('disc-new'))
check(st == 409 and 'discontinued' in b['error'], f'a new attempt -> {st} "{b["error"][:70]}…"')

print('\n[8] attemptId validation; a request without one behaves as before')
p4 = order('P', 'q6h', prn=True)
before = raw(p4)
bad = [doc(p4, 'prn', attempt=x)[0] for x in ('short', 'has space 12345', 'x' * 65, 'semi;colon-123456')]
check(bad == [400] * 4 and raw(p4) == before, f'malformed ids (too short, space, 65 chars, ";") -> {bad}; nothing written')
codes = [doc(p4, 'prn')[0] for _ in range(2)]
check(codes == [200, 200] and len(facts(p4)) == 2 and all('attemptId' not in f for f in facts(p4)),
      f'two plain {{"action":"given"}} (no attemptId) -> {codes}; 2 facts, no attemptId stored (unchanged behaviour)')
check(all('attemptId' not in r for r in mar(p4)), 'their MAR rows carry no attemptId field (WhenWritingNull)')

st, _ = call('POST', f'/api/icu/adt/encounters/{EID}/discharge', DOC)
print(f'\ncleanup: discharged {EID} -> {st}')
print(f'\nRESULT {passes} passed, {fails} failed')
sys.exit(1 if fails else 0)
