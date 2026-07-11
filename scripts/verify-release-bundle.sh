#!/bin/bash
# ==================== RELEASE BUNDLE VERIFICATION (§11 step 4) ====================
#
# Run BEFORE trusting a transferred bundle (download or physical media):
#   1. manifest.json parses and carries the expected schema;
#   2. every artifact's sha256 matches BOTH the manifest AND SHA256SUMS
#      (the two records must agree with the bytes and with each other —
#      a tampered manifest or a tampered artifact both fail);
#   3. artifact sizes match the manifest;
#   4. optionally, the manifest commit equals an expected commit.
# ANY failure exits non-zero with a loud verdict: a bundle that fails
# verification MUST be treated as nonexistent, never installed.
#
# Usage: verify-release-bundle.sh <bundledir> [expected-commit]
set -u

DIR=${1:?bundledir}; EXPECT=${2:-}
FAIL=0
bad() { echo "FAIL   $1"; FAIL=1; }
ok()  { echo "ok     $1"; }

[ -f "$DIR/manifest.json" ] || { echo "FAIL   no manifest.json in $DIR"; echo "BUNDLE VERIFICATION FAILED"; exit 1; }
[ -f "$DIR/SHA256SUMS" ]   || { echo "FAIL   no SHA256SUMS in $DIR";   echo "BUNDLE VERIFICATION FAILED"; exit 1; }

python3 - "$DIR" "$EXPECT" <<'EOF' || FAIL=1
import hashlib, json, os, sys
d, expect = sys.argv[1], sys.argv[2]
try:
    m = json.load(open(os.path.join(d, "manifest.json")))
except Exception as e:
    print(f"FAIL   manifest.json unreadable: {e}"); sys.exit(1)
if m.get("schema") != "aurora-release-manifest/1":
    print(f"FAIL   unexpected manifest schema: {m.get('schema')!r}"); sys.exit(1)
print(f"ok     manifest: version {m['version']} commit {m['commit']} environment {m['environment']}")
if expect and m["commit"] != expect:
    print(f"FAIL   manifest commit {m['commit']} != expected {expect}"); sys.exit(1)
sums = {}
for line in open(os.path.join(d, "SHA256SUMS")):
    h, _, name = line.strip().partition("  ")
    sums[name.lstrip("*")] = h
rc = 0
for a in m["artifacts"]:
    p = os.path.join(d, a["name"])
    if not os.path.isfile(p):
        print(f"FAIL   artifact missing: {a['name']}"); rc = 1; continue
    h = hashlib.sha256(open(p, "rb").read()).hexdigest()
    if h != a["sha256"]:
        print(f"FAIL   {a['name']}: sha256 {h[:16]}… != manifest {a['sha256'][:16]}… (corrupted or tampered)"); rc = 1; continue
    if sums.get(a["name"]) != a["sha256"]:
        print(f"FAIL   {a['name']}: manifest and SHA256SUMS disagree"); rc = 1; continue
    if os.path.getsize(p) != a["bytes"]:
        print(f"FAIL   {a['name']}: size {os.path.getsize(p)} != manifest {a['bytes']}"); rc = 1; continue
    print(f"ok     {a['name']}: sha256 + size verified ({a['bytes']} bytes)")
extra = set(sums) - {a["name"] for a in m["artifacts"]}
if extra:
    print(f"FAIL   SHA256SUMS lists artifacts the manifest does not: {sorted(extra)}"); rc = 1
sys.exit(rc)
EOF

echo
if [ "$FAIL" != 0 ]; then
  echo "BUNDLE VERIFICATION FAILED — treat this bundle as NONEXISTENT. Do not install it; re-transfer or re-cut the release."
  exit 1
fi
echo "BUNDLE VERIFIED — contents match the manifest and checksums."
