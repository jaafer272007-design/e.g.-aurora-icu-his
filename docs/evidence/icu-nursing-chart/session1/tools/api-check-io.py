# REAL-API + PostgreSQL check of the I&O manual snapshots (contracts §5 + Amendment 1 §9.3):
# the two catalogue types charted through the existing observations API, latest-by-entry
# replacement 500 -> 200 with history kept, explicit zero, missing values, balance only when both
# exist, amendment handling, permissions, the existing callers unchanged, and the admission
# binding: a form loaded for admission A, then discharge + readmission B before submission ->
# the stale save is 409 and creates nothing in B (or A). The client derivation is the SHIPPED
# deriveIoView, run by io-derive.mjs on the real reads.
import json, os, subprocess, sys
from common import *
DOC, NUR, PHA = login('sara.rahman'), login('maya.chen'), login('samir.qassem')
run = utcnow().strftime('%H%M%S')
IN, OUT = 'io_current_intake_ml', 'io_current_output_ml'
def chart(pid, entries, expected=None, tok=None):
    body = {'patientId': pid, 'entries': entries, **({'expectedEncounterId': expected} if expected is not None else {})}
    return call('POST', '/api/icu/observations', tok or NUR, body)
def reads(pid, eid):
    out = []
    for code in (IN, OUT):
        st, b = call('GET', f'/api/icu/observations?patientId={pid}&encounterId={eid}&typeCode={code}', NUR); assert st == 200, st; out += b
    return out
def view(pid, eid):
    r = subprocess.run(['node', os.path.join(os.path.dirname(__file__), 'io-derive.mjs')], input=json.dumps({'patientId': pid, 'encounterId': eid, 'observations': reads(pid, eid)}),
                       capture_output=True, text=True, check=True, env={**os.environ})
    return json.loads(r.stdout)
def count(pid, eid=None):
    enc = f'''and "EncounterId"='{eid}' ''' if eid else ''
    return int(sql(f'''select count(*) from "Observations" where "PatientId"='{pid}' and "TypeCode" in ('{IN}','{OUT}') {enc}'''))

cat = {t['typeCode']: (g['groupCode'], t) for g in call('GET', '/api/icu/observations/catalog', NUR)[1] for t in g['types']}
check(cat[IN][0] == 'nursing' and cat[OUT][0] == 'nursing' and cat[IN][1]['unit'] == 'mL' and not cat[IN][1]['scoreInput'], 'catalogue serves both types (nursing group, mL, not score inputs)')
check(all(c not in (cat['total_input'][1].get('derivationInputs') or []) + (cat['total_output'][1].get('derivationInputs') or []) for c in (IN, OUT)),
      'the derived fluid totals do not take the snapshot types as inputs')

PID, EA = admit(DOC, f'Io{run}')
print(f'admitted synthetic {PID} ({EA})')
v = view(PID, EA)
check(v['intake'] is None and v['output'] is None and v['balanceMl'] is None and v['history'] == [], 'new admission: both Not recorded, no balance, empty history')

print('== admission binding (writes nothing on refusal)')
st, b = chart(PID, [{'typeCode': IN, 'value': 500}])
check(st == 400 and 'expectedEncounterId is required' in b['error'] and count(PID) == 0, f'I&O without expectedEncounterId -> 400, nothing written ({st})')
st, b = chart(PID, [{'typeCode': IN, 'value': 500}], expected='ENC-NOPE')
check(st == 409 and 'nothing was recorded' in b['error'] and count(PID) == 0, f'I&O with a wrong expectedEncounterId -> 409, nothing written ({st})')
st, b = chart(PID, [{'typeCode': IN, 'value': 500}], expected='  ')
check(st == 400 and count(PID) == 0, f'blank expectedEncounterId -> 400 ({st})')

print('== replacement 500 -> 200, explicit zero, balance')
st, b = chart(PID, [{'typeCode': IN, 'value': 500}], expected=EA)
check(st == 200 and b[0]['encounterId'] == EA and b[0]['value'] == '500' and b[0]['source'] == 'manual' and b[0]['recordedBy'] == 'RN Maya Chen', 'intake 500 charted (server-stamped, manual, recorder from the token)')
v = view(PID, EA)
check(v['intake']['valueMl'] == 500 and v['output'] is None and v['balanceMl'] is None, 'intake 500 shown; output Not recorded; no balance with one value missing')
st, b = chart(PID, [{'typeCode': IN, 'value': 200}], expected=EA)
v = view(PID, EA)
check(st == 200 and v['intake']['valueMl'] == 200 and [h['valueMl'] for h in v['history']] == [200, 500], 'entering 200 after 500 displays 200; 500 stays in history (newest first)')
st, b = chart(PID, [{'typeCode': OUT, 'value': 0}], expected=EA)
v = view(PID, EA)
check(st == 200 and b[0]['value'] == '0' and v['output']['valueMl'] == 0 and v['balanceMl'] == 200, 'explicit zero output is a value (not missing): balance 200 - 0 = 200')
st, b = chart(PID, [{'typeCode': IN, 'value': 300}, {'typeCode': OUT, 'value': 120}], expected=EA)
v = view(PID, EA)
check(st == 200 and b[0]['clinicalTime'] == b[1]['clinicalTime'] and v['intake']['valueMl'] == 300 and v['output']['valueMl'] == 120 and v['balanceMl'] == 180,
      'both values in one save share one clinical time; balance 300 - 120 = 180')
