# Discharge the synthetic encounter a saferetry-setup.py run admitted (frees its bed — the local
# seed has few free beds). Usage: python3 saferetry-cleanup.py <setup.json>
import json, sys, urllib.request
API = 'http://localhost:8080'
eid = json.load(open(sys.argv[1]))['eid']
tok = json.loads(urllib.request.urlopen(urllib.request.Request(API + '/api/auth/login', method='POST', headers={'Content-Type': 'application/json'},
      data=json.dumps({'username': 'sara.rahman', 'password': 'Aurora2026!'}).encode())).read())['token']
r = urllib.request.urlopen(urllib.request.Request(f'{API}/api/icu/adt/encounters/{eid}/discharge', method='POST', headers={'Authorization': 'Bearer ' + tok}))
print('discharged', eid, '->', r.status)
