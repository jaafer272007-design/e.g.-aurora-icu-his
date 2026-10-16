# Session 2 — patient chart: evidence and handoff

Work for the owner-approved plan (`docs/design/icu-update-nursing-patient-chart.md` §3) under
the frozen contract (`docs/design/icu-update-nursing-patient-chart-contracts.md`, including
Amendment 1 §9), Session 2's ownership in §2. ICU only, English interface, AI disabled.
Synthetic data only. No server, database, hospital system, installer or deployment was
touched or contacted.

## Base and branch

| | |
|---|---|
| Preparation base (verified before branching) | `claude/icu-nursing-chart-prep` = **`05e92e2050c490393b36ab3fbb60a5acd81aeac3`** (Amendment 1; not the superseded `9d68bca`) |
| Reviewed base | `2fc317ca4cb923abae1718a9a30ad9af8a7592ba`, an ancestor of the prep commit; draft PR #234's branch was still at it when this work started |
| `main` | `f0bf4647c7fb921baf760225bf838f69f655c697`, unchanged |
| Branch | `claude/icu-nursing-chart-patient-chart`, created from `05e92e2`. No PR was opened (contract §1) |
| Prep ref at push time (2026-10-16) | **moved to `ede8358`**: "contract Amendment 2", appended §10. It changes only the server's implement check order (an absent order is 404 before any body 400). It is docs-only (+26 lines in the contracts file) and says "Sessions 2 and 3 need no change". `05e92e2` is its parent. This branch was **not** rebased: it stays on the verified `05e92e2`, and nothing in it depends on §10 |

## Commits (in order)

| Commit | Content |
|---|---|
| `3dc882a` | **The chart implementation** (source only). Every check below ran on this source. |
| the commit adding this directory | Evidence only (`docs/evidence/icu-nursing-chart/session2/**`): tools, logs, screenshots, this README, and `pending-insertion.patch` |

*[Superseded 2026-10-16: the insertion is now implemented as commit `5315769`. See "Final
insertion" at the end of this file.]*

**Pending, not made:** the final `PatientNurseCarePanel` insertion commit (§6). See
"The care-panel insertion" below.

## Changed paths (`git diff --stat 05e92e2 3dc882a`)

```
src/hooks/usePatientScores.ts                      (patient-keyed state; new usePatientObservations)
src/pages/MissionControl/MissionControl.tsx        (layout per role, removed cards/state, patient isolation)
src/pages/MissionControl/MissionControl.css        (retired-card CSS removed; new cards; grid; narrow header)
src/pages/MissionControl/LatestObservationsCard.tsx (the combined card)
src/pages/MissionControl/chartObservations.ts      (new — pure: reading lists, resolution, driving pressure)
src/pages/MissionControl/ActiveMedicationsCard.tsx (new — replaces Active Infusions)
src/pages/MissionControl/ImagingResultsCard.tsx    (new)
src/pages/MissionControl/chartResults.ts           (new — pure: active-med filter/kind, imaging order)
src/pages/MissionControl/useChartRead.ts           (new — patient-keyed read hook)
src/pages/MissionControl/LabsCard.tsx              (renamed title, results link, no-trend guard)
src/pages/MissionControl/WeightHeightCard.tsx      (compact; editor reset + late-save guard)
src/pages/MissionControl/AttachmentsCard.tsx       (id="attachments" for the grid only)
src/pages/MissionControl/DigitalTwin.tsx           (deleted)
```

No file outside Session 2's ownership changed. That includes no server code, no
`src/lib/api/**`, no `src/components/**`, OrdersMedication, NurseWorkspace, nurse-care,
`App.tsx` or `02_PROJECT_STATUS.md`.

## What the chart now does

**Latest Charted Observations (one card).**
- The card has three groups: Bedside, Ventilator and Hemodynamics.
- The reading lists are the retired cards' lists word for word, minus the one duplicate. CVP
  appears once, in Bedside.
- Every real value shows its time and its source. Times are on the hospital clock
  (`displayStamp`); the old card printed the raw UTC `HH:mm`.
- Set and measured values stay separate readings.
- Driving pressure keeps `projectVentilator`'s condition: it is derived only when Pplat and
  PEEP share one charted timepoint, and the cell says "not derived" otherwise.
- The 24 h fluid-balance strip moves in unchanged. It is still `projectHemodynamics` over the
  same read, which counts charted interval fluids only.
- The I&O manual-snapshot codes are never read by this card.
- When the record can't be read, the card says "not read". It never says "not charted" in
  that case.
- A group with no value at all folds to one line with a keyboard-reachable "Show readings"
  toggle.

**Removed from the chart:** the Ventilator, Hemodynamics, Active Infusions, Smart Alerts,
Daily Goals and Patient Digital Twin cards, together with their anchors (`#vent`, `#hemo`,
`#alerts`, `#goals`, the twin), state, handlers and CSS. Kept: the header's "Critical
Alerts" unit stat (same meaning: the critical entries of the per-patient alerts feed, which is
0 in production), the rail's alert counts and the Alerts filter.

