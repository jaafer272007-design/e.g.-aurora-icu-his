# REAL-API + PostgreSQL check of repeating / one-time nursing orders (contracts §3 + Amendment 1
# §9.1): create validation, pending/signing, round 1 open on signing, completion + full interval
# to the millisecond (the acceptance example: Done at hh:mm:59.9xx with a 1-minute interval opens
# at the next minute's :59.9xx, never at :00), exact unlock, early/stale/double completion,
# concurrent copies of one attempt and concurrent different attempts, safe replay (also after
# discontinuation and discharge), late completion creating no extra round, hour intervals,
# legacy-style empty requests, body shape errors, RBAC, and no MAR/administration side effects.
# Direct DB writes: only the stated lateness setup (a signed stamp moved 10 min back) and reads.
import json, sys, threading, time
from datetime import datetime, timedelta
from common import *
DOC, NUR, PHA = login('sara.rahman'), login('maya.chen'), login('samir.qassem')
run = utcnow().strftime('%H%M%S')
PID, EID = admit(DOC, f'Rounds{run}')
print(f'admitted synthetic {PID} ({EID})')
NS = lambda s: datetime.strptime(s, '%Y-%m-%dT%H:%M:%S.%fZ')
def create(summary, interval=None, sign=True, nursing=True, extra=None, raw_draft=None):
    d = raw_draft or {'patientId': PID, 'category': 'Nursing', 'summary': f'{summary} {run}', 'priority': 'Routine', 'requiresImplementation': True,
         **({'nursing': ({} if interval is None else {'intervalMinutes': interval})} if nursing else {}), **(extra or {})}
    return call('POST', '/api/icu/orders', DOC, {'drafts': [d], 'sign': sign})
def mk(summary, interval=None, sign=True):
    st, o = create(summary, interval, sign); assert st == 200, (st, o); return o[0]
def impl(oid, rid=None, aid=None, tok=None, body=None):
    if body is None and rid is not None: body = {'roundId': rid, 'attemptId': aid}
    return call('POST', f'/api/icu/orders/{oid}/implement', tok or NUR, body)
def get(oid): return [o for o in call('GET', f'/api/icu/orders?patientId={PID}', NUR)[1] if o['orderId'] == oid][0]
def raw(oid): return sql(f'''select coalesce("NursingJson",'') || E'\\n' || "HistoryJson" || E'\\n' || "Status" || E'\\n' || coalesce("AdministrationsJson",'NULL') from "Orders" where "OrderId"='{oid}' ''')
def comps(oid): return json.loads(sql(f'''select "NursingJson" from "Orders" where "OrderId"='{oid}' '''))['completions']

print('== create validation (400, nothing created)')
n0 = sql('select count(*) from "Orders"')
for label, draft in [
    ('nursing on a Medication draft', {'patientId': PID, 'category': 'Medication', 'summary': 'x', 'priority': 'Routine', 'nursing': {}}),
    ('nursing without requiresImplementation', {'patientId': PID, 'category': 'Nursing', 'summary': 'x', 'priority': 'Routine', 'nursing': {}}),
    ('interval 0', {'patientId': PID, 'category': 'Nursing', 'summary': 'x', 'priority': 'Routine', 'requiresImplementation': True, 'nursing': {'intervalMinutes': 0}}),
    ('interval 2881 (48 h + 1 min)', {'patientId': PID, 'category': 'Nursing', 'summary': 'x', 'priority': 'Routine', 'requiresImplementation': True, 'nursing': {'intervalMinutes': 2881}}),
    ('interval 1.5', {'patientId': PID, 'category': 'Nursing', 'summary': 'x', 'priority': 'Routine', 'requiresImplementation': True, 'nursing': {'intervalMinutes': 1.5}}),
    ('blank instructions', {'patientId': PID, 'category': 'Nursing', 'summary': '   ', 'priority': 'Routine', 'requiresImplementation': True, 'nursing': {}}),
    ('missing instructions', {'patientId': PID, 'category': 'Nursing', 'priority': 'Routine', 'requiresImplementation': True, 'nursing': {}}),
    ('unknown nursing field', {'patientId': PID, 'category': 'Nursing', 'summary': 'x', 'priority': 'Routine', 'requiresImplementation': True, 'nursing': {'every': 5}}),
]:
    st, b = create('', raw_draft=draft); check(st == 400, f'{label} -> 400 ({st}: {(b or {}).get("error", b) if isinstance(b, dict) else b})')
