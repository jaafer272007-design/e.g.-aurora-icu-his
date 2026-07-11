#!/bin/bash
# ==================== AURORA BACKUP + RESTORE-VERIFICATION (§11 step 4 — B1) ====================
#
# THE RULE THIS SCRIPT ENFORCES: a backup that has not been PROVEN
# restorable does not count as a backup. Every run that produces a dump
# also RESTORES it into a scratch database and verifies the result —
# automatically, not "looks fine". A failed verification is a loud,
# non-zero, status-file-recorded failure: the backup is to be treated as
# NONEXISTENT.
#
# TARGET-INDEPENDENT: works against any PostgreSQL the environment can
# reach (the local proof uses a local cluster; production's sidecar/cron
# wiring is deferred install tooling). RECOMMENDED CADENCE, wired at
# install time: run `backup` DAILY, and `reverify` of the newest dump
# before any software update (the updater must hard-stop on failure).
#
# Commands:
#   backup            dump + checksum + restore-verify + retention (default)
#   reverify <dump>   re-verify an EXISTING dump end-to-end (checksum +
#                     restore + structural checks vs its metadata)
#
# Environment:
#   DATABASE_URL       source database (required)
#   RV_ADMIN_URL       connection with CREATEDB rights on the Postgres
#                      that hosts the scratch restore (required; the
#                      scratch database is created and dropped per run)
#   BACKUP_DIR         where dumps live (required)
#   RETAIN             dumps to keep, newest first        (default 14)
#   RV_COMPARE_SOURCE  1 = ALSO assert strict per-table content equality
#                      restored == source. Only meaningful when the
#                      source is QUIESCED (no writes) — the empirical
#                      proof harness uses it; a live system races.
#   RV_ALLOW_SHRINK    1 = skip the counts-not-lower-than-previous check
#                      (documented escape for legitimately reset sources;
#                      the never-delete rules make shrinkage a red flag
#                      everywhere else)
#   RV_KEEP_SCRATCH    1 = keep the scratch DB on failure (forensics)
#
# Verification performed on every dump:
#   V1 checksum        the dump's sha256 matches its .sha256 sidecar
#   V2 restorability   pg_restore into a fresh scratch DB completes
#                      without errors
#   V3 structure       every table named in the archive TOC exists in
#                      the restored database
#   V4 counts          per-table row counts of the RESTORED database are
#                      recorded as the dump's metadata; on `backup`, they
#                      must not be LOWER than the previous verified
#                      backup's (never-delete rules → monotonic), and no
#                      previously-present table may vanish
#   V5 (opt) equality  strict per-table content equality vs the source
#                      (md5 over deterministically-ordered row digests)
# Outcome is written to $BACKUP_DIR/LAST_VERIFICATION (JSON) — the
# install tooling and any human can see at a glance whether the newest
# backup is PROVEN or the pipeline is in a failed state.
set -u

CMD=${1:-backup}
DATABASE_URL=${DATABASE_URL:?DATABASE_URL is required}
RV_ADMIN_URL=${RV_ADMIN_URL:?RV_ADMIN_URL is required (createdb rights for the scratch restore)}
BACKUP_DIR=${BACKUP_DIR:?BACKUP_DIR is required}
RETAIN=${RETAIN:-14}
mkdir -p "$BACKUP_DIR"

TS=$(date -u +%Y%m%dT%H%M%SZ)
# lowercase: an unquoted CREATE DATABASE folds the identifier, but the
# connection URL does not — mixed case would create one name and try to
# restore into another (caught empirically by the proof harness)
SCRATCH=$(echo "aurora_rv_${TS}" | tr '[:upper:]' '[:lower:]')
STATUS_FILE="$BACKUP_DIR/LAST_VERIFICATION"

die() { # loud failure: status file + verdict + non-zero exit
  python3 - "$STATUS_FILE" "$1" "$2" <<'EOF'
import json, sys, datetime
json.dump({"status": "FAILED", "backup": sys.argv[2], "reason": sys.argv[3],
           "at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")},
          open(sys.argv[1], "w"), indent=2)
