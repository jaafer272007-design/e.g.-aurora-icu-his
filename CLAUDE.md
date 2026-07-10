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
    30-day free-DB expiry documented), Layer 2 ADT DONE in Aurora
    Core (/admissions + /discharges screens live; roster = derived view
    over open encounters), and Layer 3 user administration DONE in Core
    Identity (/admin/users; escalation safeguards + immutable audit) —
    next is Layer 4 master data in Core — see "Stage 10 — API
    Integration" below
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
| Administrator        | admin.view, patients.view, users.manage | /admin |
| Pharmacist           | patients.view, orders.view, results.view (view-only) | /beds |
| RespiratoryTherapist | patients.view, orders.view, results.view, ai.view (view-only) | /beds |
| Ancillary            | patients.view, orders.view, results.view, results.create | /beds |
| AlliedHealth         | patients.view, results.view (view-only) | /beds |

Route guards: /workspace = orders.sign · /nurse = meds.administer ·
/admin = admin.view · /admin/users = users.manage (Layer 3) ·
/beds & /patients & /timeline = patients.view ·
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
  action, not misuse — makes the order create fail (since the
  encounter-scoping fix: 409 "no open encounter" at the
  EncounterGuard chokepoint; before it: validation 400) and all three
  suites fail from then on. The fix is for each suite to admit its own
  patient first, as the ADT suite already does (and the
  encounter-scope suite now does); it rides with the next touch of
  each suite.
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
  demoted (400); (5) granting a CLINICAL JobTitle (any title deriving
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
  self/last-admin guards are each a precise 400; unknown account 404).
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
Repairs the patient-safety defect found live: ORD-113 stayed ACTIVE on
the discharged P-1017 (discharge never touched orders; a readmission
would resurface the previous admission's actives; the MAR inherited the
defect). **The forward invariant ("orders require an admitted patient")
and the backward one ("an admission's orders end when the admission
ends") are ONE RULE: an order's lifecycle is bounded by its ENCOUNTER.**
- **`encounterId` on orders** alongside patientId (migration
  `AddOrderEncounterScope`; wire contract gains the field — the ONLY
  delta, byte-parity verified on everything else). The aggregate root
  is Patient → Encounter → {Orders, MAR, …}.
- **ONE chokepoint, not scattered conditions**: `EncounterGuard`
  (`server/Core/Adt/`) asserts the encounter is open on EVERY
  clinical-initiation path — order create, sign, modify, implement,
  dose administration, and (since the results audit PR) lab/imaging
  RESULT creation; consult REQUEST writes join it when that path
  exists. Blocking is RESOURCE STATE, not validation
  and not permission — the answer is **409 Conflict** with a precise
  `{error}`, never 400/403/404 (a Consultant with full authority is
  equally blocked). The administer guard sits BEFORE the dose lookup so
  closed-encounter is always 409, never masked as a 404.
- **THE INVARIANT IS DELIBERATELY NARROW — a closed encounter is NOT
  immutable**: you cannot initiate new care on a closed episode; you
  MUST still be able to complete the record of care already given.
  Explicitly exempt (never routed through the guard, tested): result
  acknowledgment AND its audited reversal (both asserted 200 on a
  discharged patient — live, since the results audit PR), note
  authoring/addenda, the discharge summary, audited amendments, and
  manual discontinue of a stray order (closing out the record is not
  initiating care). Creating a NEW result is initiating care and IS
  guarded (the asymmetry — see "Result un-acknowledgment + result
  creation (built)").
- **The order STATE MACHINE on a closed encounter (the general form of
  the narrow invariant)**: an order may only move TOWARD a terminal
  state — never be acted upon or activated. administer, sign, modify,
  implement → 409; discontinue → 200. "You cannot initiate new care on
  a closed episode, but you must still complete the record of care
  already given" is the clinical statement of this rule; the state
  machine is its mechanical statement. It is also why the discharge
  cascade and the migration backfill are COHERENT with the invariant
  rather than exceptions to it: both only move orders toward a
  terminal state (discontinued) — they take the one transition the
  closed encounter permits, which is why they need named paths for
  their audit semantics but no bypass of the guard's rule.
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
  (documented in the workflow header with reasons): sign/modify/
  implement 409s (unreachable live — the cascade removes their
  preconditions; proven against SQL-injected specimens on a closed
  encounter) and acknowledge-on-closed-encounter → 200 (live would
  discharge a seeded patient and break the auth suite's roster
  subset assert).
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
  "replayed acknowledge → 404" behavior). KNOWN remaining 404-where-state
  sites (recorded, ride with the next touch of each): orders sign/modify/
  discontinue/implement fold status into their lookups (a replayed
  discontinue or sign of a completed order → 404), and the MAR's
  re-document of a non-scheduled dose → 404; ADT/Users state conflicts
  use 400 with precise errors (pre-convention, deliberate then).
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
- **THE ENCOUNTER RULE IS ASYMMETRIC HERE — the crux**: CREATING a
  result is initiating care → EncounterGuard, 409 on a closed episode.
  ACKNOWLEDGING and UN-ACKNOWLEDGING are completing the record of care
  already given → they MUST succeed on a closed encounter (the day-3
  blood culture that results on day 7, after discharge). The guard is
  NEVER called on the ack/un-ack paths, and the suite asserts both
  directions LIVE (it can now: the results belong to the suite's own
  admitted-then-discharged patient, so no seeded patient is touched).
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
   deactivate accounts, password reset): DONE — built in AURORA CORE
   (`server/Core/Identity/UsersApi.cs` + `/admin/users`; see "Layer 3 —
   User Administration (built)" above); ties to the Administrator
   profile via the new `users.manage` permission and its `/admin`
   landing screen; supersedes the Phase 2 "no registration/reset flow
   yet" note (admin-managed exists; SELF-SERVICE still does not).
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
persistence (Postgres + migrations), **Layer 2 ADT (Aurora
Core-native Patient/Encounter/Bed with the roster seam's
identity/location half dissolved)**, and **Layer 3 (user
administration in Core Identity, escalation safeguards + immutable
audit)**, and **the encounter-scoping fix (the ORD-113 defect — an
order's lifecycle is bounded by its encounter; see the section
above)** are DONE. **The next step is Layer 4 (master data /
formulary) in Core** → the deferred Print Center → Stage 11 (device
integration + the Observation model per the locked rule above; Stage
11 also absorbs the remaining bedside-snapshot half of the roster).
The full architectural review + Core-extraction inventory ran before
the relocation and resolved the domain-relocation open question as (a).

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

**CODIFIED RULE — a skipped check and a passed check are visually
identical.** A run whose gated jobs are skipped still concludes SUCCESS
and shows green on the commit. Green CI is NOT evidence unless the job
carrying the assertions actually EXECUTED — before treating any check as
evidence (in review, in a verification report, in "CI is green"), open
the run and confirm the asserting job ran and reached its assertion
steps. The same rule covers local commands (a command that can exit 0
without evaluating anything is not a check) and two corollaries:
ABSENCE of a check is equally silent (manual-dispatch suites produce
evidence only when someone dispatches them), and an assertion whose
failure is swallowed by its surrounding construct (`cmd && echo` lists,
`read VAR <<<"$(…assert…)"`) gated nothing.

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
  non-deployed ref now correctly fails.
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
feature, not test reset. **The next step is master data (Layer 4) in
Core**,
then the Print Center, then Stage 11 device + AI integration per the
locked rules above (Stage 11 also absorbs the roster's remaining
bedside-snapshot columns). The Timeline's four still-mock sources
(Consults/Notes/Nursing/I&O) migrate with that later work, not Phase 3.