check(sql('select count(*) from "Orders"') == n0, 'no order created by any invalid draft')
o1, o2880 = mk('interval 1 min accepted', 1, sign=False), mk('interval 2880 min accepted', 2880, sign=False)
check(o1['nursing'] == {'intervalMinutes': 1, 'completions': []} and o2880['nursing']['intervalMinutes'] == 2880, 'bounds 1 and 2880 accepted; pending -> no current round')

print('== pending -> signed: round 1 open on signing')
st, b = impl(o1['orderId'], '2026-10-15T08:00:00.000Z~r1', 'attemptpend001')
check(st == 409 and 'pending' in b['error'], f'completing a PENDING repeating order -> 409 ({st})')
st, b = impl(o1['orderId'])
check(st == 400 and 'requires roundId and attemptId' in b['error'], f'empty request on a repeating order -> 400 ({st})')
st, signed = call('POST', f'/api/icu/orders/{o1["orderId"]}/sign', DOC)
r1 = signed['nursing']['currentRound']
sig = [e for e in signed['history'] if e['action'] == 'signed'][0]['time']
check(r1['number'] == 1 and r1['dueTime'] == sig.replace(' ', 'T') + ':00.000Z' and r1['roundId'] == r1['dueTime'] + '~r1',
      f'signed -> round 1 due at the signing minute, nursing stamp form ({r1["roundId"]})')

print('== the acceptance example: Done at :59.9xx, 1-minute interval -> next round at the next :59.9xx')
A = mk('acceptance 1-minute', 1)
while not (utcnow().second == 59 and utcnow().microsecond >= 880000): time.sleep(0.002)
sent = utcnow()
st, b = impl(A['orderId'], A['nursing']['currentRound']['roundId'], f'acc1{run}')
got = utcnow()
c1 = b['nursing']['completions'][0]; r2 = b['nursing']['currentRound']
done_t, due2 = NS(c1['completedTime']), NS(r2['dueTime'])
print(f'  sent {sent.isoformat()}  recorded {c1["completedTime"]}  next due {r2["dueTime"]}')
check(st == 200 and b['status'] == 'active' and r2['number'] == 2, 'Done -> 200, order stays active, round 2 current')
check(sent - timedelta(milliseconds=1) <= done_t <= got + timedelta(milliseconds=1), 'completedTime is the server clock at completion (ms precision, within the request)')
check(due2 - done_t == timedelta(minutes=1), f'next due = completion + exactly 60 000 ms ({(due2 - done_t).total_seconds()*1000:.0f} ms)')
check(due2.second == 59 and due2.microsecond >= 880000, f'round 2 opens at :59.{due2.microsecond//1000:03d} of the next minute — not at :00 (minute truncation gone)')
check(r2['roundId'] == r2['dueTime'] + '~r2', 'round identity = due (ms) + ~r2')
before = raw(A['orderId'])
while utcnow() < due2 - timedelta(milliseconds=40): time.sleep(0.002)
st, b = impl(A['orderId'], r2['roundId'], f'acc2early{run}')
check(st == 409 and 'not due yet' in b['error'] and r2['dueTime'] in b['error'], f'round 2 at due - 40 ms -> 409 not due yet ({st})')
check(raw(A['orderId']) == before, 'the early request wrote nothing (row byte-identical)')
while utcnow() < due2 + timedelta(milliseconds=3): time.sleep(0.001)
st, b = impl(A['orderId'], r2['roundId'], f'acc2{run}')
check(st == 200 and b['nursing']['currentRound']['number'] == 3, f'round 2 at due + 3 ms -> 200 ({st})')

