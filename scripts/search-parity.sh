#!/usr/bin/env bash
#
# AURORA — old-vs-new byte-parity harness for GET /api/icu/adt/patients/search
# (the Hospital Shell design §4.1 endpoint rewrite).
#
# WHAT IT PROVES. Two server builds — OLD (the in-memory implementation) and
# NEW (the SQL-pushdown rewrite) — answer an identical query matrix, and the
# responses are byte-diffed. Run on BOTH engines (the owner's requirement on
# the rewrite): PostgreSQL, the engine that ships to the hospital, and the
# SQLite demo path, the engine local development and CI actually run. SQLite's
# LIKE/lower() are ASCII-only, so Arabic and cased non-ASCII queries are in
# the matrix on both engines, and a cross-engine report states divergence
# plainly instead of picking whichever engine agrees with the old behaviour.
#
# WHY IT IS COMMITTED. Every rendered proof in this project's history lived in
# a session scratchpad and cannot be re-run by anyone (02 → Known Feature
# Gaps). This one is a file in the repository: two built server dirs and a
# Postgres in, a verdict out.
#
# RULE-5 GATES (03): /healthz.build is asserted equal to the EXPECTED label
# BEFORE any capture — a 200 identifies a listener, not a build; every non-2xx
# assertion checks the {error} MESSAGE, not only the code; and `die` prints
# the HTTP code AND the body, never prose alone.
#
# USAGE
#   scripts/search-parity.sh --engine pg     --old-dir <publish> --new-dir <publish> \
#       --old-build <label> --new-build <label> --pg-url <postgres://…> --work <dir>
#   scripts/search-parity.sh --engine sqlite --old-dir <publish> --new-dir <publish> \
#       --old-build <label> --new-build <label> --work <dir>
#
#   Each --*-dir is a `dotnet publish` output whose build was stamped with
#   -p:SourceRevisionId=<label> (the /healthz.build contract, Program.cs
#   ResolveRunningBuild). The pg database must be CREATED and EMPTY (or
#   already carrying this harness's fixtures — fixture creation is
#   idempotent); both binaries then read the SAME rows, so the pg leg is
#   byte-exact with ZERO masking.
#
#   The sqlite leg reseeds per boot BY DESIGN (Program.cs demo path), so OLD
#   and NEW each build their own dataset from the same deterministic seed +
#   the same fixture requests. Everything is byte-compared EXCEPT the one
#   server-clock field a fixture cannot pin: discharge stamps
#   (DischargeRequest carries no time), masked on BOTH sides as
#   lastDischargedAt:"MASKED" — stated here so the pg leg is understood as
#   the byte-exact one and the sqlite leg as the translation-semantics one.
set -euo pipefail

ENGINE="" OLD_DIR="" NEW_DIR="" OLD_BUILD="" NEW_BUILD="" PG_URL="" WORK="" KNOWN=""
while [ $# -gt 0 ]; do case "$1" in
  --engine) ENGINE=$2; shift 2;; --old-dir) OLD_DIR=$2; shift 2;;
  --new-dir) NEW_DIR=$2; shift 2;; --old-build) OLD_BUILD=$2; shift 2;;
  --new-build) NEW_BUILD=$2; shift 2;; --pg-url) PG_URL=$2; shift 2;;
  --work) WORK=$2; shift 2;;
  # comma-separated matrix case names whose divergence is MEASURED AND
  # ACCEPTED (recorded in 02 with the run that measured it). A diff
  # confined to these cases reports DIVERGENCE-AS-RECORDED and exits 0;
  # a diff touching ANY other case still fails — the known set never
  # blinds the harness to a novel one.
  --known-divergence) KNOWN=$2; shift 2;;
  *) echo "unknown arg $1"; exit 2;;
esac; done
[ -n "$ENGINE" ] && [ -n "$OLD_DIR" ] && [ -n "$NEW_DIR" ] && [ -n "$OLD_BUILD" ] \
  && [ -n "$NEW_BUILD" ] && [ -n "$WORK" ] || { echo "missing required args"; exit 2; }
[ "$ENGINE" = pg ] && [ -z "$PG_URL" ] && { echo "--engine pg needs --pg-url"; exit 2; }
mkdir -p "$WORK"

PORT=5391
BASE="http://127.0.0.1:$PORT"
SRV_PID=""

