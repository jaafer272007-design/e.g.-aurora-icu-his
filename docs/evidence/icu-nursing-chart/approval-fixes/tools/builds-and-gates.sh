#!/bin/bash
# The required final builds + ci.yml gates, ONCE, over a clean worktree of the final source commit
# (arg 1), plus the production + staging bundles the focused legs serve, the server publish, and the
# PRE-FIX production bundle (arg 2: a worktree of the reviewed head) used only to reproduce both
# defects on the real UI.   builds-and-gates.sh <fixed worktree> <reviewed-head worktree>
set -u
S=${SCRATCH:?}; W=${1:?}; OLD=${2:?}
export DOTNET_ROOT=/root/.dotnet PATH=/root/.dotnet:$PATH
run() { echo "\$ $*"; ( eval "$@" ) 2>&1 | tail -${TAILN:-4}; echo "exit ${PIPESTATUS[0]}"; }
cd "$W"
echo "# builds + ci.yml gates, ONCE, clean worktree at $(git rev-parse HEAD) ($(git status --porcelain | wc -l) uncommitted paths) $(date -u +%FT%TZ)"
run npx tsc -b --force
run npx vite build
run VITE_APP_ENV=production npx vite build --base=/ --outDir $S/ui-fix-prod --emptyOutDir
run VITE_APP_ENV=staging npx vite build --base=/ --outDir $S/ui-fix-staging --emptyOutDir
echo '$ ci.yml: VITE_APP_ENV allow-list gate (mirror check, refusal executed, production identity builds)'
python3 - <<'PY'
import re, sys
vite = open('vite.config.ts').read(); cs = open('server/Core/Shared/AppEnv.cs').read()
vm = re.search(r"KNOWN_APP_ENVS = \[([^\]]*)\]", vite); cm = re.search(r"Known = \[([^\]]*)\]", cs)
if not vm or not cm: sys.exit("mirror check could not FIND a list")
norm = lambda m: sorted(t.strip().strip('\'"') for t in m.group(1).split(',') if t.strip())
if norm(vm) != norm(cm): sys.exit(f"allow-list DRIFT: {norm(vm)} != {norm(cm)}")
print("ok: vite allow-list mirrors AppEnv.Known:", " | ".join(norm(vm)))
PY
out=$(VITE_APP_ENV=definitely-invalid npx vite build 2>&1); rc=$?
[ "$rc" != "0" ] && echo "$out" | grep -q "UNKNOWN ENVIRONMENT IDENTITY: VITE_APP_ENV is 'definitely-invalid'" && echo "ok: refused by the gate's own message (exit $rc)" || echo "GATE FAILED (exit $rc)"
for g in reception-required-fields-gate awaiting-bed-gate ai-section-gate edition-gate vocab-registration-gate; do TAILN=2 run node scripts/$g.mjs; done
TAILN=6 run dotnet build server -c Release --nologo --no-incremental
TAILN=2 run dotnet publish server -c Release --nologo -o $S/app-fix-pub
echo "\$ git diff --stat 72a7894 HEAD -- server   (server source vs the reviewed head)"
git diff --stat 72a7894 HEAD -- server; echo "(empty = identical)"
cd "$OLD"
echo "# PRE-FIX production bundle (reproduction only) at $(git rev-parse HEAD)"
run VITE_APP_ENV=production npx vite build --base=/ --outDir $S/ui-old-prod --emptyOutDir
