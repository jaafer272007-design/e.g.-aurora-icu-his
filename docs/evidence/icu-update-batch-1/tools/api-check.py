# REAL-API check of late-dose re-timing — the live server (this branch) +
# local PostgreSQL 16, synthetic patient/drugs only. Orders are created and
# documented ONLY through the real endpoints; the database is touched
# directly for exactly two synthetic setups, each stated: (1) backdating an
# order's "signed" event (its therapy start) so past instances exist, and
# (2) inserting one pre-update ("legacy") late fact with no scheduleAnchor.
import json, subprocess, sys, time, urllib.request, urllib.error
from datetime import datetime, timedelta, timezone
API = 'http://localhost:8080'
PG = ['psql', '-h', 'localhost', '-U', 'aurora', '-d', 'aurora_batch1', '-Atq', '-v', 'ON_ERROR_STOP=1']
import os
ENV = {'PGPASSWORD': os.environ['AURORA_LOCAL_DB_PASSWORD'], 'PATH': '/usr/bin:/bin'}  # the local synthetic DB's password
fails = 0
def check(cond, msg):
    global fails
    print(('  PASS ' if cond else '  FAIL ') + msg)
    if not cond: fails += 1
def call(method, path, tok=None, body=None):
    req = urllib.request.Request(API + path, method=method, data=None if body is None else json.dumps(body).encode(),
                                 headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + tok} if tok else {})})
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read() or 'null')
    except urllib.error.HTTPError as e:
        raw = e.read(); return e.code, (json.loads(raw) if raw else None)
def login(u):
    return call('POST', '/api/auth/login', body={'username': u, 'password': 'Aurora2026!'})[1]['token']
def sql(q):
    return subprocess.run(PG + ['-c', q], env=ENV, capture_output=True, text=True, check=True).stdout.strip()
S = lambda t: t.strftime('%Y-%m-%d %H:%M')
I = lambda t: t.strftime('%Y-%m-%dT%H:%M')

DOC, NUR, PHA = login('sara.rahman'), login('maya.chen'), login('samir.qassem')
run = datetime.now(timezone.utc).strftime('%H%M%S')
now = datetime.now(timezone.utc).replace(second=0, microsecond=0, tzinfo=None)
if now.minute == 0:  # a :00 "now" makes an instance exactly on-time; step off it
    time.sleep(61); now = datetime.now(timezone.utc).replace(second=0, microsecond=0, tzinfo=None)
F0 = now.replace(minute=0)
print(f'clock (server/UTC): now={S(now)}  F0 (this hour)={S(F0)}  run={run}')

# synthetic drugs (distinct classes — no duplicate-therapy interplay)
freqs = ['q1h', 'q4h', 'q8h', 'once']
for k in 'ABCDEFGP':
    st, _ = call('POST', '/api/icu/formulary', PHA, {'drugId': f'syn-{k.lower()}-{run}', 'name': f'Synthetic {k} {run}', 'brandNames': [], 'drugClass': f'SynClass{k}{run}',
        'form': 'vial', 'strengths': ['1 mg'], 'doses': ['1 mg'], 'defaultDose': '1 mg', 'routes': ['IV'], 'frequencies': freqs,
        'prnCapable': k == 'P', 'allergyBlock': [], 'allergyWarn': []})
    assert st in (200, 201), (k, st)
beds = call('GET', '/api/icu/adt/beds', DOC)[1]
free = [b['bedId'] for b in beds if not b.get('patientId')][0]
st, adm = call('POST', '/api/icu/adt/admissions', DOC, {'nameFirst': 'Synthetic', 'nameSecond': 'Retime', 'nameFamily': f'Patient{run}', 'age': 60, 'sex': 'F',
    'allergies': 'None known', 'bedId': free, 'diagnosis': 'synthetic re-timing check', 'attending': 'Dr. Sara Rahman'})
PID, EID = adm['patient']['patientId'], adm['encounter']['encounterId']
print(f'admitted synthetic {PID} ({EID}) at {free}')

def order(k, freq, first, prn=False):
    """create + sign via the REAL endpoint, then backdate ONLY the signed event so the first instance is `first`"""
    med = {'drugId': f'syn-{k.lower()}-{run}', 'drug': f'Synthetic {k} {run}', 'dose': '1 mg', 'route': 'IV', 'frequency': freq, 'duration': 'ongoing', 'prn': prn}
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
def mar(oid):
    return [r for r in call('GET', '/api/icu/mar', NUR)[1] if r['orderId'] == oid]
def derived(oid):
    return [r['scheduledTime'] for r in mar(oid) if r['status'] == 'scheduled' and 'T' in r['adminId']]
def doc(oid, inst, action='given', reason=None, at=None):
    body = {'action': action}
    if reason: body['reason'] = reason
    if at: body['administeredAt'] = S(at)
    return call('POST', f'/api/icu/mar/{oid}/administrations/{I(inst) if isinstance(inst, datetime) else inst}', NUR, body)
def facts(oid):
    return json.loads(sql(f"""select coalesce("AdministrationsJson",'[]') from "Orders" where "OrderId"='{oid}'"""))
