# Session 3 — nurse workflows and shared patient care: handoff evidence

*Written by Session 3 on `claude/icu-nursing-chart-nurse-workflows`. Synthetic data only; local
disposable PostgreSQL (`aurora_s3`, port 8093). No change to `main`, no PR, no merge, no installer or
EXE, no hospital access or deployment, no monitoring. The update-validation write barrier /
failed-health rollback release gate is untouched and stays UNRESOLVED. Shared docs and
`02_PROJECT_STATUS.md` are Session 1's; nothing outside Session 3's ownership was edited.*

## 1. Base and commits

| | SHA |
|---|---|
| Preparation base (`claude/icu-nursing-chart-prep`, verified before branching) | `05e92e2050c490393b36ab3fbb60a5acd81aeac3` (Amendment 1 included; not the superseded `9d68bca`) |
| Reviewed base (draft PR #234 head, an ancestor of the prep commit) | `2fc317ca4cb923abae1718a9a30ad9af8a7592ba` |
| `main` (unchanged) | `f0bf4647c7fb921baf760225bf838f69f655c697` |

The prep ref had not moved when the branch was created. Ordered commits on this branch:

1. `0fe049b` — nurse workflows: one shared MAR controller, nursing rounds, persisted I&O, PatientNurseCarePanel
2. `9e87e5b` — nurse-care panel: read the MAR only with orders.view; "Not recorded" never in a value colour
3. `78758b6` — evidence(session 3): focused-check tooling (docs only)
4. (this commit — README, logs, screenshots; docs only)

Changed source paths (`git diff --stat -M 05e92e2 9e87e5b`): `src/App.tsx` (provider wiring only),
new `src/features/nurse-care/{marController.ts, nursingController.ts, ioController.ts,
NurseCareProvider.tsx, PatientNurseCarePanel.tsx, IoPanel.tsx, nurseCare.css}`, moved
`src/pages/NurseWorkspace/{MarCard.tsx, marDays.ts}` → `src/features/nurse-care/` (`marDays.ts`
byte-identical), `src/pages/NurseWorkspace/{NurseWorkspace.tsx, OrdersCard.tsx, IoCard.tsx,
NurseWorkspace.css}`, deleted `src/pages/NurseWorkspace/TasksCard.tsx`. No `server/**`,
`src/lib/**`, `src/components/**`, `src/pages/MissionControl/**` or migration change.

## 2. Exported interface (for Session 2) and integration prerequisites

```ts
// src/features/nurse-care/PatientNurseCarePanel.tsx — named export, the frozen §6 signature
export function PatientNurseCarePanel({ patientId }: { patientId: string }): JSX.Element
// src/features/nurse-care/NurseCareProvider.tsx — already mounted by src/App.tsx inside
// <BrowserRouter>, outside <Routes> (nothing for Session 2 to wire)
export function NurseCareProvider({ children }: { children: ReactNode }): JSX.Element
export function useNurseCare(): NurseCare                       // { mar, nursing, io, showToast, addConsumer }
export function useMarView(patientIds: readonly string[] | null, tick: number)       // used by both screens
export function useNursingQueue(patientIds: readonly string[] | null, tick: number)  // Nurse Workspace
export function useIoSaving(patientId: string, encounterId: string | null): boolean
```

**Session 2:** `import { PatientNurseCarePanel } from '../../features/nurse-care/PatientNurseCarePanel'`
and render `<PatientNurseCarePanel patientId={patientId} />` in the nurse's chart
(`profileOf(session.jobTitle) === 'Nurse'`). It needs no other props, providers or CSS; it renders
two cards (MAR, I&O) stacked in a flex column and adapts to the width it is given (container
queries). Give it a full-width row or a column ≥ 320 px. Observation for Session 2: at a 390 px
viewport the existing chart grid measures 732 px (every chart card is 700 px), so the page scrolls
sideways at phone width; the panel itself, given the phone column (358 px), fits with nothing
overflowing (check V below). Session 3's checks mount the panel through a **harness-only** overlay
(`tools/contract-standin/harness-chart-placement.sh`), never committed into MissionControl.

**Session 1 (integration prerequisite):** this branch consumes the frozen contract and does not
build on its own until Session 1's commits are assembled with it. `tsc -b` on the bare branch fails
on exactly these names and nothing else (log `02-bare-tsc`): from `src/lib/api` —
`implementNursingOrder`, `NursingWriteResult`, `getPatientOrdersAuthoritative`, `getIoSnapshots`,
`recordIoSnapshot` (Amendment 1 signature), `IoRead`, `IoView`, `IoSnapshot`, `IoSnapshotDraft`,
`IoWriteResult`, `IO_SNAPSHOT_MAX_ML` (the §5.3 re-export of `ioSnapshots.ts` from `index.ts`);
`src/lib/nursingRounds.ts` — `nursingRoundState`, `isRepeatingNursing`, `lastNursingCompletion`,
`formatNursingInterval`, `newNursingAttemptId`, `nursingStampOf`, `displayNursingTime`,
`localizeNursingStamps`, `settleNursingAttempt`, `NursingPendingAttempt`; and `Order.nursing`
(types.ts). Nursing completion types are derived from `Order['nursing']`, so no import depends on
where `NursingCompletion`/`NursingRound` are declared. Adapters that became unused are left in
place (`getNursingTasks`, `toggleNursingTask`, `getIoEntries`, `recordIoEntry`, `IO_CATEGORIES`;
contract §2 — Session 1 decides).

## 3. What changed, against the brief

**Nurse Workspace.** Nursing Tasks card, the Tasks Open KPI, their fetch/state/toggle code and
`TasksCard.tsx` are gone; the demo I&O worksheet is replaced. Orders to Implement and the SBAR
handoff are kept. KPIs: My Patients, Meds Due (unchanged), **Orders Due** (actionable now only).

**Orders to Implement — nursing rounds** (`nursingController.ts`, `OrdersCard.tsx`). One row per
order showing its one current round: interval ("every 2 h" / "one-time"), round number, due or
"Next due" in hospital time to the second (`displayNursingTime`), the last completion and a
keyboard-operable completion history. A locked round stays visible with its opening time; Done is
disabled until exactly `dueMs` and a timer opens it without reload; an open round 30 min past its
due time reads OVERDUE and stays actionable. The header splits "N due now · M upcoming". Only Done
exists (no Held/Refused). The order-ID-only completed set is gone: the display uses each order's
freshest version (a read by start order, or a write answer), so a repeating order shows its next
round instead of disappearing. Done: one attempt id per deliberate click, an immediate per-order
lock, controls disabled through the save and an authoritative per-patient read started after the
answer. Unanswered → **unconfirmed**, stored as `NursingPendingAttempt[]` under
`aurora.nursingUnconfirmed:<nurse>`; "Retry saving" re-sends the identical `{ roundId, attemptId }`.
A refused retry (401 included) keeps it unconfirmed with the reason (Amendment 1 §9.2); only
`settleNursingAttempt` over `getPatientOrdersAuthoritative` settles it. Legacy one-time orders keep
the existing empty request.

**One shared MAR implementation** (`marController.ts`, `NurseCareProvider.tsx`). The page-local
logic moved without a rule change: attempts/ids, saving/settling/unconfirmed, settlement only from
authoritative reads applied in start order (older reads discarded whole), pinned-minute retry with
its 400 fallback to the original request, the 5 s recheck, rolling timers/first dose/continuous/PRN
exceptions/later-round lock/overdue reasons/backdating (all in the unchanged MarCard, marDays and
server). New: one controller per tab, so locks, in-flight requests and outcomes survive
`/nurse` ⇄ `/patients/:id` and patient switches; each attempt captures its patient (`patientId`,
an optional addition to the stored `MarAttempt` shape — attempts stored by the previous build
still restore and learn their patient from the first MAR row of their order); every settling read
covers the patient of every lock; the controllers follow the signed-in nurse.

**I&O** (`IoPanel.tsx`, `ioController.ts`, workspace `IoCard.tsx`). Latest manual values from
`io_current_intake_ml` / `io_current_output_ml` via the contract adapters: 500 then 200 shows 200
with both in history; 0 is a value; absent = "Not recorded"; balance only with both; units,
hospital time, recorder, amendment history (effective value); no midnight reset; current admission
only. Editor keyed to patient + admission; a 409 after discharge/readmission clears the typed
values and says so. One save per patient + admission in flight (guard survives remount); refused
saves keep the values; unanswered saves say "not confirmed — check the history", never resend. No
demo state: with no server the panel says I&O is unavailable. The workspace wraps the same panel
in a patient selector; the chart fixes the patient.

**PatientNurseCarePanel.** The patient's MAR cards (same controls/dialog/locks/daily cards) and
I&O. Reads the MAR only with `orders.view` (the server's read permission), shows documenting
controls only with `meds.administer`, I&O entry only with `observations.record`. Clears at once on
a patient change; late responses for another patient never render.

## 4. Checks run (source `9e87e5b`, once, by `tools/final-verify-s3.sh`)

Run 2026-10-16 00:24 UTC on `9e87e5be1d404b0b41f9b78972a592d2c9392ea5` (source taken with
`git archive`, tools as committed in the evidence commit `78758b6`); every step's command and exit
code is in `logs/SUMMARY.txt`. Browser: Chromium (Playwright), device zone UTC; server zone
Asia/Baghdad.

| Step | What | Result |
|---|---|---|
| 02 | `tsc -b --force`, bare branch (no stand-ins) | exit 2 **as expected**: only Session 1's contract names / `Order.nursing` are missing (`logs/02-bare-tsc.log`) |
| 04, 05 | `tsc -b --force` + `vite build`, branch + stand-ins | pass |
| 06 | controller harness (real extracted controllers, fake clock) | **74 passed, 0 failed** — MAR M1–M10, nursing rounds N1–N11, I&O guard I1 |
| 06b | mutation check (2 deliberate rule breaks in a scratch copy) | harness failed 8 checks on the mutated tree, as required |
| 08 | previous round's daily-card / midnight harness on the moved `marDays.ts` (UTC, Los Angeles) | 25/25 · 25/25 |
| 08 | previous round's first-dose / safe-retry mirror harness (UTC, Los Angeles) | 46/46 · 46/46 |
| 12 | previous round's MAR safe-retry browser suite against the extracted controller (real server; v2 copy, base/DB only) | **41 passed, 0 failed** (F, S1, S1b, S2, S3, S4) |
| 14 | Session 3 browser suite | **62 passed, 0 failed** — W 3, R 16, X 11, P 1, I 15, K 3, Q 4, V 8 + no page errors |

Coverage against the brief: duplicate task panel removed (W); one-time vs repeating Done, double
click, exact unlock 7 ms after the due instant without reload, future rows visible, counts, legacy
empty request, unconfirmed → retry with the identical pair, refused 401 retry kept unconfirmed,
original committing later → exactly one completion (R; N1–N11); MAR route and patient transitions
during saving / unconfirmed / lost saves, retry, reload recovery (X; M1–M10; suite 12); patient
switch display (P: 93 samples over 4 s, no row of the previous patient); daily cards and midnight
grouping (step 08); I&O 500→200, zero, Not recorded, balance, history, amendment, no midnight
reset, refused/unanswered saves, double click, workspace selector, discharge + readmission 409 with
the new admission blank and the old one's snapshots kept (I); keyboard (K); permissions (Q); light,
dark, 1440 px and 390 px (V).

Kinds of evidence, honestly labelled:
- **Real modules.** The controller harness bundles the real `src/features/nurse-care/*` with a fake
  clock and controlled transport. The MAR "server" there is the app's own mock adapter
  (`applyAdministration`/`deriveMarRows`, the shipped mirror of the server rules).
- **Real server.** The MAR, ADT, roster and orders in both browser suites are the real ASP.NET
  server + PostgreSQL from the prep commit's `server/` (this branch does not change `server/`).
- **Contract stand-ins / simulator — not Session 1's code.** Session 1's nursing-round and I&O
  endpoints and client adapters do not exist on this branch. The scratch build overlays
  contract-faithful stand-ins (`tools/contract-standin/*.standin.ts`) at Session 1's paths, and the
  browser suite answers exactly the nursing-implement / I&O snapshot requests from a simulator
  written from contract §3.3/§3.4/§5 and Amendment 1. These results must be re-run once on the
  assembled source: `run-controller-harness.sh <integrated tree>` needs no stand-in; in
  `s3-browser.cjs`, scenarios W, X, P, K, Q, V run as they are, while R and I seed through the
  simulator and need real nursing orders / the real I&O endpoints at integration.

## 5. Screenshots (`screenshots/`)

| File | Shows |
|---|---|
| `W-workspace-dark-1440.png` | Nurse Workspace: no Nursing Tasks / Tasks Open; MAR, I&O, Orders to Implement, handoff |
| `R-orders-to-implement-dark.png` | Orders to Implement: one-time, repeating (round, next due, last done, history, lock line), counts |
| `X-chart-panel-unconfirmed-dark.png` | chart panel: an unanswered MAR save — "Not confirmed" + Retry saving, controls locked |
| `saferetry-dark-desktop-unconfirmed-retry-saving.png`, `saferetry-light-narrow390-unconfirmed-retry-saving.png` | the previous round's safe-retry suite on the extracted controller |
| `I-io-panel-dark.png` | I&O: 200 mL current intake after 500, 0 mL output, +200 mL balance, history |
| `I-workspace-io-dark.png` | the same I&O panel in the workspace, behind its patient selector |
| `Q-chart-panel-doctor-readonly-dark.png` | a doctor: MAR read-only ("view only"), I&O entry available |
| `V-chart-panel-light-1440.png`, `V-chart-panel-dark-390.png` | the panel in light at 1440 px and dark in a 358 px phone column |
| `V-orders-light-390.png`, `V-workspace-io-light-390.png`, `V-workspace-io-dark-1440.png` | narrow and wide layouts, both themes |

The amber stripe in some captures is the staging environment banner; a hidden toast can appear as an
empty pill in tall element captures (screenshot mechanics, not page state).

## 6. Observations and contract requests

1. **Pre-existing, outside Session 3's files — `src/components/DataAge.tsx` shows hospital time
   twice-converted.** It renders `displayStamp(localStamp(at))`: `localStamp` already gives the
   hospital wall time and `displayStamp` converts it again, so on a UTC+3 server every chip reads
   +3 h (e.g. "Live · 06:11" at 03:11 — the existing "Lists" chip in the Nurse Workspace shows the
   same). `src/components/**` is read-only for Sessions 2/3; reported to Session 1. Likely fix:
   `formatHm(localStamp(at).slice(11))` (or `displayStamp` of the UTC wire form).
2. **Chart grid at 390 px** — see §2 (Session 2's layout).
3. **Engineering choices for review:** OVERDUE after 30 min past due for nursing rounds (the MAR's
   due-soon constant; actionable throughout); the KPI label "Orders Due" counts due-now work; a
   legacy one-time Done goes through `implementNursingOrder` with no body (the contract's empty
   request) and an unanswered one is not persisted (the stored shape needs `roundId`/`attemptId`;
   it settles when the record shows the order no longer active, and a one-time order cannot
   complete twice); outcome toasts are shown while a nurse-care screen is mounted (the per-order
   notice stays either way).
4. No contract change is requested.

## 7. Reproduce

```
export S3_WORK=<scratch> S3_APP=<dotnet publish of server/> S3_JWT_FILE=<local secret file> \
       AURORA_LOCAL_DB_PASSWORD=<local password>   # never committed
bash docs/evidence/icu-nursing-chart/session3/tools/final-verify-s3.sh <commit>
```
