#!/bin/bash
# Does the controller harness DETECT regressions? Copy a source tree (arg 1), break two rules in the
# copy, run the harness: it must FAIL (exit 1). Mutations:
#  M-a  the MAR settling read covers only the mounted screens' patients, not the locks' patients
#  M-b  a refused RETRY of an unconfirmed nursing attempt settles it as "not saved" (Amendment 1 §9.2)
set -e
SRC=${1:?usage: mutation-check.sh <tree> <work dir>}; W=${2:?work dir}
HERE=$(cd "$(dirname "$0")" && pwd)
rm -rf "$W"; mkdir -p "$W"; cp -r "$SRC/src" "$W/src"; ln -sfn "$(readlink -f "$SRC/node_modules")" "$W/node_modules"
python3 - "$W/src/features/nurse-care" <<'PY'
import sys
d = sys.argv[1]
p = d + '/marController.ts'; s = open(p).read()
a = """      const pid = l.attempt.patientId ?? this.patientOfOrder.get(l.attempt.orderId)
      if (pid) ids.add(pid)"""
assert a in s; open(p, 'w').write(s.replace(a, "      void l"))
p = d + '/nursingController.ts'; s = open(p).read()
a = "} else if (res.kind === 'rejected' && !retry) {"
assert a in s; open(p, 'w').write(s.replace(a, "} else if (res.kind === 'rejected') {"))
print('mutations applied: M-a (marController.readIds), M-b (nursingController.send)')
PY
set +e
bash "$HERE/run-controller-harness.sh" "$W" "$W/out"
rc=$?
echo "harness exit on the mutated tree: $rc (expected 1 = regressions detected)"
[ $rc -eq 1 ]
