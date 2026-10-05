# Evidence — first ICU update batch (review copy)

Review evidence for the draft PR that carries `docs/design/icu-update-batch-1.md`.
Everything here was produced on 2026-09-29/30 (UTC) in the implementation
container, against **synthetic data only**: the seeded demo roster plus
synthetic patients and drugs created for the checks. No hospital system, no real
clinical data, and never the retired hosted test service.

**This folder is review evidence, not product.** It is docs-only: nothing under
`docs/` is compiled by `tsc` (`src` only) or by the server project (`server/`
only). It was added in its own final commit so the owner can drop that commit
before merging if they would rather not keep evidence in history.

## What was verified, and against which commit

| Commit | Content |
|---|---|
| `3c4850f` | design recorded verbatim (`docs/design/icu-update-batch-1.md`) |
| `bf744c5` | MAR design Amendment A (pure append) |
| `b292720` | late-dose re-timing (server + client) |
| `6c7ebcb` | order-type filters |
| `5c80918` | collapsible section sidebar (**the source every check ran on**) |
| `53b8733` | `02_PROJECT_STATUS.md` record (docs only; both builds re-run on it) |

`verification-summary.txt` lists every final command with its exit code, in
order. **All final steps exit 0.** Steps 12 and 12b failed because of the replay
runner, not the product: first a missing unique `GITHUB_RUN_ID` caused a drug-id
collision; then the kept synthetic patients left no free bed. Step 12c, after
both runner fixes, is the pass. The summary's paths point into the original,
now-discarded container; the matching files are here under the names below.

| File | What it shows |
|---|---|
| `verification-summary.txt` | every command + exit code (builds, `ci.yml` frontend/server steps, harnesses, suites, API, browser) |
| `schedule-before-after.txt` | **exact before/after schedules**: base `f0bf464` vs this branch, 17 scenarios, deterministic clock |
| `logs/harness-cs.json`, `logs/harness-ts.json`, `logs/07-parity.log` | server (real `MarLogic`/`MarSchedule` sources) vs client (real mock adapter + Orders chip): **0 mismatches** |
| `logs/harness-before.json` | the same scenarios on the base commit's sources |
| `logs/13-api-check.log` | **33/33** real-API re-timing checks (real server + PostgreSQL 16); this run crossed midnight |
| `logs/15-api-check-keep.log` | 31/31, the same run minus discharge (it kept the patient admitted for the browser checks) |
| `logs/11-suite-mar-e2e.log`, `logs/12c-suite-orders-e2e-rerun.log` | the repo's `deployed-mar-e2e` (9/9 steps) and `deployed-orders-e2e` (12/12) replayed locally; their 3 hosted-service gate steps are skipped (stated in each log) |
| `logs/14-agreement.log`, `logs/agreement-snapshot.json` | server MAR = Orders next-dose chip = printed MAR cells, for all 8 synthetic medication orders |
| `logs/16-browser-verify.log` | **101/101** browser checks (Chromium) |
| `logs/17-browser-sweep.log` | 23 screens: collapsed 64px → expanded 198px (220px on Backup & Recovery), labels + content follow |
| `logs/18-browser-mar-print.log` | nurse MAR rows + printed MAR cells for the re-timed patient; Meds-Due KPI 9 = MAR card 9 |
| `logs/21…26-ci-*.log` | `ci.yml` frontend + server job steps run locally (tsc --force, vite build, 4 structural gates, env allow-list, dotnet build, vocab gate) |
| `logs/healthz.json` | the server under test: `staging`, `edition: icu`, AI disabled, build `5c80918` |

## Screenshots (`screenshots/`, light theme, Chromium)

These are JPEG re-encodes of the original PNG captures (re-encoded to keep this
commit small; the pixels are the same screens).

