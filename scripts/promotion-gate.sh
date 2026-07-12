#!/bin/bash
# ==================== THE PROMOTION GATE (environment-separation §4/§11 step 4) ====================
#
# Runs on every push to the `production` branch (release-production.yml)
# BEFORE anything is built or published. Converts "promote carefully"
# into a mechanism: a promotion is blocked unless the promoted commit is
# EXACTLY what staging is currently serving and has already verified.
#
# The checks, in order — each failure is collected and reported; ANY
# failure blocks the promotion (exit 1). No retries: a promotion is a
# deliberate act against a steady state, not a warm-up condition.
#   1. ANCESTRY      — the promoted commit is an ancestor of main
#                      (production never runs a commit that bypassed the
#                      normal PR path; no cherry-picks, no divergence).
#   2. STAGING IDENTITY — staging /healthz reports environment=staging
#                      (the step-1 identity field; a mis-wired staging
#                      cannot vouch for anything).
#   3. SERVER CONTENT — the promoted commit's server/ tree + render.yaml
#                      blob equal the deployed staging build's (the same
#                      content-equality rule every suite gate uses).
#   4. FRONTEND CONTENT — the staging Pages build.txt commit's frontend
#                      build context equals the promoted commit's (the
#                      print suite's ctx_hash, same 8 paths), and its
#                      environment line reads staging.
#   5. SUITES GREEN ON THIS CONTENT — for each of the thirteen deployed
#                      suites: the most recent completed run concluded
#                      SUCCESS and ran against content equal to the
#                      promoted commit's (server tree; the print suite
#                      additionally the frontend context). A green run
#                      against different bytes is NOT evidence.
#
# Parameterized so it can be DRY-RUN locally against mock staging
# endpoints (the workflow passes the real ones):
#   PROMOTED_SHA   commit being promoted            (required)
#   REPO           owner/name for the suite check   (required)
#   STAGING_API    e.g. https://icu-cp49.onrender.com
#   STAGING_PAGES  e.g. https://<owner>.github.io/<repo>
#   GH_API         default https://api.github.com
#   MAIN_REF       default origin/main (ancestry reference)
#   GH_TOKEN       optional, raises API rate limits in CI
set -u