print('== stale / double completion')
before = raw(A['orderId'])
st, b = impl(A['orderId'], r2['roundId'], f'acc2again{run}')
check(st == 409 and 'already completed by RN Maya Chen' in b['error'], f'round 2 again with a NEW attempt -> 409 already completed ({st})')
st, b = impl(A['orderId'], r2['roundId'], f'acc2{run}')
check(st == 200 and raw(A['orderId']) == before, 'round 2 again with the SAME attempt -> 200 replay, row byte-identical')
st, b = impl(A['orderId'], b['nursing']['currentRound']['roundId'], f'acc2{run}')
check(st == 409 and 'different completion' in b['error'] and raw(A['orderId']) == before, f'same attempt, different round -> 409, nothing written ({st})')

print('== concurrency')
C = mk('concurrency 1-minute', 1)
rc = C['nursing']['currentRound']['roundId']
res = []
def fire(aid): res.append(impl(C['orderId'], rc, aid))
ts = [threading.Thread(target=fire, args=(f'samecopy{run}',)) for _ in range(6)]
[t.start() for t in ts]; [t.join() for t in ts]
check(sorted(r[0] for r in res) == [200] * 6 and len(comps(C['orderId'])) == 1, '6 concurrent copies of ONE attempt -> 6 x 200, exactly 1 completion')
check(sum(1 for e in json.loads(sql(f'''select "HistoryJson" from "Orders" where "OrderId"='{C["orderId"]}' ''')) if e['action'] == 'implemented') == 1, '... and exactly 1 history entry')
D = mk('concurrency different attempts', 1)
rd = D['nursing']['currentRound']['roundId']; res = []
ts = [threading.Thread(target=lambda k=k: res.append(impl(D['orderId'], rd, f'diff{k}{run}'))) for k in range(5)]
[t.start() for t in ts]; [t.join() for t in ts]
check(sorted(r[0] for r in res) == [200, 409, 409, 409, 409] and len(comps(D['orderId'])) == 1, '5 concurrent DIFFERENT attempts on one round -> one 200, four 409, 1 completion')

print('== late completion creates no extra round; hours interval')
L = mk('late 1-minute', 1, sign=False)
call('POST', f'/api/icu/orders/{L["orderId"]}/sign', DOC)
h = json.loads(sql(f'''select "HistoryJson" from "Orders" where "OrderId"='{L["orderId"]}' '''))
for e in h:
    if e['action'] == 'signed': e['time'] = (utcnow() - timedelta(minutes=10)).strftime('%Y-%m-%d %H:%M')
sql(f'''update "Orders" set "HistoryJson"=$h${json.dumps(h, separators=(',', ':'))}$h$ where "OrderId"='{L["orderId"]}' ''')
lr = get(L['orderId'])['nursing']['currentRound']
check(lr['number'] == 1, f'signed 10 min ago (1-minute interval) -> still round 1 only (no clock-created rounds): {lr["roundId"]}')
st, b = impl(L['orderId'], lr['roundId'], f'late1{run}')
nd = b['nursing']['currentRound']
check(st == 200 and nd['number'] == 2 and NS(nd['dueTime']) - NS(b['nursing']['completions'][0]['completedTime']) == timedelta(minutes=1),
      'late completion -> round 2 due at completion + 1 min (not on the old grid)')
H = mk('hours interval 2 h', 120)
st, b = impl(H['orderId'], H['nursing']['currentRound']['roundId'], f'hours1{run}')
check(st == 200 and NS(b['nursing']['currentRound']['dueTime']) - NS(b['nursing']['completions'][0]['completedTime']) == timedelta(hours=2), '120-minute order -> next due completion + exactly 2 h')

