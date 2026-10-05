# REAL-API check of the ROLLING TIMER (Amendment B) — the live server (this
# branch) + local PostgreSQL 16, synthetic patient/drugs only. Orders are
# created, modified, discontinued and documented ONLY through the real
# endpoints. The database is touched directly for exactly two synthetic
# setups, each stated where it happens: (1) backdating an order's "signed"
# event (its therapy start) so an overdue first round exists; (2) inserting
# pre-update ("legacy") facts with no `round`. Every assertion re-reads the
# durable state (GET /api/icu/mar, GET /api/icu/orders, or the row itself).
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
for k in 'ABCDEFGHJKP':
    st, _ = call('POST', '/api/icu/formulary', PHA, {'drugId': f'rol-{k.lower()}-{run}', 'name': f'Rolling {k} {run}', 'brandNames': [], 'drugClass': f'RolClass{k}{run}',
        'form': 'vial', 'strengths': ['1 mg'], 'doses': ['1 mg'], 'defaultDose': '1 mg', 'routes': ['IV'], 'frequencies': ['q1h', 'q4h', 'q8h', 'once'],
        'prnCapable': k == 'P', 'allergyBlock': [], 'allergyWarn': []})
    assert st in (200, 201), (k, st)
free = [b['bedId'] for b in call('GET', '/api/icu/adt/beds', DOC)[1] if not b.get('patientId')][0]
st, adm = call('POST', '/api/icu/adt/admissions', DOC, {'nameFirst': 'Synthetic', 'nameSecond': 'Rolling', 'nameFamily': f'Timer{run}', 'age': 61, 'sex': 'M',
    'allergies': 'None known', 'bedId': free, 'diagnosis': 'synthetic rolling-timer check', 'attending': 'Dr. Sara Rahman'})
PID, EID = adm['patient']['patientId'], adm['encounter']['encounterId']
print(f'admitted synthetic {PID} ({EID}) at {free}')

def order(k, freq, first=None, prn=False):
    """create + sign via the REAL endpoint; when `first` is given, backdate ONLY the signed event (DB setup 1) so round 1 is due at `first`"""
    med = {'drugId': f'rol-{k.lower()}-{run}', 'drug': f'Rolling {k} {run}', 'dose': '1 mg', 'route': 'IV', 'frequency': freq, 'duration': 'ongoing', 'prn': prn}
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

print('\n[A] q1h: an overdue round stays the ONE current round; explicit actual vs later documentation; early; duplicate; backdated no-rewind; held/refused')
F = H0 - timedelta(hours=3)
A = order('A', 'q1h', F)
c = current(A)
check(c is not None and c['scheduledTime'] == S(F) and c['adminId'] == RID(F, 1) and c['round'] == 1, f'3 h after the first dose: exactly one current round, round 1 due F={S(F)} (no generated missed/future rounds): {pending(A)}')
st, b = doc(A, RID(F, 1))
check(st == 400 and 'delay reason' in b['error'], f'given 3 h late without a reason -> 400 at the documenting moment ({b["error"][:70]})')
act = now - timedelta(minutes=10)
st, b = doc(A, RID(F, 1), reason='synthetic: off the unit', at=act)
fa = facts(A)[-1]
check(st == 200 and fa['documentedTime'] == S(act) and fa['scheduledTime'] == S(F) and fa['round'] == 1, f'given with reason + administeredAt {S(act)}: fact keeps slot {fa["scheduledTime"]}, actual {fa["documentedTime"]}, round {fa.get("round")}')
h = hist(A)[-1]
check(h['time'] != S(act) and f'(documented {h["time"]})' in h['detail'] and f'next round due {S(act + timedelta(hours=1))}' in h['detail'] and 'from the actual administration time' in h['detail'],
      f'audit: documenting time separate + next round stated: "{h["detail"]}"')
c = current(A)
check(c and c['scheduledTime'] == S(act + timedelta(hours=1)) and c['round'] == 2 and c['timerFrom'] == S(act) and c['timerRule'] == 'given', f'MAR: round 2 due actual+1h = {S(act + timedelta(hours=1))} (timed from given {S(act)})')
r2 = c['adminId']
st, b = doc(A, r2)   # early: due in ~50 min, given now
g2 = P(facts(A)[-1]['documentedTime'])
c = current(A)
check(st == 200 and c['scheduledTime'] == S(g2 + timedelta(hours=1)) and c['round'] == 3, f'round 2 given EARLY at {S(g2)} (due {r2[:16]}) -> round 3 due {c and c["scheduledTime"]} = given+1h')
st, b = doc(A, r2)
check(st == 409 and 'already documented as given' in b['error'] and 'RN Maya Chen' in b['error'], f'duplicate round 2 -> 409 ({b["error"][:90]})')
r3 = c['adminId']; due3 = P(c['scheduledTime'])
st, b = doc(A, r3, at=g2 - timedelta(minutes=20))
c = current(A)
check(st == 200 and c['round'] == 4 and c['scheduledTime'] == S(due3) and c['adminId'] == RID(due3, 4) and c['adminId'] != r3,
      f'round 3 given with an OLDER backdated actual ({S(g2 - timedelta(minutes=20))} < timer {S(g2)}): timer not rewound; round 4 shares due {S(due3)} with round 3 but has its own identity {c and c["adminId"]}')