def hist(oid):
    return json.loads(sql(f"""select "HistoryJson" from "Orders" where "OrderId"='{oid}'"""))
def show(label, oid):
    print(f'    {label}: ' + ' | '.join(f"{r['scheduledTime'] or '(prn)'} {r['status']}" + (f"@{(r.get('documentedTime') or '')[-5:]}" if r['status'] in ('given','held','refused') else '') + ('↻' if r.get('scheduleAnchor') else '') for r in mar(oid)))

print('\n[A] q1h — owner example with explicit actual times; the 2h delay-reason rule judged at the DOCUMENTING moment')
F = F0 - timedelta(hours=2); A = order('A', 'q1h', F)
show('before', A)
check(derived(A)[:3] == [S(F), S(F + timedelta(hours=1)), S(F + timedelta(hours=2))], 'before: therapy-start grid F, F+1h, F+2h')
st, b = doc(A, F, at=F + timedelta(minutes=5))
check(st == 400 and 'delay reason' in (b or {}).get('error', ''), f'actual 5 min late but documented {int((now-F).total_seconds()//60)} min after the slot, no reason -> 400 delay reason ({st}: {(b or {}).get("error","")[:80]})')
st, b = doc(A, F, reason='synthetic: pump occlusion', at=F + timedelta(minutes=5))
f = facts(A)[-1]
check(st == 200 and f.get('scheduleAnchor') == S(F + timedelta(minutes=5)), f'with reason -> 200; fact scheduleAnchor={f.get("scheduleAnchor")} (actual time, not the documenting time)')
check(f['scheduledTime'] == S(F) and f['documentedTime'] == S(F + timedelta(minutes=5)), 'original scheduled time + actual time preserved on the fact')
check(f'schedule re-timed: next dose {S(F + timedelta(minutes=65))}' in hist(A)[-1]['detail'], 'history records the re-timing: ' + hist(A)[-1]['detail'][:160])
show('after F@F+5', A)
d = derived(A)
check(d[0] == S(F + timedelta(minutes=65)) and S(F + timedelta(hours=1)) not in d and S(F + timedelta(hours=2)) not in d, f'next grid F+65 (…), old F+1h/F+2h superseded: {d}')
for stale in (F + timedelta(hours=1), F + timedelta(hours=2)):
    st, b = doc(A, stale)
    check(st == 409 and 're-timed' in (b or {}).get('error', ''), f'stale browser posts {S(stale)} -> 409 ({(b or {}).get("error","")[:90]})')
st, b = doc(A, F + timedelta(minutes=65), at=F + timedelta(minutes=72))
f = facts(A)[-1]
check(st == 200 and f.get('scheduleAnchor') == S(F + timedelta(minutes=72)), f'F+65 given at F+72 (no reason: {int((now-(F+timedelta(minutes=65))).total_seconds()//60)} min < 120) -> anchor {f.get("scheduleAnchor")}')
d = derived(A)
check(d and d[0] == S(F + timedelta(minutes=132)), f'next = F+132 (the "07:05 given 07:12 -> 08:12" step): {d}')
show('after F+65@F+72', A)

print('\n[B] q8h — 40-min delay needs no reason but re-times; duplicate; discontinue')
F = F0 - timedelta(hours=1); B = order('B', 'q8h', F)
show('before', B)
st, b = doc(B, F, at=F + timedelta(minutes=40))
check(st == 200 and facts(B)[-1].get('scheduleAnchor') == S(F + timedelta(minutes=40)), f'given at F+40, no reason -> 200 + anchor')
check(derived(B) == [S(F + timedelta(minutes=520))], f'next = F+8h40: {derived(B)}')
st, b = doc(B, F + timedelta(hours=8)); check(st == 409 and 're-timed' in b['error'], f'stale F+8h -> 409')
st, b = doc(B, F); check(st == 409 and 'already documented' in b['error'], f'duplicate F -> 409 ({b["error"][:70]})')
show('after', B)
B_orders_snapshot = None

print('\n[C] older dose recorded later never rewinds the newer schedule')
F = F0 - timedelta(hours=2); C = order('C', 'q1h', F)
st, b = doc(C, F + timedelta(hours=1), at=F + timedelta(minutes=65))
check(st == 200 and facts(C)[-1].get('scheduleAnchor') == S(F + timedelta(minutes=65)), 'F+1h given at F+65 -> anchor')
st, b = doc(C, F, at=F + timedelta(minutes=10))
check(st == 400, f'older F given at F+10 without reason -> 400 (backdating cannot dodge the reason rule)')
st, b = doc(C, F, reason='synthetic: charted late', at=F + timedelta(minutes=10))
check(st == 200 and 'scheduleAnchor' not in facts(C)[-1], 'older F given at F+10 with reason -> 200, NO anchor')
check('schedule not re-timed: a later dose is already documented' in hist(C)[-1]['detail'], 'history says why it did not re-time')
check(derived(C)[0] == S(F + timedelta(minutes=125)), f'schedule stays F+125 (not rewound to F+70): {derived(C)}')
show('after', C)

