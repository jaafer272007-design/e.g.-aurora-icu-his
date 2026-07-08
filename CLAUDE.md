# AURORA ICU — Adult ICU Mission Control (HIS Module)

## Goal
Best-in-class Adult ICU UI + workflow inside a Hospital Information System:
fast decisions, low cognitive load, easy for doctors/nurses, ready to wire to
real APIs and medical devices later.

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
7. Timeline — ✅ built, formal review pending (`/timeline/:patientId`, read-only aggregated feed derived from the canonical stores — no store of its own; MC timeline card reads the same feed; minimal ClinicalNote model added for freeform notes)
8. AI Clinical Assistant — ✅ built, formal review pending (`/ai` unit ranking + `/ai/:patientId`, canonical AI risk model — MC AI panel + alert-center risk alerts read derived views; all predictions simulated until Stage 11)
9. Login / Role-Switch screen — ✅ built (`/login`, three-layer RBAC below; real username+password auth added in Stage 10 Phase 2, Stage 9 local session kept as the offline fallback)
10. API Integration (ASP.NET Core Web APIs) — 🔄 in progress: Phase 1
    (roster/patients) + Phase 2 (authentication) built — see "Stage 10 —
    API Integration" below
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
| Doctor               | patients.view, orders.view, orders.create, orders.sign, orders.modify, orders.discontinue, results.view, results.acknowledge, notes.document, ai.view | /workspace |
| Nurse                | patients.view, orders.view, orders.implement, meds.administer, notes.document, results.view, ai.view | /nurse |
| Administrator        | admin.view, patients.view | /admin |
| Pharmacist           | patients.view, orders.view, results.view (view-only) | /beds |
| RespiratoryTherapist | patients.view, orders.view, results.view, ai.view (view-only) | /beds |
| Ancillary            | patients.view, orders.view, results.view (view-only) | /beds |
| AlliedHealth         | patients.view, results.view (view-only) | /beds |

Route guards: /workspace = orders.sign · /nurse = meds.administer ·
/admin = admin.view · /beds & /patients & /timeline = patients.view ·
/orders = orders.view (mutating UI additionally needs the prescriber
permissions) · /labs = results.view · /ai = ai.view. A session lacking a
route's permission gets an explicit Access Restricted state (never a
silent redirect); no session → /login. The `?as=nurse` dev preview is
retired — the login screen replaces it.

## Canonical Data Domains (mock stores in src/lib/api/data — each maps to a future ASP.NET Core service)
- `roster.ts` — patient identity, location, and bedside state (ONE record per
  patient). Bed board, MC roster/detail, DW rounding list, and NW assignment
  are all derived views; assignments/panels store patient IDs only.
  Orders/results/consults keep denormalized name/bed DISPLAY snapshots by
  design (audit records) but never redefine identity.
- `orders.ts` — orders & medications incl. full audit history + MAR (Screen 5)
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
/server, deployable via render.yaml. Next: later Stage 10 phases —
remaining domains one at a time with server-side permission enforcement
(Phase 3+), then Stage 11 device + AI integration per the locked rules
above.
