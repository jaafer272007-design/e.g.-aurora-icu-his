# AURORA ICU — Adult ICU Mission Control (HIS Module)

## Goal
Best-in-class Adult ICU UI + workflow inside a Hospital Information System:
fast decisions, low cognitive load, easy for doctors/nurses, ready to wire to
real APIs and medical devices later. AURORA ICU is the FIRST MODULE of the
broader Aurora HIS platform — see "Platform Direction — Aurora Core +
Modules" below.

## Build Methodology (follow in order, do not skip)
1. UI only, dummy data, HTML/CSS/JS first (already done for screens 1–3 —
   see /reference, treat as the exact visual spec, do not redesign).
2. Convert to a real Vite + React + TypeScript project. Extract shared
   tokens/components once — never re-derive per screen.
3. Review each screen against: UX, ease of use for doctor/nurse, fit with
   real ICU workflow, API-readiness, performance/code organization.
4. Only after a screen is approved, move to the next one in the roadmap.
5. Mock data adapters must be shaped exactly like a future real API response
   (field names, nesting) so swapping in ASP.NET Core endpoints later is a
   data-layer change only, never a UI rewrite.
6. No real API, no auth, no backend until Stage 9 below.

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
    30-day free-DB expiry documented), and Layer 2 ADT DONE in Aurora
    Core (/admissions + /discharges screens live; roster = derived view
    over open encounters) — next is Layer 3 user administration in Core
    — see "Stage 10 — API Integration" below
11. Medical device integration (ventilators, monitors, lab) + AI

## Architecture Rules (binding for all future screens)
See `docs/architecture.md` — production-grade HIS rules: stable PatientID for all
routing/lookups (bed = location only), separated domain models, service-layer
data access, independent reusable components, real-time-ready design, structured
alert/device models. Apply incrementally; don't wholesale-refactor existing code.

## RBAC (Stage 9) — three-layer permission model (PROVISIONAL)
User → Role (JobTitle) → PermissionProfile → Permissions. Roles are NEVER
bound to permissions directly. Profile and permissions are ALWAYS computed
from the JobTitle at read time via lookup (`src/lib/session.ts`) — never
stored redundantly (same rule as clock-computed states). The session stores
ONLY `{ name, jobTitle, token? }` in sessionStorage (survives refresh,
tab-scoped) — `token` is the JWT from Stage 10 Phase 2 authentication;
it adds server-verified identity but permissions are NEVER read from it
client-side. When the auth API is unreachable/unconfigured, login falls
back to the Stage 9 LOCAL session (no token, password not verified,
console-logged). Service-layer adapters re-enforce permissions (defense in
depth); server-side permission enforcement per endpoint is Stage 10
Phase 3+ scope. Finer-grained permissions per profile come in a later
stage — these tables are provisional.

JobTitle → PermissionProfile:
| PermissionProfile    | JobTitles |
|---|---|
| Doctor               | Consultant, Specialist, Senior Resident, Resident, Intern |
| Nurse                | Staff Nurse, Charge Nurse, Head Nurse |
| Pharmacist           | Pharmacist, Clinical Pharmacist |
| RespiratoryTherapist | Respiratory Therapist |
| Ancillary            | Laboratory Technician, Radiology Technician |
| AlliedHealth         | Physiotherapist, Dietitian |
| Administrator        | Hospital Administrator, IT Administrator, Receptionist, Billing Officer, Medical Records Officer |

PermissionProfile → Permissions (and Dashboard landing view):
| Profile | Permissions | Landing |
|---|---|---|
| Doctor               | patients.view, orders.view, orders.create, orders.sign, orders.modify, orders.discontinue, results.view, results.acknowledge, notes.document, ai.view, adt.admit, adt.discharge | /workspace |
| Nurse                | patients.view, orders.view, orders.implement, meds.administer, notes.document, results.view, ai.view, adt.transfer | /nurse |
| Administrator        | admin.view, patients.view | /admin |
| Pharmacist           | patients.view, orders.view, results.view (view-only) | /beds |
| RespiratoryTherapist | patients.view, orders.view, results.view, ai.view (view-only) | /beds |
| Ancillary            | patients.view, orders.view, results.view (view-only) | /beds |
| AlliedHealth         | patients.view, results.view (view-only) | /beds |