check('timer unchanged' in hist(A)[-1]['detail'], f'audit says the timer was unchanged: "{hist(A)[-1]["detail"][-120:]}"')
r4 = c['adminId']; due4 = P(c['scheduledTime'])
st, b = doc(A, r4, action='held')
check(st == 400, 'held without a reason -> 400')
st, b = doc(A, r4, action='held', reason='synthetic: SBP 82 (held early)')
c = current(A)
check(st == 200 and c['scheduledTime'] == S(due4 + timedelta(hours=1)) and c['timerRule'] == 'skipped' and c['timerFrom'] == S(due4),
      f'round 4 HELD early (due {S(due4)}) -> round 5 due slot+1h {c and c["scheduledTime"]} (not documenting time + 1h)')
due5 = P(c['scheduledTime'])
st, b = doc(A, c['adminId'], action='refused', reason='synthetic: declined')
c = current(A)
check(st == 200 and c['scheduledTime'] == S(due5 + timedelta(hours=1)) and c['round'] == 6, f'round 5 REFUSED -> round 6 due {c and c["scheduledTime"]}')
fa = facts(A)
check([x.get('round') for x in fa] == [1, 2, 3, 4, 5] and [x['status'] for x in fa] == ['given', 'given', 'given', 'held', 'refused'], f'durable facts: rounds {[x.get("round") for x in fa]} statuses {[x["status"] for x in fa]}')

print('\n[B] held/refused LATE: next = skipped slot + interval, already past -> overdue (never skipped or auto-documented); then Given')
Fb = H0 - timedelta(hours=2)
B = order('B', 'q1h', Fb)
st, _ = doc(B, RID(Fb, 1), action='held', reason='synthetic: NPO for procedure')
c = current(B)
check(st == 200 and c['scheduledTime'] == S(Fb + timedelta(hours=1)) and c['round'] == 2, f'held 2 h late -> round 2 due {c and c["scheduledTime"]} (slot+1h, already past = overdue, the ONLY pending row)')
st, _ = doc(B, c['adminId'], action='refused', reason='synthetic: declined')
c = current(B)
check(st == 200 and c['scheduledTime'] == S(Fb + timedelta(hours=2)) and len(pending(B)) == 1, f'refused -> round 3 due {c and c["scheduledTime"]}')
st, _ = doc(B, c['adminId'])
g = P(facts(B)[-1]['documentedTime']); c = current(B)
check(st == 200 and c['scheduledTime'] == S(g + timedelta(hours=1)) and c['timerRule'] == 'given', f'then GIVEN at {S(g)} -> round 4 due {c and c["scheduledTime"]}')
check(len(facts(B)) == 3, f'no fabricated catch-up facts: {len(facts(B))} facts for 3 resolutions')

print('\n[C] multi-day overdue: a q8h round overdue 2+ days (across midnight) stays current and documentable')
Fc = H0 - timedelta(days=2, hours=3)
C = order('C', 'q8h', Fc)
c = current(C)
check(c and c['scheduledTime'] == S(Fc) and c['round'] == 1 and len(pending(C)) == 1, f'round 1 due {S(Fc)} is the single current round 51 h later')
st, _ = doc(C, RID(Fc, 1), reason='synthetic: therapy paused, restarting')
g = P(facts(C)[-1]['documentedTime']); c = current(C)
check(st == 200 and c['scheduledTime'] == S(g + timedelta(hours=8)), f'given {S(g)} -> round 2 due {c and c["scheduledTime"]}')

