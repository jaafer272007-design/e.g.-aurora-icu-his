# Session 1 shared helpers for the real-API + PostgreSQL checks (synthetic data, local only).
import json, os, subprocess, urllib.request, urllib.error
from datetime import datetime, timezone
API = os.environ.get('NURSING_API', 'http://localhost:8080')
DB = os.environ.get('NURSING_DB', 'aurora_nursing1')
SCRATCH = os.environ['SCRATCH']
PG = ['psql', '-h', 'localhost', '-U', 'aurora', '-d', DB, '-Atq', '-v', 'ON_ERROR_STOP=1']
ENV = {'PGPASSWORD': open(os.path.join(SCRATCH, 'db.pw')).read().strip(), 'PATH': '/usr/bin:/bin'}
STATE = os.path.join(SCRATCH, 'nursing-state.json')
fails = 0; passes = 0
def check(cond, msg):
    global fails, passes
    print(('  PASS ' if cond else '  FAIL ') + msg, flush=True)
    if cond: passes += 1
    else: fails += 1
def call(method, path, tok=None, body=None, raw_body=None, content_type='application/json'):
    data = raw_body if raw_body is not None else (None if body is None else json.dumps(body).encode())
    headers = {**({'Content-Type': content_type} if data is not None else {}), **({'Authorization': 'Bearer ' + tok} if tok else {})}
    req = urllib.request.Request(API + path, method=method, data=data, headers=headers)
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read() or 'null')
    except urllib.error.HTTPError as e:
        raw = e.read()
        try: return e.code, (json.loads(raw) if raw else None)
        except ValueError: return e.code, raw.decode(errors='replace')
def login(u): return call('POST', '/api/auth/login', body={'username': u, 'password': 'Aurora2026!'})[1]['token']
def sql(q): return subprocess.run(PG + ['-c', q], env=ENV, capture_output=True, text=True, check=True).stdout.strip()
def utcnow(): return datetime.now(timezone.utc).replace(tzinfo=None)
def load_state():
    return json.load(open(STATE)) if os.path.exists(STATE) else {}
def save_state(s): json.dump(s, open(STATE, 'w'), indent=1)
def admit(doc, tag):
    free = [b['bedId'] for b in call('GET', '/api/icu/adt/beds', doc)[1] if not b.get('patientId') and b.get('active', True)]
    st, adm = call('POST', '/api/icu/adt/admissions', doc, {'nameFirst': 'Synthetic', 'nameSecond': 'Nursing', 'nameFamily': tag,
        'age': 58, 'sex': 'F', 'allergies': 'None known', 'bedId': free[0], 'diagnosis': 'synthetic nursing-order / I&O check',
        'attending': 'Dr. Sara Rahman'})
    assert st in (200, 201), (st, adm)
    return adm['patient']['patientId'], adm['encounter']['encounterId']
def summary():
    print(f'\nRESULT: {passes} passed, {fails} failed', flush=True)
    return 1 if fails else 0