| File | Viewport · role · what to look at |
|---|---|
| `desktop1440-doctor-beds-collapsed.jpg` / `-expanded.jpg` | 1440×900 · Consultant · nav / main / bed panel (3 columns): the rail frees 134px for main |
| `desktop1440-doctor-orders-collapsed.jpg` / `-expanded.jpg` | 1440×900 · Consultant · nav / patient rail / main |
| `desktop1440-doctor-labs-expanded.jpg` | 1440×900 · Consultant · Labs & Imaging |
| `desktop1440-doctor-labentry-collapsed.jpg` / `-expanded.jpg` | 1440×900 · Consultant · Lab Entry |
| `w1180-doctor-lab-entry-expanded.jpg` | 1180×820 · Consultant · labels expand at the old icon-only breakpoint |
| `w1000-doctor-orders-expanded.jpg` | 1000×800 · Consultant · labels below the old breakpoint, content pushed |
| `phone390-nurse-orders-collapsed.jpg` / `phone390-nurse-labs-expanded.jpg` | 390×844 touch · Staff Nurse · tap toggle; overlay drawer (column stays 64px) |
| `tablet1024-nurse-labs-expanded.jpg` | 1024×768 touch · Staff Nurse · toggle opened, push layout |
| `short1280x480-doctor-orders-expanded-scrolled.jpg` | 1280×480 · Consultant · the nav scrolls to its last item |
| `desktop1440-nurse-landing-expanded.jpg` | 1440×900 · Staff Nurse · 14 sections |
| `desktop1440-it-administrator-landing-expanded.jpg` | 1440×900 · IT Administrator · 4 sections |
| `desktop1440-doctor-orders-completed-imaging.jpg` | 1440×900 · Consultant · Completed + Imaging → combined empty state |
| `desktop1440-doctor-orders-P1004-active-medication.jpg` | 1440×900 · Consultant · Medication + Active kept across an in-app patient switch |
| `desktop1440x1100-nurse-mar-P-1022-retimed.jpg` | 1440×1100 · Staff Nurse · MAR with "↻ next dose re-timed", across midnight |
| `desktop1440x1100-nurse-print-mar-P-1022.jpg` | 1440×1100 · Staff Nurse · printed MAR sheet for the same synthetic patient |

No role showed Reception, Awaiting Bed or AI Assistant. The full role lists are
in `logs/16-browser-verify.log` §[6].

## Tools (`tools/`)

The harnesses and scripts that produced the logs, kept for re-running. Their
absolute paths are the original container's, so adjust them before use.

- `marharness/`: a C# console project that compiles the **real** `server/Core/**`
  sources, plus the scenario file.
- `marharness-before/`: the same harness against a worktree of the base commit.
- `tsharness/`: bundles the **real** client modules with esbuild under a fake clock.
  Also here: the parity comparison, the before/after renderer and the live agreement check.
- `api-check.py`: the real-API re-timing check.
- `run-suite.py`: replays a `deployed-*-e2e.yml` workflow against `localhost`.
- `run-server.sh`: the local stack launcher. Set `AURORA_LOCAL_DB_PASSWORD`; the JWT secret is read from a file.
- `browser/`: the Playwright checks, plus the JPEG re-encoder.
- `final-verify.sh`: produced steps 01–10 of the summary.

The database was touched directly for exactly two synthetic setups, both
stated in `api-check.py`: backdating a synthetic order's "signed" event, and
inserting one pre-update ("legacy") late fact. Every order and every
documentation otherwise went through the real endpoints.

## Correction (after Codex's review, 2026-09-30)

The follow-up commits that correct this batch have their own evidence in
[`correction/`](correction/README.md). They cover the owner's rolling timer
(MAR Amendment B), atomic documentation under the order row lock, and the
corrected rollback statement. The re-timing evidence above (`scheduleAnchor`,
the floor rule, missed rows) describes the superseded first version and is kept
as the record of what was built then.

## Follow-up: sidebar hover + daily MAR cards (`sidebar-mar-cards/`)

Two owner-approved refinements (2026-10-04, after Codex's review passed at
`def08a9`): the sidebar keeps its hover across section changes, and the nurse
MAR shows one card per prescription per hospital day. Their proof is in
`sidebar-mar-cards/` (see `sidebar-mar-cards/README.md`).

## Follow-up: one action per medication round (`one-action-per-round/`)

The owner's correction (2026-10-05, after Codex verified `dacab4e`): a
scheduled dose can be documented only from its exact scheduled time, with
immediate submission protection on every MAR action. Continuous and PRN
documentation intervals are recorded as unresolved, because no source defines
them. Its proof is in `one-action-per-round/` (see
`one-action-per-round/README.md`).

## Follow-up: the owner's decisions + safe retry (`safe-retry-first-dose/`)

The owner's decisions and the settlement correction (2026-10-05, after Codex
verified `d66c6cf`):
- Continuous stays available when needed and PRN as needed, with no interval.
- The first dose is open on signing; later rounds stay locked.
- An unanswered MAR save is settled only from the record, through a
  server-deduplicated `attemptId`, and Retry saving re-sends the same attempt.

Both of Codex's failures were reproduced on the pre-change build first. Its
proof is in `safe-retry-first-dose/` (see `safe-retry-first-dose/README.md`).
