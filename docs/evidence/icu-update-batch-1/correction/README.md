# Evidence — correction of the first ICU update batch (draft PR #234)

Review evidence for the commits that correct PR #234 after Codex's review. The
design source is `docs/design/icu-update-batch-1-correction.md` (verbatim). The
rule is MAR design **Amendment B** in `docs/design/mar-derived-schedule.md`, and
the status record is `02_PROJECT_STATUS.md` 2026-09-30 (later).

Everything here was produced on 2026-09-30 (UTC) in the implementation
container against **synthetic data only**: the seeded demo roster plus synthetic
patients and drugs created for these checks. No hospital system and no real
clinical data were used, and the retired hosted test service was never
contacted. Like the rest of `docs/evidence/`, this is docs-only review evidence
and can be dropped before merge.

## What was verified, and against which commit

| Commit | Content |
|---|---|
| `f99ad6c` | correction prompt recorded verbatim |
| `93f22a4` | MAR Amendment B (pure append: 109 added, 0 removed) |
| `4cc37a8` | order row lock (atomic documentation) |
| `b814788` | the rolling timer (server + client + print + MAR e2e); **the server and bundle under test** |
| `f0c7d56` | encounter-scope e2e accepts the round identity; **the final source every build/harness step ran on** |
| `5d07c06` | `02_PROJECT_STATUS.md` record (docs only) |

`verification-summary.txt` lists every result. **Every final step exits 0.**
Earlier failed runs are kept under their own names and explained there.

| File | What it shows |
|---|---|
| `verification-summary.txt` | every command/check and its result |
| `schedules.txt` | **the exact schedules** for 19 deterministic scenarios: each read's rows (`[ ]` marks the one current round) and each documentation's result and next round, beside the stated expectation |
| `logs/final/SUMMARY.txt` + `01…16-*.log` | builds, the `ci.yml` frontend/server job steps, the harness runs, and the expectation + parity check (**209 checks, 0 failures**) |
| `logs/final/harness-cs.json`, `harness-ts.json` | raw output: real server sources vs real client modules |
| `logs/api-check-rolling.log` | **35/35** real-API checks (PostgreSQL 16): overdue round stays single and documentable; explicit actual vs later documentation; early; duplicate; backdated no-rewind; held/refused (early, on time, late); multi-day; legacy activation (the approved 06:00/06:50/06:55 → 07:55 case); legacy late fact starts no timer; frequency modification; once; PRN; discontinue; 404s; discharge |
| `logs/concurrency-check.log` | **28/28** synchronized overlapping requests on this branch (method below) |
| `logs/concurrency-check-reviewed-head.log` | the same harness on the reviewed head `2d14aa0`: **defect reproduced**. Both nurses got 200, but only 1 fact and 1 audit entry survived |
| `logs/suite-*-e2e.log` | `deployed-mar-e2e` 9/9, `deployed-orders-e2e` 12/12, `deployed-encounter-scope-e2e` 12/12, `deployed-assignments-e2e` 11/11, replayed locally |
| `logs/browser-rolling.log`, `browser-setup.json` | **12/12** browser checks |
| `logs/healthz.json` | the server under test: `staging`, `edition: icu`, AI disabled, build `b814788` |

### How the concurrency proof is synchronized

`concurrency-check.py` makes the overlap deterministic without a stress loop:

1. A separate `psql` session holds the target order's row lock.
2. Two requests are released together by a barrier.
3. The check asserts that **both are still in flight** after 1.5 s, i.e. parked
   on the database lock.
4. The lock is released.

From there, only the server's own locking decides the outcome. Every outcome is
then checked on the durable state: the row itself and a fresh `GET /api/icu/mar`.

The cases:
- the same current round;
- PRN (two distinct valid facts);
- Given vs Held;
- Given vs discontinue, and Given vs a frequency change, each ordering forced
  by queuing one request 0.4 s later while both are still parked;
- two independent orders (the second is not blocked);
- Given vs the discharge cascade, both orderings.

## Screenshots (`screenshots/`, dark theme, Chromium, device zone UTC, server zone Asia/Baghdad)

| File | Viewport · role · what to look at |
|---|---|
| `dark-desktop1440-nurse-mar-rolling-baghdad.jpg` | 1440×1000 · Staff Nurse · each repeating order shows one current round, a `round n` tag and "timed from the dose given 03:05" or "…skipped dose due 03:00". Times are Baghdad; storage is UTC 00:05 / 00:00 |
| `dark-desktop1440-nurse-print-mar-rolling.jpg` | 1440×1135 · Staff Nurse · printed MAR: "next dose due" per active order and `round 1` per cell. The slot line shows the raw UTC stamp; that is pre-existing and not changed (the excluded timestamp class) |
| `dark-desktop1440-doctor-orders-medication-filter-collapsed.jpg` | 1440×900 · Consultant · the type filter (Medication) in dark theme; next-dose chips equal the MAR rounds |
| `dark-desktop1440-doctor-orders-sidebar-expanded.jpg` | 1440×900 · Consultant · the expanded sidebar in dark theme; every item measured ≥ 7.46:1 against its rendered background |

## Tools (`tools/`)

The paths are the original container's. The local DB password is read from
`AURORA_LOCAL_DB_PASSWORD`, and the JWT secret from a file.

- `rollharness/`: C# harness over the **real** `server/Core/**`, plus `scenarios.json` (the expectations).
- `rollts/`: the same scenarios over the **real** client modules (esbuild, fake clock), and `check.py` (expectations + parity).
- `render-schedules.py`: produces `schedules.txt`.
- `api-check-rolling.py`, `concurrency-check.py`, `browser-setup.py`, `browser/rolling-browser.cjs`: the live checks. The browser script uses the first round's `../../tools/browser/lib.cjs`.
- `run-server-rolling.sh`: the stack under test. `run-server-reviewed.sh`: the reviewed-head contrast server (port 8081).
- `run-suite.py`: replays a `deployed-*-e2e.yml`. `--skip=N` skips a named hosted-data step, stated in the log.
- `final-verify-rolling.sh`: produced `logs/final/`.

The database was touched directly only for stated synthetic setups:
- backdating an order's "signed" event, so an overdue round exists;
- inserting pre-update (legacy) facts without `round`;
- the `psql` lock session of the concurrency check.

Every order, documentation, modification, discontinue and discharge otherwise
went through the real endpoints.

## Follow-up: the rolling-timer correction (`timer-fix/`)

After Codex reviewed `87358f2`, one timer defect was corrected: a Given after a
Held/Refused round now restarts the timer from its actual time. Its proof is in
`timer-fix/` (see `timer-fix/README.md`). The evidence above is unchanged and
still documents the earlier commits.
