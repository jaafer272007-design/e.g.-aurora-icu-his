# Synthetic setup for the rolling-timer browser check (real endpoints; one
# stated DB touch: backdating each order's "signed" event so round 1 is due
# at H0-1h). Leaves the patient ADMITTED for the browser; prints JSON.
import json, subprocess, urllib.request, urllib.error
from datetime import datetime, timedelta, timezone
API = 'http://localhost:8080'
PG = ['psql', '-h', 'localhost', '-U', 'aurora', '-d', 'aurora_rolling', '-Atq', '-v', 'ON_ERROR_STOP=1']
ENV = {'PGPASSWORD': __import__('os').environ['AURORA_LOCAL_DB_PASSWORD'], 'PATH': '/usr/bin:/bin'}
def call(m, p, t=None, b=None):
    r = urllib.request.Request(API + p, method=m, data=None if b is None else json.dumps(b).encode(), headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + t} if t else {})})
    with urllib.request.urlopen(r) as x: return json.loads(x.read() or 'null')
def sql(q): return subprocess.run(PG + ['-c', q], env=ENV, capture_output=True, text=True, check=True).stdout.strip()
S = lambda t: t.strftime('%Y-%m-%d %H:%M')
login = lambda u: call('POST', '/api/auth/login', b={'username': u, 'password': 'Aurora2026!'})['token']
DOC, NUR, PHA = login('sara.rahman'), login('maya.chen'), login('samir.qassem')
now = datetime.now(timezone.utc).replace(second=0, microsecond=0, tzinfo=None); H0 = now.replace(minute=0); run = now.strftime('%H%M')
F = H0 - timedelta(hours=1)
for k in 'GHW':
    call('POST', '/api/icu/formulary', PHA, {'drugId': f'disp-{k.lower()}-{run}', 'name': f'Display {k} {run}', 'brandNames': [], 'drugClass': f'DispClass{k}{run}',
        'form': 'vial', 'strengths': ['1 mg'], 'doses': ['1 mg'], 'defaultDose': '1 mg', 'routes': ['IV'], 'frequencies': ['q1h', 'q8h'], 'prnCapable': False, 'allergyBlock': [], 'allergyWarn': []})
free = [b['bedId'] for b in call('GET', '/api/icu/adt/beds', DOC) if not b.get('patientId')][0]
adm = call('POST', '/api/icu/adt/admissions', DOC, {'nameFirst': 'Synthetic', 'nameSecond': 'Rolling', 'nameFamily': f'Display{run}', 'age': 57, 'sex': 'F',
    'allergies': 'None known', 'bedId': free, 'diagnosis': 'synthetic rolling-timer display check', 'attending': 'Dr. Sara Rahman'})
PID = adm['patient']['patientId']
def order(k, freq, backdate=True):
    med = {'drugId': f'disp-{k.lower()}-{run}', 'drug': f'Display {k} {run}', 'dose': '1 mg', 'route': 'IV', 'frequency': freq, 'duration': 'ongoing', 'prn': False}
    oid = call('POST', '/api/icu/orders', DOC, {'drafts': [{'patientId': PID, 'category': 'Medication', 'priority': 'Routine', 'medication': med}], 'sign': True})[0]['orderId']
    if backdate:
        h = json.loads(sql(f"""select "HistoryJson" from "Orders" where "OrderId"='{oid}'"""))
        for e in h:
            if e['action'] == 'signed': e['time'] = S(F - timedelta(minutes=30))
        sql(f"""update "Orders" set "HistoryJson"=$h${json.dumps(h, separators=(',', ':'), ensure_ascii=False)}$h$ where "OrderId"='{oid}'""")
    return oid
G = order('G', 'q1h'); Hd = order('H', 'q1h'); W = order('W', 'q8h', backdate=False)
act = F + timedelta(minutes=5)
call('POST', f'/api/icu/mar/{G}/administrations/{F.strftime("%Y-%m-%dT%H:%M")}~r1', NUR, {'action': 'given', 'administeredAt': S(act)})
call('POST', f'/api/icu/mar/{Hd}/administrations/{F.strftime("%Y-%m-%dT%H:%M")}~r1', NUR, {'action': 'held', 'reason': 'synthetic: SBP 82'})
print(json.dumps({'pid': PID, 'name': f'Display{run}', 'given': {'order': G, 'actualUtc': S(act), 'nextUtc': S(act + timedelta(hours=1))},
                  'held': {'order': Hd, 'slotUtc': S(F), 'nextUtc': S(F + timedelta(hours=1))}, 'waiting': {'order': W}}))