print('\n[D] held / refused / early given never re-time')
F = F0 - timedelta(hours=1); D = order('D', 'q1h', F)
st, _ = doc(D, F, 'held', 'synthetic: SBP 82'); check(st == 200 and 'scheduleAnchor' not in facts(D)[-1], 'held F -> no anchor')
st, _ = doc(D, F0, 'refused', 'synthetic: declined'); check(st == 200 and 'scheduleAnchor' not in facts(D)[-1], 'refused F0 -> no anchor')
check(derived(D) == [S(F0 + timedelta(hours=1))], f'grid unchanged, next F0+1h: {derived(D)}')
st, _ = doc(D, F0 + timedelta(hours=1)); check(st == 200 and 'scheduleAnchor' not in facts(D)[-1], 'early given (documented before its slot) -> no anchor')
check(derived(D) == [S(F0 + timedelta(hours=2))], f'next F0+2h: {derived(D)}')

print('\n[E] a pre-update late fact (no anchor) is never reinterpreted; its bytes stay identical')
F = F0 - timedelta(hours=1); E = order('E', 'q1h', F)
legacy = '{"adminId":"ADM-9001","scheduledTime":"%s","status":"given","documentedTime":"%s","documentedBy":"Legacy Nurse"}' % (S(F), S(F + timedelta(minutes=20)))
sql(f"""update "Orders" set "AdministrationsJson"='[{legacy}]' where "OrderId"='{E}'""")
check(derived(E)[0] == S(F + timedelta(hours=1)), f'legacy late fact: grid stays F+1h (not F+80): {derived(E)}')
st, _ = doc(E, F + timedelta(hours=1), at=now)
raw = sql(f"""select "AdministrationsJson" from "Orders" where "OrderId"='{E}'""")
check(st == 200 and raw.startswith('[' + legacy + ','), 'after a new documentation the legacy fact bytes are unchanged')
show('after', E)

print('\n[F] frequency modification keeps the re-timing: next = anchor + NEW interval')
F = F0 - timedelta(hours=1); Fo = order('F', 'q1h', F)
doc(Fo, F, at=F + timedelta(minutes=5))
st, _ = call('PUT', f'/api/icu/orders/{Fo}', DOC, {'changes': {'frequency': 'q4h'}, 'reason': 'synthetic: de-escalate'})
check(st == 200 and derived(Fo)[0] == S(F + timedelta(minutes=245)), f'q1h re-timed at F+5 then modified to q4h -> next F+4h05: {derived(Fo)}')

print('\n[G] once + PRN never re-time; #110 completion preserved')
F = F0 - timedelta(hours=1); G = order('G', 'once', F)
st, o = doc(G, F)
gst = [x for x in call('GET', f'/api/icu/orders?patientId={PID}', DOC)[1] if x['orderId'] == G][0]['status']
check(st == 200 and 'scheduleAnchor' not in facts(G)[-1] and gst == 'completed', f'once given late -> no anchor; GET /orders derives it {gst} (#110)')
P = order('P', 'q4h', None, prn=True)
st, _ = doc(P, 'prn'); check(st == 200 and 'scheduleAnchor' not in facts(P)[-1], 'PRN given -> no anchor')

# agreement snapshot for the client-side check (Orders next-dose chip / due count vs server MAR)
json.dump({'now': S(datetime.now(timezone.utc).replace(tzinfo=None)), 'mar': call('GET', '/api/icu/mar', NUR)[1],
           'orders': call('GET', f'/api/icu/orders?patientId={PID}', DOC)[1]}, open(sys.argv[1], 'w'))
print(f'\nagreement snapshot -> {sys.argv[1]}  (patient {PID})')

print('\n[H] discontinued order: facts stay (anchor kept), nothing derived, documenting -> 409')
st, _ = call('POST', f'/api/icu/orders/{B}/discontinue', DOC, {'reason': 'synthetic: course complete'})
rows = mar(B)
check(st == 200 and all(r['status'] != 'scheduled' for r in rows) and any(r.get('scheduleAnchor') for r in rows), f'MAR after discontinue: {[(r["scheduledTime"], r["status"], r.get("scheduleAnchor")) for r in rows]}')
st, b = doc(B, F0 - timedelta(hours=1) + timedelta(minutes=520)); check(st == 409 and 'discontinued' in b['error'], f'document on discontinued -> 409 ({b["error"][:60]})')

if len(sys.argv) > 2 and sys.argv[2] == 'keep':
    print(f'\n[I] encounter KEPT OPEN for the browser checks: {PID} / {EID}')
else:
    print('\n[I] discharge: encounter scope hides every order from the MAR; documenting -> 409')
    st, _ = call('POST', f'/api/icu/adt/encounters/{EID}/discharge', DOC)
    left = [r for r in call('GET', '/api/icu/mar', NUR)[1] if r['patientId'] == PID]
    check(st == 200 and not left, f'discharged -> MAR rows for {PID}: {len(left)}')
    st, b = doc(A, F0); check(st == 409, f'document after discharge -> {st} ({(b or {}).get("error","")[:70]})')
print(f'\nAPI CHECK {"PASSED" if fails == 0 else f"FAILED ({fails})"}')
sys.exit(1 if fails else 0)
