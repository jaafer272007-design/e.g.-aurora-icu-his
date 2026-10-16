# Replays a deployed-*-e2e workflow's steps against the LOCAL synthetic stack.
# Skipped, stated: step 0 (checkout — this is the working tree), step 1 (the
# ENVIRONMENT GATE — it asserts the retired hosted staging URL), step 2 (the
# build-content gate — it polls the retired hosted service). API is overridden
# to http://localhost:8080; the hosted service is never contacted.
import os, subprocess, sys, tempfile, yaml
wf = yaml.safe_load(open(sys.argv[1]))
job = wf['jobs']['e2e']
env = dict(os.environ)
env.update({k: str(v) for k, v in (wf.get('env') or {}).items()})
env['API'] = 'http://localhost:8080'
# Actions supplies a unique run id; the suites name their run-scoped resources with it
import time as _t
env.setdefault('GITHUB_RUN_ID', 'local' + str(int(_t.time())))
genv = tempfile.NamedTemporaryFile(delete=False).name
env['GITHUB_ENV'] = genv
failed = False
for i, st in enumerate(job['steps']):
    name = st.get('name', '')
    if i < 3:
        print(f'SKIP  [{i}] {name[:90]}'); continue
    cond = st.get('if')
    if failed and not (cond and 'always()' in cond):
        print(f'NOT RUN (earlier failure) [{i}] {name[:80]}'); continue
    open(genv, 'w').close()
    r = subprocess.run(['bash', '-e', '-o', 'pipefail', '-c', st['run']], env=env, capture_output=True, text=True, cwd='/home/user/e.g.-aurora-icu-his')
    for line in open(genv):
        if '=' in line:
            k, v = line.rstrip('\n').split('=', 1); env[k] = v
    status = 'PASS' if r.returncode == 0 else f'FAIL(exit {r.returncode})'
    print(f'{status}  [{i}] {name[:90]}')
    out = (r.stdout + r.stderr).strip()
    if out: print('      ' + out.replace('\n', '\n      ')[:4000])
    if r.returncode != 0: failed = True
print('SUITE', 'FAILED' if failed else 'PASSED')
sys.exit(1 if failed else 0)