**Active Medication Orders.**
- Source: `getPatientOrders(patientId)`, filtered to active `Medication` orders of this
  patient.
- One row per order. Two orders for the same drug stay two rows.
- Rows are grouped continuous / scheduled / PRN, each with dose · route · frequency (or the
  PRN indication), the prescriber, the signing time and the order id.
- No pump rate, trend or status dot.
- Pending, discontinued and completed orders are not listed.
- Gated on `orders.view`, which is the server's own gate on that read.

**Laboratory Results.** The card is renamed from Laboratory Trends; it has the same panels,
latest values and trend, plus a link to the results screen. When a panel has fewer than two
draws, the chart is not drawn (it used to plot `NaN` axes, identically on the prep commit;
see the before screenshots). The latest values stay.

**Imaging Results (new).**
- Source: `getImagingStudies(patientId)`.
- Studies are listed newest first by their latest stamp (reported → performed → ordered).
- Each row shows modality, description, status, the clinician-marked flag, the dates, the
  acknowledgement, and the impression. Findings are one keyboard toggle away.
- The latest 4 are shown, with "Show all".
- It is view only and links to the existing Labs & Imaging screen. Acknowledging, documenting
  and correcting keep their existing authorities there.
- Laboratory and Imaging Results are both gated on `results.view`, the server's gate on both
  reads.

**Weight & Height (compact).** Weight and height come first. The three derived values sit on
one small line, and the scope and derivation notes are one footnote. Editor and history are
unchanged. The card's area is about one third of the prep card with the same data (415×188
vs 1272×185 px at 1600 px).

**Nurse profile** (`profileOf(jobTitle) === 'Nurse'`, contract §6):
- No SOFA or NEWS2 card, no observation score chip, no score colour and no score legend.
- The same 27 readings are visible.
- The nurse's chart reads only the full observation list (`usePatientObservations`) and
  computes no score.
- Every other profile keeps its scoring presentation. Score formulas are untouched.

**Patient isolation.**
- `usePatientScores`, `usePatientObservations` and the new card reads hold their result
  *with* the patient it was read for. The render that switches patients already shows
  loading, and late answers are dropped.
- The chart detail, identity and coverage render only when they match the routed patient.
- Detail refreshes started before a switch are dropped.
- Patient cards remount per patient, so editors and toggles reset.
- A Weight & Height save that answers after a switch never paints the previous patient's
  encounter.

**Narrow widths.** The chart header row now wraps at ≤ 760 px. On the prep commit it forced a
732 px frame at 390 px, so every card scrolled sideways. That is measured in the same way on
both commits; see `tools/chart-verify.cjs` §7.

### Layout

| | Doctor and other non-nurse profiles | Nurse |
|---|---|---|
| Row 1 | Observations (8 cols) · right column: Weight & Height, Active Medication Orders | Observations · right column: Weight & Height, Laboratory Results |
| Row 2 | SOFA · NEWS2 | **the medication + I&O slot** (full width) |
| Row 3 | Laboratory Results · Imaging Results | Imaging Results (full width) |
| then | Attachments, Clinical Timeline | Attachments, Clinical Timeline |

At ≤ 1500 px the observations take the full width and the right column's two cards sit side
by side below them. At ≤ 1100 px every card is full width and the patient rail is hidden (existing
behaviour).

## Commands actually run, and results

All of these ran on source **`3dc882a`**. `logs/00-source.txt` records `git diff --quiet HEAD
-- src` as clean at run time.

