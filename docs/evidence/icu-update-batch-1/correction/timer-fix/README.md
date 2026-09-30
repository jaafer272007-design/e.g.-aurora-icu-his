# Evidence — the rolling-timer correction (draft PR #234, after Codex's review of `87358f2`)

Proof that a **Given after a Held/Refused round restarts the timer from its
actual administration time**. It also shows that a genuinely older backdated
Given still never rewinds the timer.

| Source | Where |
|---|---|
| The prompt, verbatim | `docs/design/icu-update-batch-1-timer-correction.md` |
| The rule | MAR design `### C` in `docs/design/mar-derived-schedule.md` (pure append) |
| The status record | `02_PROJECT_STATUS.md` 2026-09-30 (latest) |

All of it was produced on 2026-09-30 (UTC) in the implementation container.
Only synthetic patients and drugs were used, with no hospital system and no
real clinical data, and the retired hosted test service was never contacted.
It is docs-only review evidence and can be dropped before merge.

## Commits

| Commit | Content |
|---|---|
| `fb139ce` | the prompt, recorded verbatim |
| `c24ca1e` | MAR design `### C` (61 lines appended, 0 removed) |
| `9633899` | **the fix** (server `MarSchedule.cs` + `MarApi.cs` audit note; client `marSchedule.ts` + mock `orders.ts` audit note). **The server under test** (`logs/healthz.json`) |
| `eb616f9` | the harness scenarios and checks (docs only). **The final source every build/harness step ran on** |

## The reproduced case, before and after

Synthetic q1h order, round 1 due 06:00:

1. Round 1 is given at 06:05, so the next round is due 07:05.
2. That round is held (or refused) early at 06:10, so the next is due 08:05.
3. That round is given early at 06:50.

| | Next due after step 3 | Timer rule | Timer from |
|---|---|---|---|
| Reviewed head `87358f2` | 08:05 | skipped | 07:05 |
| This branch | **07:50** | given | 06:50 |

`schedules.txt` shows both runs, row by row, for R20–R25.

## Files

| File | What it shows |
|---|---|
| `schedules.txt` | R20–R25 on this branch, then the same scenarios on the reviewed head (each wrong next round is marked `EXPECTED …`) |
| `logs/final/SUMMARY.txt` + `01…16-*.log` | on `eb616f9`: builds, the `ci.yml` frontend/server steps, the harness runs, expectations + parity. **Every step exits 0; 372 checks, 0 failures** |
| `logs/final/harness-cs.json`, `harness-ts.json` | raw output: the real server sources vs the real client modules |
| `logs/reviewed-check.log`, `reviewed-harness-*.json` | the same 25 scenarios on the reviewed head's sources: **77 failures, all in R20/R21/R23/R24** |
| `logs/api-check-timerfix.log` | **49/49** on the real API + PostgreSQL 16 (see below) |
| `logs/api-check-timerfix-reviewed-head.log` | the same script against a server built from `87358f2`: **6 failures**, all the defect |
| `logs/healthz.json`, `logs/dotnet-publish.log` | the server under test: `staging`, `edition: icu`, AI disabled, build `9633899` |

### The real-API check (`api-check-timerfix.py`)

The stack:
- the published server, with `TZ=Asia/Baghdad` and UTC storage, on local
  PostgreSQL 16;
- a new synthetic patient.

The database was touched directly only to backdate each order's "signed" event,
so that round 1 is 4 h overdue. Seven q1h orders:

| Order | Round 2 | Round 3 Given |
|---|---|---|
| A | held **early** | early, with actual time N+1 **supplied separately** and documented N+2 → next N+61, **from the actual time** |
| B | refused **early** | early at N+2 → N+62 |
| E | held early | **backdated to N−10, older than the hold at N** → timer kept (next = the skipped due + 1 h, **same minute as round 3, distinct `~r4`**); the audit names the kept timer; a subsequent Given then restarts it |
| C / G | held / refused **late** | **on time** → due + 1 h |
| D / J | held / refused **late** | **late** (1 h 32 m) → actual + 1 h |

Then, for every order:
- three refreshes return the identical current round;
- the stale round-3 identity returns 409;
- a **fresh read of the stored facts** shows the rounds, statuses, skipped
  slots, documenting times and reasons;
- **every history event** states its round and next due.

Finally `timerfix-client.ts` runs the **real client modules** over the orders
and MAR rows this server returned:
- the Orders next-dose chip and the printed MAR's "next dose due"
  (`nextExpectedDose`, which `buildMar` calls) equal the server MAR's current
  round;
- the printed cells carry the stored rounds;
- the Meds-Due / MAR-card due count is computed with its own predicate.

## Not re-run, and why

This patch changes only the round arithmetic and the audit wording. The lock,
the rendering components, the sidebar and the filters are untouched: `git diff
87358f2..eb616f9` shows no change in `OrderLogic.cs`, `OrdersApi.cs`,
`AdtApi.cs`, MarApi's lock lines, or any `.tsx`/`.css`. So these were not
repeated:

| Check | Last result |
|---|---|
| The concurrency campaign | 28/28, `../logs/concurrency-check.log` |
| The browser pass | 12/12, `../logs/browser-rolling.log` |
| The replayed deployed suites | `../logs/suite-*` |

The update-write/rollback **release gate** stays **UNRESOLVED** (see the
status record). No installer was changed or built.

## Tools

In `../tools/`. The local DB password is read from `AURORA_LOCAL_DB_PASSWORD`.

- `rollharness/scenarios.json`: R20–R25 are appended.
- `rollts/harness.ts`: adds the due count and the mock audit note.
- `rollts/check.py`: checks the due count and the audit note.
- `api-check-timerfix.py`: the real-API check. `TIMERFIX_API` / `TIMERFIX_DB`
  select the reviewed-head contrast server.
- `timerfix-client.ts`: the client-module check.
- `final-verify-timerfix.sh`: produced `logs/final/`.
