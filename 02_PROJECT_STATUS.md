# 02_PROJECT_STATUS — Aurora HIS: the changing record

**Last updated: 2026-07-11 · current through the print live-verification
PR — the deployed Discharge Summary now RENDER-VERIFIED for a discharged
patient on the live Pages site (a stale-Pages-deploy live finding fixed;
`/build.txt` frontend stamp; twelfth suite `deployed-print-e2e.yml`
renders documents headlessly behind server + Pages freshness gates).
Previous milestones: patient-identity read (PR #51 — both
Print-Center-recorded open questions resolved, now including the live
render), Print Center Foundation Phase 1 (PR #50), safety enforcement
(PR #46). Next: environment separation — a design proposal
(`docs/design/environment-separation.md`) is authored and awaiting
project-owner approval before any implementation; the remaining Print
Center templates follow.**

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
   `docs/design/environment-separation.md` (test + production tiers,
   staging deferred with a stated no-rework path; separate PostgreSQL /
   JWT secret / Render service / seeds; git-based promotion via an
   explicit `production` branch; boundary matrix with ≥2 locks per
   crossing; environment identity in `/healthz` and `build.txt` asserted
   by every suite before write legs). NOTHING is implemented — no code,
   config, or service changes ship with the proposal; implementation
   starts only after approval.]*
3. Print Center
   *[2026-07-11 per project owner: the Print Center FOUNDATION (Phase 1 —
   rendering architecture + the first three templates) was pulled forward
   ahead of environment separation — see "Print Center Foundation —
   Phase 1 (built)" above. The remaining TEN templates ride later PRs on
   that foundation; environment separation remains queued.]*
4. Stage 11 — device integration + the Observation model (per the locked
   rule in 01_ARCHITECTURE.md; absorbs the roster's remaining
   bedside-snapshot columns)
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
