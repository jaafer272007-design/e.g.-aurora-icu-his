# 02_PROJECT_STATUS — Aurora HIS: the changing record

**Last updated: 2026-07-13 · current through the CUSTOM / OTHER LAB TEST
ENTRY (built — an 8th "Custom / Other" tab on the `/lab-entry` screen for
documenting a test the catalogue lacks: free-text name + value (required) +
optional unit / display-only reference range / note. UNSTRUCTURED and
UNFLAGGED by design — the system never computes normal/abnormal/critical for
a custom test, and the reference range is context only, never a flag (the
safety choice). Same `results.document` authority (doctor + nurse),
server-owned provenance, `source=manual`, encounter-scoped. Stored via a
small additive change — `LabDrawRow.Custom` + free-text value/unit/range
columns (EF migration `AddCustomLabResult`), the numeric items array stays
empty and the inbox/Timeline branch on `Custom` so they never misparse or
fabricate a flag; byte-parity holds for structured results. In Results on
File a custom result shows a "custom · unflagged" tag, never a
normal/abnormal/critical badge. The 7 catalogue panels are unchanged. Option
B (catalogue tests with flagging ranges) dropped for safety; Option C (LIS
test-list import) recorded as a future item. Verified headless (RBAC,
non-numeric value, no-crash inbox/Timeline, byte-parity, 409) + a real-browser
render of the tab. Prior: the LAB RESULT-ENTRY
(DOCUMENTATION) PATH (built — the missing HUMAN feed into the existing lab
store: a manual `/lab-entry` documentation/transcription screen for the ICU
bedside team, built from the validator's `LAB_RESULT_ENTRY_DESIGN.md`. A NEW
`results.document` permission atom — Nurse + Doctor + SeniorDoctor — was added
and reconciled against the existing producing-service `results.create`
(kept on Ancillary, unchanged) per the owner's decision on the design's open
item #1; a lean catalogue-driven `POST /api/icu/results/labs/document` derives
unit/refRange/flag from the lab catalogue, links an existing order or stands
alone, and stamps `source=manual` via a new `LabDrawRow.Source` column (EF
migration; byte-parity preserved — the field is absent on the wire for
pre-existing rows). ABG (incl. PaO₂) enters as a lab panel through this
screen. Verified headless — full RBAC matrix, order-linked + standalone,
catalogue-derived value-flags, provenance, source=manual, validation 400s,
closed-encounter 409; LIS integration + ABG analyzer auto-feed + coded-analyte
identity recorded as future items. Prior: the CLINICAL SCORING ENGINE
DESIGN RECORD (docs-only — the clinical validator's architectural design
recorded verbatim as `docs/design/clinical-scoring-engine.md`: a GENERIC
scoring engine with SOFA as its first score (qSOFA/APACHE II/NEWS2/
SAPS II later as score definitions, the Observation-Type-Catalogue
pattern), replacing the currently-fabricated bedside SOFA/EWS; seven
LOCKED engine principles safe to decide now (missing-data-never-normal →
INCOMPLETE; latest-within-a-window; total + per-component; trend/ΔSOFA;
computed-not-stored; replaces fabrication; clinical-validation-required);
and the validator's SEQUENCING decision — the detailed SOFA scoring
rules are DELIBERATELY DEFERRED until the prerequisite data sources are
complete: Labs (complete + connected) → Ventilator module + ABG → THEN
the Scoring Engine with SOFA. The Known-Feature-Gaps "Derived Clinical
Scores" (F8) entry is superseded by this formal record; nothing is
built). Prior: the STAGE 11 PRINT
TEMPLATES (the 3 contract documents deferred until Observations existed,
built from the owner's recorded design —
`docs/design/stage11-print-templates.md`: the ADAPTIVE landscape 24-hour
Vital Signs / Observation Flowsheet with the traditional
vitals+neuro+fluids split and per-column computed rows; the Ventilator &
Device Report snapshot with derived ΔP, labelled charted-or-computed
Minute Ventilation, and always-present-honestly-empty device sections;
and the MAR rendered from the VERIFIED persisted administration events —
status/actual time/nurse/server-required reason on held/refused. The
Print Center Contract's implemented set is COMPLETE at 13/13 (+ the
retained Admission Note); the PRINT CENTER ENGINE is recorded as a
future feature, deliberately not built (design P2); 28/28 headless
render proof incl. discharged-patient re-renders and a locally
time-spread multi-hour grid). Prior: §12 STEP 4 (the
bedside READ-SWAP, built to the owner's six recorded decisions F5–F10:
every bedside vitals surface — roster/bed board/Mission Control — now
projects the LATEST charted Observations of the OPEN encounter, per-type
demo-snapshot fallback in demo-seeded environments only, honest nulls
otherwise; the simulated MonitorCard (waveforms/jitter/STREAMING) and the
panels.ts vent/hemo demo data are DELETED — the manual-era display is the
"Latest Charted Observations" card with clinical time + source per value
(F5-a), and the bed-board jitter is gone with it; EtCO₂ added to the
catalogue as a data top-up with seed-if-missing (F6, 51→52 types,
fresh-vs-topped-up catalog byte-identical); the F7 tile map is live
(arterial ← art lines, NIBP ← cuff, MAP charted never recomputed);
19/19 byte-parity incl. a BYTE-IDENTICAL roster for demo patients,
12/12 server matrix incl. readmission-never-inherits, 25/25 UI proof,
bundle proofs re-run; the step-3 POST-MERGE pass was 13/13 on 24e77ac
after the print suite's Pages gate honestly caught a stale deploy that
was then redeployed from main). Prior: STEP 3 (the
/observations screen: the entry form is RENDERED FROM the Type
Catalogue — enabled groups only, no observation vocabulary in frontend
code; both §10 entry modes as ONE staged submission — many values are a
timed round, one value is an ad-hoc entry, the server stamps the time
either way; the chart read view groups by timepoint with the §8
amendment history always visible (original struck-through, actor + role
+ reason layers) and derived values computed at render from catalogue
inputs; the two-tier correction UI — tier-1 self-amend shows NO reason
field per Q1, tier-2 shows the required reason; profiles without
observations.record get the read-only chart; the domain is REAL-ONLY in
the adapters — no mock observations exist, unreachable-API states say
so honestly; 41/41 headless UI proof on a live local server). Prior:
STEP 2 (the Observation Service write paths: server-stamped rounds,
catalogue-driven validation incl. derived-rejection + compound
components + disabled-group 409 + round atomicity, the §8 two-tier
corrections with the actor always recorded; 59/59 matrix incl.
SQLite-aged window expiry + 18/18 parity; POST-MERGE the full
thirteen-suite sequential pass ran GREEN on merge commit c6d7b61 —
13/13, incl. the extended observations suite's first live run with
every step's exact text executed). Prior: STEP 1 (the
generic catalogue-driven Observation model built per the recorded
design: the `(typeCode → value)` record with the amendments[] audit
carrying the corrector actor; the Observation Type Catalogue seeded
from §1 — all 8 groups, 51 types as data, derived values flagged,
devices group disabled by default; group enablement behind the new
`observations.configure`; the SeniorDoctor profile per the owner's F4
answer — Consultant = Doctor superset + correct/configure, office
Administrator carries NOTHING observation-related; 17/17 matrix incl.
the hard-constraint probes + 5/5 frontend smoke + 17/17 parity + 9/9
bundle proof; the thirteenth suite added and the promotion gate
extended; write paths are step 2). Prior: the STAGE 11 DESIGN
RECORD (the validator's complete Observation Model design is now the
versioned repo artifact `docs/design/stage11-observation-model.md`,
with the F1/F2/F3 RBAC decisions baked in; the fragment-built draft
PR #67 is marked SUPERSEDED — DO NOT MERGE, its correct engineering
salvaged into the §12 rework; the pre-build verification report's
code-vs-design findings are recorded, incl. the TWO bedside fake
sources; the F4 mechanism question — how the three-layer RBAC model
expresses "Consultant-tier" — is FLAGGED and awaiting the owner
before §12 step 1 wires permissions). Prior: the PRINT CENTER HUB
DISCHARGED-ENCOUNTER PICKER (the recorded display debt resolved: the
hub's patient picker now lists discharged patients from the REAL
closed-encounter read — `GET /adt/encounters?status=discharged`, the
existing Layer 2 read, no new source — in a clearly-distinguished
group below the unchanged roster group; 18/18 headless proof incl. a
genuine admit→discharge flow rendering the Discharge Summary with full
identity, byte-parity on the admitted flow, and the 9/9 production
bundle proof re-run). Prior: the WORKING-SESSION
DECISIONS RECORD (docs-only): the PROJECT VISION is recorded in
01_ARCHITECTURE.md § Project Vision (Scenario C, confirmed by the
project owner — a modular HIS whose Core operates independently, with
a "when required" future Integration Layer for FHIR/HL7
interoperability); the IMAGING-ORDERING feature gap is recorded under
"Known Feature Gaps" (imaging results are built, ordering a study is
not — validator-identified); and the Stage 11 MANUAL-ENTRY clinical
requirement (bedside vitals/NIBP/ventilator/CVP/hemodynamics must
support manual charting, not only device feeds — validator-identified)
is recorded under the Stage 11 build-order item. Prior: the PRINT CENTER
CONTRACT v1.0 + THE BUILDABLE BATCH (the validator-confirmed 13-template
list is now a versioned repo artifact — `docs/print-center-contract.md`
— and the 8 genuinely-remaining buildable templates are built on the
Phase-1 pattern; 28-check headless proof incl. fresh-patient orders,
byte-stability across a live formulary deactivation, a discharged
face-sheet via the identity read, and a 2-page A4 pagination proof with
the repeating table header; the 3 Stage-11 templates remain deferred per
contract). Prior: the Mission-Control fresh-patient fix (the detail
page resolves identity from the REAL roster first; 8/8 headless repro).
Before that: environment-separation §11 STEP 4 (PARTIAL) — the target-independent release + backup
mechanisms: the `production` branch promotion model with a gate that
only releases what staging is serving and has verified (ancestry +
content equality + all twelve suites green on that content); the
release bundle with manifest + checksums whose verification treats any
mismatch as "bundle does not exist"; and the backup script whose EVERY
run restores into a scratch database and proves the data comes back
(strict-equality proven locally on 15 tables; failed verification is a
loud non-zero FAILED state, never silent trust). OS-specific install
tooling + the VM rehearsal are DEFERRED pending production server
facts. Prior: STEP 3 — production build & serving mode: the frontend is served
SAME-ORIGIN by the API in production with a RELATIVE base (no hostname
in the artifact), the mock/demo layer is COMPILED OUT of production
bundles (bundle-inspection + sourcemap proof — absent, not disabled),
a runtime environment cross-check paints a FULL-SCREEN refusal on any
frontend/API environment mismatch, staging/dev carry an unmistakable
banner (absent from the production artifact), and the API_BASE_URL
repo variable is retired into deploy-pages.yml (§6.4). Prior: STEP 2 —
seed modes + boot tripwires (T1 demo-credential scan, T2 demo-config
refusals, refuse-unknown-APP_ENV; 36-check boot matrix). Prior: the
aud-claim RIDER completing step 1 (aud == APP_ENV at issuance and
validation, oracle-free, fail-closed). Prior: the ENVIRONMENT-IDENTITY
PR — `/healthz` and `/build.txt` carry an `environment` name (`staging`)
and every deployed suite refuses to run any write leg unless the
environment it reports matches the suite's in-file declared target
(mismatch = immediate loud failure, no retry); LIVE-VERIFIED 12/12. Prior milestone:
the print live-verification PR — the deployed Discharge Summary
RENDER-VERIFIED for a discharged patient on the live Pages site
(`/build.txt` frontend stamp; twelfth suite `deployed-print-e2e.yml`
renders documents headlessly behind server + Pages freshness gates).
Previous milestones: patient-identity read (PR #51 — both
Print-Center-recorded open questions resolved, now including the live
render), Print Center Foundation Phase 1 (PR #50), safety enforcement
(PR #46). Next: environment separation — a design proposal
(`docs/design/environment-separation.md`, revision 2: production is
ON-PREMISES/offline-first, the cloud stack is the staging tier) is
authored and awaiting project-owner approval before any implementation;
the remaining Print Center templates follow.**

*[Superseded — contradiction found while refreshing this marker
(2026-07-12), flagged per the doc rule rather than silently rewritten:
the "Next:" tail above is stale. As this same paragraph's newer
entries record, the environment-separation design was APPROVED (PR
#53 merged by the owner) with §11 steps 1–4 since built, and the
buildable Print Center templates are built (Contract v1.0). The
current ordering lives in "Remaining build order" below.]*

*[Docs split note (2026-07-10): every unmarked line below was moved verbatim
from the pre-split CLAUDE.md. The only additions are lines styled like this
one and the three subsections explicitly marked "Attributed addition"
(Remaining build order, In-flight work, PR history). Binding rules that
originated inside these records were moved to 01_ARCHITECTURE.md or
03_DEVELOPMENT_RULES.md and are noted where they were extracted.]*

## Current Status
Screens 1–8 are built as componentized, routed React pages backed by
canonical mock stores (see Canonical Data Domains); Stage 9 login/RBAC is
in place with real authentication layered on top (Stage 10 Phase 2).
Screens 2, 4–8 await formal review. Stage 10 Phase 1 (roster/patients) and
Phase 2 (auth: bcrypt users table, POST /api/auth/login, JWT middleware on
the roster endpoint, Bearer-token frontend with Stage 9 local-session
fallback) are built on the ASP.NET Core + SQLite + Docker service in
/server, deployable via render.yaml. Phase 3 has migrated Labs/Imaging
results (server-side RBAC on acknowledge) and Orders & Medication
(server-side RBAC on the full lifecycle — create/sign/modify/discontinue
doctor-only, implement nurse-only, actor always from the token) and the
MAR (dose documentation derived from the real Orders data — nurse-only
administer with doctor-403, held/refused reason-validated), the Timeline
(server-derived order/med/lab/imaging events, frontend hybrid-merged with
the four still-mock sources across a documented seam), and AI (the FINAL
domain — read-only ranking + per-patient risk endpoints, both roles read,
trend/delta computed at read never stored, alert-center integration
preserved from the same store). **Stage 10 Phase 3 is now complete.** The
agreed platform direction (see "Platform Direction — Aurora Core +
Modules") makes AURORA ICU one module of the broader Aurora HIS: every
new layer from here is built inside Aurora Core from the start. The
architectural review + Core-extraction inventory has RUN and resolved the
relocation question as (a): the seven real server-side domains (Orders,
Medication, MAR, Labs, Imaging, Timeline, AI) plus Identity/auth now live
under `server/Core/` (same assembly, behavior-neutral — routes/DTOs/wire
shapes byte-identical, verified by full-surface old-vs-new diff + all six
E2E suites); the roster deliberately stays in `server/Modules/Icu/Roster/`
(the roster's identity/location half is now DISSOLVED — see "Platform
Direction"). Database persistence is DONE: Render Postgres via
DATABASE_URL + EF Core migrations; writes survive restarts, collation
parity is pinned and byte-verified, the id counters are
persistence-aware — with the 30-day free-database expiry documented as
the operational constraint. **Layer 2 ADT is DONE, built directly in
Aurora Core**: Patient/Encounter/Bed entities, admit/discharge/transfer
endpoints (doctor-authority admit/discharge, nursing transfer, full
validation with precise conflict errors), live /admissions and
/discharges screens, Bed Overview composed from the real bed registry +
roster, and the roster endpoint re-founded as a derived view over open
encounters. **Layer 3 user administration is DONE in Core Identity**:
the Phase 2 Users entity extended (Active + immutable audit history),
six admin-only endpoints behind the new `users.manage` permission with
the escalation safeguards verified in both directions (self-demotion/
self-deactivation guards, last-active-admin guard, clinical-title
justification, actor always from the token, deactivation = status
change never a delete, generic 401 for deactivated logins), and the
`/admin/users` screen showing the live derivation chain before any
title is granted. **The encounter-scoping fix (ORD-113) is DONE**: an
order's lifecycle is bounded by its encounter — `encounterId` on
orders, the `EncounterGuard` 409 chokepoint on every clinical-
initiation path (with the deliberately NARROW invariant: completing
the record of care stays allowed on a closed encounter), the discharge
cascade auto-discontinuing active/pending orders in the same
transaction, encounter-aware MAR/queues over a longitudinal chart, the
reserved System principal, and the one-time audited backfill that
neutralized ORD-113 itself (verified against a state-equivalent
replica of the live DB — see "Encounter-scoped orders (built)").
**Result un-acknowledgment + result creation are DONE** (the results
audit PR): audited never-destroy reversal of acknowledgments (doctor
RBAC, required reason, result returns to the inbox), real lab/imaging
result creation under the new Ancillary `results.create` permission
with server-derived encounterId, the ASYMMETRIC encounter rule (create
→ 409 on closed; ack/un-ack → 200 on closed — completing the record),
the AddResultAudit migration + backfill verified against a
live-equivalent replica, and the labs E2E suite rewritten
self-sufficient — the permanently-spent acknowledge leg is resolved by
feature, not test reset. **Layer 4's first domain — the DRUG FORMULARY
in Core Master Data — is DONE** (`server/Core/MasterData/` +
`/formulary`; see "Layer 4 — Master Data: the Formulary (built)"):
Pharmacy-maintained reference tables behind the new `formulary.manage`
permission, deactivation-never-deletion with the inactive-drug 409 at
order create/modify, the frequency vocabulary moved out of Core/Orders
with byte-identical validation, Orders & Medication reading the drug
list from the API, and the tenth deployed suite
(`deployed-formulary-e2e.yml`, self-sufficient). **Layer 4 phase 2 is
DONE — the Lab Test Catalogue (Laboratory's `labcatalog.manage` on
Ancillary, seeded from the panels the labs domain implies, panel
vocabulary moved out of ResultsLogic), the ORDER→RESULT LINKAGE
(`Order.testId?` + server-derived `LabDraw.orderId?` fulfilling the
oldest unfulfilled matching order; results may exist without an order —
walk-in/reflex are legitimate), and ORDER SETS (Pharmacy's
`ordersets.manage`; apply runs through the shared order-creation path,
never a bypass), with the eleventh suite
(`deployed-labcatalog-e2e.yml`)**. **Server-side safety enforcement is
DONE**: unknown drugId/testId → 400 (the ORD-168 hole closed, confirmed
on a live-upgrade replica with the historical-rendering guarantee),
inactive → 409, and the safety.ts allergy/interaction/duplicate model
enforced at creation — hard blocks never overridable, warn-level 409
without an audited overrideJustification; the orders/MAR suites moved
to own admitted patients (the duplicate-therapy check made shared demo
patients untenable) with the owed absence probes shipped. **Next: the
deferred Print Center**,
then Stage 11 device + AI integration per the
locked rules above (Stage 11 also absorbs the roster's remaining
bedside-snapshot columns). The Timeline's four still-mock sources
(Consults/Notes/Nursing/I&O) migrate with that later work, not Phase 3.

*[Superseded 2026-07-11 per project owner: safety enforcement is merged
AND LIVE-VERIFIED (see the record below), and the NEXT build-order item
is ENVIRONMENT SEPARATION (dev/staging/prod), then the Print Center —
see "Remaining build order".]*

## Screen Roadmap
1. ICU Bed Overview — ✅ approved (`/reference/icu-bed-overview.html`)
2. Patient Mission Control — ✅ built, formal review pending (`/reference/icu-mission-control.html`)
3. Doctor Workspace — ✅ approved (`/reference/icu-doctor-workspace.html`)
4. Nurse Workspace — ✅ built, formal review pending (`/nurse`, first screen built directly in React)
5. Orders & Medication — ✅ built, formal review pending (`/orders/:patientId`, canonical orders model — DW/NW read derived views)
6. Laboratory & Imaging — ✅ built, formal review pending (`/labs/:patientId`, canonical results model — MC lab card + DW results queue read derived views)
7. Timeline — ✅ built, formal review pending (`/timeline/:patientId`, read-only aggregated feed derived from the canonical stores — no store of its own; MC timeline card reads the same feed; minimal ClinicalNote model added for freeform notes). Stage 10 Phase 3: the order/med/lab/imaging events are server-derived; the frontend hybrid-merges the four still-mock sources (see "Stage 10 — API Integration")
8. AI Clinical Assistant — ✅ built, formal review pending (`/ai` unit ranking + `/ai/:patientId`, canonical AI risk model — MC AI panel + alert-center risk alerts read derived views; all predictions simulated until Stage 11). Stage 10 Phase 3 (FINAL domain): ranking + per-patient risk endpoints are real/authenticated, read-only for all roles, trend/delta computed at read (see "Stage 10 — API Integration")
9. Login / Role-Switch screen — ✅ built (`/login`, three-layer RBAC below; real username+password auth added in Stage 10 Phase 2, Stage 9 local session kept as the offline fallback)
10. API Integration (ASP.NET Core Web APIs) — 🔄 in progress: Phase 1
    (roster/patients) + Phase 2 (authentication) + Phase 3 (Labs/Imaging
    results, Orders & Medication, the MAR, the Timeline, then AI — the
    FINAL Phase 3 domain; server-side RBAC on every mutation, read-only
    for the aggregation/AI domains) built; Phase 3 COMPLETE, database
    persistence DONE (Postgres + migrations — writes survive restarts;
    30-day free-DB expiry documented), Layer 2 ADT DONE in Aurora
    Core (/admissions + /discharges screens live; roster = derived view
    over open encounters), and Layer 3 user administration DONE in Core
    Identity (/admin/users; escalation safeguards + immutable audit) —
    next is Layer 4 master data in Core — see "Stage 10 — API
    Integration" below
11. Medical device integration (ventilators, monitors, lab) + AI

## Stage 10 — API Integration (Phase 1: roster/patients ONLY)
One domain per phase, one phase per PR. Phase 1 replaces ONLY the
roster/patients read path with a real service; Orders, Labs/Results, MAR,
Consults, Notes, Nursing, Timeline, and AI all remain mock adapters until
their own turns in later Stage 10 phases.
- `/server` — ASP.NET Core 8 minimal API, Dockerized (2-stage build).
  One real endpoint: `GET /api/icu/patients` (+ `GET /healthz` probe).
  The wire contract mirrors the mock adapter exactly — `RosterRecordDto`
  in `src/lib/api/types.ts` is the single source of truth for the shape.
  `alertCount` is NOT served: it is derived (AI alerts + unacked results +
  bed alert) from domains that are still mock, so the frontend keeps
  deriving it (derived state is never stored/served — locked rule).
- **SQLite, deliberately** — a documented Phase 1 simplification. Moving
  to SQL Server later is an EF Core provider swap (`UseSqlite` →
  `UseSqlServer` + connection string), not a rewrite. The DB is created
  and seeded at startup from `server/Data/roster-seed.json`, which is
  GENERATED from `src/lib/api/data/roster.ts` — never hand-edit it.
- **Hosting: Render free tier** (`render.yaml` blueprint, Docker runtime,
  rootDir `server`, health check `/healthz`). Free tier spins down when
  idle — cold starts of ~30–60s are expected; the frontend adapter
  handles this with an 8s timeout + silent fallback to the mock roster,
  so the UI never blocks on a sleeping server.
- **Frontend config**: `VITE_API_BASE_URL` env var (see `.env.example`).
  Unset/empty = pure mock mode (safe default). The Pages deploy workflow
  reads it from the `API_BASE_URL` GitHub repo variable. Only
  `getPatients()` in `src/lib/api/index.ts` calls the real API; on any
  fetch failure it falls back to the mock roster (never a broken UI).

*[Docs split note: the CORS convention bullet moved to
01_ARCHITECTURE.md § Cross-cutting server conventions.]*

### Phase 2 — authentication (built)
- **Users table** (same SQLite DB): the SAME 20 staff as the Stage 9
  preset list. `server/Data/users-seed.json` is GENERATED from
  `src/lib/session.ts` (`SAMPLE_STAFF` + `usernameOf`, e.g.
  "Dr. Sara Rahman" → `sara.rahman`) — never hand-edit it. Only bcrypt
  hashes are stored (work factor 10, one salt per user), never plaintext.
- **Demo credential — NON-PRODUCTION**: all 20 SEEDED accounts share the
  password `Aurora2026!` (override via `DEMO_PASSWORD` env). Layer 3 user
  administration now exists (admins create accounts with admin-set initial
  passwords and can reset passwords — see "Layer 3 — User Administration"
  below); SELF-SERVICE registration and SELF-SERVICE password reset still
  do not, by scope. This is a documented prototype simplification only.
- **`POST /api/auth/login`** (anonymous): username OR full display name +
  password → `{ token, name, jobTitle }`. Any failure returns the SAME
  generic 401 `{"error":"Invalid credentials"}` — never reveals whether
  the username or password was wrong (an unknown user still runs a bcrypt
  verify against a decoy hash so timing doesn't leak either).

*[Docs split note: the JWT convention bullet moved to
01_ARCHITECTURE.md § Cross-cutting server conventions.]*

- **Frontend**: the login screen is a real username+password form
  (`login()` in `src/lib/api/index.ts`); on success the session stores the
  JWT and adapters attach `Authorization: Bearer` (see `authHeaders()`).
  Profile/permissions are STILL derived from JobTitle — unchanged. If the
  auth API is unreachable/times out (8 s) or `VITE_API_BASE_URL` is unset,
  login falls back to the Stage 9 local session (password NOT verified,
  console-logged) — same resilience pattern as the roster fallback. A
  401 on the roster (stale/tokenless session) falls back to the mock
  roster, console-logged, never a broken UI.
- **Deployed verification**: `.github/workflows/deployed-auth-e2e.yml`
  (manual dispatch) smoke-tests the LIVE Render service — health, login
  JWT, generic 401s, roster 401/200, CORS — run it after any /server
  deploy.

### Phase 3 — Laboratory & Imaging results (built)
First DOMAIN migration after roster, and the first SERVER-SIDE RBAC
enforcement. Orders, MAR, Consults, Notes, Nursing, Timeline, and AI
remain mock until their own phases.
- **Tables** (same SQLite DB): LabDraws + ImagingStudies, seeded at boot
  from `server/Data/labs-seed.json` / `imaging-seed.json` — GENERATED
  from `src/lib/api/data/results.ts` (verified byte-for-byte: zero field
  diffs wire-vs-seed) — never hand-edit them. Result items are a JSON
  column (same pattern as roster's nested objects).
- **Endpoints** (all `.RequireAuthorization()`, wire contract = the mock
  adapter's documented one): `GET /api/icu/results/labs?patientId`,
  `GET /api/icu/results/imaging?patientId`, `GET /api/icu/results/inbox`
  (unit-wide unacked, DERIVED server-side at read time — derived state is
  never stored), `POST /api/icu/results/labs/{id}/acknowledge`,
  `POST /api/icu/results/imaging/{id}/acknowledge`.
- **Server-side RBAC** (`Rbac`, now in `server/Core/Identity/`): mirrors `src/lib/
  session.ts` — JobTitle (from the JWT claim) → PermissionProfile →
  Permissions, computed at read time, never stored/never in the token.
  Acknowledge requires `results.acknowledge`: a NURSE token gets a
  generic 403 even when the UI is bypassed; a doctor token succeeds. The
  acknowledging actor is the TOKEN's name claim — never a request field.
  Replayed acknowledge → 404 (SUPERSEDED by the results audit PR:
  replay is now a 409 state conflict — see that section). Client
  `hasPermission` checks remain as
  defense in depth.
- **Frontend adapters** (`apiGet`/`apiPost` helpers): reads fall back to
  mock on unreachable/timeout/401 (console-logged) like the roster; the
  acknowledge WRITE distinguishes outcomes — server 403/404 = real denial
  (never applied locally), network failure or tokenless-session 401 =
  offline mode (mock apply, keeping the Stage 9 experience coherent).
- **Known display debts** (documented, deliberate): the MC lab-trend card
  stays a client-side derived view (chart presentation metadata isn't
  served); roster `alertCount`'s unacked-results component still derives
  from the mock store until alert derivation gets its own pass.
- **Deployed verification**: `.github/workflows/deployed-labs-e2e.yml`
  (manual dispatch) — authenticated fetches return seeded data, 401s
  without a token, nurse-403/doctor-200 acknowledge on the LIVE service.

### Phase 3 — Orders & Medication (built)
Second clinical-domain migration; server-side RBAC on EVERY lifecycle
mutation. MAR administrations, Timeline, and AI remain mock until their
own phases.
- **Table** (same SQLite DB): Orders, seeded at boot from
  `server/Data/orders-seed.json` — GENERATED from
  `src/lib/api/data/orders.ts` (verified byte-for-byte: 19 orders, zero
  field diffs wire-vs-seed) — never hand-edit it. Medication /
  administrations / history are JSON columns the mutations rewrite; a Seq
  column preserves the mock's insertion order.
- **Endpoints** (all `.RequireAuthorization()`):
  `GET /api/icu/orders?patientId|status|implement` (per-patient list incl.
  audit history, signature queue, implementation queue — the same derived
  views, repointed at the real store; the NW patientIds narrowing stays a
  client-side derivation), `POST /api/icu/orders` (create; sign=true
  activates + generates the administration schedule server-side; patient
  name/bed resolved from the roster), `POST .../{id}/sign`,
  `PUT .../{id}` (modify; reason required, audit diff computed
  server-side), `POST .../{id}/discontinue` (reason required; scheduled
  administrations cancelled), `POST .../{id}/implement`.
- **Server-side RBAC**: create/sign/modify/discontinue require the doctor
  permissions; implement requires the NURSE's orders.implement (a doctor
  token is correctly 403'd there). A nurse token gets a generic 403 on
  every prescriber mutation even when the UI is bypassed. The
  acting/signing actor is ALWAYS the token's name claim. CORS now allows
  PUT (GET/POST/PUT) — modify's preflight needs it.
- **Request validation — no silent no-ops (patient-safety rule)**: a
  mutation payload that doesn't match the contract is ALWAYS a 400 with
  an `{error}` body, never a 200 that does nothing and never a 500.
  Unrecognized JSON fields fail binding (request DTOs carry
  `JsonUnmappedMemberHandling.Disallow`); create validates every draft
  (known patientId, category/priority whitelists, complete medication
  fields, summary-or-medication) BEFORE inserting any so an invalid
  batch creates zero orders; modify rejects a `changes` object with no
  recognized field instead of recording a "no field change" audit entry.
  Fields the server INTERPRETS must parse: frequency (drives schedule
  generation) is validated against the vocabulary the formulary/order
  sets/seeds use — named values (continuous, daily, bid, tid, qid, once,
  sliding scale, per level, per CRRT protocol) or q<1-48>h — anything
  else is 400, never saved. Display-only free text (dose/route/duration)
  stays bounded free text — Layer 4's formulary now CARRIES the
  reference values (doses, routes, limits) but order fields remain free
  text; enforcement against them is recorded future scope.
  This rule applies to every future mutating endpoint.
- **Frontend adapters**: reads + all five mutations swapped with the
  labs write semantics (server 403/404/400 = real denial, never applied
  locally; network failure or tokenless-session 401 = offline mock
  apply). `getMarRows`/`documentAdministration` migrated in the MAR PR
  (below).
- **Deployed verification**: `.github/workflows/deployed-orders-e2e.yml`
  (manual dispatch, idempotent) — 401s, seeded reads, nurse-403 on all
  four prescriber mutations, doctor-200 with token actor, implement
  doctor-403/nurse-200, malformed→400, unparseable frequency→400 on the
  LIVE service.

### Phase 3 — Medication Administration Record (MAR, built)
Third clinical-domain migration; completes Layer 1 for orders + doses.
Timeline and AI remain mock until their own phases.
- **No table of its own — reads the REAL Orders data.** MAR rows DERIVE
  server-side at read time from the signed medication orders'
  administrations (the coupling: administrations live on Orders, now a
  real domain, so the MAR never keeps a parallel copy). Verified the
  server derivation matches the mock `deriveMarRows` byte-for-byte
  (zero field diffs). Adding an optional `reason` to MedAdministration
  keeps orders byte-parity (absent on seeds → absent on the wire).
- **Endpoints** (all `.RequireAuthorization()`): `GET /api/icu/mar`
  (unit-wide derived rows — the nurse-assignment narrowing stays a
  client-side derivation), `POST /api/icu/mar/{orderId}/administrations/
  {adminId}` (document a dose: Given/Held/Refused; mutates the order's
  administration in place + audit history).
- **Server-side RBAC — polarity FLIPS vs the prescriber mutations**:
  administering requires the NURSE's meds.administer, so a DOCTOR token
  gets a generic 403 (mirroring implement); a nurse token succeeds. Both
  roles retain read access. The administering actor is ALWAYS the token's
  name claim. Held/Refused require a reason (validated like discontinue);
  Given needs none. Re-documenting a non-scheduled dose → 404
  (SUPERSEDED by the state-conflict PR: the dose exists, already
  documented → 409 naming who documented it and when; absent ids stay
  404). Malformed
  payloads → 400 (unknown fields fail binding; reason bounded) per the
  request-validation rule.
- **Frontend**: only the MAR adapters swapped
  (`getMarRows`/`documentAdministration`) with the proven read/write
  fallback semantics (server 403/404/400 = real denial never applied
  locally; offline = mock apply). The MAR card's Held/Refused now open a
  required-reason dialog. Timeline and AI adapters untouched.
- **Deployed verification**: `.github/workflows/deployed-mar-e2e.yml`
  (manual dispatch, idempotent) — 401s, seeded reads (both roles),
  doctor-403/nurse-200 administer with token actor, held-without-reason
  400, malformed 400, re-document 404 on the LIVE service.

### Phase 3 — Timeline (built)
Read-only AGGREGATION with NO table — the architectural rule holds
server-side too. `GET /api/icu/timeline?patientId` DERIVES events at read
time from the real domains it can reach; the frontend hybrid-merges the
still-mock sources. AI stays mock.
- **Server derives four categories** from real data, no parallel copy:
  order/med (the Orders audit history — create/sign/modify/discontinue/
  implement AND the MAR administrations, which already live on that
  history), lab (draw resulted + acknowledged), imaging (ordered/
  performed/reported/acknowledged). `TimelineLogic.Derive` ports the mock
  `deriveTimeline` for exactly these — verified byte-for-byte vs the mock
  filtered to these categories (zero field diffs, 4 patients).
- **THE SEAM (explicit, so later migrations don't rewrite the aggregator)**:
  four sources are STILL MOCK this phase — Consults, ClinicalNotes,
  Nursing task completions, I&O entries. The adapter (`getTimeline`) is a
  HYBRID: fetch the real server events, merge with ONLY
  `MOCK_TIMELINE_CATEGORIES = [task, io, consult, note]` from the mock
  derivation, sort into one feed. The two sets are DISJOINT → no event
  appears twice (verified: hybrid merge reconstructs the pure-mock feed
  byte-for-byte, zero duplicate ids). When those domains migrate they
  move server-side and drop out of that list — the merge/sort code does
  not change. MC's timeline card keeps reading the mock derivation until
  `getPatientDetail` migrates (documented drift, like the MC lab card).
- **Read-only for every role** — no mutations, no new RBAC surface;
  behind `.RequireAuthorization()`, both doctor and nurse read, unauth
  401. **Validation**: unknown query params → 400, missing/empty
  patientId → 400, unknown patientId → 400 naming the field (consistent
  with Orders) — never a silent 200.
- **UI preserved exactly**: category filters with live counts, day/shift
  filters, critical-result accenting, deep-links to each event's screen,
  and the Patient Not Found card on unresolved IDs.
- **Deployed verification**: `.github/workflows/deployed-timeline-e2e.yml`
  (manual dispatch, idempotent) — 401, both-role reads (server-only
  categories, seeded events as a subset), malformed-param 400s, and an
  order signed via the real API appearing once as Timeline events
  (derivation, not duplication) on the LIVE service.

### Phase 3 — AI Clinical Assistant (built — FINAL Phase 3 domain)
Completes the Layer 1 transactional migration. Everything is SIMULATED
mock model output until Stage 11 — no real inference is added; the server
just serves the same predictions from SQLite now.
- **Table** (same SQLite DB): AiRisks, one row per patient risk profile,
  seeded at boot from `server/Data/ai-seed.json` — GENERATED from
  `src/lib/api/data/ai.ts` (verified byte-for-byte: 14 profiles / 70 risks,
  zero field diffs wire-vs-mock) — never hand-edit it. Each row stores ONLY
  the per-risk `history[]` + `probability` (as a JSON column) plus scalar
  display fields; a Seq column preserves the mock's profile order.
- **Trend/delta COMPUTED at read, never stored** (locked clock-computed-
  state rule): `AiLogic` ports `riskTrendOf` (delta of last vs first
  history sample: ≥4 rising, ≤−4 falling, else stable), `isElevated`, and
  `deriveRiskRanking` from the mock exactly. The stored rows carry no
  `trend`/`delta` field — the ranking endpoint derives both at read.
- **Endpoints** (both `.RequireAuthorization()`, wire contract = the mock
  adapter's): `GET /api/icu/ai/ranking` (unit-wide, sorted by highest
  current risk; top.trend/top.delta + alsoElevated all derived server-side),
  `GET /api/icu/ai/risks?patientId` (one patient's simulated profile —
  categories, probabilities, q15min history, factors, suggestions).
- **Read-only for EVERY role — no mutations, no new RBAC surface** (like
  Timeline): behind auth, both doctor and nurse read 200, unauth 401.
- **Validation** (codified rule): unknown query params → 400, missing/empty
  patientId → 400, unknown patientId → 400 naming the field; a real patient
  with no AI profile → 200 null (distinct from unresolved) — never a silent
  200, never a 500.
- **Alert Center integration preserved**: risks ≥65% surface as patient
  alerts (≥80% critical) via `deriveRiskAlerts`, still derived from the
  SAME mock store (through `getPatientDetail`, unchanged) — the exact data
  the AI table seeds from, so no parallel copy. MC's AI panel likewise
  derives its single-patient view from that store. Both move to the real
  endpoint when `getPatientDetail` migrates (documented drift, like the MC
  lab-trend and timeline cards).
- **Frontend**: only the AI read adapters swapped (`getRiskRanking`,
  `getRiskProfile`) to the real endpoints with Bearer token + graceful
  mock fallback (the proven read semantics — unreachable/timeout/401 →
  console-logged mock). `getRiskProfiles` (all-profiles) has no server
  endpoint and stays a mock accessor. No mutations exist to migrate.
- **Deployed verification**: `.github/workflows/deployed-ai-e2e.yml`
  (manual dispatch, idempotent — the domain is read-only) — 401, both-role
  ranking + per-patient reads (seeded present, sorted desc, trend/delta
  computed and NOT stored), malformed/unknown-param 400s on the LIVE
  service.

### Database persistence (built) — Postgres + EF Core migrations
The blocking prerequisite for Layer 2 (ADT) is DONE. Writes (signed
orders, acknowledged results, documented doses, …) now SURVIVE restarts
and redeploys on Render.

*[Docs split note: the provider, migrations, and collation-parity
convention bullets moved to 01_ARCHITECTURE.md § Cross-cutting server
conventions.]*

- **Persistence-aware ID counters (bug FOUND by the restart test)**: the
  in-memory ORD-/ADM-/Seq counters used to reset every boot — fine when
  the DB reseeded too, but against a durable DB a restart re-issued
  existing ids and a VALID create 500'd on a duplicate key.
  `OrderLogic.InitializeCounters` now resumes each counter from the
  highest persisted id in its generated block (ORD-101+/ADM-501+/
  Seq 1001+ — disjoint from the seed blocks ORD-2001+/ADM-401-4xx/
  Seq 1-999), so fresh-DB behavior is unchanged and restarts are safe.
  ~1,900 generated ids fit before touching the seed block — a documented
  prototype bound, superseded by DB-generated ids at Layer 2.
- **E2E idempotence under persistence**: `deployed-labs-e2e.yml`
  acknowledged a HARDCODED lab (single-shot forever on a durable DB — its
  "idempotence" was an illusion of reseed-on-boot); it now picks an
  unacked lab dynamically each run and fails loudly when the well runs
  dry. The other five suites were audited persistence-safe (run-created
  mutations, subset reads). Suites must be dispatched SEQUENTIALLY, never
  concurrently (relocation-PR lesson).
- **The labs acknowledge leg was SPENT (post-#25 live validation,
  2026-07-09) — RESOLVED by the results-audit PR**: every seeded unacked
  lab on the durable DB had been acknowledged by prior runs, so
  `deployed-labs-e2e.yml` stopped forever at its designed loud-failure
  assert, its nurse-403 RBAC check lost automated coverage, and
  acknowledge-on-a-closed-encounter was untestable by anyone. The fix
  shipped as the predicted feature, never a test reset: genuine result
  CREATION plus audited UN-ACKNOWLEDGE (see "Result un-acknowledgment +
  result creation (built)" below), and the suite was rewritten
  self-sufficient — it creates the results it consumes. The
  do-NOT-reset-the-live-database rule stands.

*[Docs split note: the "Codified rule — finite seeded resources" bullet
moved to 03_DEVELOPMENT_RULES.md § Deployed E2E suite disciplines.]*

- **WARNING — discharging P-1007 breaks the Timeline suite** (MOSTLY
  RESOLVED by the safety-enforcement PR: the Orders and MAR suites now
  admit their OWN patients — forced anyway, because server-side safety
  made shared demo patients untenable: their accumulated active orders
  trip the duplicate-therapy check. Timeline's created order is a
  Nursing order with no drug, so it was untouched and STILL depends on
  P-1007 having an open encounter; its own-patient fix rides with its
  next touch).
- **OPERATIONAL CONSTRAINT — Render free Postgres EXPIRES: 30 days**
  (verified against the Render changelog — the policy changed 2024-05-20
  from the previous 90 days), then a 14-day grace period to upgrade
  before Render DELETES the database and all data (email warnings before
  each). 1 GB fixed; one free DB per workspace. At expiry: Migrate()
  fails at boot, `/healthz` goes down, the frontend falls back to mock
  (never a broken UI). Recovery: upgrade the plan (data kept) or create
  a fresh free DB (real writes LOST; seeds repopulate baseline on next
  boot). Any real use requires a paid database.
- **Verification**: dotnet build clean; full-surface SQLite-vs-Postgres
  byte parity (~100 checks incl. every ordered path, error surface, CORS
  preflight, live create+sign) — zero diffs; the first-ever
  restart-survival assertion (sign + acknowledge → container restart →
  writes intact, zero reseeding, no duplication); restart-collision
  regression (create → restart → create = next id, no 500); all six E2E
  suites run sequentially TWICE against the same persistent DB — 12/12;
  SQLite demo fallback boots with the warning.

### Single environment — every test writes to the system of record (recorded constraint)
Aurora has ONE environment. All verification — the automated deployed
suites and manual testing alike — writes PERMANENTLY to the live durable
database. Test patients, test accounts, and their audit events are
indistinguishable from real ones and cannot be removed, because the
never-destroy principle correctly forbids it. Known artifacts to date:
users tc004411 and test.consultant33256 (deactivated), patients P-1023
"EncScope Test" and P-1024 "Admin409 Test", and several E2E-created
patients and encounters, all discharged. Layer 4 additions: patient
P-1034 "Formulary Test" (discharged) with orders ORD-167/ORD-168 for
nonexistent drugs (the formulary-authority live finding — discontinued,
reason "verification artifact"), formulary-suite run patients (e.g.
P-1032, discharged) and their run drugs (inactive, accumulate by
design), and two inactive e2e drugs from suite runs.

*[Docs split note: the missing-concept statement ("This is NOT a hygiene
problem…") moved to 01_ARCHITECTURE.md § Environment separation.]*

### Layer 2 — ADT (built) — the first Aurora Core-native domain
Patient / Encounter / Bed live in `server/Core/Adt/` from day one — never
ICU-shaped first. The first WRITE feature on the durable database, and
the point where the roster seam's identity/location half DISSOLVES.
- **Entities** (AddAdt migration; collation-"C" pins on the ordered/joined
  string keys): `Patient` (table AdtPatients — a person, persists across
  visits: PatientId, MRN, name, age, sex, allergies), `Encounter` (one
  admission: bed, diagnosis, attending, status open|discharged, admitted/
  discharged time+actor, event history JSON), `Bed` (a PLACE: id, area,
  display order — occupancy is DERIVED from open encounters at read time,
  never stored). Seeds: AdtPatients + open Encounters derive at boot from
  the SAME roster-seed.json as the bedside table (P-1001→ENC-1001, no
  drift); Beds from `Data/beds-seed.json` (GENERATED from beds.ts
  BED_LAYOUT — never hand-edit). ADT id counters follow the
  OrderLogic.InitializeCounters persistence rule (resume from persisted
  max — new ids CONTINUE the seed sequence: P-1015+/ENC-1015+).
- **Endpoints** (`/api/icu/adt/*` — the prefix is accepted historical
  cosmetics): `GET beds` (registry + derived occupancy), `GET
  encounters?patientId&status`, `POST admissions` (create Patient if the
  MRN is new, open Encounter, assign a FREE bed), `POST
  encounters/{id}/discharge` (close; bed frees by derivation), `POST
  encounters/{id}/transfer` (move to a FREE bed). All behind JWT auth.
- **RBAC — transfer polarity FLIPS**: admit + discharge are DOCTOR
  authority (adt.admit/adt.discharge → nurse 403); transfer within the
  unit is a NURSING action (adt.transfer → doctor 403, mirroring
  implement/MAR). Actor always from the token's name claim. Permissions
  added to BOTH `Rbac` and `src/lib/session.ts` (provisional tables
  extended, not re-litigated).
- **Validation** (codified rule): unknown fields fail binding → 400;
  occupied bed, duplicate open encounter, nonexistent bed, transfer to
  occupied/same bed, re-discharge → 400 each naming the precise conflict
  (the STATE conflicts among these — occupied bed, duplicate open
  encounter, same-bed/occupied-target transfer, transfer-of-discharged,
  re-discharge — are SUPERSEDED to 409 by the state-conflict PR;
  nonexistent-bed and unknown-field stay validation 400)
  (occupant id, encounter id); unknown encounter → 404. Never a silent
  200, never a 500.
- **The roster is now a DERIVED view** (`Modules/Icu/Roster`): open
  Encounters ⋈ Core Patient identity ⋈ the module's bedside snapshot —
  the module reads CORE (correct direction); Core no longer reads the
  roster table anywhere. Admissions appear on the bed board immediately,
  discharges drop off, transfers move beds. A fresh admission has no
  bedside row: a neutral default snapshot is synthesized at read (stable,
  zeroed scores/vitals, all organs ok, an INFO bed note — excluded from
  high-priority alert derivation) until Stage 11 Observations. WHAT
  REMAINS of the old seam: only the bedside columns of the roster table,
  Stage 11 scope; its identity/location columns are dead weight kept for
  schema stability.
- **Seam sites dissolved**: OrderLogic draft validation + order-create
  name/bed resolution, AI ranking's diagnosis join, and timeline/AI
  patientId validation all read Core ADT now. New rule enforced: an
  order for a patient with NO OPEN ENCOUNTER is 400 ("orders require an
  admitted patient"); unknown-patient error text kept byte-identical.
- **Frontend**: the Admissions and Discharges nav placeholders are LIVE
  (`/admissions` admission form with free-bed picker + census;
  `/discharges` open-encounter list with role-gated Discharge/Transfer
  actions + durable discharged history). Route guard patients.view;
  action buttons appear only with the matching adt.* permission. ADT
  WRITES ARE REAL-ONLY — the durable system of record is never applied
  to local mock state (unlike the Stage 9-era offline apply); a rejected
  write surfaces the server's precise {error}. Reads fall back to
  display-only mock derivations offline. `getBeds()` now composes the
  REAL bed registry + REAL roster, so Bed Overview reflects ADT
  immediately (mock fallback offline; getUnitSummary KPIs stay mock —
  documented drift).
- **Deployed verification**: `.github/workflows/deployed-adt-e2e.yml`
  (manual dispatch, SEQUENTIAL with the other suites; idempotent under
  persistence by design — unique MRN per run, dynamic free-bed picks,
  discharges its own encounter). Container-restart durability (admit +
  transfer + discharge + event history survive; counters resume) is
  asserted in local verification where the container can be restarted;
  the live suite asserts the closed encounter remains queryable
  (cross-run accumulation = live durability evidence). The auth E2E's
  exact-14 roster count became a seeded-SUBSET assertion (the census
  legitimately changes under ADT — same lesson class as the labs fix).

### Layer 3 — User Administration (built) — Aurora Core Identity
Administrators create, view, edit, deactivate/reactivate accounts and
reset passwords (`server/Core/Identity/UsersApi.cs`; `/admin/users`
screen). The Phase 2 Users entity was EXTENDED, never duplicated —
JobTitle remains the SINGLE stored role field; PermissionProfile and
Permissions stay derived at read time (locked rule). Usernames are
natural keys — no id counters to resume.
- **THE PRIVILEGE-ESCALATION SURFACE IS THE CENTRAL CONCERN** — creating
  or editing a JobTitle changes who can sign orders. Safeguards, all
  server-enforced and all locally verified in both directions:
  (1) every endpoint requires the Administrator profile's `users.manage`
  — doctor/nurse/pharmacist tokens get the generic 403 on ALL six
  endpoints; (2) every action is AUDITED on the account's immutable
  append-only event history (JSON column, same pattern as Orders
  history/ADT events): who (ALWAYS the token's name claim, never a
  request field), when (UTC **date**+time — account changes span months,
  unlike HH:mm bedside events), what changed ("Consultant → Staff
  Nurse"); (3) an administrator cannot deactivate or demote THEIR OWN
  account (400 — lockout prevention + no quiet track-covering; a LATERAL
  admin→admin self title change stays allowed and audited); (4) the LAST
  ACTIVE Administrator-profile account can be neither deactivated nor
  demoted (400; SUPERSEDED to 409 by the state-conflict PR — transient
  system state: the same request succeeds once another active
  administrator exists. The SELF guards deliberately stay 400 —
  actor-relative, never valid for that pair in any state); (5) granting a CLINICAL JobTitle (any title deriving
  the Doctor or Nurse profile) requires an explicit `justification`
  recorded in the audit — the acknowledged-override pattern from
  medication safety; administrative titles need none.
- **Deactivation is a STATUS CHANGE, never a delete** — an account that
  signed an order must stay resolvable forever or the audit trail
  breaks. A deactivated account gets the SAME generic 401 on login as
  bad credentials (no account-state oracle; the bcrypt verify still
  runs, so timing matches too). Outstanding JWTs live out their 12 h
  expiry — token revocation is a documented prototype limitation.
- **Passwords**: bcrypt work factor 10, distinct salt per account;
  admin-set initial password on create; reset SETS a new hash and never
  reveals/transmits the old one; the audit records THAT a reset
  happened, never any password material (asserted: no password string
  anywhere on the wire). Stated minimum 8 chars — below it is a 400
  "too weak" per the codified validation rule (unknown fields fail
  binding; duplicate username, unknown JobTitle — must be one of the
  20 — blank/weak password, clinical-without-justification, and the
  self guards a precise 400; unknown account 404; replayed
  deactivate/reactivate and the last-admin guards are 409 since the
  state-conflict PR).
- **Migration `AddUserAdmin`** (Users += Active, EventsJson; Username
  collation-"C" pin for the DB-side ORDER BY): backfill defaults
  HAND-SET to true/"[]" so the 20 pre-Layer-3 accounts on the durable
  database come through ACTIVE with valid empty histories — verified by
  running the new binary against a pre-Layer-3 database (all 20 active,
  loginable, clinical data untouched).
- **Frontend** (`/admin/users`, users.manage guard — non-Administrator
  profiles get the explicit Access Restricted state naming the missing
  permission, and no User Accounts nav item): account list shows the
  DERIVED profile per row (never stored); the DERIVATION CHAIN
  (JobTitle → Profile → Permissions) renders live while assigning a
  title in create AND edit, so an admin sees exactly what authority
  they are granting before they grant it; clinical titles surface the
  required justification field; self row hides Deactivate. Writes are
  REAL-ONLY (identity is the durable system of record); the list read
  falls back to a display-only derivation of the Stage 9 preset staff.
- **Deployed verification**: `.github/workflows/deployed-users-e2e.yml`
  (manual dispatch, SEQUENTIAL) — SELF-SUFFICIENT per the codified
  finite-seeded-resources rule: creates every user it touches
  (run-id-unique), never mutates seeded accounts (the admin bootstrap
  login is the only, read-only, seeded dependency), admits ITS OWN
  patient for the clinical-authority proof (a created Doctor-titled
  account genuinely signs an order; a created Nurse-titled one is
  403'd) and discharges it, then deactivates all created accounts — no
  live credentials left behind; deactivated rows accumulate across runs
  by design (live durability evidence). The LAST-ADMIN guard is
  asserted in LOCAL verification only (live would require mutating
  seeded admins). Container-restart survival (accounts, statuses, reset
  password, full audit chains) is asserted locally.

### Encounter-scoped orders (built) — the ORD-113 fix

*[Docs split note: the invariant statement, the encounterId/aggregate-root
bullet, the EncounterGuard chokepoint, the deliberately-narrow invariant,
and the closed-encounter state machine moved verbatim to 01_ARCHITECTURE.md
§ "Aggregate root & encounter lifecycle invariants". The build/verification
record continues below. Pre-existing artifact, moved verbatim and flagged in
the split PR: the first block below begins mid-sentence — its lead-in
describing the discharge cascade was already missing in the pre-split
file.]*

  active AND pending orders in the same transaction — audited with the
  DISCHARGING CLINICIAN as actor, reason "patient discharged —
  auto-discontinued at discharge", scheduled administrations cancelled
  via the single shared `OrderLogic.Discontinue` mechanics, never
  deleted. Lifecycle/system writes to closed encounters go through
  DISTINCT, EXPLICITLY-NAMED paths (`DischargeCascade`,
  `BackfillEncounterScope`) with their own audit semantics — never a
  bypass boolean on the guard.
- **Encounter-aware derived views**: the MAR and the working queues
  (pending/active status views, implementation queue) derive ONLY from
  orders on open encounters; the plain per-patient chart stays
  LONGITUDINAL (person-level history — readmission presentation
  semantics are a recorded open question, below).
- **Reserved System principal** (`system` row in the Users table,
  seeded idempotently): inactive, JobTitle "System" (maps to NO
  permission profile), a valid bcrypt hash matching nothing — it can
  NEVER authenticate (same generic 401 + decoy-verify timing as any bad
  login, asserted) and all four user-admin mutations on it are 400
  ("reserved system principal"). It exists so migrations — which have
  no token — still record an honest audit actor.
- **One-time audited backfill** (boot-time, idempotent, logged):
  resolves `encounterId` for every pre-existing order — the patient's
  OPEN encounter if one exists (every prior order was created under the
  forward invariant), else the MOST RECENT encounter — then restores
  the invariant: active/pending orders on non-open encounters are
  discontinued with actor **System**, reason "system migration —
  encounter closed before the encounter-bound invariant existed".
  Verified against a state-equivalent replica of the live DB: all 36
  orders scoped per the rule, ORD-113 → ENC-1017 and neutralized with
  exactly one appended audit event, all 35 other orders byte-identical
  on every pre-existing column, encounters untouched, second boot 0/0
  with no duplicate events.
- **Frontend**: `Order.encounterId?` added to the wire type (absent on
  the mock store); no UI change — `apiPost` already routes any non-401
  error (incl. the new 409) to `denied`, never applied locally.
- **Deployed verification**:
  `.github/workflows/deployed-encounter-scope-e2e.yml` (manual
  dispatch, SEQUENTIAL, build-id gated, `if: always()` cleanup) —
  SELF-SUFFICIENT: admits its own patient, creates the orders it
  consumes, and the discharge cascade itself guarantees no active
  order is left behind. Asserts: ORD-113's backfill audit (read-only —
  re-asserting "exactly one discontinued event" every run IS the
  idempotence evidence), create-on-discharged → 409, both created
  orders carry the encounterId, cascade discontinues active+pending
  with clinician actor + exact reason + cancelled doses, MAR drops the
  rows, administer → 409, readmission = same patient/new encounter/no
  stale actives/new order scoped to the new encounter. LOCAL-ONLY legs
  (documented in the workflow header with reasons), as amended by later
  PRs: acknowledge-on-closed-encounter → 200 moved LIVE in the results
  audit PR (the labs suite tests it on its own patient), and the
  sign/modify-on-closed 409s moved LIVE in the state-conflict PR (the
  separated lookups no longer 404 on the cascade-discontinued status
  before the guard answers — the suite now asserts the GUARD's 409).
- **Recorded open questions (do NOT fix ad hoc)**: (1) administration
  timestamps are DATE-LESS (HH:mm) — masked today by the single-day
  simulation, but a real multi-day chart needs full timestamps;
  Stage 11 Observation work is the natural owner. (2) Readmission
  chart PRESENTATION semantics — the longitudinal per-patient chart
  now correctly shows prior-encounter orders as discontinued, but how
  a readmission's chart should present/group prior-episode history
  (filter by encounter? collapse? annotate?) is an unresolved design
  question for the Orders screen.

### Result un-acknowledgment + result creation (built) — the results audit PR
A genuine clinical feature, not a test fixture — built because live
verification proved a class of correct clinical behaviour had become
unverifiable: no way to create a result, no way to reverse an
acknowledgment, the labs suite permanently red on its spent seeded well,
its nurse-403 check without automated guard, and
acknowledge-on-a-closed-encounter untestable.
- **Un-acknowledge** (`POST /api/icu/results/{labs|imaging}/{id}/
  unacknowledge`): a clinician reverses their own or another's
  acknowledgment. NEVER a deletion (the never-destroy principle from the
  Stage 11 override rule and Layer 3 deactivation): results now carry an
  append-only EventsJson history — the original acknowledgment (actor,
  time) survives there forever; the reversal appends its own audited
  event with actor FROM THE TOKEN and a REQUIRED reason (400 without,
  validated like discontinue); the current-state summary fields clear
  and the result RETURNS TO THE INBOX (derived, as always). RBAC mirrors
  acknowledge — doctor 200, nurse generic 403, verified both directions.
- **Replay is a STATE CONFLICT (409), never 404** — by the 403/404/409
  convention the encounter-scoping fix codified, 404 is reserved for ids
  that resolve to NOTHING: acknowledging an already-acknowledged result
  and reversing an unacknowledged one are both 409 with a precise error
  naming the current state (this DELIBERATELY supersedes the Phase 3-era
  "replayed acknowledge → 404" behavior). The remaining 404-where-state
  sites this paragraph used to record (orders sign/modify/discontinue/
  implement, the MAR re-document) and the ADT/Users 400-where-state
  conflicts were ALL unified by the state-conflict PR — see "The
  four-code rule (unified)" below.
- **Audit timestamps are DATED UTC (yyyy-MM-dd HH:mm, the Layer 3 users-
  audit convention)** on every NEW resulted/acknowledged/unacknowledged
  event — result audit trails span discharges and readmissions. The
  acknowledgedAt SUMMARY field stays HH:mm (the bedside display
  contract, byte-parity preserved). KNOWN LIMITATION: the 79 backfilled
  acknowledgment events carry whatever the pre-migration rows stored —
  bare HH:mm, "D-n HH:mm", or "" — a date was never recorded and is NOT
  fabricated; only post-migration events carry full dates.
- **Result creation** (`POST /api/icu/results/labs` and `/imaging`):
  results arrive UNACKNOWLEDGED and enter the inbox. Scoped to the
  patient's open encounter exactly as orders are — `encounterId`
  SERVER-derived, never client-supplied (a payload containing it at ANY
  position fails binding → 400; asserted in the suite as the regression
  tripwire). Authority is the PRODUCING SERVICE's: new permission
  `results.create` on the Ancillary profile (lab/radiology technicians;
  seeded accounts noor.al-amin / pablo.reyes) — doctor AND nurse tokens
  are 403'd on create, the same polarity flip as implement/administer/
  transfer. Validation per the codified rule: closed vocabularies parse
  (panel ∈ the LabPanelKey union, modality ∈ ImagingModality, item/study
  flags ∈ normal|abnormal|critical — the frequency precedent), items
  complete with finite values and sane ref ranges (unit may be EMPTY —
  unitless analytes like pH are part of the canonical shape), draw-level
  flag DERIVED from the worst item (never client-supplied), bed/name
  resolved from Core ADT, timestamps and actor server-stamped. Imaging
  creation records the RESULTED stage (status final, report+impression
  required) — the ordered/performed pipeline arrives with the imaging
  ORDER workflow, not manual result entry. Ids LAB-9001+/IMG-9501+
  (disjoint from seed blocks, persistence-aware counters per the
  OrderLogic rule — restart-verified).

*[Docs split note: the "THE ENCOUNTER RULE IS ASYMMETRIC HERE — the crux"
bullet moved to 01_ARCHITECTURE.md § "Aggregate root & encounter lifecycle
invariants".]*

- **Migration `AddResultAudit`** (LabDraws + ImagingStudies +=
  EncounterId, EventsJson; EventsJson backfill default hand-set to "[]"
  per the Layer 3 lesson) + idempotent boot backfill: scopes existing
  results by the orders rule (open encounter, else most recent) and
  RESTRUCTURES existing acknowledgments into the event history FROM THE
  ROW'S OWN stored actor/time fields — the same facts moved into the
  append-only record, never invented (a seed acknowledgment with no
  stored actor becomes actor "Unknown", time "" — the ADT historical-
  seed convention). Verified against a live-equivalent replica (all 73
  labs acknowledged — the spent-well state): 80 results scoped, 79
  acknowledgments restructured from their own fields, every pre-existing
  column byte-identical, Orders/Encounters tables untouched, second boot
  0/0 with no duplicate events, and un-ack works on the migrated
  live-shaped rows (the spent well is now recoverable BY DESIGN — a
  clinical action, not a test reset).
- **Wire deltas**: LabDraw/ImagingStudy gain `encounterId` + `history`
  (ResultEvent[]) — verified as the ONLY deltas by a 94-check
  byte-parity sweep. Frontend: types extended; `unacknowledgeLab`/
  `unacknowledgeImaging` adapters (proven write semantics — denied never
  applied locally; offline mock-apply clears the summary only, the
  audited record is the server's); the Labs screen's ImagingCard gains a
  permission-gated "Reverse" action with a required-reason dialog (the
  MAR held/refused pattern). DISPLAY DEBTS (documented, deliberate):
  acknowledged LAB results have no list UI yet, so lab un-ack is
  adapter/API-level until a lab result-detail view exists; result-entry
  UI for technicians is deferred to Layer 4 (needs the lab test catalog)
  — the LIS/device feed is the real source at Stage 11.
- **`deployed-labs-e2e.yml` REWRITTEN self-sufficient** (the codified
  finite-seeded-resources rule): admits its own patient, creates the
  results it consumes via the real endpoint, asserts seeded reads as a
  SUBSET (len>=49 + lookup-by-id), covers creation RBAC both directions,
  the encounterId binding tripwire, nurse-403/doctor-200 acknowledge
  (automated RBAC coverage restored), the full un-ack cycle
  (never-destroy history, inbox return, replay 409 / absent-id 404),
  create-on-closed → 409 vs ack/un-ack-on-closed → 200 LIVE, and ends
  with `if: always()` cleanup that discharges the run's encounter AND
  acknowledges any leftover run results (both legal on the closed
  encounter by design) — the suite is permanently green-capable against
  the durable DB again.
- **Recorded open question (do NOT fix ad hoc) — results have NO ORDER
  LINKAGE**: a result carries patientId and encounterId but nothing ties
  it to the order that requested it — a doctor orders a CBC, a
  technician creates a CBC result, and the two are unconnected. In a
  real HIS the result FULFILS the order (the same aggregate-root
  question one level down: Patient → Encounter → Order → Result). This
  belongs with Layer 4's lab catalog / order sets — recorded here so it
  is not rediscovered later.

### The four-code rule — application record (the state-conflict PR)

*[Docs split note: the convention itself moved to 01_ARCHITECTURE.md § "The
four-code rule (unified)"; below is that PR's application/verification
record.]*

- **Frontend audit result — zero behavioral change**: the only
  status-code branching in any adapter is `=== 401` (the offline/local-
  session split); `adtPost`/`usersPost` surface the server's `{error}`
  for every non-401 status and `apiPost` maps them to `denied` (never
  applied locally) — a 409 already behaved exactly like 403/400.
- **No schema change** — no migration; a fresh boot applies the existing
  chain ending at `AddResultAudit`, and the ModelSnapshot is untouched.
- Deployed suites assert BOTH branches (absent → 404, conflict → 409) of
  every changed code: orders (replayed sign/discontinue/modify, implement
  shape-400/pending-409/replay-409, absent-id 404s), MAR (re-document 409
  with actor, absent order/dose 404s), ADT (occupied/duplicate/
  re-discharge/transfer 409s + absent-encounter 404s, nonexistent-bed
  still 400), users (replayed deactivate/reactivate 409, absent account
  404; last-admin 409 stays local-only — live would mutate seeded
  admins), encounter-scope (sign/modify on closed → guard 409, now live).
  LIVE VALIDATION COMPLETE (2026-07-10): all suites green against the
  deployed service. One suite bug found live and fixed on the way (orders
  run #16): an absent-id 404 probe must carry the token AUTHORIZED for
  that mutation — RBAC runs BEFORE the lookup and the 403 is generic
  precisely so error codes are no existence oracle, so probing the
  nurse-only implement with a doctor token gets 403, never the 404 under
  test. The orders loop was the only instance (MAR/ADT/users audited
  correct); same lesson class as the $OID bug — suite code only the
  runner executes needs the runner to execute it.

### Layer 4 — Master Data: the Formulary (built) — Aurora Core
The REFERENCE layer begins (`server/Core/MasterData/`) — the third kind
of data, distinct from transactional (orders, results) and entity
(patients, encounters, users): a real, database-backed drug formulary
Pharmacy maintains, replacing the hardcoded 19-drug frontend list. The
lab test catalog and order sets are the NEXT master-data domains — Layer
4 is formulary-complete, not complete.
- **Tables** (migration `AddFormulary` — three new tables, nothing else
  touched): FormularyDrugs (one row per drug: generic name, brand names,
  class, form, strengths, doses, default dose, dose limits
  min/max/maxDaily/perKg, routes, per-drug frequencies, PRN flag, the
  allergyBlock/allergyWarn tags safety.ts consumes, Active, append-only
  EventsJson, Seq; DrugId is a natural key — no counters), NamedFrequencies
  (the vocabulary), InteractionRules (pairwise, read-only this PR). Seeds
  formulary-seed.json / frequencies-seed.json / interactions-seed.json are
  GENERATED from `src/lib/api/data/formulary.ts` (extended with the new
  reference fields) — never hand-edit. No DB-side string ORDER BY → no
  new collation pins.
- **RBAC — a new profile boundary**: `formulary.manage` on the PHARMACIST
  profile (the results.create polarity flip): doctor/nurse/administrator
  tokens get the generic 403 on every mutation; every authenticated
  profile reads. Verified in both directions.
- **Endpoints**: `GET /api/icu/formulary` (all drugs incl. inactive; the
  ordering UI filters), `GET .../frequencies`, `GET .../interactions`
  (reads for all); `POST /api/icu/formulary` (create), `PUT .../{drugId}`
  (edit — drugId is the immutable natural key; audited field diffs),
  `POST .../{drugId}/deactivate|reactivate` (mutations, Pharmacy only).
  Audit events carry dated UTC times and the TOKEN's actor (Layer 3
  convention).
- **DEACTIVATION, NEVER DELETION** (the Layer 3 rule applied to reference
  data): a drug that has ever been prescribed must stay resolvable
  forever or historical orders become unreadable. An INACTIVE drug cannot
  be selected for a NEW order — order create (and modify changing the
  drugId) answers **409** ("reactivate it and the same request succeeds"
  — resource state, checked after the encounter guard so the deeper
  cause reports first); every EXISTING order referencing it keeps
  rendering, and its lifecycle (modify dose, discontinue, MAR) continues
  — asserted live. A drugId with NO formulary row stays permitted free
  text on orders — the documented escape hatch until the formulary is
  the sole source of orderable drugs. (SUPERSEDED as an acceptable end
  state by the live finding below: the escape hatch is now a RECORDED
  DEFECT to close with the safety-enforcement work, not a design.)
- **LIVE FINDING (2026-07-10, post-merge verification) — THE FORMULARY
  IS NOT YET AUTHORITATIVE FOR ORDERING**: an order for
  'totally-fake-drug-xyz' ("Fictional Compound"), a drug in NO
  formulary, was created and signed with a 200 (live artifacts
  ORD-167/ORD-168 on P-1034 — discontinued "verification artifact" and
  discharged). Management is authoritative (create/deactivate/audit,
  RBAC-enforced) but the order service still accepts ANY drugId string.
  FIXED by the server-side safety-enforcement PR (see "Server-side
  safety enforcement (built)" below): the order service now treats the
  formulary as authoritative — ordering an UNKNOWN drugId is rejected
  (validation 400 naming the field, by the unknown-patientId precedent —
  the drugId is a payload field, not an addressed resource; 404 stays
  reserved for addressed ids) and an INACTIVE one stays 409. The
  frequency-parity legs in the orders AND formulary suites switched to
  formulary drugs in the same PR.

*[Docs split note: the "CODIFIED TEST-COVERAGE LESSON" bullet moved to
03_DEVELOPMENT_RULES.md § Deployed E2E suite disciplines.]*

- **The frequency vocabulary MOVED to master data**: OrderLogic's
  hardcoded array ("per CRRT protocol" was ICU-specific content sitting
  in Core/Orders) became the NamedFrequencies table; order validation
  reads it via FormularyLogic and builds the error text from it in seed
  order — behavior BYTE-IDENTICAL (accepted set = the 9 named values ∪
  q<1-48>h; rejected q0h/q49h/q99999999999h/whenever with the exact
  pre-Layer-4 message — asserted string-equal locally and live). Per-drug
  frequencies on formulary create/edit validate against the same
  vocabulary, so Pharmacy can never author a frequency the order endpoint
  would reject.
- **Four-code**: replayed de/reactivation → 409; duplicate drugId on
  create → 409 naming the existing drug (drug ids are permanent).
  RECORDED TENSION, not fixed here: Layer 3's duplicate USERNAME is a
  400 — the two duplicate-natural-key answers should converge one way or
  the other in a later consistency pass. Absent id → 404; malformed →
  400 (unknown fields fail binding; an all-null doseLimits object on
  edit CLEARS the limits — partial updates cannot otherwise express
  removal).
- **Frontend**: `/formulary` management screen (route guard
  formulary.manage — only Pharmacist profiles see the nav item or reach
  it): drug list with status/allergy-tag/dose-limit display, create/edit
  forms with the live frequency-vocabulary hint, deactivate/reactivate
  with confirm, per-drug audit history. Formulary WRITES are REAL-ONLY
  (reference data is a durable system of record); reads fall back to the
  mock store offline. Orders & Medication now reads its drug list from
  the API (`getFormulary` w/ mock fallback) and the order-entry search
  excludes inactive drugs (server enforces regardless).
- **Recorded, deliberately NOT done here**: (a) the safety.ts
  allergy/interaction checks stay CLIENT-side; once they move
  server-side, a client that skips them must be REJECTED (the server
  re-validates on POST /orders — defense in depth becomes enforcement).
  FORMULARY AUTHORITY AT ORDERING is part of this same work item (the
  live finding above): unknown drugId → 400, inactive → 409, plus the
  suites' missing absence probes;
  (b) the order→result linkage open question rides with the LAB CATALOG,
  the next master-data domain; (c) interaction-rule MANAGEMENT (the
  table is served read-only); (d) dose-limit ENFORCEMENT at ordering
  time (the limits are carried reference data today).
- **Verification**: 78-check behavior matrix (RBAC both directions, all
  four-code branches, the deactivation invariant end-to-end, the exact
  frequency accepted/rejected sets incl. error-text string equality);
  35-check byte-parity sweep old-main vs branch on every unaffected
  endpoint (zero diffs — incl. the frequency error text, now DB-built);
  live-upgrade migration simulation against a replica carrying replayed
  live-like writes (one migration applied, all 9 pre-existing tables
  byte-identical, 19/9/6 rows seeded, second boot 0 changes);
  Postgres restart survival (created drug + deactivation + audit intact,
  create-after-restart Seq continues, the 409 holds).
  `deployed-formulary-e2e.yml` (manual dispatch, gate v3 content
  equality, shared `deployed-e2e` concurrency group — the tenth suite):
  SELF-SUFFICIENT per the finite-seeded-resources rule — creates every
  drug it mutates (run-unique ids, never touches the 19 seeded drugs),
  admits its own patient for the deactivation-invariant proof, asserts
  seeded reads as a SUBSET (vocabulary asserted EXACT — no endpoint
  mutates it, and exactness IS the parity claim), and ends with
  `if: always()` cleanup (discharge + deactivate run drugs, outcomes
  asserted loudly).

### Layer 4 phase 2 — Lab Test Catalogue, order→result linkage, Order Sets (built)
Completes Layer 4's planned domains (`server/Core/MasterData/`).
- **Lab Test Catalogue** (migration `AddLabCatalogOrderSets`, table
  LabTests): one row per orderable test — testId (natural key == the
  LabPanelKey the results wire has always used), name, category grouping,
  specimen, component analytes (unit + refRange + numeric bounds) as a
  JSON column, Active, append-only EventsJson. SEEDED FROM WHAT THE LABS
  DOMAIN ALREADY IMPLIES: `src/lib/api/data/catalog.ts` (new mock store,
  the seed source) is derived from the seven panels in the seeded
  results/LAB_TREND templates, so catalogue and existing results agree by
  construction; chart presentation metadata stays with the trend
  templates. New permission `labcatalog.manage` on ANCILLARY — the
  producing-service principle behind results.create, kept as its OWN
  atom (entering a result ≠ redefining reference ranges); doctor, nurse,
  PHARMACIST and administrator are all 403'd on catalogue mutations.
- **The panel vocabulary moved to the catalogue** (the NamedFrequencies
  precedent): ResultsLogic's hardcoded Panels array is gone; result
  creation validates the panel against the LabTests table and builds the
  error text from it in seed order — byte-identical on seeds. A panel
  resolves against ANY catalogue test, ACTIVE OR INACTIVE — deactivation
  blocks ORDERING, never RESULTING (below). Modalities stay a closed
  union until the imaging-order workflow exists.
- **Deactivation invariant, with a deliberate asymmetry**: an inactive
  test cannot be NEWLY ORDERED (order create with its testId → 409,
  after the encounter guard); every existing result referencing it keeps
  rendering; and creating a RESULT for it stays 200 — a result completes
  care already ordered, and blocking it would strand the day-3 order
  whose test was retired on day 5 (the results-audit asymmetry, one
  level down). All three directions asserted live.
- **ORDER→RESULT LINKAGE (closes the recorded open question)**: orders
  gain `testId?` (Lab category only — testId on any other category is
  SHAPE, 400); lab results gain `orderId?` — SERVER-derived at creation
  (a payload carrying it fails binding, exactly as encounterId does):
  the result fulfils the OLDEST UNFULFILLED active Lab order for the
  same test on the open encounter. THE MODEL CHOICE, justified: results
  MAY exist without an order — reflex adds, standing lab protocols and
  walk-in/outside results are legitimate unsolicited entries in any real
  LIS, mandatory linkage would block exactly those, and all ~80
  pre-linkage rows stay null (a linkage is never invented — the
  never-fabricate backfill rule). Both wire deltas are ADDITIVE
  (`Order.testId?`, `LabDraw.orderId?` — absent on all pre-existing
  rows, so every unaffected read is byte-identical). Order COMPLETION
  when its result arrives is a recorded open question — the linkage is
  one-way (result → order) this PR.
- **Order Sets** (table OrderSets, seeded from formulary.ts
  ORDER_SET_DEFS; the Lactate/ABG lab items now carry their catalogue
  testIds): named bundles referencing the formulary and the catalogue.
  New permission `ordersets.manage` on PHARMACIST (protocol authorship
  stewarded with the formulary in the provisional model; a distinct atom
  so a future split costs a table edit). AUTHORING integrity: set items
  validate the same shape rules as order drafts, and an UNKNOWN
  drugId/testId in a DEFINITION is 400 (reference data must be
  internally consistent) while an INACTIVE reference is allowed at
  authoring and 409s at APPLY (state).
- **APPLY IS THE ORDER-CREATION PATH, NEVER A BYPASS**:
  `POST /api/icu/order-sets/{setId}/apply` composes drafts and calls the
  SAME OrdersApi.Create the endpoint uses (extracted, behavior-neutral)
  — clinician RBAC (orders.create/sign — nurse 403), draft validation,
  the encounter guard, and the inactive-drug/test 409s all apply
  identically; applying to a DISCHARGED patient returns the
  STRING-IDENTICAL 409 a single order gets (asserted). An inactive SET
  is its own 409. NOTE: the Orders screen's set expansion keeps its
  client-side allergy screening and composes drafts through POST /orders
  (the same path, still no bypass); the apply endpoint applies ALL items
  — replicating the safety screen server-side is the queued
  safety-enforcement work item.
- **Frontend**: `/lab-catalog` (Laboratory) + `/order-sets` (Pharmacy)
  management screens with per-item audit history (set items edited as
  validated JSON — a structured set-item editor is recorded display
  debt); the Orders screen gains a catalogue-driven "Order Lab Test"
  picker (active tests only, orders carry the testId) and its order-set
  card reads the REAL definitions (inactive sets excluded); adapters
  follow the proven read-fallback/REAL-ONLY-write pattern.
- **Recorded, deliberately not done here**: (a)
  CATALOGUE-AUTHORITATIVE ORDERING — SUPERSEDED: shipped with the
  safety-enforcement PR (unknown testId → 400, inactive stays 409);
  (b) the suites' absence probes likewise shipped there; (c) order
  completion on result arrival; (d) interaction-rule management and
  dose-limit enforcement (unchanged).
- **Verification**: 67-check behavior matrix (all RBAC polarities incl.
  the pharmacist-403-on-catalogue cross-check, linkage both branches,
  the asymmetry, apply-path equivalence); byte-parity sweep vs main —
  zero diffs on every unaffected endpoint including the three formulary
  reads (the additive columns are invisible on pre-existing rows);
  live-upgrade migration simulation on a Postgres replica with replayed
  writes (one migration, all pre-existing DATA byte-identical —
  compared per-column since ADD COLUMN changes physical order — new
  tables 7/4, both new columns all-null); second boot 0/0; restart
  survival (linkage, catalogue test + audit, set deactivation all
  intact; creates continue). `deployed-labcatalog-e2e.yml` is the
  ELEVENTH suite — gate v3, shared concurrency group, self-sufficient
  (run-unique test/set/drug + own patient), `if: always()` cleanup with
  asserted outcomes.

### Server-side safety enforcement (built) — the reference layer becomes AUTHORITATIVE
The consolidated work item queued since the formulary's live finding.
Three interdependent parts, one PR (they share the same test-migration
consequence). No schema change — the only wire delta is the additive
`overrideJustification` request field on order create/set apply.
- **Part 1 — formulary/catalogue authority at ordering**: the order
  service no longer accepts arbitrary reference ids. Call sites:
  `OrderLogic.ValidateDraft` (unknown drugId → 400 "does not match any
  formulary drug"; unknown testId → 400 "does not match any catalogue
  test" — the unknown-patientId precedent: payload fields, never 404),
  `OrderLogic.ValidateChanges` (modify's changes.drugId, same 400), and
  order-set authoring now surfaces the same shared text through
  ValidateDraft (its own redundant resolution checks removed). INACTIVE
  stays 409 (state, after the encounter guard) — unchanged. PRECEDENCE
  NOTE: for a draft with BOTH an unknown drug and an invalid frequency,
  the unknown-drug 400 now reports first (field order); the frequency
  error is byte-identical for resolvable drugs.
- **Part 3 — the safety.ts move (server-authoritative medication
  safety)**: `SafetyLogic` re-runs the allergy/interaction/duplicate
  checks at order creation — a client that skips its own check is
  caught; the client copy stays for UX. THE MODEL: HARD BLOCK, never
  overridable → 409 (allergyBlock tag matching the patient's documented
  allergy field; block-severity interaction rules against ACTIVE med
  orders on the OPEN encounter — e.g. duplicate therapeutic
  anticoagulation). 409 not 400: correcting the allergy record or
  discontinuing the interacting order lets the same request succeed.
  WARN, overridable → 409 WITHOUT `overrideJustification`; proceeds
  WITH one and appends an audited "safety override" event (actor from
  the token, the warnings acknowledged, the justification — the Layer 3
  clinical-justification pattern) to each affected order's history:
  allergyWarn cross-reactivity, warn-severity interactions, duplicate
  therapy. Blocks are checked for EVERY draft before any insert (a
  blocked batch creates zero orders); "none known" allergies skip the
  allergy legs; a stray justification with no findings is ignored and
  never audited. Set APPLY inherits everything through the shared
  create path (sepsis-bundle on a penicillin-allergic patient → the
  allergy block 409, asserted). RECORDED follow-up scope: the MODIFY
  path validates formulary authority but does not re-run
  allergy/interaction screening; batch-internal duplicates (two drafts,
  same drug, one request) are unseen — same property as the client
  check; the set-apply endpoint has no per-item skip (the Orders
  screen's client-side screening composes drafts instead).
- **HISTORICAL RENDERING GUARANTEE (the Print Center note)**: ORD-168's
  fictional drug is IN the durable database forever, and any historical
  view or export — the forthcoming Print Center especially — must render
  orders whose drugId resolves to nothing without crashing. CONFIRMED at
  the API level on a live-upgrade replica: an escape-hatch order
  persisted by the OLD binary still READS under enforcement, its dose
  can still be modified and it can still be discontinued (the closed
  encounter state machine's terminal transition), while a NEW order for
  the same fictional drug is 400. Reads never consult the formulary —
  UI/print renderers must preserve that property (display the stored
  drug text, never join-require the formulary row).
- **Part 2 — the coupled suite migration (the coverage lesson made
  concrete)**: the orders and formulary suites' frequency-parity legs
  rode the escape hatch (drugId 'x') and broke by design — they now
  order real drugs (the orders suite creates its OWN run drug; the
  formulary suite uses its reserved DRUG2, since an active $DRUG order
  would trip the duplicate check). The labcatalog suite's
  unknown-testId leg FLIPPED from asserting acceptance to asserting the
  400. Absence probes added where owed: orders (unknown drugId + testId
  400s with exact text), formulary (unknown drugId), labs
  (create-result-for-unknown-patient 400). The orders and MAR suites
  now ADMIT THEIR OWN PATIENTS — forced by enforcement itself (the
  shared P-1001's accumulated active orders trip the duplicate-therapy
  check on every new med order), which also resolves their leg of the
  recorded P-1001-discharge WARNING. The orders suite gained a SAFETY
  step asserting the full model live: allergy block 409 (override does
  NOT clear it), warn 409 → audited override 200 (event + actor +
  justification asserted), duplicate 409, interaction block vs warn.
  Both suites gained if: always() cleanup (discharge + deactivate run
  rows, outcomes asserted).
- **Frontend**: `createOrders` sends the order form's acknowledged
  override text as BOTH `note` (audit display, as before) and
  `overrideJustification` (the server gate) — the UI flow is unchanged;
  a raw API client without the acknowledgment is now stopped.
- **Verification**: 30-check enforcement matrix (authority both
  branches incl. modify + set-authoring texts, every safety
  severity/override combination, the audited-event shape, none-known
  skip, stray-justification no-op, oversized justification 400);
  35-check byte-parity sweep vs main — zero diffs on every unaffected
  endpoint (the bad-frequency parity probe repointed at a resolvable
  drug per the precedence note); live-upgrade replica (zero migrations,
  the ORD-168 confirmation above); suites: orders/MAR/formulary/
  labcatalog/labs migrated as described, all eleven YAML-validated.
- **LIVE-VERIFIED (2026-07-11, deployed build e8f3cf56 — post-merge)**:
  - **Hands-on before/after (project owner)**: an order with an unknown
    drugId flipped from **200 on build 9ac4624** (the escape hatch —
    exactly the recorded ORD-168 gap) to **400 on build e8f3cf56** (the
    formulary is now authoritative for ordering; the gap is closed). A
    HARD allergy block returns **409 and is NOT cleared by an
    `overrideJustification`**. A cross-reactivity WARNING returns **409
    without a justification and 200 with one**, appending the audited
    "safety override" event carrying the actor, the acknowledged
    warning, and the reason. All three parts of the work item are done:
    formulary/catalogue-authoritative ordering, safety.ts moved
    server-side, and the block/warn asymmetry with audited override.
  - **Deployed suites (sequential, per the discipline)**: orders
    (29131534519 — incl. the full SAFETY step), MAR (29131571293),
    labcatalog (29131655282) and labs (29131689581) all green on first
    dispatch with every assertion step executed. The FORMULARY suite's
    first run (29131600533) failed on its OWN final leg — the
    "order after reactivation" probe re-orders the run drug while the
    run's signed order for the same drug is still active, which is now
    a duplicate-therapy 409 — the server behaving exactly as specified;
    suite-only fix (discontinue the run order before the re-order probe)
    validated GREEN on its branch (run 29132008305, 14/14 steps — the
    content-equality gate passes a workflow-only branch by design). One
    retry also surfaced a TRANSIENT "no free beds" (16 beds, 14 seeded
    encounters — the two free beds were briefly held by concurrent
    hands-on verification; a read-only ops audit confirmed no leaked
    encounters afterwards).

### Print Center Foundation — Phase 1 (built) — read-only rendering, 3 of 13 templates
The first production-ready Print Center slice: the rendering
ARCHITECTURE (binding rules recorded in 01_ARCHITECTURE.md § Print
Center) plus the ICU Admission Note, Daily Progress Note, and Discharge
Summary. The remaining ten templates are LATER PRs on this foundation.
Frontend-only: no server change, no schema, no new endpoints, no domain
logic touched.
- **Architecture**: `/print` hub (patient → encounter → document picker;
  standard app chrome, route + nav guarded by `patients.view`) and
  `/print/:templateId/:patientId?enc=` (the printable document — NO app
  chrome at all; on-screen paper preview with a toolbar that print media
  hides). Template registry (`registry.tsx`: id, orientation,
  encounter scope, data builder, component) → shared `PrintLayout`
  (hospital header + logo placeholder, identity band, encounter band,
  title, printed-by/at, notices, footnotes, footer) + shared primitives
  (Section/FactGrid/MedTable/WriteIn/SignatureBlock) → read-only
  selectors composing EXISTING adapters (`getPatientOrders`,
  `getLabDraws`, `getImagingStudies`, `getTimeline`, `getEncounters`,
  plus new `getRosterRecord` — a read-only exposure of the SAME roster
  fetch getPatients/getBeds already share, not a new endpoint). Adding a
  template = one selector + one component + one registry entry.
- **Printing**: browser-native — `window.print()`, print preview, and
  save-as-PDF. `@page` A4 with proper margins; page numbers via `@page`
  margin boxes (render on Chromium 131+/Firefox, silently absent
  elsewhere — nothing else depends on them); table headers repeat per
  page (`display: table-header-group`); predictable break rules
  (`break-inside: avoid` on bands/signatures, `break-after: avoid` on
  headings, orphans/widows 3); black-on-white, photocopy-friendly, no
  color load-bearing. A print-media rule also hides the app nav/header
  chrome globally, belt-and-braces.
- **THE FORMULARY GUARANTEE, PROVEN not asserted**: (1) code level — the
  print module has ZERO master-data imports (`getFormulary`/
  `getLabCatalog` never referenced; all grep hits are the comments
  stating the rule); (2) runtime — on a local server + headless Chromium
  (Playwright print pipeline), a run patient was admitted, two run drugs
  ordered (one manually discontinued with a reason, one left active),
  the encounter discharged, and the Discharge Summary captured; BOTH
  drugs were then deactivated in the live formulary and the document
  re-rendered **byte-identical** (only the "Printed <timestamp>"
  generation stamp normalized) — 15/15 checks green, A4 PDFs captured
  for all three templates.
- **Discharge-medication classification comes from the audit trail, not
  a new model**: "Medications at discharge" = orders discontinued with
  the discharge cascade's exact persisted reason ("patient discharged —
  auto-discontinued at discharge"; still-active orders when printed
  before discharge); "stopped during admission" = discontinued with any
  other reason, printed with that reason; "changes" = the orders'
  `modified` audit events. All from persisted order records.
- **Surfaced, not buried (the two recorded open questions where print
  makes them visible)**: (a) date-less HH:mm/"D-n HH:mm" charted times
  print EXACTLY as charted with a † footnote explaining the recorded
  open question — dates are never fabricated; (b) every document is
  ENCOUNTER-scoped and says so; when other encounters exist a notice
  names the scope and the readmission-presentation open question.
- **NEW recorded gap (found by this work, not fixed here)**: the roster
  is a derived view over OPEN encounters, so a discharged patient's
  MRN/age/sex/allergies are not retrievable — the Discharge Summary
  printed after discharge falls back to the encounter's identity
  snapshot, renders "—" for the missing fields, and carries an explicit
  notice. A Core patient-identity read (AdtPatients is already
  persisted) is the natural future fix; recorded as its own open
  question below.
- **Recorded open questions (do NOT fix ad hoc)**:
  (1) **The discharged-patient identity read gap** — persistence and
  retrievability DIVERGE at discharge: the AdtPatients row (MRN, name,
  age, sex, allergies) persists forever per the never-destroy principle,
  but the ONLY demographic read — the roster — is by design a derived
  view over OPEN encounters, and the Encounter carries only its display
  snapshot (name, bed, diagnosis, attending). Nothing is lost; it is a
  MISSING READ SURFACE, first hit by print because printing is the first
  consumer to need chart data after the census stops covering the
  patient. It does not touch the encounter-scoping invariant (which
  governs writes; printing is pure read). FIX DIRECTION: a Core
  patient-identity read — GET Patient by id over the persisted
  AdtPatients row (a SERVER PR, behind patients.view). That adds a
  middle rung to the print identity ladder (roster → patient read →
  encounter snapshot) and removes the "—" dashes with NO template or
  layout change.
  (2) **Age is a static integer, not a date of birth** — AdtPatients
  stores `age` as the integer captured at admission, so a summary
  printed long after admission prints the ADMISSION-ERA age. Harmless
  today; to be addressed when the identity read above is designed
  (store/serve DOB, compute age at render — the clock-computed-state
  rule).
  *[BOTH RESOLVED by the patient-identity-read PR (2026-07-11) — see
  "Core patient-identity read (built)" below: (1) GET
  /api/icu/adt/patients/{id} serves identity through the SAME resolver
  the roster uses, discharged patients resolve 200, and the print
  identity ladder gained exactly the middle rung described (no template
  or layout change); (2) DateOfBirth is captured on new admissions with
  age COMPUTED at read; legacy rows keep the admission-era age served
  plainly with its provenance (ageSource) — never a fabricated birth
  date.]*
- **Honesty rules**: narrative sections with no canonical store (past
  history, assessment, plan, follow-up, procedures) print as ruled
  write-in areas — never fabricated; ventilator SETTINGS are Stage 11
  Observation scope, so the progress note prints the roster's vent
  support flag + a write-in, never the placeholder panel data; unknown
  template/patient ids render the locked NotFound pattern.
- **Verification**: `tsc -b --force` + `vite build` clean; 15/15
  headless checks (template rendering, med classification both buckets,
  byte-stability, footnotes/notices, toolbar hidden under print media,
  no nav on the document route, both NotFound paths); offline behavior
  exercised incidentally (a CORS-blocked run fell back to mock and
  correctly rendered NotFound for the API-only patient — never another
  record's data); A4 PDFs of all three templates attached to the PR
  session record.

### Core patient-identity read (built) — GET /adt/patients/{id} + the DOB redesign
Closes BOTH open questions the Print Center recorded (see the supersession
note on them above). A Discharge Summary — the document whose purpose is
to be printed after discharge — no longer renders "Patient Not Found" or
"—" identity dashes for a discharged patient.
- **The read**: `GET /api/icu/adt/patients/{patientId}` (Aurora Core ADT)
  — person-level identity (mrn, name, dateOfBirth?, age, ageSource, sex,
  allergies) from the persisted AdtPatients row, resolvable WHETHER OR
  NOT an open encounter exists. Gated on `patients.view` — the permission
  that already means "may read who patients are"; ALL SEVEN profiles
  carry it in both Rbac.cs and session.ts (verified), so no matrix
  change. FOUR-CODE: absent id → 404; a DISCHARGED patient → 200 (they
  exist — they are just not admitted); 403 via the generic RBAC deny
  (before the lookup); unknown query params → 400; admissions body
  changes fail binding on unknown fields (Disallow, unchanged).
- **NO FORK — one resolver, three entry points**: `Patient.ToDto()` is
  THE canonical identity assembly; the roster projection
  (RosterApi.cs), the POST /admissions response, and the new read all
  serve it. The roster's former direct field reads (p.Name/p.Mrn/p.Age/
  p.Sex/p.Allergies) now go through the resolver — the roster wire shape
  is unchanged (int age arrives computed-at-read for DOB rows, recorded
  value for legacy rows) and the sweep proves it byte-identical.
- **DOB, not a static age (the redesign done here, where identity
  retrieval was being designed)**: AdtPatients gains `DateOfBirth`
  ("yyyy-MM-dd", nullable); `Age` became nullable — EXACTLY ONE is
  populated per row. New admissions capture dateOfBirth (the Admissions
  form gained a date field with a "DOB unknown — record an estimated
  age" fallback for the unconscious-trauma reality); age is COMPUTED at
  read (clock-computed-state rule) with birthday-aware math, and the
  wire carries `ageSource: "dateOfBirth" | "recordedAtAdmission"`.
  EXISTING ROWS: a true DOB cannot be reconstructed from an
  admission-era integer — so it never is (the never-fabricate
  discipline): migration `AddPatientDateOfBirth` only adds the nullable
  column and relaxes Age to nullable; every pre-existing row keeps its
  recorded age, served with `recordedAtAdmission` provenance and no
  dateOfBirth key. Admission validation: both age+dateOfBirth → 400;
  neither → 400; malformed/future/over-130 dateOfBirth → 400.
- **Print middle rung (no template or layout change — verified)**: the
  identity ladder in `selectors.ts` is now roster record (admitted) →
  `getPatientIdentity` (by id; STRICTLY REAL-ONLY — every non-200,
  including 403/5xx/offline, resolves null so printed identity is the
  system of record or visibly absent, never a mock substitute) →
  encounter snapshot (honest last resort). Only the selector/adapter and
  the `source` type union changed; PrintLayout.tsx and every template
  are untouched.
- **Re-admission identity rules (adversarial-review finding — never a
  silent no-op)**: re-admitting a known MRN with a dateOfBirth COMPLETES
  a legacy row that has none (estimate → recorded truth; stored age
  clears); a dateOfBirth CONTRADICTING the recorded one is a 409
  (identity corrections are not an admission side effect — an audited
  correction path is recorded future scope); a submitted AGE estimate
  never downgrades recorded identity — the stored identity stands and
  the response returns it.
- **NEW recorded limitation — DOB is a civil date, the server has only
  UTC**: east of UTC, between local and UTC midnight, a same-day birth
  is rejected as "in the future" and a computed age reads one year low
  for those hours (mirrored west of UTC). Fixing this needs a facility
  timezone concept — future scope, do not fix ad hoc.
- **Adversarial review (find → verify, 10 confirmed findings — all fixed
  here except the recorded limitation above)**: the scaffolded
  migration's Down() would have DESTROYED DOBs and fabricated Age 0 on
  rollback — hand-edited to materialize the DOB-computed age BEFORE
  dropping the column (rollback-tested on the Postgres replica: the DOB
  row came back Age 39, never 0); re-admission silently discarded a
  clinician-typed DOB — the rules above; getPatientIdentity masked
  403/5xx with the mock fallback and could label mock identity as
  patient-record on a printed document — made strictly real-only; the
  ADT suite's new legs had the known suite bug classes (ids exported to
  GITHUB_ENV only AFTER asserts → a failed assert would leak an open
  encounter past the always() cleanup; the banned
  `read VAR <<<"$(…assert…)"` pattern; a Feb-29 ValueError; a
  UTC-midnight race in the expected-age computation; a Dec-31 vacuous
  discrimination window) — all reworked: export-before-assert for BOTH
  encounters, expected age re-derived at assert time, Feb-29 clamp,
  discrimination logged.
- **Wire deltas (documented)**: the new route; POST /admissions response
  patient gains `ageSource` (+ `dateOfBirth` when present); the
  missing-identity 400 text is now "one of dateOfBirth or age is
  required" and the out-of-range text dropped the now-wrong "is required
  and" clause. Everything else byte-identical (44-check parity sweep,
  incl. the roster and every error surface).
- **Verification**: 24-check behavior matrix (RBAC all four profiles +
  401, the no-fork equality on seeds AND on a live DOB admission, the
  discharged-patient 200 byte-identical to pre-discharge, 404/400
  probes, the birthday-aware age proof — born 30 years ago TOMORROW
  serves 29, not the naive 30 — and all three re-admission identity
  rules); migration ROLLBACK tested empirically (Down materializes the
  computed age, then Up re-applies cleanly); 44-check byte-parity sweep
  vs main (zero unexpected diffs; three documented deltas asserted
  explicitly);
  live-upgrade migration simulation on a real Postgres 16 database (old
  binary seeds + replays writes incl. a discharged patient → new binary
  applies exactly AddPatientDateOfBirth; all 16 pre-existing AdtPatients
  rows byte-identical per column, DateOfBirth NULL everywhere, roster
  byte-identical across the upgrade, the pre-migration discharged row
  resolves with its recorded age + provenance, a post-upgrade DOB
  admission computes correctly; second boot 0 migrations/0 reseeds);
  10-check headless print proof (Discharge Summary for a GENUINELY
  discharged patient: no Patient Not Found, MRN/age/sex/allergies all
  printed and matching the chart record, no dashes, no snapshot notice,
  formulary byte-stability still holds through the new rung, absent id
  still the locked NotFound); `deployed-adt-e2e.yml` extended (no-fork
  equality live, identity-survives-discharge, DOB leg, validation 400s,
  absence probe; cleanup releases both run encounters).
- **LIVE FINDING (2026-07-11, hands-on — a gap the API suites are
  structurally blind to)**: after PR #51 merged, the DEPLOYED API served
  discharged patients' full identity (owner-verified: P-1047 → 200 with
  MRN, age 36, allergies "Sulfa") and deployed-adt-e2e ran green
  (29154429557) — yet the DEPLOYED Discharge Summary still rendered
  identity dashes with the snapshot notice. CAUSE — a STALE PAGES
  DEPLOYMENT, not a code defect: deploy-pages' deploy job was SKIPPED on
  the #51 branch push (single push, PR created seconds later — the
  documented push-time PR-gate trap; run 29154143554 concluded green
  with `deploy: skipped`), and pushes to main never trigger the workflow
  at all, so the live frontend was still PR #50's build (6e2482e). An
  API suite can never see this class: it does not render documents.
  RESOLUTION, all live-verified: the site was redeployed by dispatch
  (the deploy JOB confirmed run, not just a green run); deploy-pages now
  stamps `/build.txt` with the built commit — the `/healthz build`
  analogue for the FRONTEND; and the TWELFTH suite,
  `deployed-print-e2e.yml`, renders the LIVE Discharge Summary with
  headless Chrome for its own admitted-then-discharged DOB patient,
  behind TWO content-equality gates (server, and Pages freshness via
  build.txt — missing/stale fails loudly naming the dispatch-deploy
  operational step). FIRST GREEN RUN against the live site: 29155016123
  (pre-registration slot-borrow; patient P-1048/ENC-1052) — 8/8: no
  Patient Not Found, MRN rendered, age 40/F COMPUTED from DOB, allergies
  matching the chart, no dashes, no snapshot notice, locked NotFound for
  an absent id. Requirement 3 counts as live only from this run — a
  suite passing against the API is NOT evidence about the rendered page.
- **Display debt (recorded)**: the Print Center hub lists ROSTER
  patients only, so a discharged patient's documents are reachable only
  by deep link today — the hub needs a discharged-encounter picker
  (rides with the remaining templates).
  *[RESOLVED 2026-07-12 — the picker is built; see "Print Center hub —
  discharged-encounter picker (built)" below.]*

### Environment identity (built) — environment-separation §11 step 1
*[Attributed addition 2026-07-11 — the first IMPLEMENTATION PR of the
approved environment-separation design (merged as PR #53): the
freshness-gate mechanism extended by one field, on the current cloud
environment. No new infrastructure, no production build, no seed
changes.]*
- **`/healthz` carries `environment`** alongside `build`: read at runtime
  from `APP_ENV` (configuration, not code — `render.yaml` sets
  `staging`; a future production install sets `production` through the
  same variable, no code change; unset = `development`, a local dev
  process per the design's tuple). The deployed cloud tier is the
  STAGING environment per the merged design.
- **`/build.txt` (Pages) is now TWO lines**: commit, then environment —
  the value lives in `deploy-pages.yml` itself (versioned, inside the
  Pages gate's comparison set; no dashboard state), passed as an env var
  so the production build later carries a different value through the
  same mechanism.
- **All twelve deployed suites gain an ENVIRONMENT GATE** before the
  content gate, any login, and any write leg. Each suite declares
  `EXPECTED_ENV: staging` in-file (the design's per-suite target table —
  there is deliberately NO production entry to select). Semantics:
  `<unreachable>` (cold start) and `<absent>` (a mid-deploy older build)
  are retried on the same budget the content gate uses as its
  deploy-waiter; a PRESENT-but-different environment fails IMMEDIATELY
  and loudly — a wrong environment is not a warming-up condition. The
  print suite additionally asserts the frontend's environment from
  build.txt line 2 once content matches (a mismatch there is a
  deploy-pages misconfiguration, immediate failure), and still treats a
  legacy one-line stamp as a stale deploy to wait out.
- **Deliberately deferred from design step 1**: the JWT `aud`
  environment claim. The owner's build order for this PR scoped the
  environment-identity fields + suite gates only; `aud` issuance and
  validation ride a follow-up PR before step 2.
  *[Superseded 2026-07-11: BUILT — see "aud-claim environment rider
  (built)" below. The rider also supersedes this record's
  unset→"development" healthz default: /healthz now reports "unset"
  honestly, because authentication fails closed on a missing or unknown
  APP_ENV.]*
- **Verification (local, old main :8081 vs branch :8080, fresh identical
  SQLite seeds)**: 46-check byte-parity sweep — every endpoint
  byte-identical except `/healthz`, which is asserted to be exactly
  old + `environment: "staging"`; 11-check behavior matrix — APP_ENV
  set/unset values, gate PASSES on staging, gate fails on absent field
  only AFTER the full retry budget (deploy-waiter, timed), gate fails
  IMMEDIATELY (<2 s, no retry) against a mock healthz reporting
  `production`, the two-line stamp writes and parses, and a legacy
  one-line body parses as `<absent>` (stale path). All 14 workflow YAMLs
  machine-validated. No schema change → no migration simulation
  (metadata on a health endpoint + workflow asserts only).
- **Post-merge operational sequence (recorded)**: merging changes both
  the `server/` tree and the `render.yaml` blob → Render redeploys (and
  Blueprint-syncs the new `APP_ENV`); Pages needs one dispatch of
  deploy-pages (main pushes never trigger it) since `deploy-pages.yml`
  is inside the print suite's context hash. Then dispatch the twelve
  suites SEQUENTIALLY as usual — each must now show the ENVIRONMENT GATE
  step passing with `environment=staging` BEFORE its content gate.
- **LIVE-VERIFIED (2026-07-11, merge commit 1de8a30e)**: the sequence
  above was executed and all twelve suites ran GREEN against the live
  staging environment, each with its ENVIRONMENT GATE step succeeding
  (job- and step-level evidence, not run-level). deploy-pages dispatch
  29162527528 (deploy JOB ran — not skipped — stamping the two-line
  build.txt). Suite runs, in dispatch order: auth 29162771786, adt
  29162794155, users 29162815199, labs 29162833335, orders 29162853620,
  mar 29162873241, timeline 29162891787, ai 29162909300,
  encounter-scope 29162927618, formulary 29162944542, labcatalog
  29162966428, print 29162988331. The print run's log shows the full
  mechanism live: `attempt 1: healthz environment=staging ·
  expected=staging` (API half), `pages build=1de8a30e… ·
  environment=staging` (frontend half, two-line stamp parsed), then the
  8/8 render proof. Render Blueprint-synced `APP_ENV=staging`
  automatically on the merge deploy — no manual dashboard step was
  needed.

### aud-claim environment rider (built) — the deferred half of §11 step 1
*[Attributed addition 2026-07-11 — completes design step 1: the JWT
audience IS the environment, so a token minted in one environment is
structurally invalid in another EVEN IF the signing secret were somehow
shared — defense in depth on top of the per-environment `JWT_SECRET`.]*
- **Issuance stamps `aud` with the running `APP_ENV`** (AuthApi; the old
  fixed `aurora-icu-client` audience is gone). **Validation requires
  `aud == APP_ENV`** (Program.cs `ValidAudience`). Consequence, recorded:
  tokens minted before the rider fail validation once — a single forced
  re-login at the deploy that ships this.
- **No oracle**: `IncludeErrorDetails=false` — every invalid token gets
  the same bare `WWW-Authenticate: Bearer error="invalid_token"`; the
  401 must not reveal whether the audience or the signature failed
  (previously the header carried a descriptive reason — removed).
- **Fail-closed on missing/unknown `APP_ENV`** (shared resolver
  `Core/Shared/AppEnv.cs`, whitelist development|staging|production):
  login returns 503 ("authentication unavailable … fail-closed",
  config state — identical for every caller, not a credentials oracle);
  validation's audience becomes an unmatchable per-boot GUID so NO token
  validates; boot logs it loudly; `/healthz` reports the honest value
  ("unset" or the raw unknown string) instead of step 1's
  "development" default (superseded above). Local dev now sets
  `APP_ENV=development` explicitly. Step 2 escalates unknown `APP_ENV`
  to refuse-boot; the surface that matters — tokens — is closed already.
- **Suite coverage** (auth suite): the issued token's decoded `aud` must
  equal the suite's declared target (the same value the environment gate
  proved `/healthz` serves); a token whose ONLY difference is a swapped
  `aud` and a token with a corrupted signature are both rejected 401
  with IDENTICAL, description-free `WWW-Authenticate` headers; the
  same-environment token is proven by every authorized leg.
- **Verification (local)**: 16-check matrix with five instances sharing
  ONE deliberately identical `JWT_SECRET` — the crux: staging token
  works on staging (200) and is REJECTED on production (401), and vice
  versa, despite the shared secret; pre-rider (old-audience) token
  rejected by the new build; unset and unknown (`prod`) `APP_ENV`
  instances refuse to issue (503) and to validate (401 for a genuinely
  valid staging token); aud-mismatch / bad-signature / wrong-environment
  rejections carry identical headers with no `error_description` (old
  main's descriptive header captured for contrast). 45-check byte-parity
  sweep old main vs rider (fresh identical seeds): every endpoint
  byte-identical including `/healthz` — the only behavioral deltas are
  the token's `aud` value and the invalid-token 401 header, both
  intended. No schema change → no migration simulation.
- **LIVE-VERIFIED (2026-07-11, merge commit 611293aa)**: all twelve
  suites dispatched sequentially and GREEN against the deployed rider
  (auth 29163847159, adt 29163879241, users 29163899918, labs
  29163919440, orders 29163939023, mar 29163958588, timeline
  29163976791, ai 29163995982, encounter-scope 29164015570, formulary
  29164036734, labcatalog 29164056395, print 29164076069 — job-level
  evidence each). The auth run's log carries the rider live: the issued
  token's decoded `aud` equals `staging`, and both crafted invalid
  tokens rejected identically with the bare header — `T_AUD -> HTTP 401
  · www-authenticate: Bearer` / `T_SIG -> HTTP 401 · www-authenticate:
  Bearer` — no reason disclosed. Every suite's login+write legs are the
  same-environment positive path.
- **Operational rule (recorded per project owner)**: token-issuance
  changes force a re-authentication of every logged-in user (as this
  deploy did — pre-rider tokens fail validation). Once real users
  exist, schedule any change to token issuance for LOW-ACTIVITY
  windows; in the production model this belongs in the release/update
  planning of §11 steps 4–5.

### Seed modes + boot tripwires (built) — environment-separation §11 step 2
*[Attributed addition 2026-07-11 — the design principle applied at the
boot layer: a production environment REFUSES TO RUN in any state
acceptable in dev but dangerous in production. Not "configured not to"
— refuses to boot, loudly. Every guard fails closed; the refusal banner
(stderr, exit 1, process never binds) names the tripwire and the fix,
because a refusing production instance is a configuration error to
repair, never a silent degradation. Mechanics in
`server/Core/Persistence/BootGuards.cs` + the mode split in Seeder.]*
- **APP_ENV-moded seeding.** development/staging: the full demo set,
  byte-identical to before (proven below). production: NO demo
  patients, NO demo staff, NO shared password — boots with
  non-hospital-specific reference data (beds as starting configuration,
  frequency vocabulary, interaction rules, lab catalogue, order sets),
  the formulary per the **FORMULARY_SEED install policy** (required,
  explicit: `starter` seeds the reference formulary with EVERY drug
  DEACTIVATED + an audit event — the existing safety enforcement
  rejects inactive drugs, so unvalidated starter content is
  structurally unprescribable until Pharmacy validates by reactivating
  each drug through the Layer 4 screen; `empty` seeds none and Pharmacy
  builds/imports its own through the same screen — that is how real
  formulary content arrives instead of demo drugs), the reserved system
  principal, and **ONE bootstrap administrator** whose credential comes
  from `ADMIN_BOOTSTRAP_PASSWORD` at provision time — never hardcoded,
  refused if missing on a first boot, refused outright if it IS the
  demo password. Clinical tables start EMPTY. (The design's
  forced-change-on-first-login gate needs a self-service
  password-change surface that does not exist yet — recorded as riding
  the bootstrap-moment/install tooling of steps 4–5; until then the
  credential is operator-chosen, never in repo/image, rotatable via
  Layer 3.)
- **T1 — demo-credential tripwire.** On EVERY production boot — fresh
  seed, migrated database, or an account a human later touched — the
  demo password is bcrypt-verified against every ACTIVE account's hash;
  any match refuses to serve, naming the usernames. The scan verifies
  the compile-time constant against stored hashes in memory only —
  nothing plaintext is stored or logged. This makes the shared demo
  password STRUCTURALLY IMPOSSIBLE in production: a database carrying
  it cannot be booted, however it got there.
- **T2 — demo-config tripwire.** Production refuses to boot with:
  `DEMO_PASSWORD` set (the knob only exists to vary the shared demo
  seed password); no `DATABASE_URL` (the ephemeral SQLite fallback
  forgets on restart); no `JWT_SECRET` (the per-boot random key is a
  dev convenience and proves the secret was never provisioned);
  `CORS_ORIGINS` missing (the built-in default includes the Vite dev
  ports) or containing a localhost/loopback origin (a dev origin
  against production lets any local page in a clinician's browser call
  the system of record); `FORMULARY_SEED` missing or unknown (the
  install decision must be explicit, never guessed).
- **Unknown/missing `APP_ENV` refuses to BOOT, in every tier** — the
  boot/seed-layer escalation the aud-rider record forecast, now built.
  Consistent, not contradictory: the rider's fail-closed token layer
  (login 503 + unmatchable validation audience) stays in place beneath
  the boot gate as defense in depth. Local consequence: `dotnet run` /
  `docker run` now require `APP_ENV=development` explicitly.
- **Verification (local; no infrastructure spent — local PostgreSQL 16
  for the production boots)**: **36-check boot matrix** — 13 refusal
  cases each asserting exit 1 + the named banner (unknown/unset
  APP_ENV; every T2 item; first-boot missing/demo bootstrap credential;
  and the crux: a Postgres database seeded by a STAGING boot — demo
  accounts and all — REFUSES to boot as production, T1); dev/staging
  boots with demo config untouched; then the CLEAN production boot,
  proven to matter as much as the refusals: serves
  `environment=production`, T1 logs clean, bootstrap admin logs in with
  the provisioned credential (token `aud=production`), demo logins 401,
  roster/encounters EMPTY, 16 beds free, users = exactly admin + the
  inactive system principal, 19 starter drugs all deactivated with the
  validation event, reference data present — followed by the DAY-ONE
  FLOW: admin creates a doctor (individual credential, clinical-title
  justification per the Layer 3 safeguard), the doctor admits the first
  real patient into a seeded bed, ordering an UNVALIDATED starter drug
  is REJECTED, a pharmacist validates it by reactivation, the same
  order then succeeds; a second production boot without
  `ADMIN_BOOTSTRAP_PASSWORD` serves (idempotent) with data intact; and
  the `FORMULARY_SEED=empty` variant boots with no formulary but full
  reference data. **45-check byte-parity sweep** (old main vs branch,
  staging mode, fresh identical seeds): every endpoint byte-identical —
  the dev/staging path is untouched. No schema change → no migration
  simulation.
- **STAGING VERIFIED LIVE (2026-07-11, merge commit fd2d334e)**: the
  deployed staging service booted the tripwire code (its
  `APP_ENV=staging` config passes every production-scoped guard by
  construction) and all twelve suites ran GREEN sequentially against
  it — auth 29165027342, adt 29165067366, users 29165087557, labs
  29165127797, orders 29165146525, mar 29165166261, timeline
  29165186505, ai 29165206270, encounter-scope 29165226622, formulary
  29165245763, labcatalog 29165266601, print 29165286262 (job-level
  evidence each). Nothing in this PR runs in production until steps
  4–5 stand one up; the tripwires' own proof is the recorded 36-check
  local boot matrix.

### Production build & serving mode (built) — environment-separation §11 step 3
*[Attributed addition 2026-07-11 — the final environment-separation
build step before the release pipeline: the frontend gains a PRODUCTION
build/serving mode in which every guarantee is structural. All proofs
local; no infrastructure spent.]*
- **Same-origin serving with a relative API base.** When a compiled
  bundle is present in `wwwroot`, the API service serves it (static
  files + SPA fallback that deliberately EXCLUDES `/api` — an unknown
  API route stays an honest 404, never a 200 HTML page). The production
  bundle calls its API with a RELATIVE base: `VITE_APP_ENV=production`
  forces `API_BASE=''` and ignores any `VITE_API_BASE_URL` — **the
  artifact carries no hostname to point at a wrong environment**, the
  cross-origin seam does not exist (no CORS surface used), and
  frontend/API version skew is unrepresentable (they ship together).
  Dev/staging serving is unchanged: Pages → Render cross-origin,
  governed by the API's CORS allowlist; the staging Render image has no
  `wwwroot`, so the serving code is dormant there (proven by parity).
- **The mock/demo layer is compiled OUT of production bundles** — not
  disabled: ABSENT. Every mock fallback in the service layer
  (`src/lib/api/index.ts`, 54 sites) sits behind the statically-replaced
  `import.meta.env.VITE_APP_ENV !== 'production'`; dead branches and the
  mock-store modules they reference are eliminated. Three build findings
  fixed to make that TRUE rather than assumed: (1) live helpers that
  lived inside mock modules dragged demo data into the production graph
  — extracted to real modules (`api/logic.ts`: AI threshold/trend
  helpers + IO vocabulary; `api/bedboard.ts`: the real bed-board join);
  (2) `toSummary`'s alertCount enriched from MOCK ai/results stores even
  on the real path — production now derives it from the real wire field
  alone (crit/high bed alert); (3) the mock stores' top-level demo-data
  construction counted as module side effects that defeated
  tree-shaking — annotated `/* @__PURE__ */` (comments only). A
  production data call that cannot be served REFUSES loudly:
  `apiUnavailable()` rejects and paints a full-screen overlay — never
  demo data, because none exists in the artifact. Honest consequence:
  the still-mock-only Stage 11 domains (unit summary, bedside panels,
  mission-control composite, nursing tasks/I&O, consults, notes, the
  timeline's four mock feeds) refuse in production until they become
  real; the production timeline serves the server-derived categories
  alone. The Stage 9 local-session fallback, the demo staff directory,
  the demo-credentials disclaimer, and the `SAMPLE_STAFF` presets are
  compiled out of production the same way; the bed board's physicians
  strip derives from real attendings in production (demo list retained
  in dev/staging for parity).
- **Runtime environment cross-check with FULL-SCREEN refusal**
  (`EnvironmentGate`): the bundle compiles in its expected environment;
  on load it fetches the wired API's `/healthz` and compares the
  step-1 `environment` field. A response naming a DIFFERENT environment
  replaces the entire app with a refusal naming both values and the
  serving origin — no login form, no navigation. An unreachable healthz
  is NOT a verdict (cold start/offline ≠ wrong environment), and a
  pure-mock dev session (no API) skips the check.
- **Staging/dev banner** (`EnvironmentBanner`): a persistent amber
  striped strip — "STAGING ENVIRONMENT — not the system of record;
  everything here is test data" (or DEVELOPMENT) — driven by the same
  compiled-in identity. Production renders nothing AND the banner is
  absent from the production artifact (same DCE mechanism; hidden in
  print CSS — document marking is Print Center scope).
- **§6.4 executed**: `vars.API_BASE_URL` (dashboard state) is retired —
  the staging API URL now lives in `deploy-pages.yml` itself alongside
  `VITE_APP_ENV: staging`, inside the print suite's Pages-gate
  comparison set. No dashboard-resident routing config remains.
- **Verification (all local)**: **9-check bundle-inspection proof** —
  eight mock-only marker strings (demo patients, demo staff, the demo
  password, the banner text, the local-session log line, mock order
  ids, mock AI narratives) present in the staging bundle and ABSENT
  from production, plus a SOURCEMAP module inventory asserting NO
  `src/lib/api/data/` module exists in the production graph (bundle:
  467 kB staging vs 386 kB production). **18-check headless runtime
  proof**: production served same-origin (login → real ADT data from
  the step-2 production Postgres, every network request same-origin,
  no banner, no demo content, SPA deep link works, `/api/nonexistent`
  404), the artifact grep'd free of hostnames, the DELIBERATE MISMATCH
  (production bundle served by a staging API) painting the full-screen
  refusal naming both environments with the app unusable behind it,
  and the staging bundle showing the banner with demo login/roster
  unchanged. **45-check server byte-parity** (old main vs branch,
  staging, no wwwroot) + dormant-serving parity (`/`,
  `/api/nonexistent`, `/beds` identical 404s). `tsc` clean; no schema
  change → no migration simulation.
- **STAGING VERIFIED LIVE (2026-07-11, merge commit 9eb4d53f)**:
  deploy-pages dispatch 29166358985 (deploy job RAN) shipped the new
  staging bundle — banner, cross-check, and the in-file API URL — and
  all twelve suites ran GREEN sequentially against the deployed pair:
  auth 29166387094, adt 29166412514, users 29166435052, labs
  29166453461, orders 29166474397, mar 29166492899, timeline
  29166512907, ai 29166531545, encounter-scope 29166551588, formulary
  29166570931, labcatalog 29166589657, print 29166609180 (job-level
  evidence each). The print run renders a live document FROM the new
  bundle — the environment chrome coexists with the locked print
  output, and the retired `API_BASE_URL` repo variable is proven
  unnecessary (the deployed site now builds its API target from
  deploy-pages.yml alone). The live staging site now displays the
  STAGING banner to every user — the intended, visible outcome.

### Release + backup mechanisms (built) — environment-separation §11 step 4, PARTIAL
*[Attributed addition 2026-07-11 — step 4 is deliberately PARTIAL per
the project owner: the TARGET-INDEPENDENT pieces are built here; the
OS-specific install tooling (`aurora-update`/`aurora-verify` against a
concrete server) and the VM install/rollback/restore rehearsal are
DEFERRED until the production server's shape is known (OS, backend
on-prem vs reaching in, network path to the database). Nothing here
assumes a target OS, deploys anywhere, or spends anything.]*
- **The `production` branch + promotion gate**
  (`.github/workflows/release-production.yml` +
  `scripts/promotion-gate.sh`). A BRANCH, not a tag scheme, drives
  production: a branch has a single mutable HEAD meaning "what
  production should run" and rollback is pointing it back; tags are the
  immutable RELEASE LABELS the workflow cuts (`release/r<N>`). **What a
  human does to promote**: `git fetch origin main && git push origin
  <validated-main-commit>:production` (the first push creates the
  branch — which is why this PR does NOT create it; the first promotion
  is the owner's deliberate act). The gate blocks the release unless:
  the commit is an ANCESTOR of main; staging's `/healthz` says
  `environment=staging`; the commit's server tree + render.yaml equal
  the deployed staging build's; the staging Pages `build.txt` carries
  the same frontend context; and EVERY one of the twelve suites' most
  recent completed run concluded success ON CONTENT EQUAL to the
  promoted commit's (a green run against different bytes is not
  evidence). No retries — a promotion is not a warm-up condition.
- **The release bundle: manifest + checksums**
  (`scripts/make-release-bundle.sh` / `verify-release-bundle.sh`).
  Manifest: `aurora-release-manifest/1` JSON — version (`r<run>`),
  commit, environment, component identities (server tree, frontend
  context hash, render.yaml blob — the SAME identities every gate
  compares), and per-artifact sha256 + byte size; plus a flat
  `SHA256SUMS`. Verification requires the bytes, the manifest, and
  SHA256SUMS to all agree (a tampered artifact OR a tampered manifest
  both fail), sizes to match, and optionally the commit to equal an
  expected value — any failure is a loud "treat this bundle as
  NONEXISTENT". The release job builds the §11-step-3 production app
  image (server + same-origin frontend) as the bundle's artifact and
  publishes a GitHub Release; the tooling itself is artifact-agnostic
  and was proven locally with real frontend/server artifacts (no docker
  in the sandbox — the image build is exercised by the first real
  promotion). Signing is future scope; checksums + GitHub Release
  provenance now.
- **THE CENTERPIECE — backup WITH restore-verification**
  (`scripts/aurora-backup.sh`). The rule it enforces: a backup that has
  not been PROVEN restorable does not count as a backup. Every `backup`
  run: `pg_dump -Fc` + sha256 sidecar, then RESTORES the dump into a
  fresh scratch database and verifies — V1 checksum, V2 restorability
  (pg_restore, exit-on-error), V3 every archived table exists in the
  restore, V4 restored per-table counts recorded as the dump's metadata
  and NOT LOWER than the previous verified backup's (the never-delete
  rules make counts monotonic — shrinkage is a data-loss tripwire;
  `RV_ALLOW_SHRINK=1` is the documented escape for a knowingly reset
  source), V5 (quiesced sources / the proof harness) STRICT per-table
  content equality vs the source via deterministic row-digest
  aggregation. Outcome lands in `BACKUP_DIR/LAST_VERIFICATION` (JSON,
  VERIFIED/FAILED) — any failure exits non-zero with "treat this backup
  as NONEXISTENT". `reverify <dump>` re-proves an existing backup.
  **Cadence (wired at install time — deferred tooling)**: `backup`
  daily; `reverify` the newest dump before any software update, with
  the updater hard-stopping on failure. Retention keeps the newest
  `RETAIN` (default 14) verified triplets.
- **Verification (all local, nothing spent)**: promotion gate DRY-RUN —
  6 scenarios against mock staging endpoints + the REAL GitHub API: the
  aligned case PASSES (16 individual checks: ancestry, identity,
  server/frontend content, 12 suites green-on-content) and five
  doctored states BLOCK loudly (non-ancestor commit; staging serving
  older server content; staging reporting the wrong environment; suites
  green on other content; stale Pages frontend). Bundle — produced from
  real locally-built artifacts and verified 5/5: intact PASSES,
  corrupted artifact FAILS, tampered manifest FAILS, wrong expected
  commit FAILS. Backup — against a real local Postgres populated by the
  actual server (migrate + seeds + a real admission), quiesced:
  backup→restore→compare PASSED with STRICT equality on all 15 tables
  (247 rows); a second run proved V4 non-regression; five failure paths
  demonstrated LOUD (corrupted dump → V1; truncated-but-checksummed
  dump → V2, proving a checksum alone is not restore-proof; planted
  count regression → V4 naming the shrunken table; the documented
  shrink escape; retention pruning). One empirical catch fixed during
  proofing: the scratch database name contained uppercase — unquoted
  `CREATE DATABASE` folds the identifier while the connection URL does
  not, so creation and restore targeted different names; now lowercased
  with the reason recorded in the script.
- **Byte-parity by construction**: this PR adds `scripts/` + one new
  workflow + this record — it touches NO runtime file (server/, src/,
  render.yaml, existing workflows all untouched; the diff is the
  proof). Staging behavior is unchanged.
- **Deferred (the rest of step 4, pending server facts)**: OS-specific
  `aurora-update`/`aurora-verify` against a concrete target, the
  backup sidecar/cron WIRING on the production host, and the full VM
  install/update/rollback/restore rehearsal.

### Mission Control fresh-patient fix (built) — detail page resolves REAL admissions
*[Attributed addition 2026-07-12 — owner-reported bug from local
testing: a freshly-admitted patient rendered on the bed board but their
detail page (`/patients/:id`) said "Patient Not Found", even though
`GET /api/icu/adt/patients/:id` and the roster both returned the record
(server confirmed correct).]*
- **Root cause (frontend)**: `getPatientDetail` resolved the patient
  ONLY from the MOCK store (`allPatients()`), which by definition never
  contains a real admission — the recorded Mission-Control drift biting
  for the first time on a real write. The route, the bed-board link, and
  the backend were all correct.
- **Fix**: identity now resolves from the REAL roster wire record first
  (`fetchRosterRecords` → new `rosterToPatient` projection — the same
  record the bed board renders, so any ADMITTED patient, seeded or
  fresh, resolves identically), with the mock store as the offline/
  pure-mock fallback. The composite's per-patient derived views (AI
  risks, lab trends, timeline card) legitimately resolve EMPTY for a
  fresh admission — "no data", never "no patient". The bedside PANELS
  remain Stage 11 mock scope; production's refusal arm is unchanged.
- **Verification**: faithful 8/8 headless repro in dev SQLite mode —
  doctor login → admit via the Admissions UI → patient on the bed
  board → CLICK → detail renders with name and the DOB-computed age
  (2007 → 19); seeded P-1001 regression intact; absent id still the
  locked NotFound. The step-3 production bundle proof re-ran 9/9
  (the new mock-referencing helper is confirmed eliminated from
  production bundles; sourcemap inventory still shows ZERO mock
  modules). `tsc` clean.

### Print Center Contract v1.0 + the buildable batch (built) — 8 new templates
*[Attributed addition 2026-07-12 — the template list is now a VERSIONED
CONTRACT in the repository: `docs/print-center-contract.md`, confirmed
by the project's clinical validator (the ICU physician) and recorded
verbatim from the owner's instruction. It can never again live only in
conversation.]*
- **Reconciliation (stated before building)**: contract #10 (Discharge
  Summary) and #2 (ICU Daily Progress Sheet) were already implemented by
  Phase 1 (`discharge-summary`; `daily-progress`). Phase 1's ICU
  Admission Note is NOT in the contract's enumeration — retained as an
  implemented additional document, flagged in the contract for the
  validator's next review. Genuinely remaining and BUILT HERE (8):
  #1 `face-sheet`, #3 `active-orders`, #4 `medication-orders`,
  #5 `lab-report`, #6 `imaging-report`, #7 `sbar`, #8 `consult-report`,
  #9 `transfer-summary`. NOT built (3, per contract): the MAR, the
  Vital Signs/Observation Flowsheet, and the Ventilator & Device Report
  — Stage 11 Observation-model scope.
- **Pattern held exactly**: one selector + one component + one registry
  entry per document; read-only rendering from persisted records through
  the SAME `resolveContext` identity ladder (roster record → Core
  patient-identity read → labeled encounter snapshot — the PR #63-era
  canonical path, no fork, no mock store); the live formulary is never
  consulted (zero master-data imports — the byte-stability guarantee);
  shared A4 `PrintLayout` + primitives; missing data prints as a dash;
  charted times carry the † footnote; unsigned orders/prescriptions
  print under their own "awaiting signature — NOT in force" heading,
  never mixed into active lists.
- **Honest-source rule applied** (recorded in the contract): the
  canonical nursing-notes and consultation stores do not exist yet
  (the Timeline's still-mock feeds) — `sbar` and `consult-report`
  render real identity/encounter/medication context plus whatever the
  aggregated feed carries, with ruled write-ins; in production those
  sections legitimately render "none recorded", never fabrication. The
  Face Sheet's next-of-kin/payer fields are write-ins labeled "not
  recorded by the system".
- **Verification**: 28-check headless proof against a dev SQLite server
  + built-bundle preview (real API, real auth, playwright): (A) all 8
  new templates render for the seeded admitted P-1001 with per-document
  content asserts (identity + encounter + write-in headings; order rows;
  prescription detail; analytes + acknowledgment state; imaging
  status/impression; S/B/A/R structure; consult chronology;
  transfer-summary reason/condition write-ins). (B) a FRESH patient
  admitted through the real ADT write path with a signed Vancomycin
  prescription + a signed nursing order — face-sheet shows the real
  admitted event and the DOB-computed age, active-orders shows BOTH
  categories, medication-orders shows the full prescription detail.
  (C) BYTE-STABILITY: deactivating Vancomycin in the live formulary
  (pharmacist authority) and re-rendering medication-orders produced
  normalized-identical output (then reactivated — store left as found).
  (D) after a real discharge, the face-sheet renders via the identity
  read (MRN present, Discharged row, NO snapshot notice) and the
  lab-report renders the honest empty state. (E) print CSS proven on a
  45-order Active Orders Sheet: the page.pdf A4 render spans 2 pages
  (`pdfinfo`), and `pdftotext -f 2` shows the table HEADER REPEATED on
  page 2 above continued rows (assert is case-insensitive — print CSS
  uppercases `th`, the recorded Phase-1 lesson). (F) an absent id
  renders the locked NotFound. One initial failure was that
  case-sensitivity artifact, corrected and re-asserted against the
  produced PDF — 28/28 effective. The step-3 production bundle proof
  re-ran clean after the frontend change (marker strings + sourcemap
  module inventory: zero mock modules in the production bundle);
  `tsc -b` and `vite build` clean.
### Print Center hub — discharged-encounter picker (built) — the display debt resolved

*[Attributed addition 2026-07-12 — resolves the display debt recorded in
the patient-identity-read record above.]*

- **The sourcing question, answered before building (per instruction)**:
  a real read for discharged patients / closed encounters EXISTS —
  `GET /api/icu/adt/encounters?status=discharged`, the Layer 2 ADT
  encounter list ("open census, discharge history, per-patient lookup"),
  already consumed by the live /discharges screen through the real
  `getEncounters` adapter. No gap to flag; NO new or parallel data
  source was created — the picker is populated from that read alone.
- **The build (frontend-only, hub column 1)**: the roster group renders
  UNCHANGED; below it, a clearly-labeled "Discharged — not on the
  active roster" group lists one row per discharged patient (distinct
  patients grouped from their closed encounters), each with a neutral
  "Discharged" tag (the fixed severity palette is never reassigned),
  patientId, last discharged time, and closed-encounter count, sorted
  most-recent-first (by encounterId — the ADT `HH:mm` charted times are
  not date-sortable). A patient currently on the roster never appears
  in the discharged group (a readmitted patient is found under the
  roster; step 2 already lists their past encounters), and the group is
  gated on the roster read having loaded so an admitted patient is
  never momentarily presented as discharged. Selection flows into the
  EXISTING patient → encounter → document steps: step 2 already listed
  closed encounters and step 3 already blocked open-scope templates —
  closed-encounter rows now also show the discharged time. Search
  filters both groups; a no-match query hides the discharged group
  entirely. In pure-mock dev the discharged read honestly returns
  empty (recorded adapter behavior — historical encounters exist only
  server-side), so the group is simply absent. Document identity is
  untouched — rendering still resolves through the canonical resolver
  path (selectors unchanged).
- **Stale hub copy corrected in passing** (UI copy, not a record): the
  hub note claimed "Ten further templates arrive in later phases" —
  superseded by the Contract v1.0 batch; it now points at the contract
  with three documents awaiting Stage 11.
- **Verification (18/18 headless, dev SQLite server + built preview,
  real API + real auth)**: a GENUINELY discharged patient (real admit →
  signed order → discharge) appears in the discharged group, visually
  distinguished, absent from the roster group; selecting them shows the
  closed encounter default-selected with its discharged time and the
  open-scope templates honestly blocked; opening the Discharge Summary
  renders with FULL identity via the identity read (name, MRN, age
  computed from DOB — no dashes, no Patient Not Found) including the
  signed medication. Byte-parity on the admitted flow: seeded P-1001
  still lists in the roster group with bed+MRN meta, its OPEN encounter
  default-selects with no discharged suffix, and its document still
  renders. Search behaves honestly in both groups. Two proof-side
  corrections during the run (neither a UI defect): a wrong bed-id
  regex in an assert, and duplicate same-name rows from a PRIOR run's
  patient persisting in the durable dev DB — correct behavior (distinct
  patientIds rendered, newer first, confirming the recency sort);
  locators scoped by patientId. The step-3 production bundle proof
  re-ran 9/9 after the frontend change; `tsc -b` and `vite build`
  clean.

### Stage 11 — the Observation Model DESIGN recorded; PR #67 superseded

*[Attributed addition 2026-07-12 — records the design hand-off, the
pre-build verification, and the state of the fragment build.]*

- **The design is the spec**: `docs/design/stage11-observation-model.md`
  — the validator's complete Observation Model design (clinical source:
  the ICU physician), recorded verbatim per the versioned-artifact rule,
  WITH the three RBAC decisions baked in: **F1** `observations.record`
  on the Doctor + Nurse profiles (no junior/senior split); **F2**
  `observations.correct` (tier-2 retrospective correction) is
  Consultant-tier / senior-clinical — NEVER the office Administrator
  profile; **F3** v1 ships the Type Catalogue seeded read-only with only
  group enable/disable live, held by the same Consultant-tier authority.
  Hard constraint: no observation-touching permission on the office
  Administrator profile.
- **PR #67 (the fragment build) is SUPERSEDED — DO NOT MERGE** (title
  and body marked). Built from a one-sentence fragment before the design
  existed: a closed server-side vocabulary where the design requires the
  data-driven Type Catalogue + generic `(typeCode → value)` record
  (a different database design), ~2 of the 8 clinical categories, and
  corrections without the two-tier model or a recorded corrector actor.
  Its correct engineering is salvaged into the rework per §9:
  source-agnostic fields, server-owned provenance (claimed provenance →
  400, set and entry level), closed-encounter 409 / correct-after-
  discharge 200, atomic all-or-nothing sets, the byte-parity +
  production-bundle-absence proof harnesses, panels.ts untouched.
- **Pre-build verification (the design was written without repo
  access; assumptions checked against the code, per the owner's
  instruction)**: §9's reading of #67 CONFIRMED accurate in full. §5's
  bedside-tile assumption corrected — there are TWO fake sources, not
  one: the server-side roster bedside-snapshot table
  (`MonitorVitalsJson` — vitals/NIBP monitor tiles; honest zeros +
  "baseline observations pending" for fresh real patients) AND the
  frontend `panels.ts` (ventilator/hemodynamics/infusions/alerts/goals,
  identical for every patient). The §12 step-4 read-swap replaces BOTH
  (recorded as a build-time note inside the design artifact). Context:
  in production TODAY neither fake source can reach a screen (panels.ts
  is compiled out; the MC detail read's production arm refuses) — the
  read-swap makes Mission Control WORK in production.
- **FLAGGED — F4, the Consultant-tier mechanism (awaiting the owner
  before §12 step 1 wires permissions)**: the locked three-layer RBAC
  model computes permissions from the PROFILE, and all five doctor
  titles map to ONE Doctor profile — "Consultant-tier" is currently
  inexpressible without either a new profile row (map the Consultant
  title to a SeniorDoctor profile = Doctor's superset +
  observations.correct + the enablement permission) or a title-level
  check inside the permission lookup (which would violate the locked
  "roles are NEVER bound to permissions directly" rule). Also
  unspecified: whether "Consultant-tier" is the Consultant title alone
  or Consultant + Specialist. Recorded; not silently decided.
- **Build sequencing ahead (design §12, each its own draft PR)**:
  1 Model + Catalogue + config → 2 Observation Service + Manual
  endpoint → 3 /observations screen (timed round + ad-hoc) → 4 the
  two-source bedside read-swap → then the 3 deferred print templates,
  and later the Device Adapter.

### Stage 11 §12 step 1 (built) — the generic model, the Type Catalogue, group enablement

*[Attributed addition 2026-07-12 — the first rework PR per the recorded
design (`docs/design/stage11-observation-model.md`), F4 answered by the
owner: mechanism 1, Consultant alone for v1.]*

- **The generic Observation record (Pillar 2)**: `server/Core/
  Observations/` + migration `AddObservationModel` — one row stores
  `(typeCode → value)` against the catalogue: observationId, patientId,
  server-derived encounterId, typeCode, value (numeric/enum as text,
  compound as a JSON object), catalogue-derived unit, clinicalTime,
  source (manual|device|hybrid), deviceId?, recordedBy, enteredAt,
  verifiedBy? (device era, §2), and `amendments[]` ({previousValue,
  newValue, amendedBy, amendedAt, reason, amenderRole} — the §8
  supersede-don't-erase audit WITH the actor, fixing the gap #67
  flagged). NOT a column-per-vital table; expanding the vocabulary is
  data, never schema. No write endpoints yet (step 2) — the table is
  the foundation.
- **The Observation Type Catalogue, seeded from §1 — all 8 groups, 51
  types as DATA**: vitals (8, incl. Cardiac Rhythm enum), neuro (GCS
  compound eye/verbal/motor + derived total, RASS −5..+4, pain NRS,
  pupils compound size+reaction per side), ventilator (12 —
  set-vs-measured kept separate: rr_set/rr_measured, vt_set/vt_exhaled;
  Driving Pressure DERIVED from [pplat, peep]), hemodynamics (8, the
  if-applicable ones marked optional), fluid balance (10 — totals and
  net balance DERIVED, never charted), POC lab (glucose + lactate ONLY —
  the LIS boundary), devices (pump_rate; group ships DISABLED — its
  entries are device-displayed/future; ECMO/CRRT/ICP arrive as
  catalogue data with the device era), nursing assessment (5 enum/
  numeric scales). Derived types are catalogue-flagged with their
  derivation inputs and are rejected by the charting path (step 2).
  Seeded in ALL environments (non-hospital-specific clinical reference,
  the lab-catalogue precedent), idempotent. v1 catalogue is READ-ONLY
  (F3) — no management endpoints exist. FLAGGED for the validator: the
  numeric plausibility ranges and enum member lists (rhythms, pupil
  reactions, vent modes, I:E ratios, nursing scales) are build-authored
  from standard practice — the design names the types, not these lists;
  they are catalogue data, amendable without schema change.
- **Group enablement (F3)**: GET /api/icu/observations/catalog (any
  authenticated profile; disabled groups included with honest flags) +
  POST /api/icu/observations/groups/{code}/enable|/disable — the new
  `observations.configure` permission; unknown group 404, replay 409,
  toggles stamped (token actor) with an append-only event history.
- **The SeniorDoctor profile (F4, mechanism 1)**: the Consultant title
  now derives `SeniorDoctor` — Doctor's strict SUPERSET plus
  `observations.correct` + `observations.configure`; `observations.
  record` sits on Doctor + Nurse (+ the superset) per F1. The
  three-layer model is unchanged (permissions still computed from the
  profile; no title-level binding). Every profile-comparison site was
  audited and updated: the Users-domain clinical-grant justification
  (server + UI derivation chain) treats SeniorDoctor as clinical, and
  the AI screen's view-only banner exempts it. The HARD CONSTRAINT
  holds: the office Administrator profile carries NO observation
  permission.
- **The thirteenth suite** (`deployed-observations-e2e.yml`, step-1
  scope, STATE-AWARE: reads the devices group's current state, toggles
  opposite, restores — if:always() restore; extended by later steps) and
  the promotion gate now requires all thirteen.
- **Verification**: 17/17 step-1 matrix (catalog 401/shape asserts on
  the full taxonomy incl. derived flags, compound components, POC
  boundary, optional markers; enablement RBAC in all six directions —
  nurse/Specialist/Intern/Hospital-Administrator/Receptionist 403 (the
  hard-constraint probes) and unauth 401; consultant toggle 200 with
  token actor + append-only history, replay 409, unknown 404; the
  SeniorDoctor superset non-regression incl. the users-domain
  justification rule; POST /api/icu/observations still 404 — step 2
  scope). 5/5 frontend smoke (Consultant lands /workspace with the
  SeniorDoctor profile shown, NO view-only regression on the AI screen,
  Specialist unchanged, Users Admin derivation chain marks SeniorDoctor
  clinical). 17/17 byte-parity sweep old-main vs branch (fresh-seeded
  twins; the only delta the new /observations routes). Production
  bundle proof 9/9; server build, `tsc -b`, `vite build` clean.
  Deployed suite runs post-merge (sequential).
  *[Superseded in part 2026-07-12 — the post-merge run: deploy-pages +
  the first twelve suites all green on the merge commit; the NEW
  observations suite FAILED its first live run on a HARNESS bug (curl
  piped into `python3 -` with a heredoc — the heredoc becomes python's
  script and stdin is empty; the local matrix used the file-based
  pattern, so this exact step had never executed). The server behaved
  correctly throughout, and the if:always() restore proved itself on
  its first failure — the devices group was put back to disabled.
  Fixed (response → file, then parse) in the follow-up suite-only PR;
  the re-run's result is recorded there. Lesson consistent with the
  CI-evidence rule: a suite leg only counts as validated once the
  EXACT step text has executed somewhere.]*
- **Remaining (§12)**: step 2 the Observation Service write paths
  (manual charting — timed round + ad-hoc, §7 time semantics with
  server-stamped clinicalTime, the two-tier §8 corrections), step 3 the
  /observations screen, step 4 the TWO-SOURCE bedside read-swap, then
  the 3 deferred print templates and (later) the Device Adapter.

### Stage 11 §12 step 2 (built) — the Observation Service write paths

*[Attributed addition 2026-07-12 — the second rework PR per the design;
the owner answered §11 Q1: NO reason required on tier-1
self-corrections (the amendment still always records actor, original
value, new value, timestamp); tier-2 unchanged (reason required).]*

- **Charting** (`POST /api/icu/observations`, `observations.record` —
  any doctor or nurse per F1): a timed ROUND is one request whose
  entries share ONE server-stamped `clinicalTime`; an ad-hoc entry is
  the same request with one entry (§10). **§7 time semantics are
  structural: clinicalTime and enteredAt are SERVER-stamped — the
  request has no time field, and a payload claiming
  clinicalTime/enteredAt (or source/deviceId/verifiedBy/recordedBy/
  unit/encounterId) fails binding → 400. No back-dating by
  construction.** enteredAt carries seconds (the tier-1 window needs
  them); clinicalTime keeps the charted-time convention.
- **Catalogue-driven validation (Pillar 2, data not code)**: unknown
  typeCode → 400 naming the catalogue; **DERIVED types are rejected**
  ("computed from its inputs at read time, never charted"); numeric
  plausibility ranges; enum allowed-sets; **compound values validated
  component-by-component** (GCS eye/verbal/motor ranges; missing/extra
  component → precise 400) and stored normalized; duplicate-in-round →
  400; **a type whose GROUP is disabled → 409** (deployment state — the
  inactive-drug precedent: enable the group and the same request
  succeeds). ROUND ATOMICITY: every entry validated before anything is
  written — a mixed valid+invalid round writes NOTHING.
- **The §8 two-tier correction** (`POST .../{id}/correct`): TIER 1 —
  the recorder amending their OWN entry within the flat 5-minute
  window from ENTRY time: needs only `observations.record`, **no
  reason (Q1)**; TIER 2 — anyone else's entry or after the window:
  needs `observations.correct` (Consultant-tier), reason REQUIRED
  (precise 400 naming the tier rule). BOTH tiers amend-not-erase: the
  stored value is NEVER rewritten; amendments append {previousValue,
  newValue, amendedBy, amendedAt, reason, amenderRole} — the actor is
  ALWAYS on the record (the gap #67 flagged, closed). Re-correction
  layers (append-only; previous = the last effective value);
  correcting to the current effective value → 409 ("nothing to
  correct"); corrected values re-validated against the catalogue.
  Corrections are completing the record → allowed on a CLOSED
  encounter (no EncounterGuard); charting on a closed episode stays
  409. RBAC ordering keeps 403 oracle-free: the weakest gate
  (`observations.record`, held by every possible corrector) answers
  before the lookup; the tier gate answers after.
- **Reads**: GET /api/icu/observations?patientId&typeCode&encounterId —
  oldest first (clinicalTime, id — collation-pinned), unknown param /
  missing patientId → 400.
- **The suite extended to steps 1+2** (three new steps, all file-based
  parsing — the PR #70 lesson applied): charting RBAC, the round +
  ad-hoc, no-back-dating probes, catalogue validation incl. derived
  rejection + compound components, round atomicity, a STATE-AWARE
  disabled-group probe (409 when disabled / honest 200 path when an
  operator enabled it — never a silent skip), both correction tiers
  with roles asserted, same-value 409, absent 404, and the §6 rule
  live; cleanup restores config AND releases the encounter. **The
  5-minute WINDOW-EXPIRY path is deliberately not live-tested** (clock
  manipulation) — covered by the local matrix via direct SQLite aging
  of EnteredAt (local-only), recorded here per the CI-evidence rule.
- **Verification**: 59/59 step-2 matrix (all of the above incl. the
  window expiry: the recorder 403 on their own aged entry, the
  consultant then correcting it with reason, the second amendment
  layering on the first; two proof-side fixes during the run — a
  unicode-escaped en-dash in one grep and the absent sqlite3 CLI
  (replaced with python stdlib) — neither a server defect). 18/18
  byte-parity sweep vs main (now incl. the step-1 catalog read; the
  only delta the new chart read/write/correct routes). Server build
  clean; no frontend change in this step (adapters + screen are
  step 3), so no bundle re-proof was needed.
- **Remaining (§12)**: step 3 the /observations screen, step 4 the
  two-source bedside read-swap, then the 3 deferred print templates
  and (later) the Device Adapter.
- *[Attributed addition 2026-07-12, post-merge]* **The full
  thirteen-suite sequential pass ran GREEN on the step-2 merge commit
  `c6d7b61` (13/13)** — adt, ai, auth, encounter-scope, formulary,
  labcatalog, labs, mar, orders, print, timeline, users, observations.
  The observations run (29212356852) was the extended steps-1+2 suite's
  FIRST live execution: job-level evidence confirms every substantive
  step ran `completed/success` (logins, catalog taxonomy, enablement
  RBAC incl. the hard-constraint probes, the consultant toggle+restore,
  the step-2 round/no-back-dating/validation/atomicity legs, both §8
  tiers, the §6 closed-encounter rule, and the always-runs cleanup) —
  no skipped legs (a skipped check and a passed check are visually
  identical; this pass was verified at step level).

### Stage 11 §12 step 3 (built) — the /observations entry+chart screen

*[Attributed addition 2026-07-12 — the third rework PR per the design's
§12 sequencing ("3. /observations screen: grouped entry: timed round +
ad-hoc; chart read view; read-only without permission; RBAC per §4").]*

- **Route + nav**: `/observations(/:patientId)` behind `patients.view`
  (every clinical viewer reads — §4's read rule); a new "Observations"
  nav item (same permission). Screen structure mirrors the other
  patient-scoped screens (header KPIs, rail, PatientBar); patient
  identity comes from the REAL roster read (`getRosterRecord`), not the
  mock-composite detail.
- **The entry form is data, not code (Pillar 2)**: groups and fields
  render FROM `GET /observations/catalog` — enabled groups as tabs,
  numeric types with unit + plausibility placeholder, enum types as
  selects, compound types (GCS, pupils) as component sub-inputs, and
  DERIVED types shown as un-enterable "computed at read time" rows.
  There is NO observation vocabulary in the frontend: enabling a group
  or (v2) adding a catalogue type appears here with zero code change.
  Disabled groups are named in a muted note and not offered (charting
  UIs filter on enabled; the server's 409 stays the authority).
- **Both §10 entry modes, one mechanism**: values staged across group
  tabs accumulate into ONE submission — many staged values chart as a
  timed ROUND sharing the server-stamped clinicalTime, a single value
  is an AD-HOC entry (the button renames itself). No time input exists
  anywhere (§7 — no back-dating by construction). A partially-filled
  compound blocks submission with a precise client message; every other
  validation verdict is the SERVER's, surfaced verbatim (unknown type,
  range, disabled group 409, closed encounter 409). Writes are
  REAL-ONLY (never applied to mock state) and the whole domain has no
  mock store: an unreachable API renders an explicit unavailable state,
  never simulated observations (honest data, §5).
- **The chart read view**: newest timepoint first; each round shows the
  server-stamped time, recorder, and source badge (manual today;
  device/hybrid styles exist for the later adapter). Amended entries
  show the EFFECTIVE value plus an "amended ×n" tag with the full §8
  history — the original struck-through-but-present, each layer's
  newValue/amendedBy/amenderRole/amendedAt, and the reason when one
  exists (tier-1 layers legitimately have none, per Q1).
- **Derived values computed at RENDER, never stored**: GCS Total from
  the compound's components; Driving Pressure = Pplat − PEEP at the
  same timepoint; fluid totals sum EVERY per-interval entry of the
  catalogue-listed input types at the timepoint (a repeated Urine
  Output sums, it does not replace — caught hands-on during
  verification and fixed); Net Balance derives from the derived totals.
  The INPUT lists come from the catalogue rows (`derivationInputs`);
  the arithmetic itself is a small per-type render map — a derived type
  with no renderer shows nothing rather than a guessed number.
- **The two-tier correction UI (§8, server-decided)**: on an own entry
  inside the 5-minute window the row offers "Amend (self · n min left)"
  with NO reason field (Q1); otherwise holders of
  `observations.correct` get "Correct" with the required-reason field.
  The client tier hint is display only — the server re-decides on
  submit, and its verdict (window expired, reason required, nothing to
  correct 409) is shown verbatim. Profiles with neither permission see
  no buttons; without `observations.record` the entry card is absent
  and the PatientBar says "Read-only chart" (the office-Administrator
  profile reads, never touches — the hard constraint).
- **Verification (hands-on, local server + built preview)**: 41/41
  headless UI proof — catalogue-rendered chips (7/8, Devices absent +
  named as disabled), cross-group staging, partial-compound block,
  round charting with server-stamped header, GCS compound + computed
  Total 12, tier-1 amend without reason + amend-not-erase history,
  fluid totals incl. the repeated-type sum (300+150 → Total Output 450,
  Net 250), ad-hoc mode, Specialist sees entry but NO correct
  affordance on another's entry, Consultant tier-2 with reason recorded
  (role SeniorDoctor on the layer), Receptionist read-only (no entry
  card, no correct buttons, marked read-only), nav + KPIs; screenshots
  reviewed. `tsc` + production build clean. No server change in this
  step — endpoint byte-parity is structural.
- **Flagged, not silently decided**: (1) NO group-enablement UI was
  built — F3 makes enable/disable live in v1 (it is, via the API,
  suite-proven) but §12 step 3 does not list a config UI and the design
  defers management UI; whether a small Consultant-tier enablement
  panel belongs in v1 is the owner's call. (2) The screen is
  roster-scoped (open encounters): §6-legitimate corrections on a
  DISCHARGED patient's chart are server-supported but have no picker
  here yet — recorded as a display gap (the Print-hub precedent).
  (3) Same-minute rounds by the same recorder display as one timepoint
  group (a round IS a shared clinicalTime; repeated types within it
  each show). (4) Derived-value arithmetic lives client-side in the
  render map for now; if step 4's bedside projection needs the same
  computations server-side, formula ownership should consolidate there.
- **Remaining (§12)**: step 4 the two-source bedside read-swap, then
  the 3 deferred print templates and (later) the Device Adapter.

### Stage 11 §12 step 4 (built) — the two-source bedside READ-SWAP

*[Attributed addition 2026-07-13 — the fourth and final rework PR of the
§12 model sequence. The pre-build verification surfaced six findings
(F5–F10) where the code differed from or was underspecified by the
design; ALL SIX were decided by the owner BEFORE building and are
recorded verbatim in the design artifact
(`docs/design/stage11-observation-model.md`, "Step-4 build decisions").
The step-3 post-merge thirteen-suite pass also ran GREEN on merge commit
`24e77ac` (13/13) — with one honest catch: the print suite's PAGES gate
refused a stale staging deployment (the PR-branch push predated PR #72,
so its deploy job was skipped and the live site still served the
pre-step-3 frontend); deploy-pages was dispatched on main per the gate's
own operational instruction and the re-run went green.]*

- **The server projection (M1)**: the roster read
  (`GET /api/icu/patients`) now projects every vitals field from the
  LATEST charted Observation of the OPEN encounter
  (`Core/Observations/ObservationProjection` — effective values, so
  amendments show through), falling back PER-TYPE to the demo-seeded
  snapshot row where one exists (F9 — demo rows exist only in demo
  seed mode; production is pure real-or-blank by construction), else
  an honest NULL on the wire. The fresh-patient default's fabricated
  zeros, rhythm "SR" are GONE (nulls + "—"); the bed alert says
  "baseline observations pending" only while that is true. The F7 tile
  map is data on the record: monitor sys/dia ← art_sbp/art_dbp, NIBP ←
  sbp/dbp, MAP ← the charted map (never recomputed), uo ← urine_output,
  etco2 ← the new type. ENCOUNTER scope is structural: a readmission
  projects from its own (empty) encounter — the closed stay never leaks.
- **The F6 catalogue top-up mechanism**: seeding is now
  seed-if-missing per typeCode (append-only; authored entries are
  APPENDED so a topped-up deployment's Seq equals a fresh seed's —
  proven byte-identical catalog between a fresh seed and an old
  51-type DB restarted on the new build). EtCO₂ ships as the first
  top-up (ventilator group, mmHg, 0–100). Existing rows are never
  rewritten; the v1 catalogue stays runtime-read-only (F3).
- **The frontend swap (M2)**: `panels.ts` loses its VENTILATOR and
  HEMODYNAMICS demo data — those panels now render from
  `src/lib/api/bedside.ts` (REAL path, no mock imports): latest-per-type
  tiles real-or-'—', Driving Pressure computed ONLY when Pplat and PEEP
  share a charted timepoint, the 24-h fluid strip summed from real
  per-interval entries (absent when none; the bar percent is a
  documented display scale), Compliance/SVV dropped (F6 deferred), the
  fabricated "PiCCO · q1h" panel caption replaced with "Latest charted".
  warn flags are FALSE everywhere — alarm thresholds are a clinical
  rule set that does not exist yet (recorded with the Derived Clinical
  Scores item). Infusions/alerts/goals stay mock (NOT
  observation-backed; separate future domains) and stay compiled out of
  production; Mission Control's production refusal REMAINS (F10 — a
  gate that lifts progressively as those domains become real).
- **The F5-a display**: the simulated `MonitorCard` is DELETED —
  synthetic waveforms, 2.5-s value jitter, the STREAMING badge, and the
  client-side MAP recomputation are gone (the bed board's 3-s jitter
  too). Its replacement, `LatestObservationsCard`, shows each reading
  with its clinical time and source badge, a DEMO SNAPSHOT tag on
  fallback values, "not charted" blanks, a MANUAL CHARTING badge, and a
  link to the /observations flowsheet. Bed cards and the nurse
  workspace render '—' for null vitals with threshold classes silent on
  blanks; print templates print "— not charted" (never a dangling
  unit); the unit-average-MAP KPI averages only charted values.
- **Verification**: 19/19 byte-parity old-main vs branch on fresh demo
  seeds — the roster is BYTE-IDENTICAL for demo patients (per-type
  fallback preserves values and key order) and the only intended delta
  is the catalog (etco2, asserted exactly); 12/12 server matrix (fresh
  nulls, the exact F7 map, correction→projection, demo-override,
  readmission-never-inherits); 25/25 headless UI proof (fresh bed card
  all '—' no zeros, MC card blanks→charted values with time·manual,
  130/68 vs 92/54 on screen, ΔP 14 same-timepoint, +200 mL fluid strip,
  DEMO tags on a demo patient, no STREAMING/canvases anywhere, nurse
  workspace null-safe); bundle proofs re-run (9/9 baseline + step-4
  addendum: deleted simulator markers absent from BOTH bundles,
  remaining mock panels dev-only, the F5 card ships in production, the
  vent/hemo projection tree-shakes out WITH the still-refused composite
  per F10); server + tsc + production build clean. The suite gains a
  step-4 leg (readmission-nulls, the F7 roster map incl. etco2,
  correction-reaches-projection); the F9 demo-fallback half is
  local-matrix-only (charting on a staging demo patient would be an
  immutable permanent write) — recorded per the CI-evidence rule.
- **Remaining (Stage 11)**: the 3 deferred print templates (MAR, Vitals
  Flowsheet, Ventilator & Device Report), then (later) the Device
  Adapter. The §12 model sequence (steps 1–4) is COMPLETE.

### Stage 11 print templates (built) — the contract's deferred three

*[Attributed addition 2026-07-13 — built from the owner's design
document, recorded verbatim as
`docs/design/stage11-print-templates.md` (clinical source: the
validator). The Print Center Contract is updated: implemented set
COMPLETE at 13/13 contract documents (+ the retained Admission Note).]*

- **Pre-build verification (the design's Q4)**: the MAR's
  administration-EVENT dependency was verified against the real code
  before building — `MedAdministration`/`AdminDto` persist on the
  orders store with status (given/held/refused), documentedTime, the
  administering nurse from the token (documentedBy), and a
  SERVER-REQUIRED reason for held/refused
  (`server/Core/Mar/MarApi.cs`). Every design cell field exists — no
  gap to flag; the MAR builds fully from real administration data. The
  print selector reads the ORDERS read (which carries
  documentedBy/reason), not the `/mar` projection (which omits them).
- **#12 Vital Signs / Observation Flowsheet** (`vitals-flowsheet`,
  LANDSCAPE — the first landscape document; the registry's previously
  dormant orientation field is now consumed: an `@page` override + a
  wide preview sheet): observations × 24 hourly timepoints, the window
  ANCHORED to the latest charted observation (identical for admitted
  and discharged patients), real date spans in the header (charted
  clinical times are real UTC datetimes). TRADITIONAL SPLIT per the
  validator: Vital Signs + Neurological Assessment + Fluid Balance
  sections rendered FROM the catalogue's own groups/types — ventilator
  detail deliberately lives on #13. Derived rows (GCS Total, Total
  Input, Total Output, Net Balance) compute PER COLUMN at render from
  that hour's charted entries — never charted, never stored. Repeat
  same-hour values print together ("/"); corrected entries print their
  effective value with an amendment-count footnote; empty cells are
  honestly blank. GCS prints as E/V/M; pupils compact (size +
  reaction initial) with a legend.
- **#13 Ventilator & Device Report** (`ventilator-device-report`):
  a point-in-time SNAPSHOT — the latest charted value per
  ventilator-group catalogue type, each attributed to its OWN charted
  time; Driving Pressure derives at render (Pplat − PEEP, one shared
  timepoint only); Minute Ventilation prints charted-when-charted,
  else computes VT(exhaled) × RR(measured) from one shared timepoint,
  explicitly labelled "computed". Device sections are LAID OUT NOW and
  honestly empty (the validator's always-present decision): infusion
  pumps (the one devices-group catalogue type, with a
  group-disabled context line), ECMO / CRRT / ICP ("not monitored — no
  chartable parameters exist yet").
- **#11 MAR** (`mar`): rows = the encounter's medication orders that
  carry a dose schedule; each medication's OWN scheduled times are its
  columns (q8h → its slots; PRN slots labelled — no uniform grid, per
  the validator). Cells render the persisted event: GIVEN/HELD/REFUSED,
  actual documented time, the administering nurse, and the recorded
  reason when a dose was not given; an undocumented slot on an ACTIVE
  order prints "not documented" (never assumed given), and a
  discontinued order keeps its documented doses with its stop reason
  (the discharge cascade included). Unsigned prescriptions are counted
  and pointed at the Medication Orders sheet.
- **Cross-cutting**: all three on the Phase-1 pattern (one selector +
  one component + one registry entry; the shared layout/identity
  ladder/honest-data/† conventions). The observations read gained an
  optional encounterId (episode-scoped documents — a readmission's
  flowsheet never carries a prior stay). The OBSERVATION TYPE CATALOGUE
  read supplies the printed vocabulary (labels/units/groups) — unlike
  the formulary it is v1 read-only reference data, and group enablement
  is deliberately IGNORED for historical rendering (a disabled group
  must not erase a printed flowsheet — the ORD-168 principle); values
  and units still render from each persisted observation itself.
  ADAPTIVE layouts per design P1: orientation/pagination/density are
  data-driven and the layout knobs are isolated, so the future PRINT
  CENTER ENGINE (P2 — recorded under Known Feature Gaps) can wrap
  these templates without rework.
- **Verification**: 28/28 headless render proof against a live local
  server — three charted rounds (multi-hour spread via LOCAL SQLite
  aging of ClinicalTime only; the live API has no back-dating, by
  design — the window-expiry precedent, recorded), a signed q8h order
  with a GIVEN dose and a HELD dose (reason), all three documents
  asserted for an ADMITTED and then a DISCHARGED patient (identity
  ladder; documented doses survive discharge, undocumented slots drop
  with the discontinued order; the last charted vent setup still
  renders). Screenshots reviewed; tsc + production build clean.
  Two real-behavior notes surfaced during the proof: the server
  generates only the REMAINING scheduled slots for today on a new
  order, and safety enforcement blocked a cross-reactive test drug
  against a documented allergy — both correct system behavior, worked
  with, not around.
- **Flagged, not silently decided** (design §5): (1) POC labs and
  Nursing Clinical Assessment are NOT on the flowsheet — the primary
  three groups are built per the validator's traditional split; adding
  either is a template data-list change awaiting the validator's call.
  (2) Device sections are ALWAYS-PRESENT-honestly-empty (the design's
  stated reading, restated in the owner's build instruction);
  hidden-when-empty remains the recorded alternative. (3) Minute
  Ventilation is CHARTABLE in the catalogue while the design lists it
  among computed values — built as charted-wins / computed-fallback
  (labelled); if the validator prefers compute-only, that is a
  one-line change.

### Lab Result-Entry (Documentation) path (built) — the missing HUMAN feed into the lab store
Built from the clinical validator's design (`LAB_RESULT_ENTRY_DESIGN.md`,
recorded in the PR): a manual lab-result **documentation/transcription**
screen (`/lab-entry`). The data-source assessment for the Clinical Scoring
Engine found the lab *store* complete (structured analytes incl. PaO₂, ref
ranges, order→result linkage, acknowledge lifecycle) but with **no human
feed** — results reached Aurora only via the producing-service
`results.create` API, exercised only by the E2E suite. This fills that hole:
a way for the ICU bedside team to actually *enter* results, reflecting the
real paper-based workflow (central lab prints on paper → the ICU transcribes;
bedside ABG entered from the analyzer). Entry screen over the EXISTING store —
the store was NOT rebuilt, the same shape as the `/observations` entry screen
over the observation store.
- **RBAC reconciliation (the design's open item #1 — a conscious decision,
  flagged not silently made; the project owner chose the NEW-ATOM option).**
  A NEW permission atom `results.document` was added (Nurse + Doctor +
  SeniorDoctor — the ICU bedside team who transcribe paper reports and enter
  bedside ABGs). The existing `results.create` STAYS the producing-service /
  future-LIS authority on the Ancillary profile, UNCHANGED. The two
  authorities are reconciled, not merged: a nurse/doctor is 403'd on
  `results.create` and a lab technician is 403'd on `results.document`.
  Verified live: nurse/doctor document → 200; lab-tech/administrator document
  → 403; unauth → 401; lab-tech `results.create` still 200; nurse
  `results.create` still 403.
- **Lean, catalogue-driven request** (`POST /api/icu/results/labs/document`,
  `results.document`). The client sends ONLY patientId, the catalogue panel,
  and per-analyte `{analyte, value}`. Everything else is SERVER-OWNED:
  unit/refRange/numeric-bounds are CATALOGUE-DERIVED from the lab catalogue's
  analyte definitions; the per-item **flag is DERIVED from the value against
  that reference range** (in-band → normal, out → abnormal — never
  client-claimed); the label is the catalogue test's Name; the documenting
  clinician is the token; the encounter is the patient's OPEN one; the
  order→result linkage is the SAME server-derived rule as create (oldest
  unfulfilled active Lab order for the panel on this encounter, else
  standalone); timestamps are server-stamped; and **`source` is stamped
  `manual`** (§5) so a future LIS-fed result stays distinguishable. The
  request DTO is `[JsonUnmappedMemberHandling(Disallow)]` — a client that
  tries to claim a unit, refRange or flag fails binding (verified: 400).
- **`Source` field added to the lab result** (`LabDrawRow.Source`, EF
  migration `AddLabResultSource`, wire field `LabDraw.source`). The
  source-provenance idea from the observation model (manual/device/hybrid):
  `"manual"` for this documentation path; `""` (absent on the wire) for
  pre-existing rows and the producing-service create path, which predate the
  field — a source is never invented. **Byte-parity preserved**: a seeded
  result carries no `source` on the wire (null omitted), so the 13 deployed
  suites and every existing lab GET are unchanged (verified: 0 occurrences of
  `"source"` on a seed-only patient).
- **Screen** (`/lab-entry`, `/lab-entry/:patientId`, nav "Lab Entry", gated
  by `results.document`): patient rail → catalogue panel chips → per-analyte
  inputs RENDERED FROM the catalogue (with a live in-range/out-of-range
  preview mirroring the server derivation) → optional note → submit; below,
  a "Results on File" list over the EXISTING store shows each draw's flag,
  provenance (`documented by X at time` from the audit history), order-link
  vs standalone, and a `manual` badge, with a link to the full `/labs`
  trends view (which also gained a `✎ manually documented` provenance line).
  REAL-ONLY write (a documented result is a clinical record — never applied
  to local mock state), like observations/ADT.
- **Verification** (headless, live local server): a nurse documents CBC →
  Platelets 95 against order ORD-101 (server-LINKED, Platelets 95 < 150 →
  abnormal derived, source manual, "documented by RN Maya Chen"); a doctor
  documents ABG → PaO₂ 62 STANDALONE (no ABG order → orderId absent, 62 < 80
  → abnormal, source manual); a normal in-range value → normal flag;
  catalogue-owned unit/refRange present on the stored item; the full RBAC
  matrix above; validation 400s (unknown analyte for the panel, unknown
  panel, no items, unknown patient, Disallow on unit/flag); closed-encounter
  → 409. tsc + production build clean; server build clean; the migration adds
  only the `Source` column (default `""`).
- **Recorded as FUTURE (not built now)** — see Known Feature Gaps: **LIS
  integration** (the Scenario-C automated feed that would *replace* manual
  transcription — LIS-fed results become a second `source` of the same
  object, which is exactly why `source` was built now); **ABG analyzer
  auto-feed** (a bedside blood-gas Device Adapter, like the ventilator one);
  and **coded analyte identity (LOINC-style)** (analytes are display strings
  today — the panel-membership check is a name match; a coded system is worth
  settling before any scoring join). A fourth honest limitation is recorded
  there too: the catalogue models a SINGLE reference range per analyte, so
  the documentation path grades normal vs abnormal only — a `critical` grade
  needs threshold data the catalogue does not carry yet.

### Custom / Other Lab Test entry (built) — the honest free-text escape hatch
Built from the clinical validator's design (`CUSTOM_LAB_TEST_DESIGN.md`,
recorded in the PR): an 8th **"Custom / Other"** tab on the `/lab-entry`
screen for documenting a test the catalogue does NOT have. The 7 catalogue
panels, their structured entry, catalogue-derived units/ranges, automatic
flagging, order linkage, and acknowledge lifecycle are ALL unchanged — this
is purely additive (design Option A; Option B — permanent catalogue tests
with flagging-driving ranges — was deliberately DROPPED for safety and is NOT
built).
- **Core principle — UNSTRUCTURED and UNFLAGGED (honest data).** A custom
  test has no catalogue definition, so the system does NOT compute
  normal/abnormal/critical for it — it records exactly what the clinician
  typed. The reference range is DISPLAY-ONLY context; it never drives a flag
  (the safety choice: a hand-typed range must not produce an
  authoritative-looking auto-flag). In Results on File a custom result is
  visually distinct — a violet dashed rail and a "custom · unflagged" tag
  REPLACE the normal/abnormal/critical badge, so no reader mistakes it for a
  properly-flagged structured result; the reference range (if given) shows as
  "ref: …" context.
- **Who / provenance.** Same `results.document` bedside-team authority
  (Doctor/SeniorDoctor/Nurse) — low-risk because the data is unstructured and
  affects no other patient's data or any shared definition (unlike Option B).
  Server-owned provenance (documenting clinician + time), `source=manual`,
  encounter-scoped — identical discipline to the structured path; a payload
  claiming provenance fails binding.
- **Storage — the flagged additive change (design open item #1).** The
  existing store could NOT hold a free-text value cleanly: `LabItemFull.Value`
  is a `double`, and two server consumers parse a draw's items as numeric —
  the unit-wide **inbox** does `items[0].Value` (would crash on an empty/text
  item) and the **Timeline**'s `AbnormalSummary` would fabricate "All values
  within reference range." So rather than forcing free text into a numeric
  field, a small additive change was made: `LabDrawRow` gained `Custom`
  (bool) + `CustomValue`/`CustomUnit`/`CustomRefRange` (nullable text) — EF
  migration `AddCustomLabResult` — the test name is `Label`, the numeric
  `ItemsJson` stays `"[]"`, and `Flag` stays `""` (no flag). The inbox and
  timeline now branch on `Custom` to build an honest headline from the
  free-text value and carry no flag. The new fields are absent on the wire
  for every structured result (nullable → `WhenWritingNull`), so **byte-parity
  holds** and the trends card / Mission Control views are unchanged (custom
  results are also filtered out of the numeric trends chart — unstructured
  data is not chartable). The inbox card shows a custom result with a neutral
  informational badge, never a green "normal".
- **Endpoint** `POST /api/icu/results/labs/document-custom` (`results.document`):
  free-text `testName` + `value` (both required), optional `unit` /
  `refRange` / `note`; the value is NEVER parsed as a number (a custom test
  may be descriptive, e.g. "positive"); no catalogue lookup, no order linkage.
- **Verification** (headless, live local server): doctor + nurse document a
  custom test (with and without unit/range/note); non-numeric value
  ("positive") stored; it persists `custom=true`, `flag=""` (no clinical
  flag), `source=manual`, provenance, `panel="Custom"`, `label=`testName, no
  orderId; the **inbox and Timeline do not crash** and report the free-text
  value honestly (no fabricated "within range"); RBAC matrix (doctor/nurse
  200, lab-tech/administrator 403, unauth 401); validation 400s (missing
  testName/value, Disallow on a client-claimed flag, unknown patient);
  closed-encounter → 409; the 7 catalogue panels and structured results are
  unchanged (16 structured rows carry 0 custom fields on the wire —
  byte-parity). The Custom tab + form + safety note were rendered in a real
  browser. tsc + production build clean; server build clean; the migration
  adds only the four custom columns.
- **Recorded as FUTURE (not built)** — see Known Feature Gaps: **Option C —
  LIS test-list import** (a future piece of the LIS integration / Scenario C
  Integration Layer; LIS-sourced test definitions become a future source, the
  same "manual now, integrate later" pattern — the custom-result model does
  not preclude it). Option B stays dropped for safety.

## Post-Phase-3 Roadmap — four-layer data architecture (LOCKED build order)
The remaining build is organized as four data layers. Each layer must sit
on a FULLY-REAL data foundation beneath it — never mix a new write-feature
onto a still-mock store. Per "Platform Direction" above, Layers 2–4 are
built directly in Aurora Core, not in the ICU module.

1. **Layer 1 — Transactional data** (orders, results, medication
   administrations): COMPLETE for Stage 10 Phase 3. Labs/Imaging, Orders,
   the MAR, the Timeline aggregation, and AI (the final domain) are all
   migrated behind the proven JWT + server-side RBAC pattern. The only
   remaining still-mock sources are the Timeline's four hybrid feeds
   (Consults/Notes/Nursing/I&O) — deferred with the ADT/Nursing work, not
   part of Phase 3 — and the alert/MC derived views that ride on
   `getPatientDetail` (documented drift, migrate when it does).
2. **Layer 2 — Entity/ADT data** (patient Admission / Discharge /
   Transfer): DONE — built directly in AURORA CORE (`server/Core/Adt/`;
   see "Layer 2 — ADT (built)" above). The Admissions/Discharges nav
   placeholders are live screens; admission/discharge are doctor
   authority, transfer is a nursing action; the roster is now a derived
   view over open encounters.
3. **Layer 3 — Identity/access** (user administration: create / manage /
   deactivate accounts, password reset): DONE — built in AURORA CORE
   (`server/Core/Identity/UsersApi.cs` + `/admin/users`; see "Layer 3 —
   User Administration (built)" above); ties to the Administrator
   profile via the new `users.manage` permission and its `/admin`
   landing screen; supersedes the Phase 2 "no registration/reset flow
   yet" note (admin-managed exists; SELF-SERVICE still does not).
4. **Layer 4 — Master/reference data** (drug formulary, lab test catalog,
   order sets as maintained DATABASE tables with a manual data-entry UI —
   not hardcoded frontend lists): built in AURORA CORE — the reference
   layer Pharmacy/Lab admins maintain. **The FORMULARY is DONE**
   (`server/Core/MasterData/` + `/formulary`; see "Layer 4 — Master
   Data: the Formulary (built)" above) — Orders & Medication now reads
   the drug list from the API (the hardcoded list survives only as the
   offline mock fallback), the frequency vocabulary moved out of
   Core/Orders into master data, and prescribing an inactive drug is a
   409. **The LAB TEST CATALOGUE and ORDER SETS are DONE too** (see
   "Layer 4 phase 2" below) — Layer 4's three planned domains are all
   built; what remains of the reference layer is the recorded
   enforcement work (formulary/catalogue-authoritative ordering,
   server-side safety checks).

**Database persistence — the BLOCKING prerequisite for Layer 2 (ADT) —
is DONE** (see "Database persistence (built)" above): Render Postgres via
`DATABASE_URL` + EF Core migrations replace the boot-time
`EnsureDeleted`/seed; writes survive restarts/redeploys. Two operational
notes bind: Render's FREE Postgres expires after 30 days (+14-day grace,
then deletion — see the constraint above; real use needs a paid
database), and ADT can now be built on a durable system of record as
required.

Build order (locked, amended by the architectural review): Phase 3
(all five domains), the Core relocation (option (a)), database
persistence (Postgres + migrations), **Layer 2 ADT (Aurora
Core-native Patient/Encounter/Bed with the roster seam's
identity/location half dissolved)**, and **Layer 3 (user
administration in Core Identity, escalation safeguards + immutable
audit)**, and **the encounter-scoping fix (the ORD-113 defect — an
order's lifecycle is bounded by its encounter; see the section
above)** are DONE, and **Layer 4 is DOMAIN-COMPLETE — the drug
formulary, the lab test catalogue and order sets are all built in Core
Master Data**, and **the server-side safety-enforcement work item is
DONE — the formulary and catalogue are authoritative at ordering and
medication safety is server-enforced** (see "Server-side safety
enforcement (built)"). **Next: the deferred Print
Center** *[Superseded 2026-07-11 per project owner: next is ENVIRONMENT
SEPARATION, then the Print Center — see "Remaining build order" below]*
→ Stage 11 (device
integration + the Observation model per the locked rule above; Stage
11 also absorbs the remaining bedside-snapshot half of the roster).
The full architectural review + Core-extraction inventory ran before
the relocation and resolved the domain-relocation open question as (a).

### Remaining build order (per project owner, 2026-07-10)

*[Attributed addition — this ordering was set by the project owner in the
docs-split instruction; it resolves the roadmap tail above ("Next: the
server-side safety-enforcement work item or the deferred Print Center →
Stage 11") and extends it. It was not moved from the pre-split file.]*

1. Server-side safety enforcement — IN FLIGHT (draft PR #46, below)
   *[Superseded in the safety-enforcement PR itself: this item is BUILT —
   see "Server-side safety enforcement (built)" above.]*
   *[Superseded again 2026-07-11: DONE — merged (PR #46) and
   LIVE-VERIFIED against build e8f3cf56 (hands-on before/after evidence
   + four suites green; see the LIVE-VERIFIED record above). The NEXT
   build-order item is 2 — environment separation.]*
2. Environment separation (dev/staging/production — the missing concept
   recorded in 01_ARCHITECTURE.md § Environment separation)
   *[2026-07-11: a DESIGN PROPOSAL for this item was authored and is
   awaiting project-owner approval —
   `docs/design/environment-separation.md`. Revision 2 (same day, same
   PR) after a foundational owner correction: **production is
   on-premises** — hospital LAN, offline-first, no cloud service in the
   clinical serving path. Tiers: development (local/cloud) · staging
   (the current Render + Pages stack, redesignated wholesale) ·
   production (on-prem Docker Compose: API image that also serves the
   frontend same-origin, on-prem PostgreSQL, backup sidecar). Separate
   PostgreSQL / JWT secret + `aud` claim / seeds with boot tripwires;
   git promotion via an explicit `production` branch whose only consumer
   is a gated release-bundle workflow; on-prem updates via checksummed
   release bundles + `aurora-update`/`aurora-verify`; environment
   identity in `/healthz` and `build.txt` asserted by every suite before
   write legs, with write suites having no production target. Revision 3
   (same day, owner amendments): Compose = v1 reference deployment (HA
   adoptable later without changing the model); formulary seeding is a
   choosable install-time policy; bootstrap admin gets an
   installer-generated one-time credential with forced change on first
   login (no known credential ships in the image); the repo goes private
   as a pre-deployment checklist step before any hospital install.
   NOTHING is implemented — no code, config, or service changes ship
   with the proposal; implementation starts only after approval.]*
   *[Superseded 2026-07-11: the design was APPROVED (PR #53 merged by
   the owner) and implementation began per its §11 order — step 1
   (environment identity) is built; see "Environment identity (built)"
   above. Remaining: the `aud` claim rider, then steps 2–6.]*
3. Print Center
   *[2026-07-11 per project owner: the Print Center FOUNDATION (Phase 1 —
   rendering architecture + the first three templates) was pulled forward
   ahead of environment separation — see "Print Center Foundation —
   Phase 1 (built)" above. The remaining TEN templates ride later PRs on
   that foundation; environment separation remains queued.]*
4. Stage 11 — device integration + the Observation model (per the locked
   rule in 01_ARCHITECTURE.md; absorbs the roster's remaining
   bedside-snapshot columns)
   *[Clinical requirement recorded 2026-07-12 — source: the clinical
   validator (the ICU physician), identified while testing the Mission
   Control monitor, which currently shows only auto-fed/simulated
   values with no manual-entry path. Bedside values — vitals (HR, BP,
   temp, SpO₂, RR), NIBP, ventilator settings, CVP, and hemodynamics —
   must support MANUAL entry by clinicians, not only device feeds: a
   nurse or doctor must be able to chart what they measured at the
   bedside. This is the "Manual" source of the Observation model's
   Manual/Device/Hybrid design (01_ARCHITECTURE.md § Stage 11), and it
   is a REQUIRED capability, not optional. It reinforces why Stage 11 —
   which replaces `panels.ts` with real Observations — is the top
   architectural priority after the operational work.]*
5. Architecture Freeze
6. Module #2

### In-flight work

*[Attributed addition — describes the open draft PR #46, verifiable against
the PR itself, not moved from the pre-split file. PR #46 edits the pre-split
CLAUDE.md: whichever of PR #46 and the docs-split PR merges second carries a
mechanical re-home of #46's new section into these files.]*

- **PR #46 — server-side safety enforcement** (open draft): Part 1 —
  formulary/catalogue-authoritative ordering (unknown drugId/testId →
  validation 400 naming the field; inactive stays 409 after the encounter
  guard); Part 2 — the coupled suite migration (orders/MAR suites admit
  their own patients; the owed absence probes added to the
  orders/formulary/labcatalog/labs suites); Part 3 — the safety.ts
  allergy/interaction/duplicate model enforced server-side at order
  creation (hard blocks → 409 never overridable; warn-level → 409 without
  an `overrideJustification`, 200 with one plus an audited "safety
  override" event with the token's actor).
  *[Superseded in the safety-enforcement PR itself (this PR carried the
  re-home after the docs split merged first): the work is BUILT — the
  full record is "Server-side safety enforcement (built)" above. Live
  suite validation (orders → MAR → formulary → labcatalog → labs,
  sequential) runs after merge + deploy.]*
  *[Superseded again 2026-07-11: COMPLETED AND LIVE-VERIFIED — PR #46
  merged; hands-on before/after evidence + the suite runs are recorded
  under "Server-side safety enforcement (built) → LIVE-VERIFIED" above.
  The only work now in flight is the formulary-suite duplicate-leg fix
  (suite-only, validated green on its branch, own PR).]*

## CI Evidence — skipped/no-op checks (incident + codified rule + 2026-07-10 audit)
Recorded after PR #27 incidentally discovered that PR #25 shipped real
TypeScript errors with every check "green". Full audit detail lives in
the audit PR's description; this section is the durable record.

**The incident — two independent no-op layers, same symptom:**
- **Local**: bare `npx tsc --noEmit` against the ROOT tsconfig has been a
  NO-OP since the Vite scaffold — the root file is solution-style
  (references only, no sources), so tsc compiles nothing and exits 0.
  That "tsc clean" claim let PR #25 ship real type errors in the
  Admissions/Discharges pages. The real commands: `npx tsc -b --force`
  or `npm run build` (which runs `tsc -b`).
- **CI**: `deploy-pages.yml` is the ONLY automatic workflow, and its
  build job is gated on "head branch has an open PR against main"
  evaluated AT PUSH TIME. The standard flow pushes first and opens the
  PR seconds later, so a single-push branch's only gate evaluation sees
  ZERO open PRs → the build/deploy job is SKIPPED → the run concludes
  SUCCESS → the commit (and the fresh PR) wear a green
  "Deploy to GitHub Pages" check under which npm ci / tsc / vite never
  ran (verified from run #56's gate log: "open PRs …: 0" seconds before
  PR #25's PR existed). A one-commit PR can merge with the frontend
  never typechecked by any machine. PR #27 fixed the type errors; the
  gate design itself is UNCHANGED and this trap remains until a gate
  redesign PR.

*[Docs split note: the codified skipped≠passed rule that followed here
moved to 03_DEVELOPMENT_RULES.md § "CI evidence — skipped ≠ passed".]*

**2026-07-10 audit of every gate in `.github/workflows/`** (each finding
adversarially verified; fixes deliberately NOT applied — docs-only audit,
they ride with the next touch of each file):
- **Topology**: NO `pull_request` trigger exists anywhere; NOTHING runs
  on push to main (green main = no workflow ran); no GitHub check ever
  compiles the ASP.NET Core server — a C# compile error merges green and
  fails only inside Render's own build, invisible to GitHub; all eight
  deployed E2E suites are `workflow_dispatch`-only, so their evidence is
  absent by default. deploy-pages extras: `workflow_dispatch` bypasses
  the PR gate entirely; one shared `pages` concurrency group cancels
  OTHER branches' in-flight deploys; unset `API_BASE_URL` deploys a
  mock-mode site, green.
- **Setup-failure semantics — all eight suites are LOUD**: warm-up
  exhaustion, login failure, or an unreachable service abort RED (never
  a silent green). No suite concludes success after an early setup
  abort. This half of the audit question is clean.
- **Confirmed green-without-assertion sites** (step-level, all caught or
  bounded downstream today): the users suite's CLEANUP step swallows
  every failure (`curl && echo` lists + unconditional final echo) — it
  can print "no active e2e credentials remain" while discharging and
  deactivating NOTHING; the `read VAR <<<"$(python3 -c '…assert…')"`
  pattern (MAR order-seeding, ADT admit/bed-pick, users admit) swallows
  its assert — the step passes with empty vars and a LATER step fails
  red with a misattributed cause; orders' "never persisted" claim is
  asserted only for the P-1001-scoped bodies (not the P-9999 body, and
  not at all for unparseable-frequency); four of six ADT validation
  checks assert the error TEXT but not the 400 status; ADT's
  durable-count and the suites' echo-only lines assert nothing.
- **BIGGEST FINDING — every suite is now stale-deployment-blind**: five
  suites gate warm-up on `/healthz` alone, which the PREVIOUS build
  keeps serving during a Render rebuild (the AI suite's own comment
  documents this exact trap); and since Layer 3 shipped, the three
  401-vs-404 endpoint-presence gates (AI/ADT/users) no longer
  distinguish builds either — every deployed build now has every
  surface. ALL EIGHT suites can run green against a STALE deployment,
  and with `autoDeploy: true` and no build identifier on `/healthz`, no
  green run is attributable to a specific commit. The fix (future PR):
  serve a build/commit id on `/healthz` and make every warm-up assert
  it.
- **Sequential dispatch is enforced by NOTHING** — the recorded
  never-concurrently lesson has no `concurrency:` group behind it on any
  E2E suite; concurrent dispatches race on free-bed picks and the ADT
  occupied-bed probe (false reds/greens).
- **Durable-DB debts**: labs' `assert len(d)==49` is an EXACT count in
  violation of the codified subset rule (breaks the moment lab creation
  ships); the permanently-red labs suite means its nurse-403/doctor-200
  acknowledge assertions are PERMANENTLY unobtainable live (and a
  suite that is always red breeds alarm fatigue that corrupts the
  meaning of red everywhere); suites accumulate clinical writes on live
  demo patients without cleanup (every MAR run leaves an ACTIVE
  vancomycin order on P-1001, every timeline run an active order on
  P-1007); there is NO failure-path cleanup (`if: always()` appears
  nowhere) — a mid-run failure in the ADT or users suite leaks an OPEN
  encounter occupying a bed forever, and repeated failures exhaust the
  free beds both suites need; orders/MAR/timeline headers still say
  "ephemeral DB" (stale since the persistence PR).
- **Hardening notes (theoretical today, recorded)**: every CORS assert
  tests only a simple-request response header — no suite ever issues an
  OPTIONS preflight, though the UI's order-modify depends on PUT being
  in the preflight allowlist — and greps the origin as an unescaped
  regex; server response values flow unsanitized into `GITHUB_ENV` and
  into `python3 -c` source strings (the system under test could in
  principle forge its own verdict); the auth suite never asserts the JWT
  `exp` claim; the users suite's no-password-material check matches only
  the literal key `passwordHash`; `deploy-pages` interpolates
  `github.ref_name` raw into shell + a query string.
- **Checked and clean**: no `continue-on-error`, no `if: always()`, no
  `|| true` outside the warm-up loops, no `exit 0` shortcuts beyond the
  documented gates. One tempting claim was REFUTED against source and is
  deliberately not recorded: the AI ranking does NOT drop discharged
  patients (the diagnosis join falls back to ""), so ADT discharges do
  not break the AI suite.

**2026-07-10 hardening PR (follow-up — the audit's top items, FIXED):**
- **Stale-deployment blindness KILLED**: `/healthz` now serves the
  deployed commit (`build` = `RENDER_GIT_COMMIT`, "dev" locally) and
  EVERY suite's warm-up asserts it equals the SHA the workflow was
  dispatched against — mismatch after the retry budget is a loud
  "STALE DEPLOYMENT" failure, never a green run against an old build.
  Corollary: suites must be dispatched on a ref whose HEAD is the
  deployed commit (main, after Render finishes) — dispatching a
  non-deployed ref now correctly fails. (SUPERSEDED by the gate-context
  fix — see "The stale gate's dead zone" below: the gate now compares
  CONTENT of the build context (git tree/blob hashes of server/ +
  render.yaml), so any ref whose server content matches the deployed
  build passes.)
- **Real CI exists (`ci.yml`)** — the repo's first `pull_request`
  trigger: `tsc -b --force` + `vite build` (frontend) and
  `dotnet build server` (the C# server is no longer compiled by
  nothing) on every PR and every push to main. "Green main = no
  workflow ran" is no longer true; the deploy-pages PR-gate design
  itself is still unchanged.
- **Failure-path cleanup**: the ADT and users suites end with
  `if: always()` cleanup steps (they also run on failure AND
  cancellation) that release the run's encounter and deactivate the
  run's accounts, ASSERTING each outcome — a mid-run failure can no
  longer leak a bed-occupying open encounter or an active account, and
  the cleanup step itself fails loudly if anything remains live.
- **The swallowed-assert pattern is gone**: every
  `read VAR <<<"$(python3 -c '…assert…')"` site (MAR order-seeding, ADT
  bed-pick + admission, users admission) now assigns to a variable
  first — `vals=$(python3 …)` — so a failing assert fails ITS OWN step.
- **Sequential dispatch is structural**: all eight suites share
  `concurrency: group: deployed-e2e` (`cancel-in-progress: false`) —
  two suites can never RUN concurrently. Still dispatch one at a time:
  GitHub keeps at most one PENDING run per group.
- **Labs subset rule**: `len(d)==49` → `len(d)>=49` + lookup-by-id (the
  positional `d[0]` check was also byte-order-brittle); stale
  "ephemeral DB" header comments in orders/MAR/timeline updated.
- **Still open by choice**: CORS preflight coverage, origin-regex
  escaping, JWT `exp` assert, GITHUB_ENV/python-source injection
  hardening, the deploy-pages PR-gate redesign, the permanently-red
  labs acknowledge leg, and MAR/timeline clinical-write accumulation
  on live demo patients.

### The CONFIG MISMATCH probe (2026-07-10)

*[Docs split note: the gate rule this probe exercised ("The stale gate's
dead zone") moved to 01_ARCHITECTURE.md § Verification-gate content
equality; the probe record below is verbatim.]*

**The CONFIG MISMATCH branch was FIRED live, not reasoned about
(2026-07-10, probe PR #38)**: a comment-only render.yaml change was
merged deliberately to put main into the one state that branch handles
(server trees equal, render.yaml blobs differ — a state nobody had
produced). Both protocol legs confirmed on the live service:
(1) the next dispatch (orders run 29110897161) spent its full
60-attempt budget — every attempt logging server trees EQUAL — then
failed with the exact message: "CONFIG MISMATCH: server/ trees are
EQUAL but render.yaml differs between this ref and the deployed build
'5c42000…'. … trigger a MANUAL DEPLOY of the latest commit to clear
this gate — an expected operational step, not a dead zone."
(2) after the manual Render deploy, the same dispatch (run
29112564472) PASSED — the deploy landed mid-loop (attempt 23 still saw
build 5c42000, attempt 24 saw the freshly deployed main HEAD with
matching tree+blob → exit 0), the gate's retry budget doubling as the
deploy-waiter by design.
WHAT THE PROBE ESTABLISHES — stated precisely, not as a
classification: only case (c) — a comment-only render.yaml edit
triggers NO Render rebuild (the build id sat unchanged for the ~35
minutes between the probe's merge and the manual deploy). Case (b) — a
SEMANTIC render.yaml change that alters the deployed artifact — goes
through Render's Blueprint sync, a DIFFERENT mechanism from the
rootDir build filter, which a comment-only probe never exercises; (b)
REMAINS AN UNTESTED INFERENCE (the gate's message says "should have
redeployed — check the dashboard" precisely because this is unproven).
KEEPING render.yaml IN THE COMPARISON SET never depended on the probe
— the ASYMMETRY settles it: if the set is a superset (render.yaml
turns out not to be a build input), the cost is a documented manual
deploy after a config-only change — loud and recoverable; if the set
were a subset (render.yaml dropped but semantic changes DO alter the
artifact), a stale server would pass the gate silently. A recoverable
loud failure beats an unrecoverable silent pass.

## Known Feature Gaps (recorded, not yet built)

*[Attributed addition 2026-07-12 — recorded per the project owner's
instruction, source stated per the documentation rule.]*

- **Imaging ordering is not implemented.** Source: identified by the
  project's clinical validator (the ICU physician) during hands-on
  testing. Imaging RESULTS are fully built — Labs & Imaging shows
  Imaging Studies with the status lifecycle, reports, impressions, and
  acknowledgment — but there is no way to ORDER a new imaging study:
  the Orders page offers New Medication Order, Order Lab Test, and
  Order Sets, with no Order Imaging path. A real ICU requires imaging
  ordering. To build (future): an imaging-order path parallel to the
  existing lab-order path — an imaging catalogue (modalities/study
  types), an order draft flowing through the EXISTING order-creation
  path (never a bypass), and the ordered study appearing in Imaging
  Studies with status "Ordered".
  *[Doc-vs-code contradiction FLAGGED for the project owner (per the
  03 rule — flagged, never silently fixed; the code is untouched by
  this docs PR): two pre-existing code comments claim the opposite —
  `src/lib/api/data/results.ts` ("Screen 5 places lab/imaging ORDERS;
  this store holds what comes back") and `src/lib/api/types.ts`
  ("Screen 5 (Orders & Medication) places lab/imaging orders …").
  Those comments are stale on the imaging half — Screen 5 places lab
  orders only, as this entry records; the existing Layer 4 record
  corroborates ("Modalities stay a closed union until the
  imaging-order workflow exists").]*

- **Print Center Engine (design P2, recorded 2026-07-13).** Source: the
  owner's Stage 11 print-templates design document
  (`docs/design/stage11-print-templates.md`, §0/P2 — the validator's
  vision). Print Center as an ENGINE (like an Office print system):
  templates are layouts; an interactive Print Preview lets the user set
  paper size (A4/Letter/Legal), orientation, margins, font size,
  show/hide sections (QR code / signature / logo), and the flowsheet's
  columns/time-window — then print or save PDF. A distinct, substantial
  future feature, DELIBERATELY NOT built with the Stage 11 templates
  (it would balloon "3 templates" into "a print platform"); the three
  templates are built as adaptive layouts with their layout knobs
  isolated so the engine can wrap them later without rework (the same
  discipline as the Observation model being device-ready without the
  Device Adapter). To be designed in its own session when it is its
  turn.

- **Clinical Scoring Engine — a generic scoring engine, SOFA first**
  (formalizes and supersedes the earlier "Derived Clinical Scores" gap
  from the step-4 F8 decision). Source: the clinical validator, design
  session (2026-07-13); the full architectural design is recorded
  verbatim as `docs/design/clinical-scoring-engine.md`. The validator's
  insight: Stage 11's real observation data UNLOCKS real computed
  clinical scores that REPLACE the currently-fabricated bedside
  SOFA/EWS numbers (the F8-recorded drift — SOFA/EWS/severity/organs on
  the roster are still demo snapshots in staging / synthesized defaults
  for fresh patients).
  - **The engine (not SOFA-specific code)**: a generic Clinical Scoring
    Engine with SOFA as its FIRST score; qSOFA / APACHE II / NEWS2 /
    SAPS II / custom scores plug in later as score *definitions*, not
    re-architecture — MIRRORS THE OBSERVATION TYPE CATALOGUE PATTERN
    (generic, data-driven, extend by adding a definition). A score is
    its declared inputs (observations/labs/medications via the
    canonical reads, never forks/mocks) + per-component rules +
    aggregation.
  - **Locked principles (safe to decide now, independent of data
    sources)**: P1 missing data is NEVER assumed normal → the score is
    shown INCOMPLETE with the uncomputable components flagged (assuming
    0 understates severity — unsafe); P2 latest value within a defined
    recency window, never stale — nothing in window = missing (→ P1);
    P3 always total + per-component breakdown (Resp/Coag/Cardio/CNS/
    Renal for SOFA — the number alone isn't useful); P4 trend retained
    (ΔSOFA is more meaningful than a point value); P5 computed at
    render, NEVER stored (the Net Balance / GCS Total discipline — a
    correction to an underlying observation/lab flows through
    automatically); P6 replaces the fabricated bedside SOFA/EWS, showing
    INCOMPLETE rather than a fabricated or falsely-complete number; P7
    clinical validation REQUIRED before any computed score informs care
    ("approximately right" is not acceptable for a severity score — the
    rules are specified by the clinician, not generated).
  - **THE SEQUENCING DECISION (validator's judgment) — the detailed
    SOFA scoring rules are DELIBERATELY DEFERRED**: SOFA depends on data
    that isn't fully built (vasopressor doses from the finished MAR/med
    module; PaO₂/FiO₂ + ventilation status from the Ventilator module +
    ABG/lab integration; lab values from complete/connected Labs).
    Specifying SOFA's thresholds and input-mappings against incomplete
    sources would risk rework. **Correct project sequence: (1) Print
    system — DONE (13/13); (2) finish Labs and connect them; (3) finish
    the Ventilator module + ABG; (4) THEN build the Scoring Engine with
    SOFA's detailed spec on complete, real, integrated data sources.**
    §4 of the design (the 6 organ-system thresholds, the vasopressor/
    PaO₂-FiO₂/lab-input mappings, the recency-window lengths, the
    worst-in-window-vs-current-latest question, and input-availability
    verification against real code — as was done for the MAR admin data)
    is specified with the validator when step 4's prerequisites exist.
    Consistent with Aurora's discipline of not building on incomplete
    foundations. Nothing is built now — this is the recorded engine
    architecture + locked principles only.

- **Lab Result-Entry — future items (recorded 2026-07-13).** Source: the
  clinical validator's Lab Result-Entry design (`LAB_RESULT_ENTRY_DESIGN.md`,
  §8/§10). The manual documentation path is BUILT (see "Lab Result-Entry
  (Documentation) path (built)" above); these three are deliberately deferred,
  and one honest limitation is recorded:
  - **LIS integration — the future automated feed (Scenario C Integration
    Layer).** A Laboratory Information System exists as a SEPARATE system;
    integrating it would *replace* manual transcription with an automated
    feed. This is exactly the "manual now, integrate later" pattern of the
    ventilator Device Adapter: the manual path is built and made
    integration-ready. LIS-fed results become a SECOND `source` value of the
    same lab-result object (`source` was built now precisely for this — it is
    not a rebuild, it is a new source of the same record). Record under the
    Integration Layer / this Known-Feature-Gaps list.
  - **LIS test-list import (Custom Lab Test design Option C).** Importing test
    *definitions* from the LIS test list — a future piece of the same LIS
    integration (Scenario C). It would let a catalogue-absent test be picked
    from the LIS's own list instead of typed free-hand; LIS-sourced test
    definitions become a future source, the same "manual now, integrate
    later" pattern. The Custom / Other free-text path is BUILT (see "Custom /
    Other Lab Test entry (built)"), and its unstructured-result model does not
    preclude this. Option B (permanent catalogue tests with flagging-driving
    ranges) stays deliberately DROPPED for safety — not deferred, not built.
  - **ABG analyzer auto-feed.** Like the ventilator Device Adapter, a future
    automated feed from the bedside blood-gas analyzer (manual entry via the
    lab-entry screen now — ABG is entered as a lab panel, so SOFA's PaO₂
    enters through this path).
  - **Coded analyte identity (LOINC-style).** Analytes are display strings
    today; the documentation path's panel-membership check is a NAME match.
    A coded system is worth settling before any future scoring join (it
    affects the join between a documented lab value and a score's declared
    input — flagged by the data-source assessment, noted by the design §10).
  - **Honest limitation (not a gap to close blindly): flag granularity.** The
    lab catalogue models a SINGLE reference range per analyte, so the manual
    documentation path derives normal vs abnormal only — a `critical` grade
    would need critical-threshold data the catalogue does not carry. Recorded
    so a future catalogue enrichment (critical thresholds) is a conscious
    addition, consistent with the flag-don't-fabricate discipline.

## Known Deferred Debt (documented, intentionally not yet unified)
- `panels.ts` attaches the same VENTILATOR/HEMODYNAMICS/INFUSIONS/
  PATIENT_ALERTS/GOALS to every patient — vent/hemo/infusions are now
  formally governed by the "Stage 11 — Interchangeable Clinical Data
  Sources" rule above (Observation model, Manual/Device/Hybrid); alerts
  still await the structured alert model (architecture rule 5). Stage 11
  scope — do not touch before then.
  *[SUPERSEDED IN PART by §12 step 4 (2026-07-13): the VENTILATOR and
  HEMODYNAMICS halves are RESOLVED — deleted from panels.ts and
  projected from real Observations. What remains mock in panels.ts is
  INFUSIONS/PATIENT_ALERTS/GOALS (device/orders integration, the
  structured alert model, care plans — separate future domains), still
  compiled out of production, still the reason Mission Control's
  production arm refuses (the F10 gate, lifting progressively).]*
- Infusion channels (`panels.ts` INFUSIONS) overlap active continuous
  medication orders (Screen 5) — post-Stage-11, derive infusions from active
  med orders + pump data arriving as Observations per the Stage 11 rule
  above.
- DW "Notes Due" queue (`workspace.ts` ACTION_QUEUES.notes) is workspace-local —
  should become a state of the ClinicalNote domain (a due note = one not yet
  written) when note authoring gets built.

## PR history

*[Attributed addition — compiled from `git log --merges --first-parent` on
main at the split commit (9ac4624); branch names are the record. Each PR's
substance is documented in the sections above.]*

| PR | Branch |
|---|---|
| #45 | claude/layer4-labcatalog-ordersets |
| #44 | claude/docs-formulary-authority |
| #43 | claude/formulary-suite-env |
| #42 | claude/layer4-formulary |
| #41 | claude/docs-gate-experiment |
| #40 | claude/orders-suite-absent-implement |
| #38 | claude/probe-renderyaml-sync |
| #37 | claude/gate-tree-equality |
| #36 | claude/gate-server-context |
| #35 | claude/docs-single-environment |
| #34 | claude/fix-orders-suite-oid |
| #33 | claude/state-conflict-409 |
| #32 | claude/results-unack-create |
| #31 | claude/docs-order-state-machine |
| #30 | claude/orders-encounter-scoping |
| #29 | claude/ci-evidence-hardening |
| #28 | claude/docs-ci-evidence-audit |
| #27 | claude/layer3-user-admin |
| #26 | claude/docs-labs-e2e-spent |
| #25 | claude/layer2-adt-core |
| #24 | claude/database-persistence-postgres |
| #23 | claude/aurora-core-server-relocation |
| #22 | claude/docs-aurora-core-platform-direction |
| #21 | claude/fix-ai-e2e-deploy-gate |
| #20 | claude/stage-10-phase-3-ai-api |
| #19 | claude/fix-mar-e2e-workflow |
| #18 | claude/stage-10-phase-3-timeline-api |
| #17 | claude/stage-10-phase-3-mar-api |
| #16 | claude/frequency-validation |
| #15 | claude/orders-request-validation |
| #14 | claude/stage-10-phase-3-orders-api |
| #13 | claude/post-phase3-roadmap-docs |
| #12 | claude/stage-10-phase-3-labs-api |
| #11 | claude/stage-10-phase-2-auth |
| #10 | claude/stage-10-phase-1-roster-api |
| #9 | claude/stage-9-login-rbac |
| #8 | claude/stage-11-observation-rule |
| #7 | claude/cleanup-shared-scaffold |
| #6 | claude/screen-8-ai-assistant |
| #5 | claude/consolidate-patient-roster |
| #4 | claude/screen-7-timeline |
| #3 | claude/screen-6-lab-imaging |
| #2, #1 | claude/vite-react-scaffold-routing-7t8hps |
