# ICU nursing orders + nurse patient chart — integration evidence (Session 1 assembly)

Draft PR #234, branch `claude/amazing-hopper-nwzw1x`. **Local, synthetic verification only — not
release approval, not hospital or deployed acceptance.** No change to `main` (`f0bf464`), no merge,
no installer/EXE, no hospital access or migration, no deployment, no ongoing monitoring. ICU edition,
AI disabled, English interface.

## 1. What was assembled

| Ref | Commit | Notes |
|---|---|---|
| PR branch before integration | `2fc317ca4cb923abae1718a9a30ad9af8a7592ba` | the reviewed head (first ICU batch + safe retry); live ref verified unchanged before integrating |
| Prep (contracts + Amendments 1, 2) | `ede8358736eb041e6a62143a0b5c1903a7ed4966` | |
| Session 1 — nursing orders + shared backend | `2fb4eb8fe15a049281a353818db943e64a14d536` (product `5eac7445fa8c…`) | merged as `7845d26` |
| Session 2 — patient chart (incl. its committed care-panel insertion) | `c88b3dce3ee9110c5c309407b8399d14690f9fe2` (product `5315769c0d70…`) | merged as `4fbddc5` |
| Session 3 — nurse workflows + shared patient care | `681198a440bae27722b704296f2e60526d4d23ae` (product `9e87e5be1d40…`) | merged as `0cc9264` |
| Correction 1 — DataAge single hospital-clock conversion | `0f56e8a20ce06f6eaa727c89ed00ef905ee5b5d1` | contract §11.1 |
| Correction 2 — no invented nursing OVERDUE cutoff | **`4f1009de6271c461d385bf60c6934ec4d1a431cd`** | contract §11.2 — **the last code commit** |

The assembled source uses Session 1's real shared API exports (`src/lib/api`), nursing helpers
(`src/lib/nursingRounds.ts`), admission-bound I&O adapter (`getIoSnapshots` / `recordIoSnapshot`)
and server; the chart's care panel is Session 2's committed insertion of Session 3's
`PatientNurseCarePanel`. No test stand-in or harness-only insertion is in the product source.
`git diff 5eac744 4f1009d -- server` is empty, so Session 1's server/API evidence stands for the
server half. Everything after `4f1009d` on the branch is documentation/evidence only (§7).

## 2. What was run, on which source

All runs are on the committed source **`4f1009d`** (a clean worktree; server published with
`dotnet publish -c Release`, bundles built from the same tree).

