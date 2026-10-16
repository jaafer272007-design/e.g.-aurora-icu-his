# REAL-API + PostgreSQL persistence across a server restart (synthetic data, local only).
#   python3 restart-check.py pre    -> on the NEW admission (I&O readmission B) sign a repeating
#                                      1-minute nursing order and complete round 1, then snapshot
#                                      every nursing order + both I&O views (API and stored rows)
#   (restart the server process)
#   python3 restart-check.py post   -> everything identical after the restart; the current round is
#                                      re-derived to the millisecond; a replay of a pre-restart
#                                      attempt is still recognised; the order / observation
#                                      counters continue (no duplicate keys); round 2 opens at
#                                      exactly completion 1 + 60 000 ms and completes.
import json, os, re, subprocess, sys, time
from common import *
DOC, NUR = login('sara.rahman'), login('maya.chen')
phase = sys.argv[1]
s = load_state()
IO = s['io']
IO_TYPES = ('io_current_intake_ml', 'io_current_output_ml')
def orders(pid): st, b = call('GET', f'/api/icu/orders?patientId={pid}', NUR); assert st == 200, st; return b
def nursing_orders():
    # every order of every patient involved: the legacy pre-upgrade patient + each patient holding a nursing order
    pids = {s['legacy']['pid'], IO['pid'], *sql('select distinct "PatientId" from "Orders" where "NursingJson" is not null').split()}
    return {o['orderId']: o for pid in sorted(pids) for o in orders(pid)}
def stored(): return sql('''select coalesce(json_agg(json_build_object('id', "OrderId", 'status', "Status", 'nursing', "NursingJson", 'history', "HistoryJson") order by "OrderId"), '[]') from "Orders" where "NursingJson" is not null''')
def io_view(eid):
    obs = []
    for code in IO_TYPES:
        st, b = call('GET', f'/api/icu/observations?patientId={IO["pid"]}&encounterId={eid}&typeCode={code}', NUR); assert st == 200, st; obs += b
    r = subprocess.run(['node', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'io-derive.mjs')], check=True, capture_output=True, text=True,
                       input=json.dumps({'patientId': IO['pid'], 'encounterId': eid, 'observations': obs}), env={**os.environ})
    return json.loads(r.stdout)
def num(i): return int(re.sub(r'\D', '', i))
def max_ids():
    # generated order ids are ORD-101+ (the seed block ORD-2001+ is disjoint, OrderLogic.NextOrderId)
    return {'order': max(n for n in (num(x) for x in sql('select "OrderId" from "Orders"').split()) if n < 2001),
            'obs': max(num(x) for x in sql('select "ObservationId" from "Observations"').split())}
def ms(stamp): return datetime.strptime(stamp, '%Y-%m-%dT%H:%M:%S.%fZ').replace(tzinfo=timezone.utc).timestamp() * 1000

if phase == 'pre':
    st, o = call('POST', '/api/icu/orders', DOC, {'drafts': [{'patientId': IO['pid'], 'category': 'Nursing', 'summary': 'Restart check: oral care',
        'priority': 'Routine', 'requiresImplementation': True, 'nursing': {'intervalMinutes': 1}}], 'sign': True})
    check(st == 200 and o[0]['encounterId'] == IO['eb'], f'repeating 1-minute nursing order signed on the NEW admission {IO["eb"]} ({st})')
    o = o[0]; r1 = o['nursing']['currentRound']
    st, b = call('POST', f'/api/icu/orders/{o["orderId"]}/implement', NUR, {'roundId': r1['roundId'], 'attemptId': 'restartpre0001'})
    check(st == 200 and len(b['nursing']['completions']) == 1, f'round 1 completed before the restart ({st})')
    s['restart'] = {'order': o['orderId'], 'pre': nursing_orders(), 'stored': stored(), 'ioA': io_view(IO['ea']), 'ioB': io_view(IO['eb']),
                    'ids': max_ids(), 'round1': r1['roundId']}
    check(s['restart']['pre'][o['orderId']]['nursing']['currentRound']['number'] == 2, 'pre-restart: round 2 is the current round')
    print(f"snapshot: {len(s['restart']['pre'])} orders ({sum('nursing' in o for o in s['restart']['pre'].values())} nursing), I&O A/B views, max ids {s['restart']['ids']}")
    save_state(s)
    sys.exit(summary())