| # | Command | Result | Log |
|---|---|---|---|
| 1 | `npx tsc -b --force` | exit 0 | `logs/01-tsc-b-force.log` |
| 2 | `VITE_APP_ENV=production npx vite build --outDir <scratch>/dist-prod` | exit 0. The only warning is the pre-existing chunk-size warning. Bundle `index-kooOHVI-.js` | `logs/02-vite-build-production.log` |
| 3 | `npx esbuild tools/helpers-check.ts --bundle --platform=node` + `node` | **39 / 39**. The retired cards' projections (`projectVentilator` / `projectHemodynamics`, unchanged) are the oracle: identical values in 6 scenarios, driving-pressure agreement, every code read once, I&O codes never read, active-med filter and kinds, imaging order | `logs/03-helpers-check.log` |
| 4 | `node tools/chart-verify.cjs http://localhost:5173 …` (dev bundle, `npx vite`) | **84 / 84** | `logs/04-browser-dev-bundle.log` |
| 5 | `MODE=production node tools/chart-verify.cjs http://localhost:5175 …` (bundle #2 via `vite preview`) | **80 / 80** | `logs/05-browser-production-bundle.log` |
| 6 | `node tools/before-shots.cjs http://localhost:5174 …` (a worktree of `05e92e2`) | before screenshots and card list | `logs/06-before-prep-cards.log` |
| 7 | `node tools/panel-slot-check.cjs http://localhost:5176` (**test-only stub**, see below) | **7 / 7** | `logs/07-panel-slot-stub-check.log` |

The browser checks run Playwright's Chromium against the bundle. `/api/**` is answered by
`tools/synthetic-api.cjs`, a synthetic stand-in with the wire shapes of `src/lib/api/types.ts`.
It has five patients: full data, different values, read failures, real empties, and
discharged-only. Delays and failures are controllable per patient. The hospital clock is
Asia/Baghdad and the browser runs in UTC. What `chart-verify.cjs` covers:
- **Merged observations.** Three groups; 27 readings with unique labels and CVP once; real
  values with time and source; the amended value shown; set vs measured; driving pressure
  derived at a shared timepoint and not derived across times; I&O codes absent; the fluid strip
  at `+340 mL`; times on the hospital clock.
- **Doctor layout.** Score chips, legend, and SOFA/NEWS2 present. The SOFA encounter-scoped
  read is still made.
- **Nurse layout.** No SOFA/NEWS2 card, chip or wording; the same 27 observations; no
  encounter-scoped (score) read; labs in the right column; the slot holds no administration
  controls.
- **Other profiles.** Respiratory Therapist, Physiotherapist, Clinical Pharmacist and
  Receptionist each get exactly the cards their existing permissions allow.
- **Medication and result scoping.** The 5 active prescriptions out of 10 rows. Pending,
  discontinued, completed, nursing and other-patient rows are excluded. Two same-drug orders
  stay separate. Continuous / scheduled / PRN text is shown, and no pump facts. Imaging is
  ordered newest first; "Show all" works; findings open by keyboard; the link opens
  `/labs/:patientId`.
- **Patient switching with delayed responses (doctor and nurse).** Patient A's reads are held
  for 2.5 s and the user switches to B after 0.4 s. A's rows are gone in the switching render
  and still absent after A's late answers land. B shows B's values and B's own driving-pressure
  state.
- **Weight & Height.** Compact, values kept, history kept. The editor is reset by a switch and
  not restored on return. A save held for 2 s and answered after a switch does not paint A onto
  B, and the write itself targeted A's encounter.
- **Missing, empty and error states.**
  - Dev bundle: a failed observations read shows "could not be read".
  - Production bundle: patient C's failed reads raise the existing full-screen "AURORA API
    UNAVAILABLE" refusal, and nothing anywhere claims "none".
  - Patient D: the real empties "No active medication orders…" and "No imaging studies…"; no
    observations means nothing invented.
  - A discharged patient still redirects to `/history`.
- **Keyboard.** Tab reaches the group toggle; Enter expands it and Space folds it; the global
  focus ring is shown.
- **Themes and widths.** Light and dark at 1600, 1024 and 390 px, for both roles: the theme is
  applied, and neither the page nor any card overflows horizontally.

## Screenshots

`screenshots/production/` was taken from the production-mode bundle (#2/#5), with patient A
unless noted:

| | |
|---|---|
| `doctor-A-light-1600.jpg`, `doctor-A-dark-1600.jpg` | doctor layout, both themes |
| `nurse-A-light-1600.jpg`, `nurse-A-dark-1600.jpg` | nurse layout, both themes (the slot shows the pre-integration summary) |
| `*-A-{light,dark}-1024.jpg`, `*-A-{light,dark}-390.jpg` | the 1024 px and phone-width layouts for both roles |
| `doctor-C-errors-prod-1600.jpg` | patient C on the production bundle: the existing full-screen refusal |
| `doctor-D-empty-prod-1600.jpg` | patient D: folded empty groups, real empty medication and imaging lists, "+ Add" weight |

`screenshots/before-prep-05e92e2/` holds the prep commit's chart with the same synthetic data
(doctor and nurse, light, 1600 px).

## The care-panel insertion

Status: **waiting on Session 3's handoff**. At the time of this handoff `git ls-remote` shows
no `claude/icu-nursing-chart-nurse-workflows` branch.

- **Until then:** the nurse's medication + I&O slot shows the same read-only Active Medication
  Orders summary as other roles. It has no administration controls and simulates nothing.
- **The insertion** is prepared as `pending-insertion.patch`. It adds a static import of
  `PatientNurseCarePanel` from `src/features/nurse-care/PatientNurseCarePanel` and renders
  `<PatientNurseCarePanel patientId={patientId} />` in the `.nursecare` slot in place of the
  summary. Session 2 applies it as its own final commit, on top of Session 3's handed-off
  commits, once the component exists (contract §2/§6).
- **The stub check (#7).** I applied the patch in a throwaway worktree with a **test-only stub**
  of the frozen §6 signature (never committed). The check proves:
  - the panel mounts in the slot directly after the observations row, with the routed
    `patientId`;
  - the summary leaves the nurse's chart;
  - the panel never receives the previous patient during a delayed switch, and follows the
    switch;
  - the doctor gets no panel and keeps the summary.

  The stub proves only the interface. **I am not claiming a running combined screen**: the
  real panel, the MAR and I&O inside the chart, the shared controller and the provider wiring
  are all untested here.

## Engineering choices for review

1. **Role layout.** The nurse's chart replaces the medication summary with the care panel and
   moves Laboratory Results into the right column. The prompt says the non-nurse medication
   summary is not the nurse's administration card.
2. **Laboratory Results is now gated on `results.view`**, like Imaging Results. The office
   Administrator profile (`patients.view` only) used to see a labs card. In production that
   card said "No lab results on file" because the server refused the read (403). Now it is
   absent.
3. **Observation times use the hospital clock** (`displayStamp`, day-aware "D-1 HH:mm"). The
   old bedside card printed the raw UTC minute.
4. **Folded empty groups**, and "charted" counts only real or derived values. A demo snapshot
   is shown and tagged but not counted.
5. **Imaging order** is by each study's latest stamp (reported → performed → ordered).
6. **The lab no-trend guard** and **the narrow header wrap** are fixes to pre-existing defects
   in files Session 2 owns. Both reproduce on the prep commit.

## Observed, not changed (outside Session 2's files): for Session 1

1. **`<DataAge>` "As of" shows the hospital clock offset twice.** The cause is
   `src/components/DataAge.tsx`: `displayStamp(localStamp(at))`. With hospital zone
   Asia/Baghdad, the clock read 03:02 while every "As of" chip read 06:02. This reproduces
   identically on `05e92e2`, so it is pre-existing. `src/components/**` is read-only for
   Session 2.
2. **Contract request: optional pruning of now-unread `getPatientDetail` work**
   (`src/lib/api/index.ts`). The chart no longer reads `ventilator`, `hemodynamics`,
   `infusions` or `goals`. In production `getPatientDetail` still makes a `getPatientOrders`
   call only to derive `infusions`. The plan asks for "unused loading work" to go. No API
   change is needed for the chart, and it works either way. This is Session 1's decision
   (shared adapter and types).
3. Pre-existing and left alone:
   - The lab trend plots each panel's points against the shared `drawTimes` axis.
   - The Weight & Height history and the SOFA contributor chips print raw UTC wire stamps.

## Limitations

- Not run:
  - `npm run build` as one command. Its two halves ran separately: #1 is `tsc -b`, and #2 is
    `vite build` with the production identity rather than the development one.
  - The `ci.yml` gates, `dotnet` and PostgreSQL. No server or persistence file changed, and no
    migration exists for Session 2.
- The API was a synthetic stand-in, not the real server. The real-server chart read on the
  integrated backend is Session 1's combined check.
- Final builds, combined acceptance, the care-panel insertion and the integrated nurse chart
  are pending integration (Session 1 / after Session 3's handoff).

---

## Final insertion: implemented (2026-10-16, supersedes "Pending" above)

*Appended; the text above is the original handoff record. Where it says the insertion is
pending or the nurse slot shows the read-only summary, this section wins.*

**Commit `5315769`** ("chart: mount PatientNurseCarePanel in the nurse's medication + I&O
slot") is the final Session 2 source commit. It sits on `8b4464e` and is followed by the
evidence commit adding this section. It applies `pending-insertion.patch`, which is now
historical, against Session 3's handed-off component:
- **Session 3:** `claude/icu-nursing-chart-nurse-workflows` `681198a`, product source
  `9e87e5b`.
- **The real module:** the named export
  `PatientNurseCarePanel({ patientId }: { patientId: string })` in
  `src/features/nurse-care/PatientNurseCarePanel.tsx`. The import path and the prop match.
- **The Nurse-profile chart** renders
  `<PatientNurseCarePanel key={`care-${patientId}`} patientId={patientId} />` in the
  `.nursecare` slot. It replaces the temporary read-only Active Medication Orders summary.
  The one addition to the prepared patch is that per-patient `key`, which every other patient
  card in the chart already has.
- **The panel renders only when the chart detail matches the routed patient.** A save in
  flight completes into the provider's controller, not into the remounted instance (contract
  §4.3).
- **No provider or controller is added.** The chart uses the single `NurseCareProvider` that
  Session 3's `App.tsx` mounts around `<Routes>`. In the assembled tree the only
  `<NurseCareProvider>` is in `App.tsx`.
- **Every other profile is unchanged:** summary card, score cards and layout. The nurse's
  score hiding is unchanged.

**This branch does not compile alone.** The import resolves only when Session 3's branch is
present, and Session 3's code also imports Session 1's `src/lib/nursingRounds.ts`. Per the
instruction, no other session's source or contract stand-in was committed here.

### Checks for the insertion (focused; the earlier suite was not repeated)

Run on a **disposable assembled checkout**, a throwaway worktree that was never committed or
pushed: `1a1acae` = `5315769` + merge of `claude/icu-nursing-chart-backend` `2fb4eb8` +
merge of `claude/icu-nursing-chart-nurse-workflows` `681198a`. Both merges were clean, and no
`src` file is changed by more than one session.

| # | Command | Result | Log |
|---|---|---|---|
| 8 | `npx tsc -b --force` (assembled tree) | exit 0 | `logs/08-assembled-insertion-check.log` |
| 8 | `node tools/panel-real-check.cjs http://localhost:5177` (assembled dev bundle, synthetic API) | **15 / 15** | same log |

What the 15 checks cover:
- **Nurse:** the real panel is mounted in the slot directly after the observations row, with
  the routed patient (`data-patient`) and that patient's MAR group header. The summary card is
  gone, score hiding is intact, and the other cards are present.
- **Delayed switch:** A's reads are held for 2.5 s and the user switches to B after 0.4 s.
  - In the switching render the panel is absent or already B.
  - After A's late answers land, the panel is B's. It contains no A identity and no A I&O
    values (1,234 / 4,321 mL), and shows B's own empty MAR and "Not recorded" I&O.
  - Switching back follows to A.
- **Other roles:** Consultant, Respiratory Therapist and Physiotherapist get no panel and no
  slot. Their summary and score cards are as before.

Screenshot: `screenshots/assembled-nurse-A-with-care-panel-1600.jpg`.

`tools/synthetic-api.cjs` now honours `typeCode` on the observations read, as the real API
does. Before that, the stand-in returned both I&O codes to each per-type read, so the panel's
history listed every snapshot twice; that was a harness artifact, not product behaviour. The
earlier checks #4/#5 do not send `typeCode` and are unaffected. The test-only stub check (#7)
is superseded by #8.

### Deferred to final integration (Session 1's combined real-backend run)

- **The real backend.** In #8 the MAR rows came from the dev bundle's mock MAR store,
  because `/api/icu/mar` is not served by the stand-in. I&O used the synthetic API. Not
  exercised here:
  - documenting Given / Held / Refused from the chart against the real server;
  - persisted I&O saves and the admission-binding 409;
  - controller locks surviving `/nurse` ↔ `/patients/:id` navigation during an unresolved
    save.
- **The production-mode bundle of the assembled tree**, the full `npm run build`, CI gates,
  `dotnet` and PostgreSQL.
- **Light/dark and narrow layouts with the real panel in the chart.** The panel's own
  responsive and theme behaviour is Session 3's evidence. The chart slot is full width at
  every breakpoint.