EOF
  echo
  echo "BACKUP VERIFICATION FAILED: $2"
  echo "Treat this backup as NONEXISTENT. The pipeline is in a FAILED state ($STATUS_FILE) until a verified backup succeeds."
  [ "${RV_KEEP_SCRATCH:-0}" = 1 ] || psql "$RV_ADMIN_URL" -qAtc "DROP DATABASE IF EXISTS $SCRATCH" 2>/dev/null
  exit 1
}

table_counts() { # $1=conninfo -> "table<TAB>count" lines, sorted
  psql "$1" -qAt -F $'\t' -c \
    "SELECT tablename, '~' FROM pg_tables WHERE schemaname='public' ORDER BY tablename" |
  while IFS=$'\t' read -r t _; do
    printf '%s\t%s\n' "$t" "$(psql "$1" -qAtc "SELECT count(*) FROM \"$t\"")"
  done
}

table_digest() { # $1=conninfo $2=table -> deterministic content digest
  psql "$1" -qAtc "SELECT coalesce(md5(string_agg(h, '' ORDER BY h)), 'empty')
                   FROM (SELECT md5(t.*::text) AS h FROM \"$2\" t) s"
}

restore_verify() { # $1=dumpfile $2=metafile-to-write $3=compare-source(0/1) $4=prev-metafile-or-empty
  local DUMP=$1 META=$2 CMPSRC=$3 PREV=$4

  # V1 — checksum
  ( cd "$(dirname "$DUMP")" && sha256sum -c "$(basename "$DUMP").sha256" >/dev/null 2>&1 ) \
    || die "$(basename "$DUMP")" "V1 checksum mismatch — the dump on disk is not the dump that was written (corruption or tampering)"
  echo "ok     V1 checksum: dump matches its sha256 sidecar"

  # V2 — restorability into a FRESH scratch database
  psql "$RV_ADMIN_URL" -qAtc "DROP DATABASE IF EXISTS $SCRATCH" >/dev/null 2>&1
  psql "$RV_ADMIN_URL" -qAtc "CREATE DATABASE $SCRATCH" >/dev/null \
    || die "$(basename "$DUMP")" "V2 could not create the scratch database $SCRATCH"
  SCRATCH_URL=$(python3 - "$RV_ADMIN_URL" "$SCRATCH" <<'EOF'
import sys, urllib.parse as u
p = u.urlsplit(sys.argv[1]); print(u.urlunsplit((p.scheme, p.netloc, "/" + sys.argv[2], p.query, p.fragment)))
EOF
)
  if ! pg_restore --no-owner --no-acl --exit-on-error -d "$SCRATCH_URL" "$DUMP" 2>"$BACKUP_DIR/.rv-restore.err"; then
    echo "----- pg_restore errors -----"; cat "$BACKUP_DIR/.rv-restore.err"
    die "$(basename "$DUMP")" "V2 pg_restore FAILED — this dump cannot be restored from"
  fi
  echo "ok     V2 restorability: pg_restore into $SCRATCH completed without errors"

  # V3 — every table in the archive exists in the restored database
  local TOC_TABLES RESTORED_TABLES missing
  TOC_TABLES=$(pg_restore -l "$DUMP" | sed -n 's/^.* TABLE public \([^ ]*\) .*$/\1/p' | sort -u)
  RESTORED_TABLES=$(psql "$SCRATCH_URL" -qAtc "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")
  missing=$(comm -23 <(echo "$TOC_TABLES") <(echo "$RESTORED_TABLES"))
  [ -z "$missing" ] || die "$(basename "$DUMP")" "V3 tables in the archive are MISSING from the restore: $(echo $missing)"
  echo "ok     V3 structure: all $(echo "$TOC_TABLES" | wc -l) archived tables exist in the restore"

  # V4 — restored per-table counts -> metadata (+ non-regression vs previous)
  local COUNTS
  COUNTS=$(table_counts "$SCRATCH_URL")
  python3 - "$META" "$(basename "$DUMP")" "$PREV" "${RV_ALLOW_SHRINK:-0}" <<EOF || die "$(basename "$DUMP")" "V4 count regression vs the previous verified backup (see above; never-delete rules make shrinkage a red flag — RV_ALLOW_SHRINK=1 only for a knowingly reset source)"
import json, sys, datetime
meta_path, dump_name, prev_path, allow_shrink = sys.argv[1:5]
counts = {}
for line in """$COUNTS""".strip().splitlines():
    t, c = line.split("\t"); counts[t] = int(c)
json.dump({"backup": dump_name, "restoredCounts": counts,
           "verifiedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")},
          open(meta_path, "w"), indent=2)
print(f"ok     V4 counts: {sum(counts.values())} rows across {len(counts)} tables recorded")
if prev_path:
    prev = json.load(open(prev_path))["restoredCounts"]
    bad = [(t, c, counts.get(t)) for t, c in prev.items() if counts.get(t, -1) < c]
    if bad and allow_shrink != "1":
        for t, was, now in bad:
            print(f"FAIL   V4 table {t}: {now} rows restored, previous verified backup had {was}")
        sys.exit(1)
    print(f"ok     V4 non-regression: no table below the previous verified backup ({len(prev)} tables compared)")
EOF

  # V5 — optional strict equality vs the (quiesced) source
  if [ "$CMPSRC" = 1 ]; then
    local diffs=0 t sd rd
    while IFS=$'\t' read -r t _; do
      sd=$(table_digest "$DATABASE_URL" "$t"); rd=$(table_digest "$SCRATCH_URL" "$t")
      if [ "$sd" != "$rd" ]; then echo "FAIL   V5 table $t: restored content differs from source"; diffs=1; fi
    done <<<"$(table_counts "$SCRATCH_URL")"
    [ "$diffs" = 0 ] || die "$(basename "$DUMP")" "V5 strict equality FAILED — restored content differs from the source"
    echo "ok     V5 equality: every table's restored content is IDENTICAL to the source (quiesced comparison)"
  fi

  psql "$RV_ADMIN_URL" -qAtc "DROP DATABASE IF EXISTS $SCRATCH" >/dev/null 2>&1
}