die() { # die <msg> [http-code] [body] — code AND body, never prose alone
  echo "FAIL - $1" >&2
  [ $# -ge 2 ] && echo "       http: $2" >&2
  [ $# -ge 3 ] && echo "       body: $3" >&2
  [ -n "$SRV_PID" ] && kill "$SRV_PID" 2>/dev/null || true
  exit 1
}

req() { # req <method> <path> [json-body] [token] → RESP_CODE / RESP_BODY
  local m=$1 p=$2 b=${3:-} t=${4:-} out
  if [ -n "$b" ]; then
    out=$(curl -sS -X "$m" "$BASE$p" -H 'Content-Type: application/json' \
      ${t:+-H "Authorization: Bearer $t"} --data-binary "$b" -w $'\n%{http_code}')
  else
    out=$(curl -sS -X "$m" "$BASE$p" ${t:+-H "Authorization: Bearer $t"} -w $'\n%{http_code}')
  fi
  RESP_CODE=${out##*$'\n'}
  RESP_BODY=${out%$'\n'*}
}

boot() { # boot <publish-dir> <expected-build> [extra env as VAR=VAL...]
  local dir=$1 expect=$2; shift 2
  # exec: SRV_PID must be the dotnet process ITSELF, not a wrapping subshell —
  # killing a wrapper leaves the server holding the port and the NEXT boot's
  # /healthz answered by the WRONG process (this repo's #204 failure; the
  # build gate below caught this harness doing exactly that on its first run)
  ( cd "$dir" && exec env -u RENDER_GIT_COMMIT -u DATABASE_URL "$@" \
      APP_ENV=development PORT="$PORT" \
      dotnet AuroraIcu.Api.dll >"$WORK/server-$expect.log" 2>&1 ) &
  SRV_PID=$!
  local i=0
  until curl -sf "$BASE/healthz" >/dev/null 2>&1; do
    i=$((i+1)); [ $i -gt 120 ] && die "server at $dir never answered /healthz (log: $WORK/server-$expect.log)"
    kill -0 "$SRV_PID" 2>/dev/null || die "server process died on boot (log: $WORK/server-$expect.log)"
    sleep 0.5
  done
  # RULE 5: identify the PROCESS before a single capture — a 200 is a
  # listener, not a build. 'dev' or absent fails: an unidentifiable process
  # is the condition this check refuses, not a pass with a caveat.
  local got; got=$(curl -sf "$BASE/healthz" | jq -r .build)
  [ "$got" = "$expect" ] || die "/healthz.build is '$got', expected '$expect' — wrong process would be answering the matrix"
}

stop_srv() { kill "$SRV_PID" 2>/dev/null || true; wait "$SRV_PID" 2>/dev/null || true; SRV_PID=""; }

login() { # → TOKEN (the seeded Consultant; demo path only — production refuses it)
  req POST /api/auth/login '{"username":"sara.rahman","password":"Aurora2026!"}'
  [ "$RESP_CODE" = 200 ] || die "login failed" "$RESP_CODE" "$RESP_BODY"
  TOKEN=$(printf '%s' "$RESP_BODY" | jq -r .token)
  [ -n "$TOKEN" ] && [ "$TOKEN" != null ] || die "login answered 200 with no token" "$RESP_CODE" "$RESP_BODY"
}

have_fixture() { # have_fixture <nationalId> → 0 if a patient already carries it
  req GET "/api/icu/adt/patients/search?q=$1&scope=all" "" "$TOKEN"
  [ "$RESP_CODE" = 200 ] || die "fixture probe failed" "$RESP_CODE" "$RESP_BODY"
  [ "$(printf '%s' "$RESP_BODY" | jq '.results | length')" -gt 0 ]
}

admit() { # admit <json> → PATIENT_ID ENCOUNTER_ID
  req POST /api/icu/adt/admissions "$1" "$TOKEN"
  [ "$RESP_CODE" = 200 ] || [ "$RESP_CODE" = 201 ] || die "fixture admission refused" "$RESP_CODE" "$RESP_BODY"
  PATIENT_ID=$(printf '%s' "$RESP_BODY" | jq -r .patient.patientId)
  ENCOUNTER_ID=$(printf '%s' "$RESP_BODY" | jq -r .encounter.encounterId)
  [ -n "$PATIENT_ID" ] && [ "$PATIENT_ID" != null ] || die "admission answered without a patientId" "$RESP_CODE" "$RESP_BODY"
}

discharge() { # discharge <encounterId> <dispositionCode>
  req POST "/api/icu/adt/encounters/$1/discharge" "{\"disposition\":\"$2\"}" "$TOKEN"
  [ "$RESP_CODE" = 200 ] || die "fixture discharge refused ($1)" "$RESP_CODE" "$RESP_BODY"
}

# ---- fixtures: deterministic identities, EXPLICIT past admission stamps ----
# (bedless — the reception-shaped path; a named bed would require
#  diagnosis+attending per #208 and add nothing to search coverage)
ensure_fixtures() {
  # F1 Arabic structured (caseless script — must behave identically everywhere)
  if ! have_fixture 19800510123; then
    admit '{"nameFirst":"أحمد","nameSecond":"حسن","nameFamily":"الجنابي","dateOfBirth":"1980-05-10","sex":"M","allergies":"None documented","nationalId":"19800510123","fileNumber":"A-77","admittedAt":"2026-08-10 08:00"}'
  fi
  # F2 five-part Latin (display-span vs full-legal-span coverage)
  if ! have_fixture 19750201456; then
    admit '{"nameFirst":"Ali","nameSecond":"Hassan","nameThird":"Omar","nameFourth":"Kareem","nameFamily":"Al-Janabi","dateOfBirth":"1975-02-01","sex":"M","allergies":"None documented","nationalId":"19750201456","fileNumber":"B-12","admittedAt":"2026-08-11 09:30"}'
  fi
  # F3 cased non-ASCII (the divergence probe: .NET ToLowerInvariant vs engine LOWER)
  if ! have_fixture 19900909789; then
    admit '{"nameFirst":"Émile","nameSecond":"Renée","nameFamily":"Ñunez","dateOfBirth":"1990-09-09","sex":"F","allergies":"None documented","nationalId":"19900909789","admittedAt":"2026-08-12 10:00"}'
  fi
  # F4 discharged (scope=discharged membership + recency sort)
  if ! have_fixture 19880115321; then
    admit '{"nameFirst":"Zainab","nameSecond":"Karim","nameFamily":"Al-Baghdadi","dateOfBirth":"1988-01-15","sex":"F","allergies":"None documented","nationalId":"19880115321","admittedAt":"2026-08-13 11:00"}'
    discharge "$ENCOUNTER_ID" home
  fi
  # F5 deceased (the isDeath disposition drives the card's status)
  if ! have_fixture 19500303654; then
    admit '{"nameFirst":"Hussein","nameSecond":"Ali","nameFamily":"Al-Basri","dateOfBirth":"1950-03-03","sex":"M","allergies":"None documented","nationalId":"19500303654","admittedAt":"2026-08-13 12:00"}'
    discharge "$ENCOUNTER_ID" died
  fi
}

# ---- the matrix ------------------------------------------------------------
# name|querystring   (urlencoded where needed; captured verbatim)
MATRIX=(
  'arabic-partial|q=%D8%AD%D9%85'                                # حم inside أحمد
  'arabic-first|q=%D8%A3%D8%AD%D9%85%D8%AF'                      # أحمد
  'arabic-crosspart|q=%D8%AD%D8%B3%D9%86%20%D8%A7%D9%84%D8%AC%D9%86%D8%A7%D8%A8%D9%8A'  # "حسن الجنابي"
  'display-span-skips-middles|q=Hassan%20Al-Janabi'              # dto.Name span (Omar/Kareem skipped)
  'fulllegal-span|q=Omar%20Kareem'
  'fulllegal-entire-lower|q=ali%20hassan%20omar%20kareem%20al-janabi'
  'inner-span|q=li%20Has'
  'ascii-upper|q=ALI'
  'cased-nonascii-lower|q=%C3%A9mile'                            # émile
  'cased-nonascii-upper|q=%C3%89MILE'                            # ÉMILE
  'legacy-seeded|q=Al-Saadi'
  'mrn-fragment|q=mrn-&limit=100'
  'nationalid-fragment|q=19750201'
  'filenumber|q=B-12'
  'patientid-fragment|q=p-10'
  'wildcard-percent|q=%25%25'                                    # "%%" literal — must match nothing, never everything
  'wildcard-underscore|q=a_'                                     # "_" literal
  'wildcard-mixed|q=100%25'                                      # "100%"
  'deceased-card|q=hussein'
  'discharged-card|q=zainab'
  'truncation|q=al&limit=2'
  'discharged-browse|scope=discharged'
  'discharged-query|q=al&scope=discharged'
)

capture() { # capture <outfile>
  : >"$1"
  local entry name qs
  for entry in "${MATRIX[@]}"; do
    name=${entry%%|*}; qs=${entry#*|}
    req GET "/api/icu/adt/patients/search?$qs" "" "$TOKEN"
    [ "$RESP_CODE" = 200 ] || die "matrix case '$name' answered non-200" "$RESP_CODE" "$RESP_BODY"
    printf '%s %s %s\n' "$name" "$RESP_CODE" "$RESP_BODY" >>"$1"
  done
  # refusals: the CODE is shared by unrelated failures on this endpoint, so
  # each leg asserts the MESSAGE unique to its guard (03, 2026-08-19)
  req GET '/api/icu/adt/patients/search?q=a' "" "$TOKEN"
  [ "$RESP_CODE" = 400 ] || die "short-q must be 400" "$RESP_CODE" "$RESP_BODY"
  printf '%s' "$RESP_BODY" | grep -q "at least 2 characters" || die "short-q 400 lost its message" "$RESP_CODE" "$RESP_BODY"
  req GET '/api/icu/adt/patients/search?q=ab&bogus=1' "" "$TOKEN"
  [ "$RESP_CODE" = 400 ] || die "unknown param must be 400" "$RESP_CODE" "$RESP_BODY"
  # the quote around the name serializes as ' (JsonOpts.Web escaping),
  # so assert the two literal halves rather than the quoted form
  printf '%s' "$RESP_BODY" | grep -q "unknown query parameter" && printf '%s' "$RESP_BODY" | grep -q "bogus" \
    || die "unknown-param 400 lost its message" "$RESP_CODE" "$RESP_BODY"
  req GET '/api/icu/adt/patients/search?q=ab&scope=x' "" "$TOKEN"
  [ "$RESP_CODE" = 400 ] || die "bad scope must be 400" "$RESP_CODE" "$RESP_BODY"
  printf '%s' "$RESP_BODY" | grep -q "scope must be one of" || die "bad-scope 400 lost its message" "$RESP_CODE" "$RESP_BODY"
  printf 'refusals 400 message-asserted\n' >>"$1"
}

run_side() { # run_side <dir> <build-label> <outfile>
  local dir=$1 label=$2 out=$3
  if [ "$ENGINE" = pg ]; then
    boot "$dir" "$label" DATABASE_URL="$PG_URL"
  else
    boot "$dir" "$label" DB_PATH="$WORK/demo-$label.db"
  fi
  login
  ensure_fixtures
  capture "$out"
  stop_srv
}

echo "== engine: $ENGINE =="
run_side "$OLD_DIR" "$OLD_BUILD" "$WORK/$ENGINE-old.txt"
run_side "$NEW_DIR" "$NEW_BUILD" "$WORK/$ENGINE-new.txt"

CMP_OLD="$WORK/$ENGINE-old.txt" CMP_NEW="$WORK/$ENGINE-new.txt"
if [ "$ENGINE" = sqlite ]; then
  # the TWO stated masks (see header): the sqlite path reseeds per boot BY
  # DESIGN, so the two boots build separate datasets and exactly two fields
  # cannot be pinned by a fixture — discharge stamps (server clock;
  # DischargeRequest carries no time) and MRNs (Random.Shared at
  # registration). Both masked on BOTH sides; everything else stays raw
  # bytes. The pg leg shares ONE dataset and masks NOTHING — it is the
  # byte-exact leg; this one is the translation-semantics leg.
  MASK='s/"lastDischargedAt":"[^"]*"/"lastDischargedAt":"MASKED"/g; s/"mrn":"[^"]*"/"mrn":"MASKED"/g'
  sed "$MASK" "$CMP_OLD" >"$WORK/$ENGINE-old.masked.txt"
  sed "$MASK" "$CMP_NEW" >"$WORK/$ENGINE-new.masked.txt"
  CMP_OLD="$WORK/$ENGINE-old.masked.txt" CMP_NEW="$WORK/$ENGINE-new.masked.txt"
fi

if diff -u "$CMP_OLD" "$CMP_NEW" >"$WORK/$ENGINE.diff"; then
  N=$(grep -c . "$CMP_OLD")
  echo "PASS - $ENGINE: old and new are byte-identical across $N captured lines"
  [ "$ENGINE" = sqlite ] && echo "       (lastDischargedAt + mrn masked on BOTH sides — the two stated per-boot fields)"
  exit 0
fi

# a diff exists — is it confined to the recorded, accepted cases?
DIFF_CASES=$(grep -E '^[-+][a-z]' "$WORK/$ENGINE.diff" | grep -vE '^(\+\+\+|---)' \
  | sed -E 's/^[-+]([a-z0-9-]+) .*/\1/' | sort -u)
UNEXPECTED=""
for c in $DIFF_CASES; do
  case ",$KNOWN," in *",$c,"*) ;; *) UNEXPECTED="$UNEXPECTED $c";; esac
done
if [ -n "$DIFF_CASES" ] && [ -z "$UNEXPECTED" ]; then
  echo "DIVERGENCE-AS-RECORDED - $ENGINE: old vs new differ ONLY on the recorded cases:"
  for c in $DIFF_CASES; do echo "         $c"; done
  echo "       (each measured and accepted in 02's rewrite record; full diff at $WORK/$ENGINE.diff)"
  exit 0
fi
echo "DIVERGENCE - $ENGINE: old vs new differ beyond the recorded set; full diff at $WORK/$ENGINE.diff"
echo "       unexpected cases:${UNEXPECTED:- (none parsed — read the diff)}"
sed -n '1,40p' "$WORK/$ENGINE.diff"
exit 1