print('== one-time nursing orders (new form)')
O1 = mk('one-time via round contract')
st, b = impl(O1['orderId'], O1['nursing']['currentRound']['roundId'], f'once1{run}')
check(st == 200 and b['status'] == 'completed' and 'currentRound' not in b['nursing'] and b['nursing']['completions'][0]['attemptId'] == f'once1{run}', 'one-time + round contract -> completed once, completion recorded, no current round')
before = raw(O1['orderId'])
st, b = impl(O1['orderId'], O1['nursing']['currentRound']['roundId'], f'once1{run}')
check(st == 200 and raw(O1['orderId']) == before, 'replay of the completing attempt -> 200, byte-identical')
st, b = impl(O1['orderId'], O1['nursing']['currentRound']['roundId'], f'once1other{run}')
check(st == 409 and 'already completed' in b['error'], f'another attempt on a completed one-time order -> 409 ({st})')
O2 = mk('one-time via empty request')
st, b = impl(O2['orderId'])
check(st == 200 and b['status'] == 'completed' and len(b['nursing']['completions']) == 1 and 'attemptId' not in b['nursing']['completions'][0], 'one-time + empty request -> completed, completion recorded without attempt')

print('== safe replay after discontinuation and after discharge')
X = mk('discontinue replay', 1)
rx = X['nursing']['currentRound']['roundId']
st, b = impl(X['orderId'], rx, f'disc1{run}')            # the "lost" answer
st, b = call('POST', f'/api/icu/orders/{X["orderId"]}/discontinue', DOC, {'reason': 'synthetic replay check'})
check(st == 200 and b['status'] == 'discontinued' and 'currentRound' not in b['nursing'], 'discontinued -> no current round')
before = raw(X['orderId'])
st, b = impl(X['orderId'], rx, f'disc1{run}')
check(st == 200 and b['status'] == 'discontinued' and raw(X['orderId']) == before, 'replay of the recorded attempt after discontinuation -> 200, nothing written')
st, b = impl(X['orderId'], b['nursing']['completions'][0]['roundId'].replace('~r1', '~r2'), f'disc2{run}')
check(st == 409, f'a new attempt after discontinuation -> 409 ({st})')
Y = mk('discharge replay', 5)
ry = Y['nursing']['currentRound']['roundId']
impl(Y['orderId'], ry, f'dis1{run}')
st, q = call('GET', '/api/icu/orders?implement=true', NUR)
check(any(o['orderId'] == Y['orderId'] and o['nursing']['currentRound']['number'] == 2 for o in q), 'implementation queue lists the active repeating order with round 2 (locked until due)')
legacy_mar = sql('''select count(*) from "Orders" where "Category"='Nursing' and "AdministrationsJson" is not null''')
check(legacy_mar == '0', 'no nursing order carries medication administrations (Done never writes AdministrationsJson)')
check(all(r['orderId'] not in (A['orderId'], C['orderId']) for r in call('GET', '/api/icu/mar', NUR)[1]), 'nursing orders never appear on the MAR')
st, b = call('POST', f'/api/icu/adt/encounters/{EID}/discharge', DOC, {})
check(st == 200, f'patient discharged ({st})')
yrow = get(Y['orderId'])
check(yrow['status'] == 'discontinued' and 'currentRound' not in yrow['nursing'], 'discharge discontinued the repeating order; no current round')
before = raw(Y['orderId'])
st, b = impl(Y['orderId'], ry, f'dis1{run}')
check(st == 200 and raw(Y['orderId']) == before, 'replay of the recorded attempt after discharge -> 200, nothing written')
st, b = impl(Y['orderId'], ry.replace('~r1', '~r2'), f'dis2{run}')
check(st == 409 and f"encounter '{EID}' is not open" in b['error'], f'a new attempt after discharge -> 409, encounter not open ({st})')
check(not any(o['orderId'] == Y['orderId'] for o in call('GET', '/api/icu/orders?implement=true', NUR)[1]), 'the implementation queue no longer lists it')