| Log | Result | What it is |
|---|---|---|
| `logs/00-builds-and-gates.log` | all exit 0 | once: `tsc -b --force`; `vite build`; the production and staging bundles; the `VITE_APP_ENV` allow-list gate (refuses an unknown value); the five `ci.yml` node gates; `dotnet build -c Release` (the one pre-existing CS8602 warning, `BootGuards.cs:103`) |
| `logs/01-controller-harness-assembled.log` | **74/74** | Session 3's controller harness, unchanged, on the assembled tree (real `src/features/nurse-care` + Session 1's real `src/lib/api` and `nursingRounds`; fake clock; the MAR "server" there is the app's shipped mock adapter — Session 3's harness design) |
| `logs/02-mar-saferetry-replay-assembled.log` | **41/41** | the MAR safe-retry / first-dose / rolling-timer browser scenarios (Session 3's `saferetry-*.v2`, unchanged) replayed against the assembled build: staging bundle served same-origin by the assembled server, **real ASP.NET + PostgreSQL**, the extracted MAR controller inside the real provider |
| `logs/03-prod-boot-and-setup.log` | **23/23** | the PRODUCTION pairing on a fresh disposable database: `APP_ENV=production`, starter formulary, bootstrap admin; `integration-setup.py` (accounts, formulary reactivation, five admissions — see Topology) |
| `logs/04-integration-check-main.log` | **110/110** | `integration-check.mjs main` — the combined browser/API acceptance (§3) |
| `logs/05-orders-medication-ui-check.log` | **38/38** | Session 1's `session1/tools/ui-check.mjs`, unchanged, on its own patient: the **Orders & Medication** Done entry point and the New Nursing Order form on the assembled production pairing |
| `logs/06-restart.log` | restarted | the server stopped and restarted on the same database |
| `logs/07-integration-check-post-restart.log` | **8/8** | `integration-check.mjs post` — state identical after the restart |
| `logs/08-base-restricted-role-probe.log` | info | `tools/base-restricted-role-probe.sh`: attribution of the one restricted-role finding on the pre-integration head `2fc317c` — a production bundle built from `2fc317c`, Session 1's base server publish of `2fc317c`, port 8081, its own disposable database (§5) |

One-pass runner: `tools/run-integration.sh <server publish> <production bundle> <commit>`
(`SCRATCH` = the session scratchpad holding `db.pw`, `jwt.secret`; generated credentials stay there).

### Topology, and what is synthetic

- **Genuine same-origin production pairing:** the assembled server publish serves its own production
  bundle (`VITE_APP_ENV=production`) from `wwwroot` on `localhost:8080`, `APP_ENV=production`, local
  disposable PostgreSQL 16 (`aurora_nursing_prod`, dropped and recreated). The production boot guards
  ran for real (formulary seed, non-localhost CORS origin, JWT secret, first-boot admin bootstrap).
- **Synthetic accounts**, each created individually by the bootstrap administrator and taken through
  its own forced first-login password change: Consultant, Staff Nurse, Charge Nurse, Clinical
  Pharmacist, Respiratory Therapist, Physiotherapist, Receptionist. Their roles are the shipped
  profiles; **no permission was granted or changed for any test**. The pharmacist reactivated two
  starter drugs (the production formulary ships deactivated). Five synthetic admissions.
- **Every nursing completion, MAR documentation and I&O read/write reached the real assembled server
  and database.** No business endpoint was answered by a simulator.
- **Controlled transport (labelled where used):** Playwright routing on the browser's own requests —
  *delays* (reads held 3–6 s, below the 8 s client timeout), *response loss* (the original request
  is held so the page sees no answer, then delivered unchanged to the real server by the harness; or
  `route.fetch()` lets the real server commit and the page sees no answer), and *401 injection* (the
  request is sent to the real server with an expired bearer token; the real server answers 401).
- Browser: Playwright Chromium only. Hospital zone `Asia/Baghdad` (the server's `TZ`); the DataAge
  section runs the browser in `America/Los_Angeles`.

## 3. Results by risk (`04`, `05`, `07`)

Counts are from the final run's logs; each bullet names its section (`[D]` … `[R]`) in
`logs/04-integration-check-main.log`, `logs/05-orders-medication-ui-check.log` (`[OM]`) and
`logs/07-integration-check-post-restart.log` (`[R]`).

**Correction 1 — DataAge on a UTC+3 hospital, a UTC−7 device, 24h and 12h `[D]`.**
- The browser ran in `America/Los_Angeles`; the display clock was primed from the server
  (`Asia/Baghdad`). Every data-age chip on the workspace (Lists, I&O) and the chart (chart read,
  MAR, I&O, imaging) showed hospital time — never the device's time and never the old
  double-converted time (+3 h) — and each tooltip carried the same time. 24h ("Lists Live · 13:32"),
  then 12h set through the real Settings control ("Lists Live · 1:32 PM").
- Nursing times stay to the second in both preferences: "Due 13:32:00" / "Due 1:32:00 PM";
  "🔒 Opens 14:32:33 …" / "🔒 Opens 2:32:33 PM …".
- Server refusal stamps (a stale page: another nurse completed the round first) read
  `yyyy-MM-dd HH:mm:ss` hospital time in both preferences, equal to the server's millisecond stamp
  converted ("…completed by RN Lina Synthetic at 2026-10-16 13:32:33", server `10:32:33.033Z`).
  Full-date stamps stay 24h — the app's existing `displayFullStamp` convention; short times follow
  the preference.

**Correction 2 + direct nursing entry, Nurse Workspace `[W]`.**
- A late one-time round stays **DUE** with the elapsed time as a fact ("Due 13:32:00 (1 min since
  due)"); no OVERDUE label anywhere; the Orders Due KPI and "7 due now · 2 upcoming" count
  actionable rounds.
- Pending order absent from the queue; once signed (doctor, real API) it shows round 1 DUE
  ("every 2 h"); minutes and hours intervals render ("every 30 min", "every 1 h").
- **Double click → exactly one implement request**; the late one-time Done recorded once (due
  `10:32:00.000Z`, done `10:33:03.411Z`) and the order left the queue.
- **Legacy one-time order:** Done sends the empty request, completes it, invents no nursing data.
- **Exact full-interval unlock:** every-1-min order — round 2 due = completion + 60 000 ms exactly;
  UPCOMING and disabled before, still locked 400 ms before, **enabled 3 ms after the due instant**
  (measured in the page, no reload), then DUE.
- **Unresolved attempt after a refused retry:** the original request held (no answer) → "⚠ Not
  confirmed", Done locked; restored after a **reload**; still unconfirmed after the 5 s
  authoritative re-check; **Retry** re-sent the same `{ roundId, attemptId }`, the real server
  answered **401** → still unresolved, nothing written; the held original then reached the real
  server and committed → confirmed from the authoritative read, **exactly one completion**; the
  late Done timed round 2 from the recorded completion + 30 min.
- **Discharge:** Done on a just-discharged admission → **409** from the real server ("encounter …
  is not open …"), shown on the row and in a toast, nothing written; the order left the queue
  (record: discontinued).
- No page errors, no 403 responses.

**Orders & Medication entry point `[OM]`** — Session 1's `ui-check.mjs`, unchanged, on its own
patient: the doctor's New Nursing Order form (one-time
default; 0 min, 49 h, 2.5 h and 2881 min refused; 48 h and 1 min accepted; Pending and Sign & order)
and the Nursing type filter; no Done control for the doctor and no order form for the nurse; a
one-time Done; a repeating round **unlocked 3 ms after its due instant** without a reload; the held
original + a **401 retry stays unconfirmed**, then the delayed original **confirmed from the
authoritative read** (4.9 s after it committed) with exactly one round-2 completion; a legacy order
keeps ✓ Implement with the empty request; no nursing order on the MAR; dark and 390 px (the form has
no internal overflow; the page's 58 px overflow at 390 px is pre-existing — Session 1 README,
limitation 5).

**Nurse patient chart `[C]`.**
- Doctor chart: SOFA + NEWS2, no care panel. Nurse chart: **this patient's MAR (Vancomycin only) +
  I&O; no SOFA, no NEWS2.**
- **One pending MAR attempt across navigation:** a Given on the chart (double click → one request)
  with its answer withheld → unconfirmed and locked; **the same attempt** unconfirmed and locked in
  the Nurse Workspace after client-side navigation (no reload) while another patient's dose stays
  open; a patient switch shows only that patient's MAR; back on the first patient it is still
  unconfirmed; after a **reload** + 5 s re-check; after **sign-out + sign-in as the same nurse**;
  **never visible to a different nurse** in the same tab; the retry re-sent the same attempt, the
  real server answered 401 → still unconfirmed, nothing written; the held original committed →
  confirmed, **exactly one given fact** with the original attempt id.
- The rolling-timer / safe-retry MAR scenarios against the extracted controller: `logs/01` (74/74)
  and `logs/02` (41/41, real server + PostgreSQL).

**I&O through the UI on the real server `[I]`.**
- New admission: Not recorded / Not recorded / balance "—" (needs both); empty history.
- One-value save → one entry, bound to the open admission (`expectedEncounterId`).
- **500 then 200 shows 200**; both in the history, newest first. **Zero** output is a value
  (balance +200 mL). **Both values** in one save → 300 / 120, +180 mL.
- **Response loss** after the real server committed → "Not confirmed", sent once (never resent),
  the re-read shows the recorded 350 mL. **401** → "Not saved — session expired", nothing written,
  the typed value kept.
- **Amendments** (the existing correction API): current intake = the effective 360 (charted 350,
  "amended"); amending the OLDEST entry (500 → 550) never makes it current; balance +240.
- **Snapshots never enter fluid totals or scores:** after 7 snapshots the doctor's fluid strip
  ("+650 mL", charted interval fluids), SOFA and NEWS2 are byte-identical.
- The workspace selector shows the same record; switched to another patient → that patient's own
  (blank) record.
- **Stale admission-A form:** values typed for admission A; A discharged and the patient readmitted
  as B (reads held so nothing re-keys the form); Save → sent bound to A → **409** from the real
  server; the typed values cleared with the reason shown; **nothing written in B, A unchanged**;
  **B starts blank.**

**Patient switching with delayed reads `[S]`** — nurse and doctor: the previous patient's reads held
3 s, then a switch: nothing of the previous patient rendered (Bedside, MAR, I&O / fluid strip are the
new patient's).

**Real-role permissions `[P]`** (shipped profiles, nothing granted):
- Clinical Pharmacist, Respiratory Therapist: full chart, no 403; Orders & Medication view-only (no
  Done / Implement control).
- Pharmacist, RT, Physiotherapist, Receptionist: **this update's composites (I&O, MAR panel, nursing
  queue) make no reads and no 403s for them**; no care panel; the Nurse Workspace does not open, and
  no MAR / queue / I&O read is attempted from it.
- **Physiotherapist and Receptionist: pre-existing forbidden reads** — see §5.

**Layout and themes `[T]`.**
- 390 px: **the care panel fits** on the nurse chart (378 of 390 px, no inner overflow); the
  workspace MAR, Orders to Implement and I&O cards fit; page-level horizontal overflow 0 px on the
  nurse chart, the workspace and the doctor chart. (The earlier 390 px scroll from the old I&O
  worksheet's totals row is gone with the worksheet.)
- Dark and light rendered for doctor chart, nurse chart and workspace.

**Compact API on the assembled server `[A]`.** 6 simultaneous copies of one attempt → all 200,
**one** completion; 4 competing attempts → one 200 + three 409, one completion; early round 409
("not due yet — it opens at …"); stale round 409; absent order + invalid body → **404** before any
400 (Amendment 2); shape errors 400; doctor implement 403; a discharged admission's order 409;
pharmacist I&O write 403 with nothing written.

**After a server restart `[R]`:** the server process stopped and restarted on the same
database: I&O rows (both admissions of the readmitted patient included), every order's status,
nursing completions and current round, and the MAR facts are identical to the pre-restart snapshot;
the nurse chart shows the same I&O (360 / 120 / +240 mL) and the given dose; the workspace keeps the
30-minute order's recorded round 2.

## 4. Screenshots (`screenshots/`)

| File | Shows |
|---|---|
| `01-doctor-chart-light.png`, `02-doctor-chart-dark.png` | doctor chart: SOFA + NEWS2, the charted-fluids strip, no care panel |
| `03-nurse-chart-light.png`, `04-nurse-chart-dark.png` | nurse chart: no SOFA/NEWS2; this patient's MAR + I&O panel |
| `05-nurse-workspace-light.png`, `06-nurse-workspace-dark.png` | Nurse Workspace |
| `07-workspace-orders-due-upcoming.png` | Orders to Implement: DUE with "N min since due", UPCOMING with "Next due …" (no OVERDUE) |
| `08-workspace-nursing-unconfirmed-after-401-retry.png` | an unresolved nursing Done after a refused (401) retry |
| `09-chart-mar-unconfirmed.png`, `10-workspace-mar-same-attempt-unconfirmed.png` | the same unconfirmed MAR attempt on the chart and, after navigation, in the workspace |
| `11-io-panel-values.png` | I&O: 300 / 120 mL, balance +180, history |
| `12-io-stale-admission-409.png` | the stale admission-A save refused; values cleared; admission B blank |
| `13-dataage-12h-workspace-orders-refusal.png`, `13b-dataage-12h-header.png` | 12h: chips, "Opens h:mm:ss PM", a refusal stamp to the second |
| `14-nurse-chart-390.png`, `15-workspace-390.png`, `16-doctor-chart-390.png` | 390 px |
| `17-pharmacist-chart.png` | a restricted clinical role's chart (no care panel) |
| `19-physiotherapist-chart-preexisting-refusal.png`, `20-receptionist-chart-preexisting-refusal.png` | the pre-existing access refusal (§5) |
| `18-after-restart-nurse-chart.png` | the nurse chart after the server restart |
| `orders-medication/` | Session 1's `ui-check.mjs` captures from this run (form, Nursing filter, locked / unconfirmed / confirmed rows, dark, 390 px) |


## 5. Findings

1. **Pre-existing defect, unresolved — restricted roles cannot open a patient chart in production.**
   A Physiotherapist (AlliedHealth: no `orders.view`) or a Receptionist (Administrator: no
   `orders.view` / `results.view`) opening `/patients/:id` gets 403 on
   `/api/icu/orders?patientId=…` (and, for the Receptionist, `/api/icu/results/labs?patientId=…`),
   and the production access refusal ("YOU DON'T HAVE ACCESS TO THIS AREA — orders") replaces the
   chart. The reads come from the chart's score hook (`src/hooks/usePatientScores.ts`) and its detail
   composite (`getPatientDetail`), which read orders and lab draws for every role. **Not introduced
   by this update:** the same reads are on `main` `f0bf464`, and the pre-integration head `2fc317c`
   reproduces it (`logs/08-base-restricted-role-probe.log`). This update's own composites (I&O, the
   MAR panel, the nursing queue) make no reads for these roles. **Not changed here:** no permission
   was granted, and the fix needs a decision on what SOFA/NEWS2 show to a role that may not read
   orders or labs. A likely shape: gate those reads by permission (as `getUnitSummaryDerived` already
   does for `results.view`) and drop `getPatientDetail`'s now-unused orders read (Session 2's pruning
   request, `../session2/README.md`).
2. **Observation, not changed — countdown granularity.** Right after a completion the lock line can
   read one minute high for up to 30 s ("Opens 13:34:03 (in 2 min)" for a round opening in ~60 s;
   "(in 1 h 01 min)" for 60 min): the countdown uses the 30 s render tick (`useNow()`), as the MAR
   card's existing lock line does. The stated opening time and the unlock itself are exact (enabled
   3 ms after the due instant).