print('== shape, range, permission, existing callers')
for label, entries, want in [('20001 mL', [{'typeCode': IN, 'value': 20001}], 400), ('-1 mL', [{'typeCode': OUT, 'value': -1}], 400)]:
    n = count(PID); st, b = chart(PID, entries, expected=EA); check(st == want and count(PID) == n, f'{label} -> {want}, nothing written ({st})')
n = count(PID); st, b = chart(PID, [{'typeCode': IN, 'value': 50}], expected=EA, tok=PHA)
check(st == 403 and count(PID) == n, f'pharmacist (no observations.record) -> 403 ({st})')
st, b = chart(PID, [{'typeCode': 'hr', 'value': 82}])
check(st == 200 and b[0]['typeCode'] == 'hr', 'an existing caller (hr, no expectedEncounterId) -> 200, unchanged')
st, b = chart(PID, [{'typeCode': 'hr', 'value': 84}], expected='ENC-NOPE')
check(st == 409, f'any caller MAY send the check: hr with a wrong expectedEncounterId -> 409 ({st})')
print('== amendments: effective value; an amended older snapshot never becomes current')
latest_in = [h for h in v['history'] if h['kind'] == 'intake'][0]['observationId']
st, b = call('POST', f'/api/icu/observations/{latest_in}/correct', NUR, {'value': 310})
v = view(PID, EA)
check(st == 200 and v['intake']['valueMl'] == 310 and v['intake']['originalValueMl'] == 300 and v['balanceMl'] == 190, 'self-correction 300 -> 310: current 310 (original 300 kept), balance 190')
oldest_in = [h for h in v['history'] if h['kind'] == 'intake'][-1]['observationId']
st, b = call('POST', f'/api/icu/observations/{oldest_in}/correct', DOC, {'value': 550, 'reason': 'synthetic transcription check'})
v = view(PID, EA)
check(st == 200 and v['intake']['valueMl'] == 310 and [h['valueMl'] for h in v['history'] if h['kind'] == 'intake'] == [310, 200, 550],
      'amending the OLDEST snapshot (500 -> 550) leaves the latest (310) current; history shows effective values')

print('== discharge + readmission: the stale form for A cannot chart into B')
form_encounter = EA                                   # the form was loaded for admission A
view_a_before = view(PID, EA)
n_a = count(PID, EA)
st, b = call('POST', f'/api/icu/adt/encounters/{EA}/discharge', DOC, {}); check(st == 200, f'A discharged ({st})')
free = [x['bedId'] for x in call('GET', '/api/icu/adt/beds', DOC)[1] if not x.get('patientId') and x.get('active', True)][0]
st, adm = call('POST', '/api/icu/adt/admissions', DOC, {'patientId': PID, 'diagnosis': 'synthetic readmission', 'attending': 'Dr. Sara Rahman', 'bedId': free})
EB = adm['encounter']['encounterId'] if st in (200, 201) else None
check(EB is not None and EB != EA, f'same patient readmitted as B ({EB})')
st, b = chart(PID, [{'typeCode': IN, 'value': 999}, {'typeCode': OUT, 'value': 111}], expected=form_encounter)
check(st == 409 and EA in b['error'] and EB in b['error'] and 'nothing was recorded' in b['error'], f'the stale save (expected A) -> 409 naming A and B ({st})')
check(count(PID, EB) == 0 and count(PID, EA) == n_a, 'nothing created in B, nothing added to A')
vb = view(PID, EB)
check(vb['intake'] is None and vb['output'] is None and vb['balanceMl'] is None and vb['history'] == [], 'admission B starts blank (Not recorded)')
va = view(PID, EA)
check(va == view_a_before and va['intake']['valueMl'] == 310 and len(va['history']) == 5, "admission A's values and full history (5 snapshots) unchanged under A")
st, b = chart(PID, [{'typeCode': IN, 'value': 40}], expected=EB)
vb = view(PID, EB)
check(st == 200 and vb['intake']['valueMl'] == 40 and vb['output'] is None and len(vb['history']) == 1, 'a save bound to B -> 200; B shows only its own value')
st0 = load_state(); st0['io'] = {'pid': PID, 'ea': EA, 'eb': EB, 'viewA': va, 'viewB': vb}; save_state(st0)
sys.exit(summary())