PROMOTED_SHA=${PROMOTED_SHA:?PROMOTED_SHA is required}
REPO=${REPO:?REPO is required}
STAGING_API=${STAGING_API:?STAGING_API is required}
STAGING_PAGES=${STAGING_PAGES:?STAGING_PAGES is required}
GH_API=${GH_API:-https://api.github.com}
MAIN_REF=${MAIN_REF:-origin/main}

FAILURES=()
fail() { FAILURES+=("$1"); echo "BLOCK  $1"; }
ok()   { echo "ok     $1"; }

gh_get() { # $1=path — GitHub API GET with optional token
  curl -s --max-time 30 ${GH_TOKEN:+-H "Authorization: Bearer $GH_TOKEN"} "$GH_API/repos/$REPO/$1"
}

# the print suite's frontend build context — keep this list IN SYNC with
# .github/workflows/deployed-print-e2e.yml (ctx_hash)
ctx_hash() {
  local c=$1
  { for p in src index.html package-lock.json vite.config.ts tsconfig.json tsconfig.app.json tsconfig.node.json .github/workflows/deploy-pages.yml; do
      git rev-parse -q --verify "$c:$p" 2>/dev/null || echo "MISSING:$p"
    done; } | sha256sum | cut -d' ' -f1
}

echo "PROMOTION GATE — promoting $PROMOTED_SHA to production"
echo "staging: $STAGING_API · $STAGING_PAGES"

# ---- 1. ancestry ----------------------------------------------------------
if git merge-base --is-ancestor "$PROMOTED_SHA" "$MAIN_REF" 2>/dev/null; then
  ok "ancestry: $PROMOTED_SHA is an ancestor of $MAIN_REF"
else
  fail "ANCESTRY: $PROMOTED_SHA is NOT an ancestor of $MAIN_REF — production only runs commits that went through the normal PR path"
fi

# ---- 2 + 3. staging identity + server content -----------------------------
HEALTHZ=$(curl -s --max-time 30 "$STAGING_API/healthz" || echo "")
S_ENV=$(echo "$HEALTHZ" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("environment","<absent>"))' 2>/dev/null || echo "<unreachable>")
S_BUILD=$(echo "$HEALTHZ" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("build","<absent>"))' 2>/dev/null || echo "<unreachable>")
if [ "$S_ENV" = "staging" ]; then
  ok "staging identity: healthz environment=staging (build $S_BUILD)"
else
  fail "STAGING IDENTITY: $STAGING_API/healthz reports environment '$S_ENV' — cannot promote what staging cannot vouch for"
fi

WANT_SRV=$(git rev-parse "$PROMOTED_SHA:server")
WANT_YML=$(git rev-parse "$PROMOTED_SHA:render.yaml")
GOT_SRV=$(git rev-parse -q --verify "$S_BUILD:server" 2>/dev/null || echo "<unknown-commit>")
GOT_YML=$(git rev-parse -q --verify "$S_BUILD:render.yaml" 2>/dev/null || echo "<unknown-commit>")
if [ "$GOT_SRV" = "$WANT_SRV" ] && [ "$GOT_YML" = "$WANT_YML" ]; then
  ok "server content: staging serves exactly the promoted server tree + render.yaml"
else
  fail "SERVER CONTENT: staging serves build '$S_BUILD' (server tree $GOT_SRV) but the promotion carries tree $WANT_SRV — promote only what staging is running"
fi

# ---- 4. frontend content ---------------------------------------------------
BODY=$(curl -sf --max-time 30 "$STAGING_PAGES/build.txt" 2>/dev/null || echo "")
F_BUILD=$(printf '%s\n' "$BODY" | sed -n 1p | tr -d '[:space:]')
F_ENV=$(printf '%s\n' "$BODY" | sed -n 2p | tr -d '[:space:]')
WANT_CTX=$(ctx_hash "$PROMOTED_SHA")
GOT_CTX=$([ -n "$F_BUILD" ] && ctx_hash "$F_BUILD" || echo "<no-build.txt>")
if [ "$GOT_CTX" = "$WANT_CTX" ] && [ "$F_ENV" = "staging" ]; then
  ok "frontend content: staging Pages serves the promoted frontend context (build $F_BUILD, environment staging)"
else
  fail "FRONTEND CONTENT: staging Pages build '$F_BUILD' (env '${F_ENV:-<absent>}', ctx $GOT_CTX) does not carry the promoted frontend context $WANT_CTX"
fi

# ---- 5. every suite green ON THIS CONTENT ----------------------------------
SUITES="deployed-auth-e2e.yml deployed-adt-e2e.yml deployed-users-e2e.yml deployed-labs-e2e.yml \
deployed-orders-e2e.yml deployed-mar-e2e.yml deployed-timeline-e2e.yml deployed-ai-e2e.yml \
deployed-encounter-scope-e2e.yml deployed-formulary-e2e.yml deployed-labcatalog-e2e.yml deployed-print-e2e.yml \
deployed-observations-e2e.yml"
for wf in $SUITES; do
  run=$(gh_get "actions/workflows/$wf/runs?status=completed&per_page=1")
  read -r R_SHA R_CONC <<<"$(echo "$run" | python3 -c '
import json,sys
d=json.load(sys.stdin); r=(d.get("workflow_runs") or [None])[0]
print((r["head_sha"] + " " + str(r.get("conclusion"))) if r else "<none> <none>")' 2>/dev/null || echo "<err> <err>")"
  if [ "$R_CONC" != "success" ]; then
    fail "SUITE $wf: latest completed run concluded '$R_CONC' — every suite must be green before promotion"
    continue
  fi
  R_SRV=$(git rev-parse -q --verify "$R_SHA:server" 2>/dev/null || echo "<unknown-commit>")
  if [ "$R_SRV" != "$WANT_SRV" ]; then
    fail "SUITE $wf: last green run was against server tree $R_SRV (commit $R_SHA), not the promoted tree — re-run the suites on this content"
    continue
  fi
  if [ "$wf" = "deployed-print-e2e.yml" ]; then
    R_CTX=$(ctx_hash "$R_SHA")
    if [ "$R_CTX" != "$WANT_CTX" ]; then
      fail "SUITE $wf: last green run was against frontend context $R_CTX, not the promoted context — re-run it on this content"
      continue
    fi
  fi
  ok "suite $wf: green on the promoted content (run head $R_SHA)"
done

echo
if [ ${#FAILURES[@]} -gt 0 ]; then
  echo "PROMOTION BLOCKED — ${#FAILURES[@]} check(s) failed. Fix the state (deploy/redeploy staging, re-run the suites, or promote the commit staging actually verified) and push again. Nothing was built or published."
  exit 1
fi
echo "PROMOTION GATE PASSED — $PROMOTED_SHA is exactly what staging is serving and has verified. Proceeding to release."
