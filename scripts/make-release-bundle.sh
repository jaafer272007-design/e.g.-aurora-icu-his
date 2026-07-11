#!/bin/bash
# ==================== RELEASE BUNDLE — manifest + checksums (§11 step 4) ====================
#
# Produces the production release bundle: the artifacts passed in, plus
#   manifest.json — what this release IS: version, commit, environment,
#                   component identities (server tree / frontend context /
#                   render.yaml blob — the SAME identities the gates
#                   compare), and per-artifact sha256 + size;
#   SHA256SUMS    — flat checksum file over every artifact + the manifest
#                   body itself is covered by verify-release-bundle.sh's
#                   cross-check (manifest ↔ SHA256SUMS must agree).
#
# TARGET-INDEPENDENT: this script packages and describes artifacts; it
# installs nothing and assumes no OS. The release workflow passes the
# docker-saved app image; the local proof passes locally built artifacts.
# Whoever installs runs scripts/verify-release-bundle.sh FIRST — the
# transfer channel (download or physical media) is untrusted by default.
#
# Usage: make-release-bundle.sh <outdir> <version> <commit> <artifact>...
set -euo pipefail

OUT=${1:?outdir}; VERSION=${2:?version}; COMMIT=${3:?commit}; shift 3
[ $# -ge 1 ] || { echo "at least one artifact file is required" >&2; exit 1; }
mkdir -p "$OUT"

# the same frontend-context path list as the print suite / promotion gate
ctx_hash() {
  local c=$1
  { for p in src index.html package-lock.json vite.config.ts tsconfig.json tsconfig.app.json tsconfig.node.json .github/workflows/deploy-pages.yml; do
      git rev-parse -q --verify "$c:$p" 2>/dev/null || echo "MISSING:$p"
    done; } | sha256sum | cut -d' ' -f1
}

SRV_TREE=$(git rev-parse "$COMMIT:server")
YML_BLOB=$(git rev-parse "$COMMIT:render.yaml")
FE_CTX=$(ctx_hash "$COMMIT")

for a in "$@"; do
  [ -f "$a" ] || { echo "artifact not found: $a" >&2; exit 1; }
  cp -n "$a" "$OUT/" 2>/dev/null || true
done

( cd "$OUT" && sha256sum $(for a in "$@"; do basename "$a"; done) > SHA256SUMS )

python3 - "$OUT" "$VERSION" "$COMMIT" "$SRV_TREE" "$FE_CTX" "$YML_BLOB" "$@" <<'EOF'
import hashlib, json, os, sys, datetime
out, version, commit, srv, fectx, yml = sys.argv[1:7]
arts = []
for a in sys.argv[7:]:
    name = os.path.basename(a)
    p = os.path.join(out, name)
    h = hashlib.sha256(open(p, "rb").read()).hexdigest()
    arts.append({"name": name, "sha256": h, "bytes": os.path.getsize(p)})
manifest = {
    "schema": "aurora-release-manifest/1",
    "version": version,
    "commit": commit,
    "environment": "production",
    "createdAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
    "components": {
        # the SAME identities every gate compares — an installed system's
        # /healthz build resolves back to these (aurora-verify, deferred
        # install tooling, replays this comparison on the target)
        "serverTree": srv,
        "frontendContext": fectx,
        "renderYamlBlob": yml,
    },
    "artifacts": arts,
}
json.dump(manifest, open(os.path.join(out, "manifest.json"), "w"), indent=2)
print(f"manifest.json: version {version} commit {commit} · {len(arts)} artifact(s)")
EOF

echo "release bundle written to $OUT:"
ls -l "$OUT"
