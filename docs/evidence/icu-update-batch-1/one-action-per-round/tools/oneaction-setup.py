# Synthetic setup for the ONE-ACTION-PER-ROUND browser check (oneaction-browser.cjs):
# one synthetic patient on the local stack, seven orders, each with its own
# synthetic drug except the continuous insulin (the formulary's own
# insulin-actrapid, 2.5 U/h IV infusion — the owner's screenshot). Every
# repeating order's round 1 is made due 4 h ago by backdating its signed
# event (the one stated DB setup, as api-check-oneaction.py), then documented
# Given through the API with a delay reason and an explicit actual time, so
# its round 2 lands where the check needs it:
#   LOCK   round 2 due at D = the next minute + 3 min (the page must open it by itself)
#   RAPID / DIALOG / UNCREC / UNCNOT / STALE   round 2 due 1 min ago (open, one-click)
#   CONT   continuous insulin — the ON DEMAND row (no round)
# Writes the JSON the browser check reads. Usage: python3 oneaction-setup.py <out.json>
import json, os, subprocess, sys, time, urllib.request, urllib.error
from datetime import datetime, timedelta, timezone
API = 'http://localhost:8080'
PG = ['psql', '-h', 'localhost', '-U', 'aurora', '-d', os.environ.get('ONEACTION_DB', 'aurora_oneaction'), '-Atq', '-v', 'ON_ERROR_STOP=1']
ENV = {'PGPASSWORD': os.environ['AURORA_LOCAL_DB_PASSWORD'], 'PATH': '/usr/bin:/bin'}
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
utcnow = lambda: datetime.now(timezone.utc).replace(tzinfo=None)
DOC, NUR, PHA = login('sara.rahman'), login('maya.chen'), login('samir.qassem')
if utcnow().second > 40: time.sleep(22)
now = utcnow().replace(second=0, microsecond=0)
F = now.replace(minute=0) - timedelta(hours=4)
run = utcnow().strftime('%H%M%S')
free = [b['bedId'] for b in call('GET', '/api/icu/adt/beds', DOC)[1] if not b.get('patientId')][0]
st, adm = call('POST', '/api/icu/adt/admissions', DOC, {'nameFirst': 'Synthetic', 'nameSecond': 'Oneaction', 'nameFamily': f'Browser{run}', 'age': 63, 'sex': 'M',
    'allergies': 'None known', 'bedId': free, 'diagnosis': 'synthetic one-action browser check', 'attending': 'Dr. Sara Rahman'})
assert st == 200, (st, adm)
PID, EID = adm['patient']['patientId'], adm['encounter']['encounterId']
def order(med, backdate):
    st, o = call('POST', '/api/icu/orders', DOC, {'drafts': [{'patientId': PID, 'category': 'Medication', 'priority': 'Routine', 'medication': med}], 'sign': True})
    assert st == 200, (st, o)
    oid = o[0]['orderId']
    if backdate:
        h = json.loads(sql(f"""select "HistoryJson" from "Orders" where "OrderId"='{oid}'"""))
        for e in h:
            if e['action'] == 'signed': e['time'] = S(F - timedelta(minutes=30))
        sql(f"""update "Orders" set "HistoryJson"=$h${json.dumps(h, separators=(',', ':'), ensure_ascii=False)}$h$ where "OrderId"='{oid}'""")
    return oid
orders = {}
D = now + timedelta(minutes=4)   # the LOCK round's due minute: >= 3 min from now
for k, round2 in (('LOCK', D), ('RAPID', now - timedelta(minutes=1)), ('DIALOG', now - timedelta(minutes=1)),
                  ('UNCREC', now - timedelta(minutes=1)), ('UNCNOT', now - timedelta(minutes=1)), ('STALE', now - timedelta(minutes=1))):
    drug = f'one-b-{k.lower()}-{run}'
    st, _ = call('POST', '/api/icu/formulary', PHA, {'drugId': drug, 'name': f'Syn {k.title()} {run}', 'brandNames': [], 'drugClass': f'SynB{k}{run}',
        'form': 'vial', 'strengths': ['1 mg'], 'doses': ['1 mg'], 'defaultDose': '1 mg', 'routes': ['IV'], 'frequencies': ['q1h'],
        'prnCapable': False, 'allergyBlock': [], 'allergyWarn': []})
    assert st in (200, 201), (k, st)
    oid = order({'drugId': drug, 'drug': f'Syn {k.title()} {run}', 'dose': '1 mg', 'route': 'IV', 'frequency': 'q1h', 'duration': 'ongoing', 'prn': False}, True)
    st, b = call('POST', f'/api/icu/mar/{oid}/administrations/{F.strftime("%Y-%m-%dT%H:%M")}~r1', NUR,
                 {'action': 'given', 'reason': 'synthetic: first dose delayed (setup)', 'administeredAt': S(round2 - timedelta(hours=1))})
    assert st == 200, (k, st, b)
    cur = [r for r in call('GET', '/api/icu/mar', NUR)[1] if r['orderId'] == oid and r['status'] == 'scheduled'][0]
    assert cur['scheduledTime'] == S(round2), (k, cur, S(round2))
    orders[k] = {'oid': oid, 'round2': cur['adminId'], 'due': cur['scheduledTime']}
oid = order({'drugId': 'insulin-actrapid', 'drug': 'Insulin (Actrapid)', 'dose': '2.5 U/h', 'route': 'IV infusion', 'frequency': 'continuous', 'duration': 'ongoing', 'prn': False}, False)
orders['CONT'] = {'oid': oid, 'round2': 'ondemand', 'due': ''}
out = {'pid': PID, 'eid': EID, 'run': run, 'setupAtUtc': S(now), 'lockDueUtc': S(D), 'orders': orders}
json.dump(out, open(sys.argv[1], 'w'), indent=1)
print(json.dumps(out, indent=1))