print('== request shape and RBAC')
PID2, EID2 = admit(DOC, f'Shape{run}')
PID_SAVE = PID; PID = PID2
Z = mk('shape checks', 3)
rz = Z['nursing']['currentRound']['roundId']
for label, body, want in [
    ('roundId without attemptId', {'roundId': rz}, 400), ('attemptId without roundId', {'attemptId': 'abcdefgh1'}, 400),
    ('attemptId too short', {'roundId': rz, 'attemptId': 'abc'}, 400), ('attemptId bad chars', {'roundId': rz, 'attemptId': 'abc def gh'}, 400),
    ('roundId in the minute form', {'roundId': rz[:16] + '~r1', 'attemptId': 'abcdefgh2'}, 400), ('unknown field', {'roundId': rz, 'attemptId': 'abcdefgh3', 'x': 1}, 400),
]:
    st, b = impl(Z['orderId'], body=body); check(st == want, f'{label} -> {want} ({st})')
st, b = call('POST', f'/api/icu/orders/{Z["orderId"]}/implement', NUR, raw_body=b'{not json')
check(st == 400, f'malformed JSON -> 400 ({st})')
st, b = call('POST', f'/api/icu/orders/{Z["orderId"]}/implement', NUR, raw_body=b'{}')
check(st == 400 and 'requires roundId' in b['error'], f'{{}} on a repeating order = the empty request -> 400 ({st})')
st, b = impl(Z['orderId'], rz, f'doc{run}', tok=DOC)
check(st == 403, f'doctor token -> 403 ({st})')
st, b = impl(Z['orderId'], rz, f'pha{run}', tok=PHA)
check(st == 403, f'pharmacist token -> 403 ({st})')
st, b = call('POST', '/api/icu/orders/ORD-0000/implement', NUR, {'roundId': rz, 'attemptId': 'absentprobe1'})
check(st == 404, f'absent order (authorised nurse) -> 404 ({st})')
# Amendment 2: an absent order is 404 WHATEVER the body (the deployed orders suite's generic probe)
for label, raw_b in [('{"reason":"x"} (the deployed suite probe)', b'{"reason":"x"}'), ('malformed JSON', b'{not json'), ('half a round contract', b'{"roundId":"x"}')]:
    st, b = call('POST', '/api/icu/orders/ORD-0000/implement', NUR, raw_body=raw_b)
    check(st == 404, f'absent order + {label} -> 404 ({st})')
st, b = call('POST', f'/api/icu/orders/{Z["orderId"]}/implement', NUR, raw_body=b'{"reason":"x"}')
check(st == 400 and 'must be empty or { roundId, attemptId }' in b['error'], f'existing order + {{"reason":"x"}} -> 400 unknown field ({st})')
st, b = impl(Z['orderId'], body={'roundId': rz[:16] + '~r1', 'attemptId': 'abcdefgh9'})
check(st == 400 and 'yyyy-MM-ddTHH:mm:ss.fffZ~r<n>' in b['error'], f'the malformed-roundId refusal names the millisecond form ({st})')
check(len(comps(Z['orderId'])) == 0, 'none of the refused requests wrote a completion')
# finite seeded resources (03 §E2E): free the shape patient's bed for the I&O check
st, b = call('POST', f'/api/icu/adt/encounters/{EID2}/discharge', DOC, {})
check(st == 200 and sql(f'''select "Status" from "Orders" where "OrderId"='{Z["orderId"]}' ''') == 'discontinued', f'shape patient discharged (bed freed; its order discontinued) ({st})')
st0 = load_state(); st0['rounds'] = {'pid': PID2, 'eid': EID2, 'order': Z['orderId'], 'acceptance': A['orderId']}; save_state(st0)
sys.exit(summary())