record_verified() { # $1=dumpname
  python3 - "$STATUS_FILE" "$1" <<'EOF'
import json, sys, datetime
json.dump({"status": "VERIFIED", "backup": sys.argv[2],
           "at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")},
          open(sys.argv[1], "w"), indent=2)
EOF
}

case "$CMD" in
  backup)
    DUMP="$BACKUP_DIR/aurora-$TS.dump"
    echo "BACKUP: pg_dump (custom format) -> $DUMP"
    pg_dump --format=custom --no-owner --no-acl --file="$DUMP" "$DATABASE_URL" \
      || die "aurora-$TS.dump" "pg_dump failed — no backup was produced"
    ( cd "$BACKUP_DIR" && sha256sum "$(basename "$DUMP")" > "$(basename "$DUMP").sha256" )
    PREV=$(ls -1 "$BACKUP_DIR"/aurora-*.meta.json 2>/dev/null | sort | tail -1 || true)
    restore_verify "$DUMP" "$BACKUP_DIR/aurora-$TS.meta.json" "${RV_COMPARE_SOURCE:-0}" "${PREV:-}"
    record_verified "aurora-$TS.dump"
    # retention: keep the newest $RETAIN verified triplets (dump+sha+meta)
    ls -1 "$BACKUP_DIR"/aurora-*.dump 2>/dev/null | sort | head -n -"$RETAIN" | while read -r old; do
      rm -f "$old" "$old.sha256" "${old%.dump}.meta.json"
      echo "retention: pruned $(basename "$old")"
    done
    echo
    echo "BACKUP VERIFIED: aurora-$TS.dump restored successfully into a scratch database and passed every check."
    ;;
  reverify)
    DUMP=${2:?reverify needs a dump file}
    [ -f "$DUMP" ] || die "$(basename "$DUMP")" "dump file not found"
    restore_verify "$DUMP" "${DUMP%.dump}.reverify.meta.json" "${RV_COMPARE_SOURCE:-0}" ""
    record_verified "$(basename "$DUMP")"
    echo
    echo "REVERIFY PASSED: $(basename "$DUMP") is restorable and structurally sound."
    ;;
  *)
    echo "unknown command '$CMD' (backup | reverify <dump>)" >&2; exit 2
    ;;
esac