3. No defect was found in the assembled update's own behaviour on the checks above.


## 6. Reused evidence (unchanged behaviour — not repeated)

- **Server / API** (`git diff 5eac744 4f1009d -- server` is empty): Session 1's
  `../session1/` — nursing lifecycle on the real API + PostgreSQL 63/63, I&O snapshots + admission
  binding 25/25, in-place upgrade of an existing install 15/15 (every pre-existing order and
  catalogue row byte-identical), clean production install 7/7, restart 3/3 + 11/11, and the repo's
  `deployed-orders-e2e.yml` (13/13 steps) and `deployed-observations-e2e.yml` (12/12) replayed.
- **Session 2's synthetic chart-insertion suite** — not repeated, as instructed; the real insertion
  is exercised here on the real server.
- **Session 3's** contract-simulator browser legs for nursing/I&O were deliberately **not** used; the
  same behaviours are covered here against the real server.

## 7. Product-source equality for the evidence commits

The final checks ran on `4f1009d`. The commits after it change only `docs/` (this directory, the
contracts doc's §11, notes in the Session 2/3 READMEs, `02_PROJECT_STATUS.md`). Verified with
`git diff --stat 4f1009d <head> -- . ':(exclude)docs' ':(exclude)02_PROJECT_STATUS.md'` → empty,
instead of re-running.

## 8. Limitations

- Local and synthetic only: PostgreSQL 16 on Linux, not the Windows appliance; no installer or
  EXE; no hospital database or migration; no deployed suite dispatched; CI runs on push (checked
  once, not monitored). **Not hospital or deployed acceptance.**
- Chromium only; real clocks, no faked server clock. The data-age "D-n HH:mm" form (a read from an
  earlier hospital day) was not exercised; one device zone (America/Los_Angeles) besides the
  hospital's.
- Transport control is Playwright routing at the browser. A "lost" request is held and then
  delivered by the harness with its original headers and body; no real network partition was
  produced.
- Session 3's controller harness (`logs/01`) uses the app's mock adapter as its MAR "server" (its
  design); the real-server MAR coverage is `logs/02` and `[C]`.
- The restart is a process restart on the same database, not a machine reboot or service manager.
- The `ci.yml` production-seed job (it uses `docker exec psql`) was not replayed locally; its
  substance — a clean production boot and seed — is `logs/03`.
- **The release gate stays UNRESOLVED** (write exclusion during update validation; a failed-health
  rollback drill — now migration-bearing, see `02_PROJECT_STATUS.md`).
- The pre-existing restricted-role defect (§5.1) is unresolved.

