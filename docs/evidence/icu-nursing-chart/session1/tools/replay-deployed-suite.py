# Replays a deployed-*-e2e.yml suite's `run:` steps VERBATIM against the LOCAL synthetic stack
# (a regression check of the endpoints this branch changed; no deployed service is touched).
#   python3 replay-deployed-suite.py <workflow.yml> <source commit of the running build>
# Emulated: the workflow env (API -> the local server), GITHUB_ENV between steps, GITHUB_SHA,
# GITHUB_RUN_ID, bash -eo pipefail per step, `if: always()` cleanup after a failure.
# Not replayed: actions/checkout (we are in the checkout) and the deployed-content freshness gate,
# which resolves Render's served commit; it is replaced by an exact local build-identity check
# (/healthz build == "<commit>-local", run-server.sh's local stamp).
import json, os, subprocess, sys, tempfile, time, urllib.request
import yaml
wf, commit = sys.argv[1], sys.argv[2]
w = yaml.safe_load(open(wf))
api = os.environ.get('NURSING_API', 'http://localhost:8080')
env = {**os.environ, **{k: str(v) for k, v in (w.get('env') or {}).items()}, 'API': api,
       'GITHUB_SHA': commit, 'GITHUB_RUN_ID': 'local' + time.strftime('%H%M%S')}
fd, genv = tempfile.mkstemp(prefix='github_env_'); os.close(fd); env['GITHUB_ENV'] = genv
def load_github_env():
    lines, i, out = open(genv).read().split('\n'), 0, {}
    while i < len(lines):
        l = lines[i]
        if '<<' in l and '=' not in l.split('<<')[0]:
            k, delim = l.split('<<', 1); i += 1; buf = []
            while i < len(lines) and lines[i] != delim: buf.append(lines[i]); i += 1
            out[k] = '\n'.join(buf)
        elif '=' in l:
            k, v = l.split('=', 1); out[k] = v
        i += 1
    return out
health = json.load(urllib.request.urlopen(api + '/healthz'))
print(f'replaying {os.path.basename(wf)} against {api}: build={health["build"]} environment={health["environment"]}', flush=True)
failed = []
for job in w['jobs'].values():
    for st in job['steps']:
        name = st.get('name', st.get('uses', ''))
        if 'uses' in st:
            print(f'\n== SKIP (uses {st["uses"]}): {name}'); continue
        if 'SERVER CONTENT' in name:
            ok = health['build'] == f'{commit}-local'
            print(f'\n== REPLACED: {name}\n   local build identity: /healthz build {health["build"]} == {commit}-local -> {"OK" if ok else "MISMATCH"}')
            if not ok: failed.append(name)
            continue
        if failed and 'always()' not in str(st.get('if', '')):
            print(f'\n== SKIP (an earlier step failed): {name}'); continue
        print(f'\n== STEP: {name}', flush=True)
        r = subprocess.run(['bash', '--noprofile', '--norc', '-eo', 'pipefail', '-c', st['run']],
                           env={**env, **load_github_env(), **{k: str(v) for k, v in (st.get('env') or {}).items()}})
        print(f'-- {"OK" if r.returncode == 0 else f"FAILED (exit {r.returncode})"}', flush=True)
        if r.returncode: failed.append(name)
print(f'\nRESULT: {"all replayed steps passed" if not failed else "FAILED: " + "; ".join(failed)}')
sys.exit(1 if failed else 0)