R = s['restart']; oid = R['order']
post = nursing_orders()
check(post == R['pre'], f'every order identical after the restart via the API ({len(post)} orders incl. legacy: completions, current rounds, history)')
check(stored() == R['stored'], 'stored nursing rows (NursingJson, history, status) byte-identical after the restart')
cur = post[oid]['nursing']['currentRound']; c1 = post[oid]['nursing']['completions'][0]
check(ms(cur['dueTime']) == ms(c1['completedTime']) + 60_000 and cur['roundId'].endswith('~r2'), f'current round re-derived exactly: due {cur["dueTime"]} = completed {c1["completedTime"]} + 60 000 ms')
check(io_view(IO['ea']) == R['ioA'] and io_view(IO['eb']) == R['ioB'], 'I&O views for admission A and the new admission B identical after the restart')
before = stored()
st, b = call('POST', f'/api/icu/orders/{oid}/implement', NUR, {'roundId': R['round1'], 'attemptId': 'restartpre0001'})
check(st == 200 and stored() == before, f'replay of the pre-restart attempt -> 200, nothing written ({st})')

print('== counters continue (no duplicate keys)')
st, o = call('POST', '/api/icu/orders', DOC, {'drafts': [{'patientId': IO['pid'], 'category': 'Nursing', 'summary': 'Restart check: post-restart order',
    'priority': 'Routine', 'requiresImplementation': True, 'nursing': {}}], 'sign': True})
check(st == 200 and num(o[0]['orderId']) > R['ids']['order'], f'new order after the restart -> {o[0]["orderId"] if st == 200 else st} (> previous max {R["ids"]["order"]})')
st, b = call('POST', '/api/icu/observations', NUR, {'patientId': IO['pid'], 'expectedEncounterId': IO['eb'], 'entries': [{'typeCode': 'io_current_output_ml', 'value': 75}]})
check(st == 200 and num(b[0]['observationId']) > R['ids']['obs'] and b[0]['encounterId'] == IO['eb'], f'new I&O value after the restart -> {b[0]["observationId"] if st == 200 else st} (> previous max {R["ids"]["obs"]}), bound to B')
vb = io_view(IO['eb'])
check(vb['output']['valueMl'] == 75 and vb['intake'] == R['ioB']['intake'] and vb['balanceMl'] == R['ioB']['intake']['valueMl'] - 75, 'B now shows the new output with its earlier intake; balance computed')

print('== round 2 opens exactly at completion 1 + interval')
due = ms(cur['dueTime'])
now = time.time() * 1000
if now < due - 300:
    st, b = call('POST', f'/api/icu/orders/{oid}/implement', NUR, {'roundId': cur['roundId'], 'attemptId': 'restartpost001'})
    check(st == 409 and 'not due yet' in b['error'], f'round 2 before its due time -> 409 not due yet ({st})')
else:
    print('  (round 2 already open when post ran — the early refusal is covered by api-check-nursing)')
while time.time() * 1000 < due + 50: time.sleep(0.05)
st, b = call('POST', f'/api/icu/orders/{oid}/implement', NUR, {'roundId': cur['roundId'], 'attemptId': 'restartpost002'})
c2 = b['nursing']['completions'][-1] if st == 200 else None
check(st == 200 and c2['round'] == 2 and ms(c2['dueTime']) == due and b['nursing']['currentRound']['number'] == 3
      and ms(b['nursing']['currentRound']['dueTime']) == ms(c2['completedTime']) + 60_000, f'round 2 completed after the restart; round 3 due = completion 2 + 60 000 ms ({st})')
check(sql(f'''select coalesce("AdministrationsJson", 'NULL') from "Orders" where "OrderId"='{oid}' ''') == 'NULL' and
      all(r['orderId'] != oid for r in call('GET', '/api/icu/mar', NUR)[1]), 'nursing Done wrote no administrations; the order is not on the MAR')
sys.exit(summary())