Route guards: /workspace = orders.sign · /nurse = meds.administer ·
/admin = admin.view · /beds & /patients & /timeline = patients.view ·
/orders = orders.view (mutating UI additionally needs the prescriber
permissions) · /labs = results.view · /ai = ai.view · /admissions &
/discharges = patients.view (the admit action additionally needs
adt.admit; discharge needs adt.discharge; transfer needs adt.transfer —
profiles never see buttons they cannot use). A session lacking a
route's permission gets an explicit Access Restricted state (never a
silent redirect); no session → /login. The `?as=nurse` dev preview is
retired — the login screen replaces it.

## Canonical Data Domains (mock stores in src/lib/api/data — each maps to a future ASP.NET Core service)
- `roster.ts` — patient identity, location, and bedside state (ONE record per
  patient). Bed board, MC roster/detail, DW rounding list, and NW assignment
  are all derived views; assignments/panels store patient IDs only.
  Orders/results/consults keep denormalized name/bed DISPLAY snapshots by
  design (audit records) but never redefine identity.
- `orders.ts` — orders & medications incl. full audit history + MAR (Screen 5).
  MAR rows are a DERIVED view over the orders' administrations (no store of
  their own) — real since Stage 10 Phase 3 MAR, reading the real Orders data.
- `results.ts` — lab draws + imaging studies incl. acknowledgments (Screen 6)
- `consults.ts` — consult requests, shared by DW and Timeline
- `notes.ts` — ClinicalNote (progress/nursing/procedure/vent): freeform notes
  tied to no structured store action (introduced with Screen 7; 'vent' notes
  stand in until Stage 11 device events)
- `nursing.ts` — nursing tasks + I&O entries (writes go through the service
  layer, never page-local state)
- `ai.ts` — AI risk predictions (Screen 8): per-patient category risks with
  q15min history, factors, advisory suggestions. SIMULATED until Stage 11;
  trend/elevation computed at read time; threshold crossings feed the
  existing alert center (MC Smart Alerts), never a separate alert list.
- Derived-only, never stored: Timeline feed (`timeline.ts`), MAR rows,
  results inbox, MC lab-trend card, rounding/assignment patient views.

## Stage 11 — Interchangeable Clinical Data Sources (locked architecture rule)
Every clinical observation — vitals, ventilator settings/readings,
hemodynamics, infusion pumps, dialysis/CRRT, temperature, urine output —
must eventually support three interchangeable sources: **Manual / Device /
Hybrid**, expressed through ONE Observation model:

```
Observation {
  value, unit,
  source: 'manual' | 'device' | 'hybrid',
  deviceId?,            // set when source involves a device
  capturedAt,           // when the value was measured
  recordedBy,           // who entered/accepted it into the record
  verifiedBy?,          // clinician verification of a device value
  isOverridden,         // a manual override exists
  overrideValue?, overrideReason?,
}
```

Rules:
- Data flows ONE way: Device Adapter → Observation Service → Clinical
  Store → derived views. Devices NEVER write directly to UI state.
- A manual override NEVER destroys the device reading — the original
  device value is always preserved alongside `overrideValue` /
  `overrideReason`, with `isOverridden` flagging the record.
- This supersedes and formalizes the `panels.ts` deferred-debt entry
  below (the identical per-patient vent/hemo/infusion data is exactly
  what the Observation model replaces).
- Implementation is Stage 11 scope, NOT before — do not build the
  Observation model or touch `panels.ts`, vitals, ventilator,
  hemodynamics, or infusion code until then.

## Known Deferred Debt (documented, intentionally not yet unified)
- `panels.ts` attaches the same VENTILATOR/HEMODYNAMICS/INFUSIONS/
  PATIENT_ALERTS/GOALS to every patient — vent/hemo/infusions are now
  formally governed by the "Stage 11 — Interchangeable Clinical Data
  Sources" rule above (Observation model, Manual/Device/Hybrid); alerts
  still await the structured alert model (architecture rule 5). Stage 11
  scope — do not touch before then.
- Infusion channels (`panels.ts` INFUSIONS) overlap active continuous
  medication orders (Screen 5) — post-Stage-11, derive infusions from active
  med orders + pump data arriving as Observations per the Stage 11 rule
  above.
- DW "Notes Due" queue (`workspace.ts` ACTION_QUEUES.notes) is workspace-local —
  should become a state of the ClinicalNote domain (a due note = one not yet
  written) when note authoring gets built.

## Locked Decisions (do not re-litigate without asking)
- RBAC: Doctor = full order/medication authority. Nurse = administer +
  document only, cannot originate orders.