print('\n[D] legacy activation — the approved compatibility case, on the real clock (F = "06:00")')
Fd = H0 - timedelta(hours=3)
D = order('D', 'q1h', Fd)
legacy = '{"adminId":"ADM-9101","scheduledTime":"%s","status":"given","documentedTime":"%s","documentedBy":"Legacy Nurse"}' % (S(Fd + timedelta(hours=1)), S(Fd + timedelta(minutes=50)))
sql(f"""update "Orders" set "AdministrationsJson"='[{legacy}]' where "OrderId"='{D}'""")   # DB setup 2: a pre-update fact (no round)
c = current(D)
check(c and c['scheduledTime'] == S(Fd) and c['round'] == 1 and len(pending(D)) == 1, f'stored "07:00" slot given at "06:50" (legacy) -> round 1 is the outstanding "06:00" slot {S(Fd)}: {[(r["scheduledTime"], r["status"]) for r in mar(D)]}')
st, _ = doc(D, RID(Fd, 1), reason='synthetic: legacy backfill', at=Fd + timedelta(minutes=55))
c = current(D)
check(st == 200 and c['scheduledTime'] == S(Fd + timedelta(minutes=115)) and c['round'] == 2, f'"06:00" given at "06:55" -> next round "07:55" = {c and c["scheduledTime"]}')
raw = sql(f"""select "AdministrationsJson" from "Orders" where "OrderId"='{D}'""")
check(raw.startswith('[' + legacy + ','), 'the legacy fact bytes are unchanged after a new documentation on the same order')
Fe = H0 - timedelta(hours=5)
E = order('E', 'q8h', Fe)
sql(f"""update "Orders" set "AdministrationsJson"='[{{"adminId":"ADM-9102","scheduledTime":"{S(Fe)}","status":"given","documentedTime":"{S(Fe + timedelta(minutes=150))}","documentedBy":"Legacy Nurse","reason":"legacy delay"}}]' where "OrderId"='{E}'""")  # DB setup 2
c = current(E)
check(c and c['scheduledTime'] == S(Fe + timedelta(hours=8)) and c['round'] == 1, f'a legacy LATE given (2.5 h) starts no timer: round 1 = the original grid slot {S(Fe + timedelta(hours=8))}, not {S(Fe + timedelta(minutes=150 + 480))}')

print('\n[F] frequency modification q1h -> q4h: the timer in force + the new interval; the stale identity -> 409')
Fo = order('F', 'q1h', H0 + timedelta(hours=1))
first = current(Fo)
st, _ = doc(Fo, first['adminId'])
g = P(facts(Fo)[-1]['documentedTime']); stale = current(Fo)['adminId']
st, _ = call('PUT', f'/api/icu/orders/{Fo}', DOC, {'changes': {'frequency': 'q4h'}, 'reason': 'synthetic: de-escalate'})
c = current(Fo)
check(st == 200 and c['scheduledTime'] == S(g + timedelta(hours=4)) and c['round'] == 2, f'modified to q4h -> round 2 due given+4h {c and c["scheduledTime"]}')
st, b = doc(Fo, stale)
check(st == 409 and 'is now due' in b['error'], f'the pre-modification identity {stale} -> 409 ({b["error"][:80]})')

print('\n[G] once and PRN unchanged')
O = order('G', 'once')
oc = pending(O)
check(len(oc) == 1 and '~r' not in oc[0]['adminId'], f'once: one dated instance, no round: {oc[0]["adminId"]}')
st, _ = doc(O, oc[0]['adminId'])
o = [x for x in call('GET', '/api/icu/orders', DOC)[1] if x['orderId'] == O][0]
check(st == 200 and o['status'] == 'completed' and not pending(O), 'once given -> order completed, nothing pending')
st, b = doc(O, oc[0]['adminId']); check(st == 409, 'once duplicate -> 409')
Pn = order('P', 'q6h', prn=True)
st1, _ = doc(Pn, 'prn'); st2, _ = doc(Pn, 'prn')
check(st1 == st2 == 200 and len(facts(Pn)) == 2 and [r['adminId'] for r in pending(Pn)] == ['prn'] and all('round' not in x for x in facts(Pn)), 'PRN: two facts, availability stays, no rounds')

print('\n[H] discontinued: facts stay, no current round, documenting -> 409')
st, _ = call('POST', f'/api/icu/orders/{B}/discontinue', DOC, {'reason': 'synthetic: course complete'})
rows = mar(B)
check(st == 200 and rows and all(r['status'] != 'scheduled' for r in rows), f'MAR after discontinue: facts only {[r["status"] for r in rows]}')
st, b = doc(B, RID(now, 9)); check(st == 409 and 'discontinued' in b['error'], f'document on discontinued -> 409 ({b["error"][:60]})')

print('\n[I] a bare grid identity and a not-yet-existing round -> 404')
cur = current(A)
st, _ = doc(A, P(cur['scheduledTime']).strftime('%Y-%m-%dT%H:%M')); check(st == 404, 'bare dated identity on a repeating order -> 404')
st, _ = doc(A, RID(P(cur['scheduledTime']), cur['round'] + 1)); check(st == 404, 'a future round number -> 404')

if '--keep' not in sys.argv:
    print('\n[J] discharge: encounter scope hides every order; documenting -> 409')
    cur = current(A)['adminId']
    st, _ = call('POST', f'/api/icu/adt/encounters/{EID}/discharge', DOC)
    left = [r for r in call('GET', '/api/icu/mar', NUR)[1] if r['patientId'] == PID]
    check(st == 200 and not left, f'discharged -> MAR rows for {PID}: {len(left)}')
    st, b = doc(A, cur); check(st == 409 and 'is not open' in (b or {}).get('error', ''), f'document after discharge -> {st} ({(b or {}).get("error","")[:60]})')
print(f'\nRESULT: {passes} passed, {fails} failed · synthetic patient {PID} · orders A={A} B={B} C={C} D={D} E={E} F={Fo} once={O} prn={Pn}')
sys.exit(1 if fails else 0)