- Orders & Medication / Lab & Imaging / Timeline are standalone routed
  screens, not drill-down panels inside Patient Mission Control.
- Nav: the sidebar "Dashboard" item is role-personalized — it resolves to
  the signed-in profile's landing view (see the RBAC tables above);
  implemented at Stage 9 via the local session.
- Doctor Workspace's quick-order drawer stays lightweight (free text +
  quick-set bundle shortcuts, no drug formulary) — do not expand it. Full
  medication ordering (searchable formulary, dose/route/frequency,
  allergy/interaction checking against the patient's allergy field) is
  Screen 5 (Orders & Medication) scope, built after Nurse Workspace.
- An ID in a URL that doesn't resolve (patient, order, …) must render an
  explicit "not found" state with a route back (see Mission Control's
  Patient Not Found card) — never redirect to or display another record's
  data. Applies to Nurse Workspace and every future screen that resolves
  an ID from a URL.
- Branching: every new screen starts from a fresh branch off the latest
  main with its own PR. Never continue building the next screen on a
  branch that already has an open PR — one screen (or fix-set) per PR.
- Time-relative states (OVERDUE/DUE for tasks, meds, etc.) are computed
  against the current clock at render time — never stored in data.

## Design System (extract into src/styles/tokens.css, reuse everywhere)
Dark medical theme, glassmorphism, background `#060b13`.
Colors: blue `#4da3ff`, cyan `#35e0d0`, green `#3de8a0`, amber `#ffb454`,
red `#ff5d6c`, violet `#a78bfa`. Severity mapping is fixed system-wide:
red = critical, amber = high, green = stable — never reassign.
Fonts: sans `-apple-system,"SF Pro Display","Segoe UI",Inter,Roboto,Arial`;
mono for all clinical/numeric values `"SF Mono","Cascadia Mono","JetBrains Mono",ui-monospace`.
Card radius 18px, `1px solid rgba(130,170,230,.13)` border, blur 14–18px,
shadow `0 12px 34px rgba(0,0,0,.38)`.
Shared components to build once and reuse: Card, Badge/Tag, SeverityDot
(pulses on critical), VitalTile, Sparkline, AlertRow, KpiPill, NavSidebar,
AppHeader, PatientRail, PatientBar, NotFoundCard (the locked not-found
pattern lives in ONE component).

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
- **CORS**: explicit allowlist only — the GitHub Pages origin
  (`https://jaafer272007-design.github.io`) + local dev/preview ports;
  override via `CORS_ORIGINS` (semicolon-separated). GET + POST.

### Phase 2 — authentication (built)
- **Users table** (same SQLite DB): the SAME 20 staff as the Stage 9
  preset list. `server/Data/users-seed.json` is GENERATED from
  `src/lib/session.ts` (`SAMPLE_STAFF` + `usernameOf`, e.g.
  "Dr. Sara Rahman" → `sara.rahman`) — never hand-edit it. Only bcrypt
  hashes are stored (work factor 10, one salt per user), never plaintext.
- **Demo credential — NON-PRODUCTION**: all 20 accounts share the password
  `Aurora2026!` (override via `DEMO_PASSWORD` env). No registration or
  password-reset flow exists yet. This is a documented prototype
  simplification only.
- **`POST /api/auth/login`** (anonymous): username OR full display name +
  password → `{ token, name, jobTitle }`. Any failure returns the SAME
  generic 401 `{"error":"Invalid credentials"}` — never reveals whether
  the username or password was wrong (an unknown user still runs a bcrypt
  verify against a decoy hash so timing doesn't leak either).
- **JWT**: HS256, claims `sub` (username), `name`, `jobTitle`, 12 h expiry
  (one shift). Signing key = `JWT_SECRET` env (render.yaml generates it);
  unset → random per-boot key (tokens just expire on service restart —
  acceptable for the demo, no secret in the repo). Validation middleware
  is registered once; endpoints opt in with `.RequireAuthorization()` —
  currently ONLY `GET /api/icu/patients` (Phase 3 endpoints adopt the
  same line). `/healthz` and login stay anonymous.
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
  Replayed acknowledge → 404. Client `hasPermission` checks remain as
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
  stays bounded free text until Layer 4 makes it formulary-driven.
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
  Given needs none. Re-documenting a non-scheduled dose → 404. Malformed
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
- **Provider**: `DATABASE_URL` set → PostgreSQL (`UseNpgsql`); the
  render.yaml blueprint defines the `aurora-db` free database and wires
  the connection string into the service env — it exists ONLY in Render's
  environment, never the repo. `DATABASE_URL` unset → the ORIGINAL
  ephemeral SQLite demo mode (rebuild + reseed every boot), retained only
  so a plain local `docker run` still works; the boot log warns LOUDLY.
- **Migrations, generated ONCE in the final namespaces**
  (`Aurora.Core.Persistence.Migrations` — the reason relocation came
  first: the ModelSnapshot embeds namespace-qualified CLR names). Boot =
  `Database.Migrate()` + the existing seed-if-empty blocks (idempotent
  per table). Schema changes are new migrations from here on — never a
  reseed. `EnsureDeleted`/`EnsureCreated` survive only in the SQLite demo
  path.
- **Collation parity (review risk #1, verified)**: SQLite orders strings
  by raw bytes; Postgres by locale. The only DB-side ORDER BYs on string
  columns — `PatientId`, `LabId`, `StudyId` — are pinned to collation
  "C" (byte order) via the project's first fluent config (`AuroraDb.
  OnModelCreating`, Npgsql-guarded); inbox/timeline/AI-ranking sorts are
  in-memory and unaffected. Verified by a full-surface byte diff of
  SQLite-old vs Postgres-new (~100 checks, zero diffs).
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
- **The labs acknowledge leg is SPENT (post-#25 live validation,
  2026-07-09)**: every seeded unacked lab on the durable DB has been
  acknowledged by prior runs, so `deployed-labs-e2e.yml` now stops at its
  designed loud-failure assert ("no unacknowledged labs remain on the
  persistent DB"). This is EXPECTED behavior, not a regression — all
  read-side steps (401s, seeded reads, CORS, imaging) still pass. The
  assert's own advice "extend the seed set" CANNOT fix it: the
  seed-if-empty blocks skip non-empty tables, so new seed entries never
  reach the existing live DB. Accepted as-is for now; do NOT reset the
  live database to revive it (that destroys all durable writes). The
  real fix is a FUTURE PR adding a genuine un-acknowledge or lab-order
  creation capability — note that un-acknowledging a result is a real
  CLINICAL action with audit implications (who reversed it, why, the
  original acknowledgment preserved — same never-destroy principle as
  the Stage 11 override rule), so it must be designed as a feature,
  never bolted onto the test suite.
- **Codified rule — finite seeded resources**: an E2E suite that
  CONSUMES a finite seeded resource is not idempotent against a durable
  database, no matter how careful the picking logic — the well
  eventually runs dry. Future suites must either CREATE the resources
  they consume (MAR/Timeline/Orders create their own orders; ADT admits
  and discharges its own patient) or assert READ-SIDE ONLY (auth, AI).
  Audit of the other six suites (2026-07-09): none consumes a finite
  seed. One related latent exposure — see the WARNING below.
- **WARNING — discharging P-1001 or P-1007 breaks three E2E suites**:
  the MAR, Timeline, and Orders deployed suites create orders against
  the SEEDED patients P-1001 and P-1007 and therefore depend on those
  patients having an OPEN ENCOUNTER. Since Layer 2, discharging either
  patient through the live Discharges screen — a LEGITIMATE user
  action, not misuse — makes the order create return 400 ("orders
  require an admitted patient") and all three suites fail from then
  on. The fix is for each suite to admit its own patient first, as the
  ADT suite already does; it rides with the next touch of each suite.
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

## Platform Direction — Aurora Core + Modules (agreed)
AURORA ICU becomes ONE MODULE of a broader Hospital Information System.
Rather than a single large Core-extraction refactor later, the Core grows
INCREMENTALLY: every new layer from now on (ADT, user administration,
master data, printing, …) is built inside Aurora Core from the start —
never ICU-shaped first and extracted afterwards.

Target structure:
- **Aurora Core** — Identity, ADT/Encounter, Master Data, Orders,
  Medication, MAR, Labs, Imaging, Timeline, Observations, Notes,
  Documents, Printing, Notifications, AI framework, API services.
- **Modules/** — ICU (everything built so far) plus future ER, OR, OPD,
  Wards, Oncology, NICU.
- **ICU-exclusive (stays in the ICU module)** — Ventilator, Hemodynamics,
  Intake & Output, ICU flowsheet, ICU daily goals, APACHE II, SOFA,
  sedation workflow, ICU dashboards.

**Open question — RESOLVED as (a) by the architectural review:** Orders,
Medication, MAR, Labs, Imaging, Timeline and AI were relocated to Core in
a dedicated BEHAVIOR-NEUTRAL PR — BEFORE the persistence fix, not after
it. The review corrected the original premise (there was no per-domain EF
config to migrate twice — one convention-based DbContext, zero fluent
config) but upheld the ordering on stronger grounds: (1) migrations
generated by the persistence swap embed namespace-qualified entity names,
so relocating afterwards would invalidate them; (2) the startup seed code
the swap rewrites is the same code the relocation moves; (3) the
reseed-on-boot regime the swap REMOVES was the strongest verification
harness the relocation would ever have (byte-known state + the idempotent
E2E suite); (4) ADT in Core depending on module-resident domains would
invert Core→Module.

**Relocation implementation (done):** same assembly (`AuroraIcu.Api`),
folders + namespaces only — the csproj split into separate Core/module
projects is DEFERRED until a second module exists. Until then the
Core→Module dependency direction is enforced by CONVENTION AND REVIEW
RULE, not the compiler. Structure:
- `server/Core/` — `Identity/` (auth, JWT, RBAC), `Orders/`, `Mar/`,
  `LabImaging/` (results — namespace avoids colliding with ASP.NET's
  `Results` class), `Timeline/`, `Ai/`, `Persistence/` (`AuroraDb` —
  renamed from RosterDb — + `Seeder`), `Shared/` (JsonOpts, ApiError).
- `server/Modules/Icu/Roster/` — the unit roster endpoint + PatientRow.
- `server/Program.cs` — composition root only (builder, CORS, JWT
  registration, seed invocation, endpoint-group Map calls).
Every `/api/icu/*` route string is byte-identical — the URL prefix on
Core domains is accepted historical cosmetics; renaming it would break
the deployed frontend and the E2E suite.

**The roster seam — identity/location half DISSOLVED at Layer 2:** ADT
re-founded Patient/Encounter in Core, and every former Core→roster read
site (order create's name/bed resolution + patientId validation, the AI
ranking's diagnosis join, timeline/AI patientId validation) now reads
Core ADT. The roster endpoint became a DERIVED view — open Encounters ⋈
Core Patient ⋈ the module's bedside snapshot — so the MODULE reads CORE
(the correct direction). WHAT REMAINS in `Modules/Icu/Roster/`: only the
ICU bedside snapshot columns (rhythm, SOFA, EWS, support flags,
bedside/monitor vitals, MAP trend, organs, LOS, code status), read by
the module alone; Stage 11 Observations absorb them and remove the
table. The Seeder still populates the bedside table from
roster-seed.json (the module's own data, not a Core read).

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
   deactivate accounts, password reset): built in AURORA CORE; ties to
   the existing Administrator profile and its `/admin` landing screen;
   supersedes the Phase 2 "no registration/reset flow yet" note.
4. **Layer 4 — Master/reference data** (drug formulary, lab test catalog,
   order sets as maintained DATABASE tables with a manual data-entry UI —
   not hardcoded frontend lists): built in AURORA CORE — the reference
   layer Pharmacy/Lab admins maintain. Orders & Medication then reads
   the formulary from here instead of the current hardcoded 19-drug list
   in `src/lib/api/data/formulary.ts`.

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
persistence (Postgres + migrations), and **Layer 2 ADT (Aurora
Core-native Patient/Encounter/Bed with the roster seam's
identity/location half dissolved)** are DONE. **The next step is Layer 3
(user administration) in Core** → Layer 4 (master data / formulary) in
Core → the deferred Print Center → Stage 11 (device integration + the
Observation model per the locked rule above; Stage 11 also absorbs the
remaining bedside-snapshot half of the roster). The full architectural
review + Core-extraction inventory ran before the relocation and
resolved the domain-relocation open question as (a).

## Accessibility — required on every screen from Screen 3 onward
(Screens 1–2 have known gaps — fix opportunistically when next touched)
- Touch targets ≥ 44×44px
- Visible `:focus-visible` ring on every interactive element
- `aria-label` on all icon-only buttons
- Never convey severity by color alone — pair with icon/text
- Contrast ≥ 4.5:1 body text, ≥ 3:1 large text

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
encounters. **The next step is Layer 3 (user administration) in Core**,
then master data (Layer 4) in Core, then the Print Center, then Stage 11
device + AI integration per the locked rules above (Stage 11 also
absorbs the roster's remaining bedside-snapshot columns). The Timeline's
four still-mock sources (Consults/Notes/Nursing/I&O) migrate with that
later work, not Phase 3.
