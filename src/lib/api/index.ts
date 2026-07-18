/* Mock API adapters.
   Each function mirrors a future ASP.NET Core endpoint (route noted per
   function) and resolves with the exact response shape the real endpoint
   will return. Replacing these bodies with `fetch` calls is the only change
   needed at API-integration time (Stage 10). */

import type {
  ActionQueuesResponse, AdministrationAction, AdmitDraft, AdmitResponse, AdtBed, AiQueryResponse, AssignableStaff, AssignedPatient, Assignment, AssignmentKind, CorrectIdentityDraft, BedsResponse, Consult, CorrectImagingDraft, CorrectLabDraft, CreateAssignmentDraft, CreateDrugDraft, CreateLabTestDraft, CreateUserDraft, DerivedUnitSummary, DispositionCode, DocumentCustomLabDraft, DocumentLabDraft, EditDrugDraft, EditLabTestDraft, EditUserDraft, Encounter, FormularyDrug, LabTest, MatchPatientDraft, MatchPatientResponse, MeasureDraft, OrderSetItemTemplate,
  DocumentImagingDraft, HandoffEntry, ImagingStudy, InteractionRule, IoEntry, LabDraw, Labs, Infusion, MarRow, MedicationDetails,
  NewIoEntry, NewObservationEntry, NewOrderDraft, NursingTask, ObsCatalogGroup, ObsEntryValue, Observation, Order, OrderSetDef,
  OrderSetsResponse, Patient, PatientDetailResponse, PatientIdentity, PatientSummary, ResultInboxItem,
  RosterRecordDto, RoundingPatient, TimelineEvent, UnassignedPatient, UnitSummaryResponse, UserAccount,
} from './types'
import { runtimeApiBase } from '../runtimeConfig'
import { composeBedsResponse } from './bedboard'
import { BEDS_RESPONSE, UNIT_SUMMARY, mockAdtBeds } from './data/beds'
import { allPatients, derivedAlertCount } from './data/patients'
import { ROSTER, rosterFor } from './data/roster'
import { GOALS, INFUSIONS, PATIENT_ALERTS } from './data/panels'
import { latestObservations, projectHemodynamics, projectVentilator } from './bedside'
import { ACTION_QUEUES, ORDER_SETS } from './data/workspace'
import { IO_ENTRIES, NURSING_TASKS, applyTaskToggle, insertIoEntry } from './data/nursing'
import { ASSIGNMENTS, applyAssignmentEnd, insertAssignment } from './data/assignments'
import { allConsults } from './data/consults'
import { deriveTimeline } from './data/timeline'
import { FORMULARY, INTERACTION_RULES, NAMED_FREQUENCIES, ORDER_SET_DEFS } from './data/formulary'
import { LAB_CATALOG } from './data/catalog'
import {
  allOrders, applyAdministration, applyDiscontinue, applyImplementation, applyModify,
  applySign, deriveMarRows, insertOrder,
} from './data/orders'
import {
  applyAcknowledgeImaging, applyAcknowledgeLab, applyUnacknowledgeImaging, applyUnacknowledgeLab,
  deriveMissionControlLabs, deriveResultInbox,
  imagingFor, labDrawsFor,
} from './data/results'
import { SAMPLE_STAFF, getSession, getToken, hasPermission, profileOf, usernameOf, type JobTitle } from '../session'
import { dayOffsetOf, nowHm, timestampMinutes } from '../time'

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))
const respond = <T>(payload: T, latencyMs: number): Promise<T> =>
  new Promise(resolve => setTimeout(() => resolve(clone(payload)), latencyMs))

/* ==================== §11 step 3 — the mock layer is ABSENT in production ====================
   Every mock/demo fallback in this module sits behind
   `if (import.meta.env.VITE_APP_ENV !== 'production')`. Vite statically
   replaces import.meta.env.VITE_APP_ENV at build time, so in a
   production bundle each guard is `if ("production" !== 'production')`
   — dead code the bundler eliminates together with the mock-store
   modules it references. Not disabled by a flag: NOT THERE (verified by
   bundle inspection, recorded in 02). A production data call that
   cannot be served REFUSES loudly instead: apiUnavailable() dispatches
   the event the full-screen overlay listens for (EnvironmentGate) and
   the call rejects — production can never quietly render demo data,
   because the demo data does not exist in the artifact. Domains that
   are STILL MOCK-ONLY (Stage 11 scope: unit summary, bedside panels,
   nursing tasks/IO, consults, notes, mission-control composite) refuse
   the same way in production until they become real. */
export class ApiUnavailableError extends Error {}
/* the LATCH (found by PR 1's production verification): on a DIRECT page
   load of a refusing route, React runs the route's effects BEFORE the
   parent EnvironmentGate's effect attaches its listener — the event
   fired into nothing and the screen rendered half-broken instead of
   refusing. The gate now also reads this latch on mount, so the refusal
   holds regardless of who ran first. */
let apiUnavailableLatched: string | null = null
export function apiUnavailableLatch(): string | null { return apiUnavailableLatched }
function apiUnavailable(what: string): ApiUnavailableError {
  apiUnavailableLatched = what
  window.dispatchEvent(new CustomEvent('aurora:api-unavailable', { detail: what }))
  return new ApiUnavailableError(`${what}: the AURORA API is unavailable — clinical data cannot be served`)
}

/** GET /api/icu/units/4B/beds — full bed board for the unit.
 *  Layer 2: composed from the REAL ADT bed registry (layout + derived
 *  occupancy) joined with the REAL roster, so admissions, discharges and
 *  transfers reflect immediately; mock fallback when offline. */
export async function getBeds(): Promise<BedsResponse> {
  const [adtBeds, roster] = await Promise.all([
    apiGet<AdtBed[]>('/api/icu/adt/beds', 'ADT beds'),
    fetchRosterRecords(),
  ])
  if (adtBeds && roster) return composeBedsResponse(adtBeds, roster)
  if (import.meta.env.VITE_APP_ENV !== 'production') return respond(BEDS_RESPONSE, 850)
  throw apiUnavailable('bed board')
}

/* ==================== Phase 3 PR 1 — HONEST-EMPTY DEGRADATION ====================
   Owner's decision (2026-07-18): domains that DO NOT EXIST yet resolve
   `null` in production instead of throwing the full-screen overlay —
   `null` means "not a domain in this version" and the UI says exactly
   that ("not yet available"), NEVER a blank that could read as clinical
   absence. This is consistent with never-fabricate: the previous mock
   payloads were the fabrication; an explicit not-yet state invents
   nothing. apiUnavailable() remains reserved for a REAL domain whose
   server is unreachable. Demo data still serves outside production. */

/** GET /api/icu/units/4B/summary — occupancy ring, KPI strip, unit alerts.
 *  NULL in production: no unit-summary domain exists yet (real in
 *  Phase 3 PR 3) — Bed Overview's summary region and Admin Home render
 *  the honest not-yet state instead of taking the whole app down. */
export function getUnitSummary(): Promise<UnitSummaryResponse | null> {
  if (import.meta.env.VITE_APP_ENV !== 'production') return respond(UNIT_SUMMARY, 120)
  return Promise.resolve(null)
}

/** Phase 3 PR 3 — the summary figures that DO have canonical sources,
 *  derived client-side from the real reads: ADT encounters (admissions /
 *  discharges falling on today's UTC day — the server stamps
 *  'yyyy-MM-dd HH:mm' in UTC) and the results inbox (unacknowledged
 *  clinician-marked criticals). Bed Overview and Admin Home call this
 *  ONLY after getUnitSummary resolved null (production) — staging keeps
 *  the demo fixture and never issues these requests. The unfiltered
 *  encounter list is the same per-load read the Statistics page already
 *  performs (its recorded growth concern covers this too — no new
 *  precedent). If either source is unreachable the underlying read
 *  throws apiUnavailable, which is correct: these ARE real domains.
 *  AUTHORITY (found by this PR's own production verification): the
 *  results inbox demands results.view, which the office Administrator
 *  profile deliberately lacks — for such a viewer the inbox is NOT
 *  fetched and the critical figures come back null (region absent by
 *  authority), instead of the 403 escalating to the full-screen
 *  refusal on Admin Home. */
export async function getUnitSummaryDerived(): Promise<DerivedUnitSummary> {
  const session = getSession()
  const mayViewResults = session !== null && hasPermission(session.jobTitle, 'results.view')
  const [encounters, inbox] = await Promise.all([
    getEncounters(),
    mayViewResults ? getResultInbox() : Promise.resolve(null),
  ])
  const today = new Date().toISOString().slice(0, 10)
  const criticalResults = inbox === null ? null : inbox.filter(r => r.flag === 'critical')
  return {
    admissionsToday: encounters.filter(e => e.admittedAt.startsWith(today)).length,
    dischargesToday: encounters.filter(e => e.status === 'discharged' && (e.dischargedAt ?? '').startsWith(today)).length,
    criticalUnacked: criticalResults === null ? null : criticalResults.length,
    criticalResults,
  }
}

/* ---------------- Stage 10 Phase 1 — REAL roster endpoint ----------------
   GET /api/icu/patients is served by the ASP.NET Core + SQLite service in
   /server. The base URL comes from VITE_API_BASE_URL (never hardcoded);
   when it is unset or the service is unreachable (Render free tier cold
   starts take ~30-60 s), the adapter falls back to the local mock so the
   app keeps working — the first request also wakes the service for the
   next load. Every OTHER adapter below remains mock until its own Stage 10
   phase. */

/* PRODUCTION IS SAME-ORIGIN BY CONSTRUCTION (§11 step 3): the bundle is
   served by the API process itself and calls it with a RELATIVE base —
   the artifact carries NO hostname to point at a wrong environment.
   [Appliance Phase 1, superseding the build-time bake:] non-production
   bundles now resolve the base at RUNTIME from /runtime-config.js
   (src/lib/runtimeConfig.ts) instead of a compiled-in VITE_API_BASE_URL
   — the same bundle serves the same-origin topology (apiBaseUrl '': the
   appliance, and Render serving its own frontend) and the cross-origin
   one (Pages, whose deploy writes the Render URL into the file). A
   missing/malformed config FAILS LOUDLY in main.tsx before any adapter
   runs — never a silent guess at an origin. */
const API_BASE = import.meta.env.VITE_APP_ENV === 'production'
  ? ''
  : runtimeApiBase ?? ''
const API_TIMEOUT_MS = 8000

/** exposed for diagnostics/tests: 'api' after a successful live fetch */
export let patientsSource: 'mock' | 'api' = 'mock'

/* ---------------- Stage 10 Phase 2 — REAL authentication ----------------
   POST /api/auth/login exchanges username (or full display name) +
   password for a JWT; the session layer stores it and adapters attach it
   as a Bearer token. `invalid` (server said 401) is a REAL rejection and
   must be shown to the user; `unreachable` (no API base, timeout, network
   or server error) triggers the Stage 9 local-session fallback in the
   Login screen — same resilience pattern as the roster fallback below. */

/** false in pure mock mode (runtime config declares apiBaseUrl: null —
 *  no API at all) — the Login screen then labels sign-ins as Stage 9
 *  local sessions up front. '' is NOT mock: it is the same-origin API. */
export const authApiConfigured = import.meta.env.VITE_APP_ENV === 'production' || runtimeApiBase !== null

/** the wired API's /healthz URL for the runtime environment cross-check
 *  (EnvironmentGate) — null in a pure-mock dev session (no API at all,
 *  nothing to cross-check); production is always same-origin '/healthz'. */
export function apiHealthUrl(): string | null {
  if (import.meta.env.VITE_APP_ENV !== 'production' && runtimeApiBase === null) return null
  return `${API_BASE}/healthz`
}

/* ---------- Settings §1.1C — System Information reads ---------- */

/** the server's own /healthz self-report (unauthenticated by design) */
export interface SystemHealth {
  status: string
  service: string
  phase: string
  build: string
  environment: string
}

/** GET /healthz — HONEST health: null means the API is genuinely
 *  unreachable right now (e.g. the free-tier server is asleep) and the
 *  Settings panel says so — it never implies healthy. */
export async function getSystemHealth(): Promise<SystemHealth | null> {
  const url = apiHealthUrl()
  if (!url) return null
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS)
    const res = await fetch(url, { signal: ctrl.signal })
    clearTimeout(timer)
    if (!res.ok) return null
    return (await res.json()) as SystemHealth
  } catch {
    return null
  }
}

/** the FRONTEND deploy stamp — build.txt (the commit SHA the Pages deploy
 *  writes next to the bundle). The two halves deploy separately (locked
 *  rule), so Settings shows BOTH builds. null = no stamp in this serve
 *  (a local/dev build — honest absence, never a fabricated SHA). */
export async function getFrontendBuild(): Promise<string | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}build.txt`, { cache: 'no-store' })
    if (!res.ok) return null
    const text = (await res.text()).trim()
    /* the SPA fallback serves index.html for unknown paths — only a real
       40-hex commit SHA counts as a build stamp */
    return /^[0-9a-f]{40}$/.test(text) ? text : null
  } catch {
    return null
  }
}

/* Multi-role login (User Management design §2): two intermediate outcomes
   exist between "rejected" and "signed in" — a forced password change
   (first login / after an admin reset) and, for a multi-role account, the
   role choice. Both ride short-lived STEP tokens that no API endpoint
   accepts (their JWT audience is a "#step" variant the session validation
   never matches) — a usable session token exists only after every step. */
export type LoginResult =
  | { ok: true; name: string; jobTitle: string; token: string; roles?: string[] }
  | { ok: 'change-password'; changeToken: string }
  | { ok: 'choose-role'; name: string; roles: string[]; selectToken: string }
  | { ok: false; reason: 'invalid' | 'unreachable'; message?: string }

/** POST /api/auth/login — real credential check (Stage 10 Phase 2). */
export async function login(username: string, password: string): Promise<LoginResult> {
  if (import.meta.env.VITE_APP_ENV !== 'production' && runtimeApiBase === null) return { ok: false, reason: 'unreachable' }
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS)
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      signal: ctrl.signal,
    })
    clearTimeout(timer)
    if (res.status === 401) return { ok: false, reason: 'invalid' }
    if (res.ok) {
      const body = (await res.json()) as {
        token?: string; name?: string; jobTitle?: string; roles?: string[]
        mustChangePassword?: boolean; changeToken?: string; selectToken?: string
      }
      if (body.mustChangePassword && body.changeToken)
        return { ok: 'change-password', changeToken: body.changeToken }
      if (body.selectToken && body.roles && body.name)
        return { ok: 'choose-role', name: body.name, roles: body.roles, selectToken: body.selectToken }
      if (body.token && body.name && body.jobTitle)
        return { ok: true, name: body.name, jobTitle: body.jobTitle, token: body.token, roles: body.roles }
    }
    console.info(`[aurora] auth API responded ${res.status} — falling back to local session`)
  } catch {
    console.info('[aurora] auth API unreachable (cold start?) — falling back to local session')
  }
  return { ok: false, reason: 'unreachable' }
}

/** the auth continuation steps share login's response shape */
async function authStep(path: string, payload: object): Promise<LoginResult> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS)
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    })
    clearTimeout(timer)
    if (res.status === 400) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      return { ok: false, reason: 'invalid', message: body?.error }
    }
    if (res.status === 401) return { ok: false, reason: 'invalid' }
    if (res.ok) {
      const body = (await res.json()) as {
        token?: string; name?: string; jobTitle?: string; roles?: string[]
        mustChangePassword?: boolean; changeToken?: string; selectToken?: string
      }
      if (body.selectToken && body.roles && body.name)
        return { ok: 'choose-role', name: body.name, roles: body.roles, selectToken: body.selectToken }
      if (body.token && body.name && body.jobTitle)
        return { ok: true, name: body.name, jobTitle: body.jobTitle, token: body.token, roles: body.roles }
    }
  } catch { /* fall through */ }
  return { ok: false, reason: 'unreachable' }
}

/** POST /api/auth/select-role — the multi-role choice step (§2): exchanges
 *  the role-select step token + the chosen role for the session token. */
export const selectRole = (selectToken: string, role: string): Promise<LoginResult> =>
  authStep('/api/auth/select-role', { token: selectToken, role })

/** POST /api/auth/change-password — the forced-change step (§4): replaces
 *  the temporary credential, then continues the login where it left off. */
export const changePassword = (changeToken: string, newPassword: string): Promise<LoginResult> =>
  authStep('/api/auth/change-password', { token: changeToken, newPassword })

/** Authorization header for the real endpoints (empty when the session is
 *  a Stage 9 local fallback — the server then answers 401 and the adapter
 *  falls back to mock data, never a broken UI). */
const authHeaders = (): Record<string, string> => {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/** Shared GET against the real API (Stage 10 Phase 3+). Resolves null on
 *  ANY failure — unreachable, timeout, 401 (tokenless/stale session) — so
 *  each adapter falls back to its mock, console-logged, never a broken UI. */
async function apiGet<T>(path: string, what: string): Promise<T | null> {
  if (import.meta.env.VITE_APP_ENV !== 'production' && runtimeApiBase === null) return null
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS)
    const res = await fetch(`${API_BASE}${path}`, { signal: ctrl.signal, headers: authHeaders() })
    clearTimeout(timer)
    if (res.ok) return (await res.json()) as T
    console.info(`[aurora] ${what} API responded ${res.status} — using mock data`)
  } catch {
    console.info(`[aurora] ${what} API unreachable (cold start?) — using mock data`)
  }
  return null
}

/** Shared POST for real mutating endpoints. Three outcomes, handled
 *  differently on purpose:
 *  - ok: the server applied the change (response body = updated record)
 *  - denied: the server REJECTED it (403 permission / 404 absent /
 *    409 state conflict / 400 malformed — the four-code rule) — the
 *    caller must NOT apply the mock mutation; enforcement is real
 *  - offline: unreachable, or a 401 tokenless/stale session whose READS
 *    are already coming from mock — the caller applies the mock mutation
 *    so the Stage 9 offline experience stays coherent */
type ApiPostResult<T> = { kind: 'ok'; data: T } | { kind: 'denied' } | { kind: 'offline' }
async function apiPost<T>(
  path: string, what: string, body?: unknown, method: 'POST' | 'PUT' = 'POST',
): Promise<ApiPostResult<T>> {
  if (import.meta.env.VITE_APP_ENV !== 'production' && runtimeApiBase === null) return { kind: 'offline' }
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS)
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      signal: ctrl.signal,
      headers: { ...authHeaders(), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    clearTimeout(timer)
    if (res.ok) return { kind: 'ok', data: (await res.json()) as T }
    if (res.status === 401) {
      console.info(`[aurora] ${what} API responded 401 (local session) — applying to mock data`)
      return { kind: 'offline' }
    }
    console.info(`[aurora] ${what} API rejected the action (${res.status})`)
    return { kind: 'denied' }
  } catch {
    console.info(`[aurora] ${what} API unreachable (cold start?) — applying to mock data`)
    return { kind: 'offline' }
  }
}

const toSummary = (r: RosterRecordDto): PatientSummary => ({
  patientId: r.patientId,
  bedId: r.bedId,
  name: r.name,
  mrn: r.mrn,
  diagnosis: r.diagnosis,
  flags: r.flags,
  isolation: r.isolation,
  fullName: r.fullName,
  nationalId: r.nationalId,
  /* alertCount stays client-derived — see the wire-contract note in
     types.ts. Dev/staging enrich it from the MOCK ai/results stores
     (documented drift); production carries no mock stores, so it derives
     from the REAL wire field alone (an active crit/high bed alert) until
     those alert domains are real. */
  alertCount: import.meta.env.VITE_APP_ENV !== 'production'
    ? derivedAlertCount(r.patientId, r.bedAlert.severity)
    : (r.bedAlert.severity === 'crit' || r.bedAlert.severity === 'high' ? 1 : 0),
})

/** shared real-roster fetch — getPatients' summaries and the Layer 2 bed
 *  board composition both read it; null = fall back to mock */
async function fetchRosterRecords(): Promise<RosterRecordDto[] | null> {
  if (import.meta.env.VITE_APP_ENV !== 'production' && runtimeApiBase === null) return null
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS)
    const res = await fetch(`${API_BASE}/api/icu/patients`, { signal: ctrl.signal, headers: authHeaders() })
    clearTimeout(timer)
    if (res.ok) {
      const roster = (await res.json()) as RosterRecordDto[]
      if (Array.isArray(roster) && roster.length > 0) return roster
    }
    console.info(`[aurora] roster API responded ${res.status} — using mock roster`)
  } catch {
    console.info('[aurora] roster API unreachable (cold start?) — using mock roster')
  }
  return null
}

/** Print Center (read-only): the FULL roster record for one patient — the
 *  same real roster fetch getPatients/getBeds already use, exposed so
 *  print selectors never re-derive or duplicate it. Null = the id is not
 *  on the active roster (roster = derived view over OPEN encounters, so
 *  discharged patients legitimately resolve to null — the print layer
 *  falls back to the encounter's identity snapshot and says so). */
export async function getRosterRecord(patientId: string): Promise<RosterRecordDto | null> {
  const roster = await fetchRosterRecords()
  if (roster) return roster.find(r => r.patientId === patientId) ?? null
  if (import.meta.env.VITE_APP_ENV !== 'production') {
    const rec = rosterFor(patientId)
    return rec ? respond(rec as RosterRecordDto, 120) : null
  }
  throw apiUnavailable('roster record')
}

/** GET /api/icu/patients — sidebar roster for Mission Control.
 *  REAL endpoint (Stage 10 Phase 1); mock fallback documented above. */
export async function getPatients(): Promise<PatientSummary[]> {
  const roster = await fetchRosterRecords()
  if (roster) {
    patientsSource = 'api'
    return roster.map(toSummary)
  }
  if (import.meta.env.VITE_APP_ENV !== 'production') {
    patientsSource = 'mock'
    const summaries: PatientSummary[] = allPatients().map(
      ({ patientId, bedId, name, mrn, diagnosis, flags, isolation, alertCount }) =>
        ({ patientId, bedId, name, mrn, diagnosis, flags, isolation, alertCount }),
    )
    return respond(summaries, 120)
  }
  throw apiUnavailable('roster')
}

/** GET /api/icu/patients/:patientId — full Mission Control payload for one patient. */
/** Mission Control's `Patient` from the REAL roster wire record — the
 *  SAME record the bed board renders, so any ADMITTED patient (seeded or
 *  freshly admitted through ADT) resolves identically. Fixes the recorded
 *  defect where a fresh admission showed on the bed board but its detail
 *  page said "Patient Not Found": the detail lookup consulted only the
 *  MOCK store, which by definition never contains a real admission. */
const rosterToPatient = (r: RosterRecordDto): Patient => ({
  ...toSummary(r),
  age: r.age,
  sex: r.sex,
  los: r.los,
  allergies: r.allergies,
  attending: r.attending,
  codeStatus: r.codeStatus,
  rhythm: r.rhythm,
  vitals: r.monitorVitals,
  organs: r.organs,
})

/** IDENTITY-ONLY patient read (Phase 3 PR 1 — the composite split): the
 *  real roster record mapped to `Patient`, nothing else. Orders & Meds,
 *  Timeline and Labs & Imaging need ONLY this for their PatientBar
 *  header + not-found guard — their bodies are already real — so they
 *  no longer pull the Stage-11 composite (whose panels kept all three
 *  production-blocked). Null = not on the active roster (the existing
 *  not-found card); a truly unreachable server still refuses loudly
 *  via getRosterRecord's own production path. */
export async function getRosterPatient(patientId: string): Promise<Patient | null> {
  const rec = await getRosterRecord(patientId)
  if (rec) return rosterToPatient(rec)
  if (import.meta.env.VITE_APP_ENV !== 'production')
    return allPatients().find(p => p.patientId === patientId) ?? null
  return null
}

/* ---------------- Phase 3 PR 2 — the composite made REAL ----------------
   Mission Control (the composite\'s only consumer since the PR-1 split)
   no longer refuses in production: every panel now composes from reads
   that are already real —
   - identity: the real roster record (unchanged);
   - ventilator/hemodynamics: the real Observations projection (§12
     step 4, unchanged — confirmed, not rebuilt);
   - labs trend card: RE-DERIVED client-side over the REAL
     GET /api/icu/results/labs draws (deriveLabsFromDraws below) —
     the same values the Labs & Imaging screen shows;
   - timeline card: the REAL GET /api/icu/timeline feed (getTimeline\'s
     own env rules), last ~24 h capped at 20 — the same events the
     Timeline screen shows;
   - infusions: derived from REAL active structured-infusion orders
     (drug/dose/route real; the 7-point RATE TREND has NO source — a
     pump/device feed is Device Adapter scope — so no sparkline is
     rendered, honestly, and no fabricated rate/status appears);
   - alerts/goals: NO domain exists (per-patient alert rules, care
     plans) — NULL in production, the not-yet card renders (PR-1 rule);
     demo lists still serve outside production.
   Mock fallbacks remain non-production-only, per part. */
export async function getPatientDetail(patientId: string): Promise<PatientDetailResponse | null> {
  const roster = await fetchRosterRecords()
  const realRec = roster?.find(r => r.patientId === patientId)
  const patient = realRec ? rosterToPatient(realRec)
    : import.meta.env.VITE_APP_ENV !== 'production'
      ? allPatients().find(p => p.patientId === patientId)
      : undefined
  if (roster === null && import.meta.env.VITE_APP_ENV === 'production') throw apiUnavailable('roster')
  if (!patient) return respond(null, 120)
  const obs = (await getObservations(patientId).catch(() => null)) ?? []
  const latest = latestObservations(obs)
  /* the three real feeds load together; each keeps its own env-aware
     fallback semantics */
  const [draws, timelineFeed, orders] = await Promise.all([
    getLabDraws(patientId).catch(() => null),
    getTimeline(patientId).catch(() => [] as TimelineEvent[]),
    /* orders feed the PRODUCTION infusion derivation only — outside
       production the card keeps the demo PUMP fixture verbatim (rates,
       trends, status dots: the device-feed preview the demo has always
       shown; deriving from orders there would silently change staging) */
    import.meta.env.VITE_APP_ENV === 'production'
      ? getPatientOrders(patientId).catch(() => null)
      : Promise.resolve(null),
  ])
  const labs = draws !== null
    ? deriveLabsFromDraws(draws)
    : import.meta.env.VITE_APP_ENV !== 'production'
      ? deriveMissionControlLabs(patientId)
      : { drawTimes: [], panels: [] }
  const infusions = import.meta.env.VITE_APP_ENV === 'production'
    ? deriveInfusionsFromOrders(orders ?? [])
    : INFUSIONS
  return respond(
    {
      patient,
      ventilator: projectVentilator(latest),
      hemodynamics: projectHemodynamics(latest, obs),
      infusions,
      labs,
      alerts: import.meta.env.VITE_APP_ENV !== 'production' ? PATIENT_ALERTS : null,
      goals: import.meta.env.VITE_APP_ENV !== 'production' ? GOALS : null,
      timeline: timelineFeed.filter(e => dayOffsetOf(e.time) >= -1).slice(0, 20),
    },
    120,
  )
}

/* the labs trend card re-derived over REAL draws — the same LabDraw rows
   the Labs & Imaging screen renders, grouped by panel: the LATEST draw\'s
   items are the results column; numeric analytes present across draws
   become the trend series (up to 3 per panel, oldest→newest). Values are
   the wire values verbatim — nothing recomputed, nothing invented. */
const SERIES_COLORS = ['#4da3ff', '#35e0d0', '#ffb454']
export function deriveLabsFromDraws(draws: LabDraw[]): Labs {
  const structured = draws.filter(d => !d.custom)
  if (structured.length === 0) return { drawTimes: [], panels: [] }
  const byTime = [...structured].sort((a, b) => timestampMinutes(a.collectedAt) - timestampMinutes(b.collectedAt))
  const recent = byTime.slice(-6)
  const drawTimes = recent.map(d => d.collectedAt)
  const panelNames = [...new Set(recent.map(d => d.panel))]
  const panels = panelNames.map(name => {
    const mine = recent.filter(d => d.panel === name)
    const latestDraw = mine[mine.length - 1]
    const results = latestDraw.items.map(it => ({
      analyte: it.analyte,
      value: `${it.value} ${it.unit}`.trim(),
      flag: (it.flag === 'critical' ? 'crit2' : it.flag === 'abnormal' ? 'abn' : '') as '' | 'abn' | 'crit2',
    }))
    const series = latestDraw.items
      .map(it => it.analyte)
      .filter(an => mine.filter(d => d.items.some(i => i.analyte === an)).length >= 2)
      .slice(0, 3)
      .map((an, i) => ({
        label: an,
        color: SERIES_COLORS[i % SERIES_COLORS.length],
        points: mine.filter(d => d.items.some(x => x.analyte === an))
          .map(d => d.items.find(x => x.analyte === an)!.value),
      }))
    return { name, series, results }
  })
  return { drawTimes, panels }
}

/* active infusions from REAL orders: active Medication orders carrying
   the structured infusion dose. dose/route are the ordered facts; rate,
   trend and the status judgement have NO source without a pump feed, so
   they are simply ABSENT (the card renders neither a sparkline nor a
   status dot for them — facts are never invented). */
export function deriveInfusionsFromOrders(orders: Order[]): Infusion[] {
  return orders
    .filter(o => o.category === 'Medication' && o.status === 'active' && o.medication?.infusion)
    .map(o => ({
      name: o.medication!.drug,
      dose: o.medication!.dose,
      route: o.medication!.route,
    }))
}

/* ---------------- Patient Assignment & Responsibility (Aurora Core) ----------------
   REAL endpoints (/api/icu/assignments…) with the usual offline mock
   fallback. Assignment is a WORKLIST, never an authority: nothing here
   gates administration — an unassigned nurse responding to an emergency
   documents exactly as before. The retired NURSE_ASSIGNMENT /
   ROUNDING_LIST fixtures are superseded by these reads. */

const toAssignedPatient = (r: RosterRecordDto): AssignedPatient => ({
  patientId: r.patientId, bedId: r.bedId, name: r.name, age: r.age, sex: r.sex,
  diagnosis: r.diagnosis, allergies: r.allergies, codeStatus: r.codeStatus,
  flags: r.flags, isolation: r.isolation, severity: r.severity,
  vitals: r.bedsideVitals,
})

const toRoundingPatient = (r: RosterRecordDto): RoundingPatient => ({
  patientId: r.patientId, bedId: r.bedId, name: r.name, diagnosis: r.diagnosis,
  flags: r.flags, severity: r.severity,
})

/** the roster records for the join (real read; mock fallback offline) */
async function assignmentRoster(): Promise<RosterRecordDto[]> {
  const real = await fetchRosterRecords()
  if (real) return real
  if (import.meta.env.VITE_APP_ENV !== 'production') return clone(ROSTER) as RosterRecordDto[]
  throw apiUnavailable('roster')
}

/** GET /api/icu/assignments — the unit-wide read (everyone with
 *  patients.view: who is responsible is basic clinical safety). */
export async function getAssignments(patientId?: string): Promise<Assignment[]> {
  const q = patientId ? `?patientId=${encodeURIComponent(patientId)}` : ''
  const real = await apiGet<Assignment[]>(`/api/icu/assignments${q}`, 'assignments')
  if (real) return real
  if (import.meta.env.VITE_APP_ENV !== 'production')
    return respond(patientId ? ASSIGNMENTS.filter(a => a.patientId === patientId) : ASSIGNMENTS, 120)
  throw apiUnavailable('assignments')
}

/** GET /api/icu/assignments/mine — the signed-in clinician's ACTIVE
 *  worklist. Server-derived from the TOKEN (#104): the user binding and
 *  the ACTIVE role's kind (Nurse → nurse, Doctor/SeniorDoctor → doctor).
 *  The mock fallback mirrors the same rule from the local session. */
export async function getMyAssignments(name: string, jobTitle: JobTitle): Promise<Assignment[]> {
  const real = await apiGet<Assignment[]>('/api/icu/assignments/mine', 'my assignments')
  if (real) return real
  if (import.meta.env.VITE_APP_ENV !== 'production') {
    const profile = profileOf(jobTitle)
    const kind = profile === 'Nurse' ? 'nurse'
      : profile === 'Doctor' || profile === 'SeniorDoctor' ? 'doctor' : null
    if (!kind) return respond([], 120)
    const userId = usernameOf(name)
    return respond(ASSIGNMENTS.filter(a => a.userId === userId && a.kind === kind && !a.endedAt), 120)
  }
  throw apiUnavailable('my assignments')
}

/** GET /api/icu/assignments/staff — the assign picker (assignments.manage). */
export async function getAssignableStaff(): Promise<AssignableStaff[]> {
  const real = await apiGet<AssignableStaff[]>('/api/icu/assignments/staff', 'assignable staff')
  if (real) return real
  if (import.meta.env.VITE_APP_ENV !== 'production') {
    return respond(SAMPLE_STAFF.flatMap(s => {
      const profile = profileOf(s.jobTitle)
      const kinds: AssignmentKind[] = profile === 'Nurse' ? ['nurse']
        : profile === 'Doctor' || profile === 'SeniorDoctor' ? ['doctor'] : []
      return kinds.length === 0 ? [] : [{
        userId: usernameOf(s.name), name: s.name, jobTitle: s.jobTitle, kinds,
      }]
    }), 120)
  }
  throw apiUnavailable('assignable staff')
}

export type AssignmentWriteResult = { kind: 'ok'; assignment: Assignment } | { kind: 'rejected'; error: string }

/** POST /api/icu/assignments — assign responsibility (assignments.manage;
 *  the SeniorDoctor interim — see the 02 record). */
export async function createAssignment(
  draft: CreateAssignmentDraft, actor: string, jobTitle: JobTitle,
): Promise<AssignmentWriteResult> {
  if (!hasPermission(jobTitle, 'assignments.manage'))
    return { kind: 'rejected', error: 'Insufficient permissions' }
  const res = await adtPost<Assignment>('/api/icu/assignments', 'assignment create', draft)
  if (res.kind === 'ok') return { kind: 'ok', assignment: res.data }
  if (res.kind === 'rejected') return { kind: 'rejected', error: res.error }
  if (import.meta.env.VITE_APP_ENV !== 'production') {
    const staff = SAMPLE_STAFF.find(s => usernameOf(s.name) === draft.userId)
    if (!staff) return { kind: 'rejected', error: `userId '${draft.userId}' does not match any user account — assignments reference real accounts, never free text` }
    const row = insertAssignment(draft, staff.name, staff.jobTitle, actor, jobTitle, nowHm())
    return 'error' in row ? { kind: 'rejected', error: row.error } : { kind: 'ok', assignment: clone(row) }
  }
  throw apiUnavailable('assignment create')
}

/** POST /api/icu/assignments/{id}/end — handover / correction; the
 *  discharge cascade ends assignments server-side on its own. */
export async function endAssignment(
  assignmentId: string, reason: string | undefined, actor: string, jobTitle: JobTitle,
): Promise<AssignmentWriteResult> {
  if (!hasPermission(jobTitle, 'assignments.manage'))
    return { kind: 'rejected', error: 'Insufficient permissions' }
  const res = await adtPost<Assignment>(
    `/api/icu/assignments/${encodeURIComponent(assignmentId)}/end`, 'assignment end',
    reason ? { reason } : {})
  if (res.kind === 'ok') return { kind: 'ok', assignment: res.data }
  if (res.kind === 'rejected') return { kind: 'rejected', error: res.error }
  if (import.meta.env.VITE_APP_ENV !== 'production') {
    const row = applyAssignmentEnd(assignmentId, actor, jobTitle, reason, nowHm())
    return 'error' in row ? { kind: 'rejected', error: row.error } : { kind: 'ok', assignment: clone(row) }
  }
  throw apiUnavailable('assignment end')
}

/** the nurse workspace worklist: my active nurse assignments joined with
 *  the roster for the bedside display fields. Zero assignments is a
 *  VALID state (honest empty worklist + the Unassigned panel). */
export async function getNurseWorklist(
  name: string, jobTitle: JobTitle,
): Promise<{ assignments: Assignment[]; patients: AssignedPatient[] }> {
  const [assignments, roster] = await Promise.all([
    getMyAssignments(name, jobTitle), assignmentRoster(),
  ])
  const byId = new Map(roster.map(r => [r.patientId, r]))
  const patients = assignments
    .map(a => byId.get(a.patientId)).filter((r): r is RosterRecordDto => !!r)
    .map(toAssignedPatient)
  return { assignments, patients }
}

/** the doctor workspace rounding list — same derivation, doctor kind
 *  (cross-cover is real: the list is the ASSIGNMENT, never
 *  attending-derived). */
export async function getRoundingWorklist(
  name: string, jobTitle: JobTitle,
): Promise<{ assignments: Assignment[]; patients: RoundingPatient[] }> {
  const [assignments, roster] = await Promise.all([
    getMyAssignments(name, jobTitle), assignmentRoster(),
  ])
  const byId = new Map(roster.map(r => [r.patientId, r]))
  const patients = assignments
    .map(a => byId.get(a.patientId)).filter((r): r is RosterRecordDto => !!r)
    .map(toRoundingPatient)
  return { assignments, patients }
}

/** the UNASSIGNED panel (the P-1191 failure made structural): every open
 *  encounter with no active nurse / no active doctor. Zero assignments is
 *  allowed — but must be VISIBLE, so no patient silently falls through. */
export async function getUnassignedPatients(): Promise<{ nurse: UnassignedPatient[]; doctor: UnassignedPatient[] }> {
  const [assignments, roster] = await Promise.all([getAssignments(), assignmentRoster()])
  const covered = (kind: AssignmentKind) => new Set(
    assignments.filter(a => a.kind === kind && !a.endedAt).map(a => a.patientId))
  const row = (r: RosterRecordDto): UnassignedPatient => ({
    patientId: r.patientId, name: r.name, bedId: r.bedId,
    diagnosis: r.diagnosis, severity: r.severity,
  })
  const nurse = covered('nurse')
  const doctor = covered('doctor')
  return {
    nurse: roster.filter(r => !nurse.has(r.patientId)).map(row),
    doctor: roster.filter(r => !doctor.has(r.patientId)).map(row),
  }
}

/** GET /api/icu/worklist/queues — notes due (orders/results queues are
 *  derived views). NULL in production: clinical notes are not a domain
 *  yet — the notes tab says so (honest-empty rule above). */
export function getActionQueues(): Promise<ActionQueuesResponse | null> {
  if (import.meta.env.VITE_APP_ENV !== 'production') return respond(ACTION_QUEUES, 120)
  return Promise.resolve(null)
}

/** GET /api/icu/consults — incoming consults (shared store; the Timeline
 *  reads the same records per patient). NULL in production: consults are
 *  not a domain yet — the card says so (honest-empty rule above). */
export function getConsults(): Promise<Consult[] | null> {
  if (import.meta.env.VITE_APP_ENV !== 'production') return respond(allConsults(), 120)
  return Promise.resolve(null)
}

/** GET /api/icu/order-sets — quick order sets by order type (the imaging
 *  STUDY VOCABULARY consumed by the imaging order card — distinct from
 *  the real Layer-4 order-set definitions). NULL in production: the
 *  vocabulary has no master-data home yet — the imaging card says so
 *  rather than offering a fabricated study list (flagged follow-up:
 *  this vocabulary belongs in Layer-4 master data, which would restore
 *  production imaging ordering). */
export function getOrderSets(): Promise<OrderSetsResponse | null> {
  if (import.meta.env.VITE_APP_ENV !== 'production') return respond(ORDER_SETS, 120)
  return Promise.resolve(null)
}

/* ---------------- Nursing domain (Screen 4) ----------------
   Write actions (document administration, complete order/task, record I&O,
   save handoff) are POSTs in the real API; the UI applies them to local
   state today so wiring them later is additive, not a rewrite:
   POST /api/icu/nursing/mar/:marId/administration   { action, time }
   POST /api/icu/nursing/orders/:orderId/complete
   POST /api/icu/nursing/tasks/:taskId/complete
   POST /api/icu/nursing/io                          { patientId, kind, category, volumeMl }
   The SBAR handoff is REAL (see getHandoffEntries/writeHandoff below) —
   the PUT-per-patient sketch that lived here was Stage-4 scaffolding and
   is superseded by the append-only, encounter-scoped series. */

/* I&O category vocabulary — re-exported so pages never import a data store
   directly (service-layer rule); becomes master data at Layer 4 */
export { IO_CATEGORIES } from './logic'

/* getNurseAssignment is RETIRED (Patient Assignment & Responsibility) —
   the nurse worklist derives from REAL assignments: getNurseWorklist(). */

/** GET /api/icu/nursing/handoff — the append-only SBAR series for the
 *  patient's OPEN encounter (or an explicit encounterId), NEWEST first.
 *  REAL-ONLY read (the observations pattern): null when the server is
 *  unreachable — the UI says so honestly; no mock series exists. */
export async function getHandoffEntries(patientId: string, encounterId?: string): Promise<HandoffEntry[] | null> {
  const real = await apiGet<HandoffEntry[]>(
    `/api/icu/nursing/handoff?patientId=${encodeURIComponent(patientId)}`
    + (encounterId ? `&encounterId=${encodeURIComponent(encounterId)}` : ''), 'handoff')
  if (real) return real
  if (import.meta.env.VITE_APP_ENV !== 'production') return null
  throw apiUnavailable('handoff')
}

/** POST /api/icu/nursing/handoff — write ONE new immutable SBAR entry
 *  (append-only: prior entries are never touched). REAL-ONLY write on
 *  the user's own token; the server gates on handoff.document + an
 *  ACTIVE nurse assignment and stamps author/role/time itself. */
export function writeHandoff(
  patientId: string, note: { s: string; b: string; a: string; r: string },
): Promise<AdtWriteResult<HandoffEntry>> {
  return usersWrite<HandoffEntry>('/api/icu/nursing/handoff', 'handoff entry', { patientId, ...note })
}

/** GET /api/icu/nursing/tasks — time-driven nursing task checklist.
 *  NULL in production: nursing tasks are not a domain yet — the card
 *  says so (honest-empty rule above). */
export function getNursingTasks(): Promise<NursingTask[] | null> {
  if (import.meta.env.VITE_APP_ENV !== 'production') return respond(NURSING_TASKS, 120)
  return Promise.resolve(null)
}

/** GET /api/icu/nursing/io — intake/output entries recorded this shift.
 *  NULL in production: the I&O worksheet is not a domain yet — the card
 *  says so (honest-empty rule above; the observation fluid-balance group
 *  is the real charting path meanwhile). */
export function getIoEntries(): Promise<IoEntry[] | null> {
  if (import.meta.env.VITE_APP_ENV !== 'production') return respond(IO_ENTRIES, 120)
  return Promise.resolve(null)
}

/** POST /api/icu/nursing/tasks/:taskId/toggle — document (or undo) a task
 *  completion in the store, so derived views (Timeline) see it.
 *  Requires notes.document (enforced here in the service layer).
 *  PRODUCTION: REJECTS with a plain error the caller toasts — the SBAR
 *  lesson: a write that appears to work but stores nothing is a
 *  data-loss bug; the nurse must SEE that it did not record. A plain
 *  Error, deliberately NOT apiUnavailable() — a rejected action, never
 *  the full-screen overlay. (Unreachable from the production UI — the
 *  tasks card shows no rows — kept as defense in depth.) */
export function toggleNursingTask(taskId: string, actor: string, jobTitle: JobTitle): Promise<NursingTask | null> {
  if (!hasPermission(jobTitle, 'notes.document')) return respond(null, 120)
  if (import.meta.env.VITE_APP_ENV !== 'production') return respond(applyTaskToggle(taskId, actor, nowHm()), 120)
  return Promise.reject(new Error('nursing task documentation is not yet available in this version'))
}

/** POST /api/icu/nursing/io — record an intake/output entry in the store.
 *  Requires notes.document; null when the profile lacks it.
 *  PRODUCTION: REJECTS with a plain error the caller toasts (same SBAR
 *  lesson as toggleNursingTask above — visibly refused, never silently
 *  dropped, never the overlay). */
export function recordIoEntry(draft: NewIoEntry, jobTitle: JobTitle): Promise<IoEntry | null> {
  if (!hasPermission(jobTitle, 'notes.document')) return respond(null, 120)
  if (import.meta.env.VITE_APP_ENV !== 'production') return respond(insertIoEntry(draft, nowHm()), 120)
  return Promise.reject(new Error('I&O documentation is not yet available in this version'))
}

/* ---------------- Orders & Medication domain (Screen 5) ----------------
   The canonical orders service. Doctor Workspace, Nurse Workspace, and the
   Orders & Medication screen all go through these functions — the mock
   module store behind them is swapped for the ASP.NET Core orders service
   at Stage 10. Mutations map to:
   POST /api/icu/orders                          (create; ?sign=true to activate)
   POST /api/icu/orders/:orderId/sign
   PUT  /api/icu/orders/:orderId                 (modify — reason required)
   POST /api/icu/orders/:orderId/discontinue     (reason required)
   POST /api/icu/orders/:orderId/implement
   POST /api/icu/orders/:orderId/administrations/:adminId  { action } */

/* ---------------- Layer 4 — Master Data: the formulary (Aurora Core) ----------------
   The drug list is a REAL database-backed reference table Pharmacy
   maintains (formulary.manage — server-enforced on every mutation; these
   client checks are defense in depth). Reference data is a durable
   system of record like ADT/identity, so WRITES are REAL-ONLY — a drug
   is never created/edited against local mock state; READS fall back to
   the mock formulary offline (no audit history). Removing a drug is
   deactivation, never a delete: an inactive drug cannot be selected for
   a NEW order (server 409) but every existing order still renders. */

/** GET /api/icu/formulary — the full formulary incl. inactive drugs
 *  (REAL endpoint; the ordering UI excludes inactive ones client-side). */
export async function getFormulary(): Promise<FormularyDrug[]> {
  const real = await apiGet<FormularyDrug[]>('/api/icu/formulary', 'formulary')
  if (real) return real
  if (import.meta.env.VITE_APP_ENV !== 'production') return respond(FORMULARY, 120)
  throw apiUnavailable('formulary')
}

/** GET /api/icu/formulary/interactions — pairwise interaction rules
 *  (read-only; the client-side safety checks in safety.ts consume them —
 *  moving those checks server-side is recorded future scope). */
export async function getInteractionRules(): Promise<InteractionRule[]> {
  const real = await apiGet<InteractionRule[]>('/api/icu/formulary/interactions', 'interaction rules')
  if (real) return real
  if (import.meta.env.VITE_APP_ENV !== 'production') return respond(INTERACTION_RULES, 120)
  throw apiUnavailable('interaction rules')
}

/** GET /api/icu/formulary/frequencies — the named frequency vocabulary
 *  (order frequencies validate against these ∪ q<1-48>h server-side). */
export async function getFrequencyVocabulary(): Promise<string[]> {
  const real = await apiGet<string[]>('/api/icu/formulary/frequencies', 'frequency vocabulary')
  if (real) return real
  if (import.meta.env.VITE_APP_ENV !== 'production') return respond(NAMED_FREQUENCIES, 120)
  throw apiUnavailable('frequency vocabulary')
}

/** POST /api/icu/formulary — add a drug (Pharmacy RBAC, formulary.manage).
 *  REAL-ONLY write. */
export function createFormularyDrug(draft: CreateDrugDraft): Promise<AdtWriteResult<FormularyDrug>> {
  return usersWrite<FormularyDrug>('/api/icu/formulary', 'formulary create', draft)
}

/** PUT /api/icu/formulary/:drugId — edit reference fields (drugId is the
 *  immutable natural key). REAL-ONLY write. */
export function updateFormularyDrug(drugId: string, draft: EditDrugDraft): Promise<AdtWriteResult<FormularyDrug>> {
  return usersWrite<FormularyDrug>(`/api/icu/formulary/${encodeURIComponent(drugId)}`, 'formulary edit', draft, 'PUT')
}

/** POST /api/icu/formulary/:drugId/deactivate — status change, never a
 *  delete (historical orders must keep resolving). REAL-ONLY write. */
export function deactivateFormularyDrug(drugId: string): Promise<AdtWriteResult<FormularyDrug>> {
  return usersWrite<FormularyDrug>(`/api/icu/formulary/${encodeURIComponent(drugId)}/deactivate`, 'formulary deactivate')
}

/** POST /api/icu/formulary/:drugId/reactivate — REAL-ONLY write. */
export function reactivateFormularyDrug(drugId: string): Promise<AdtWriteResult<FormularyDrug>> {
  return usersWrite<FormularyDrug>(`/api/icu/formulary/${encodeURIComponent(drugId)}/reactivate`, 'formulary reactivate')
}

/** GET /api/icu/order-sets — order sets with expandable items (REAL
 *  master data since Layer 4 phase 2; mock fallback offline). */
export async function getOrderSetDefs(): Promise<OrderSetDef[]> {
  const real = await apiGet<OrderSetDef[]>('/api/icu/order-sets', 'order sets')
  if (real) return real
  if (import.meta.env.VITE_APP_ENV !== 'production') return respond(ORDER_SET_DEFS, 120)
  throw apiUnavailable('order sets')
}

/* ---------------- Layer 4 phase 2 — Lab Test Catalogue + Order Sets ----------------
   Reference data the LABORATORY (labcatalog.manage, Ancillary profile)
   and PHARMACY (ordersets.manage) maintain — REAL-ONLY writes like every
   master-data domain; reads fall back to the mock stores offline.
   Deactivation is a status change, never a delete: an inactive test
   cannot be newly ORDERED (server 409) but every existing result
   referencing it still renders; an inactive set cannot be applied. */

/** GET /api/icu/lab-catalog — all tests incl. inactive. */
export async function getLabCatalog(): Promise<LabTest[]> {
  const real = await apiGet<LabTest[]>('/api/icu/lab-catalog', 'lab catalogue')
  if (real) return real
  if (import.meta.env.VITE_APP_ENV !== 'production') return respond(LAB_CATALOG, 120)
  throw apiUnavailable('lab catalogue')
}

/** POST /api/icu/lab-catalog — add a test (Laboratory RBAC). REAL-ONLY. */
export function createLabTest(draft: CreateLabTestDraft): Promise<AdtWriteResult<LabTest>> {
  return usersWrite<LabTest>('/api/icu/lab-catalog', 'lab-catalogue create', draft)
}

/** PUT /api/icu/lab-catalog/:testId — edit (testId immutable). REAL-ONLY. */
export function updateLabTest(testId: string, draft: EditLabTestDraft): Promise<AdtWriteResult<LabTest>> {
  return usersWrite<LabTest>(`/api/icu/lab-catalog/${encodeURIComponent(testId)}`, 'lab-catalogue edit', draft, 'PUT')
}

/** POST /api/icu/lab-catalog/:testId/deactivate — status change, never a
 *  delete (historical results keep resolving). REAL-ONLY. */
export function deactivateLabTest(testId: string): Promise<AdtWriteResult<LabTest>> {
  return usersWrite<LabTest>(`/api/icu/lab-catalog/${encodeURIComponent(testId)}/deactivate`, 'lab-catalogue deactivate')
}

/** POST /api/icu/lab-catalog/:testId/reactivate — REAL-ONLY. */
export function reactivateLabTest(testId: string): Promise<AdtWriteResult<LabTest>> {
  return usersWrite<LabTest>(`/api/icu/lab-catalog/${encodeURIComponent(testId)}/reactivate`, 'lab-catalogue reactivate')
}

/** DELETE /api/icu/lab-catalog/:testId — Option B removal: a TRUE delete
 *  succeeds only for a never-used test; a test referenced by any result or
 *  order answers 409 directing the caller to retire (deactivate) instead —
 *  historical results are never destroyed. REAL-ONLY. */
export function deleteLabTest(testId: string): Promise<AdtWriteResult<LabTest>> {
  return usersWrite<LabTest>(`/api/icu/lab-catalog/${encodeURIComponent(testId)}`, 'lab-catalogue delete', undefined, 'DELETE')
}

/** POST /api/icu/order-sets — author a set (ordersets.manage). REAL-ONLY. */
export function createOrderSet(draft: { setId: string; name: string; description: string; items: OrderSetItemTemplate[] }): Promise<AdtWriteResult<OrderSetDef>> {
  return usersWrite<OrderSetDef>('/api/icu/order-sets', 'order-set create', draft)
}

/** PUT /api/icu/order-sets/:setId — edit a set. REAL-ONLY. */
export function updateOrderSet(setId: string, draft: { name?: string; description?: string; items?: OrderSetItemTemplate[] }): Promise<AdtWriteResult<OrderSetDef>> {
  return usersWrite<OrderSetDef>(`/api/icu/order-sets/${encodeURIComponent(setId)}`, 'order-set edit', draft, 'PUT')
}

/** POST /api/icu/order-sets/:setId/deactivate — REAL-ONLY. */
export function deactivateOrderSet(setId: string): Promise<AdtWriteResult<OrderSetDef>> {
  return usersWrite<OrderSetDef>(`/api/icu/order-sets/${encodeURIComponent(setId)}/deactivate`, 'order-set deactivate')
}

/** POST /api/icu/order-sets/:setId/reactivate — REAL-ONLY. */
export function reactivateOrderSet(setId: string): Promise<AdtWriteResult<OrderSetDef>> {
  return usersWrite<OrderSetDef>(`/api/icu/order-sets/${encodeURIComponent(setId)}/reactivate`, 'order-set reactivate')
}

/* The Orders domain is a REAL service since Stage 10 Phase 3 (Orders PR) —
   full lifecycle behind JWT auth with server-side RBAC: create/sign/
   modify/discontinue need the doctor permissions, implement needs the
   nurse's orders.implement, all derived from the token's jobTitle claim
   on the server; the acting/signing actor comes from the token's name
   claim (the `actor` args below only feed the mock fallback path). The
   client hasPermission checks remain as defense in depth. MAR
   administrations (getMarRows/documentAdministration) stay MOCK until
   their own phase — documented drift: doses documented in the mock MAR
   don't reach the server store yet. */

/** GET /api/icu/orders?patientId — full order list incl. audit history (REAL; mock fallback). */
export async function getPatientOrders(patientId: string): Promise<Order[]> {
  const real = await apiGet<Order[]>(`/api/icu/orders?patientId=${encodeURIComponent(patientId)}`, 'orders')
  if (real != null) return real
  if (import.meta.env.VITE_APP_ENV !== 'production') return respond(allOrders().filter(o => o.patientId === patientId), 120)
  throw apiUnavailable('orders')
}

/** GET /api/icu/orders?status=pending — signature queue (REAL; mock fallback). */
export async function getPendingOrders(): Promise<Order[]> {
  const real = await apiGet<Order[]>('/api/icu/orders?status=pending', 'orders')
  if (real != null) return real
  if (import.meta.env.VITE_APP_ENV !== 'production') return respond(allOrders().filter(o => o.status === 'pending'), 120)
  throw apiUnavailable('signature queue')
}

/** GET /api/icu/orders?implement=true — nursing implementation queue (REAL;
 *  mock fallback). The patientIds narrowing stays client-side — the same
 *  derivation as before, repointed at the real store. */
export async function getImplementationQueue(patientIds?: string[]): Promise<Order[]> {
  const real = await apiGet<Order[]>('/api/icu/orders?implement=true', 'orders')
  if (real) return real.filter(o => !patientIds || patientIds.includes(o.patientId))
  if (import.meta.env.VITE_APP_ENV !== 'production') {
    /* task orders only — Lab/Imaging orders complete via their documented
       results, never a manual done (mirrors the server's implement filter) */
    const q = allOrders().filter(
      o => o.status === 'active' && o.requiresImplementation
        && o.category !== 'Lab' && o.category !== 'Imaging'
        && (!patientIds || patientIds.includes(o.patientId)),
    )
    return respond(q, 120)
  }
  throw apiUnavailable('implementation queue')
}

/* The MAR is a REAL service since Stage 10 Phase 3 (MAR PR). It has no
 *  store of its own — rows derive server-side from the real Orders
 *  administrations, and an administration action mutates the order in
 *  place (same coupling as the mock). RBAC polarity is the inverse of the
 *  prescriber mutations: administering requires the NURSE's meds.administer
 *  (a doctor token is 403'd server-side). Timeline and AI stay mock. */

/** GET /api/icu/mar — MAR rows (REAL, unit-wide derived; mock fallback).
 *  The nurse-assignment narrowing by patientIds stays client-side — the
 *  same derivation as before, repointed at the real store. */
export async function getMarRows(patientIds: string[]): Promise<MarRow[]> {
  const real = await apiGet<MarRow[]>('/api/icu/mar', 'MAR')
  if (real) return real.filter(r => patientIds.includes(r.patientId))
  if (import.meta.env.VITE_APP_ENV !== 'production') return respond(deriveMarRows(patientIds), 120)
  throw apiUnavailable('MAR')
}

/** POST /api/icu/orders — create order(s); sign=true activates immediately (doctor RBAC).
 *  `note` (the acknowledged safety-warning override composed by the order
 *  form) is written to the audit history AND carried as the server-side
 *  overrideJustification: since safety enforcement, the SERVER re-runs the
 *  allergy/interaction/duplicate checks and 409s warn-level findings
 *  without it (hard blocks are never overridable) — the client check is
 *  UX, the server is authoritative. */
export async function createOrders(drafts: NewOrderDraft[], actor: string, sign: boolean, jobTitle: JobTitle, note?: string): Promise<Order[]> {
  if (!hasPermission(jobTitle, 'orders.create') || (sign && !hasPermission(jobTitle, 'orders.sign'))) return respond([], 120)
  const r = await apiPost<Order[]>('/api/icu/orders', 'create order', { drafts, sign, note, ...(note ? { overrideJustification: note } : {}) })
  if (r.kind === 'ok') return r.data
  if (r.kind === 'denied') return []
  if (import.meta.env.VITE_APP_ENV !== 'production') {
    const created = drafts.map(d => {
      const pt = allPatients().find(p => p.patientId === d.patientId)
      return insertOrder(d, actor, sign, pt?.name ?? d.patientId, pt?.bedId ?? '—', note)
    })
    return respond(created, 150)
  }
  throw apiUnavailable('create order')
}

/** POST /api/icu/orders/:orderId/sign (doctor RBAC; REAL endpoint). */
export async function signOrder(orderId: string, actor: string, jobTitle: JobTitle): Promise<Order | null> {
  if (!hasPermission(jobTitle, 'orders.sign')) return respond(null, 120)
  const r = await apiPost<Order>(`/api/icu/orders/${encodeURIComponent(orderId)}/sign`, 'sign order')
  if (r.kind === 'ok') return r.data
  if (r.kind === 'denied') return null
  if (import.meta.env.VITE_APP_ENV !== 'production') return respond(applySign(orderId, actor), 120)
  throw apiUnavailable('sign order')
}

/** PUT /api/icu/orders/:orderId — modify medication fields; reason required
 *  (doctor RBAC; REAL endpoint). */
export async function modifyOrder(
  orderId: string, changes: Partial<MedicationDetails>, reason: string, actor: string, jobTitle: JobTitle,
): Promise<Order | null> {
  if (!hasPermission(jobTitle, 'orders.modify')) return respond(null, 120)
  const r = await apiPost<Order>(`/api/icu/orders/${encodeURIComponent(orderId)}`, 'modify order', { changes, reason }, 'PUT')
  if (r.kind === 'ok') return r.data
  if (r.kind === 'denied') return null
  if (import.meta.env.VITE_APP_ENV !== 'production') return respond(applyModify(orderId, changes, reason, actor), 120)
  throw apiUnavailable('modify order')
}

/** POST /api/icu/orders/:orderId/discontinue — reason required (doctor RBAC; REAL endpoint). */
export async function discontinueOrder(orderId: string, reason: string, actor: string, jobTitle: JobTitle): Promise<Order | null> {
  if (!hasPermission(jobTitle, 'orders.discontinue')) return respond(null, 120)
  const r = await apiPost<Order>(`/api/icu/orders/${encodeURIComponent(orderId)}/discontinue`, 'discontinue order', { reason })
  if (r.kind === 'ok') return r.data
  if (r.kind === 'denied') return null
  if (import.meta.env.VITE_APP_ENV !== 'production') return respond(applyDiscontinue(orderId, reason, actor), 120)
  throw apiUnavailable('discontinue order')
}

/** POST /api/icu/orders/:orderId/implement (nurse RBAC — mark-done only; REAL endpoint). */
export async function completeImplementation(orderId: string, actor: string, jobTitle: JobTitle): Promise<Order | null> {
  if (!hasPermission(jobTitle, 'orders.implement')) return respond(null, 120)
  const r = await apiPost<Order>(`/api/icu/orders/${encodeURIComponent(orderId)}/implement`, 'implement order')
  if (r.kind === 'ok') return r.data
  if (r.kind === 'denied') return null
  if (import.meta.env.VITE_APP_ENV !== 'production') return respond(applyImplementation(orderId, actor), 120)
  throw apiUnavailable('implement order')
}

/** POST /api/icu/mar/:orderId/administrations/:adminId — document a dose
 *  (Given/Held/Refused; nurse RBAC — checked client-side AND re-enforced
 *  server-side). Held/Refused require a reason. REAL endpoint; mock
 *  fallback only when offline. Returns the updated Order. */
export async function documentAdministration(
  orderId: string, adminId: string, action: AdministrationAction, actor: string, jobTitle: JobTitle, reason?: string,
): Promise<Order | null> {
  if (!hasPermission(jobTitle, 'meds.administer')) return respond(null, 120)
  const r = await apiPost<Order>(
    `/api/icu/mar/${encodeURIComponent(orderId)}/administrations/${encodeURIComponent(adminId)}`,
    'administer', { action, ...(reason ? { reason } : {}) })
  if (r.kind === 'ok') return r.data
  if (r.kind === 'denied') return null
  if (import.meta.env.VITE_APP_ENV !== 'production') return respond(applyAdministration(orderId, adminId, action, actor, reason), 120)
  throw apiUnavailable('administration documentation')
}

/* ---------------- Laboratory & Imaging results domain (Screen 6) ----------------
   REAL service since Stage 10 Phase 3 (ASP.NET Core + SQLite in /server) —
   the first domain with server-side RBAC: acknowledge requires the
   results.acknowledge permission derived from the JWT's jobTitle claim ON
   THE SERVER; a nurse token gets 403 regardless of the UI. The client
   hasPermission checks below REMAIN as defense in depth. The acknowledging
   actor is server-derived from the token — the `actor` argument is only
   used on the mock fallback path. Mission Control's lab-trend card stays a
   client-side derived view (chart presentation metadata is not served). */

/** GET /api/icu/results/labs?patientId — REAL endpoint; mock fallback. */
export async function getLabDraws(patientId: string): Promise<LabDraw[]> {
  const real = await apiGet<LabDraw[]>(`/api/icu/results/labs?patientId=${encodeURIComponent(patientId)}`, 'labs')
  if (real != null) return real
  if (import.meta.env.VITE_APP_ENV !== 'production') return respond(labDrawsFor(patientId), 120)
  throw apiUnavailable('labs')
}

/** POST /api/icu/results/labs/document — MANUALLY DOCUMENT a lab result
 *  (Lab Result-Entry design). The ICU bedside team transcribes a paper
 *  central-lab report or enters a bedside ABG. REAL-ONLY write (like
 *  observations/ADT): documenting a result is a clinical record and is
 *  never applied to local mock state. The payload is lean — the server
 *  derives unit/refRange/flag from the catalogue, the label from the test
 *  name, the documenting clinician + time + encounter + order linkage, and
 *  stamps source=manual. RBAC is results.document, re-enforced server-side. */
export function documentLabResult(draft: DocumentLabDraft): Promise<AdtWriteResult<LabDraw>> {
  return usersWrite<LabDraw>('/api/icu/results/labs/document', 'lab result documentation', draft)
}

/** POST /api/icu/results/labs/document-custom — document a CUSTOM / OTHER lab
 *  test (Custom Lab Test design): a free-text, UNSTRUCTURED, UNFLAGGED result
 *  for a test the catalogue lacks. Same results.document authority and
 *  REAL-ONLY discipline as the structured path; the server stamps provenance
 *  + source=manual and stores it tagged custom with NO clinical flag. */
/** POST /api/icu/results/imaging/document — Imaging Result Entry: document
 *  the PAPER radiology report (same results.document authority as labs).
 *  Linked (orderId → the order supplies the study identity and is
 *  fulfilled) or honestly UNLINKED (study type picked directly). Critical
 *  is CLINICIAN-MARKED — never system-derived. REAL-ONLY write. */
export function documentImagingReport(draft: DocumentImagingDraft): Promise<AdtWriteResult<ImagingStudy>> {
  return usersWrite<ImagingStudy>('/api/icu/results/imaging/document', 'imaging report documentation', draft)
}

export function documentCustomLabResult(draft: DocumentCustomLabDraft): Promise<AdtWriteResult<LabDraw>> {
  return usersWrite<LabDraw>('/api/icu/results/labs/document-custom', 'custom lab result documentation', draft)
}

/** POST /api/icu/results/labs/:labId/correct — the two-tier CORRECTION of a
 *  documented lab result (Lab Result Editing design; mirrors the observation
 *  amendment). Tier-1 (documenter, ≤5 min) sends no reason; Tier-2
 *  (Consultant-tier) requires it — the SERVER decides the tier; the client
 *  hints are display only. Amend-not-erase: the correction history rides on
 *  the returned result. REAL-ONLY write. */
export function correctLabResult(labId: string, draft: CorrectLabDraft): Promise<AdtWriteResult<LabDraw>> {
  return usersWrite<LabDraw>(
    `/api/icu/results/labs/${encodeURIComponent(labId)}/correct`, 'lab result correction', draft)
}

/** POST /api/icu/results/imaging/:studyId/correct — the SAME two-tier
 *  correction for a documented imaging report (Imaging Report Correction —
 *  the PR #80 model, verbatim). Correctable: findings, impression,
 *  performedAt, reportingRadiologist, note, and the clinician-marked
 *  critical flag. Amend-not-erase; §2b visibility on acknowledged reports.
 *  REAL-ONLY write. */
export function correctImagingReport(studyId: string, draft: CorrectImagingDraft): Promise<AdtWriteResult<ImagingStudy>> {
  return usersWrite<ImagingStudy>(
    `/api/icu/results/imaging/${encodeURIComponent(studyId)}/correct`, 'imaging report correction', draft)
}

/** GET /api/icu/results/imaging?patientId — REAL endpoint; mock fallback. */
export async function getImagingStudies(patientId: string): Promise<ImagingStudy[]> {
  const real = await apiGet<ImagingStudy[]>(`/api/icu/results/imaging?patientId=${encodeURIComponent(patientId)}`, 'imaging')
  if (real != null) return real
  if (import.meta.env.VITE_APP_ENV !== 'production') return respond(imagingFor(patientId), 120)
  throw apiUnavailable('imaging')
}

/** GET /api/icu/results/inbox — unit-wide unacknowledged results, DERIVED
 *  server-side at read time (REAL endpoint; mock fallback). */
export async function getResultInbox(): Promise<ResultInboxItem[]> {
  const real = await apiGet<ResultInboxItem[]>('/api/icu/results/inbox', 'results inbox')
  if (real != null) return real
  if (import.meta.env.VITE_APP_ENV !== 'production') return respond(deriveResultInbox(), 120)
  throw apiUnavailable('results inbox')
}

/** POST /api/icu/results/labs/:labId/acknowledge — REAL endpoint; requires
 *  results.acknowledge (checked client-side AND re-enforced server-side). */
export async function acknowledgeLab(labId: string, actor: string, jobTitle: JobTitle): Promise<LabDraw | null> {
  if (!hasPermission(jobTitle, 'results.acknowledge')) return respond(null, 120)
  const r = await apiPost<LabDraw>(`/api/icu/results/labs/${encodeURIComponent(labId)}/acknowledge`, 'acknowledge')
  if (r.kind === 'ok') return r.data
  if (r.kind === 'denied') return null
  if (import.meta.env.VITE_APP_ENV !== 'production') return respond(applyAcknowledgeLab(labId, actor, nowHm()), 120)
  throw apiUnavailable('acknowledge result')
}

/** POST /api/icu/results/imaging/:studyId/acknowledge — REAL endpoint; same RBAC. */
export async function acknowledgeImaging(studyId: string, actor: string, jobTitle: JobTitle): Promise<ImagingStudy | null> {
  if (!hasPermission(jobTitle, 'results.acknowledge')) return respond(null, 120)
  const r = await apiPost<ImagingStudy>(`/api/icu/results/imaging/${encodeURIComponent(studyId)}/acknowledge`, 'acknowledge')
  if (r.kind === 'ok') return r.data
  if (r.kind === 'denied') return null
  if (import.meta.env.VITE_APP_ENV !== 'production') return respond(applyAcknowledgeImaging(studyId, actor, nowHm()), 120)
  throw apiUnavailable('acknowledge result')
}

/** Convenience dispatcher for inbox items (lab or imaging). Resolves truthy on success. */
export function acknowledgeResult(
  kind: 'lab' | 'imaging', id: string, actor: string, jobTitle: JobTitle,
): Promise<LabDraw | ImagingStudy | null> {
  return kind === 'lab' ? acknowledgeLab(id, actor, jobTitle) : acknowledgeImaging(id, actor, jobTitle)
}

/** POST /api/icu/results/labs/:labId/unacknowledge — REVERSE an
 *  acknowledgment (results audit PR). Same RBAC as acknowledge; a REQUIRED
 *  reason is validated server-side. Never a deletion: the server keeps the
 *  original acknowledgment in the result's audit history and the result
 *  returns to the inbox. Offline mock apply clears the summary only (the
 *  audited record is the server's). */
export async function unacknowledgeLab(labId: string, reason: string, jobTitle: JobTitle): Promise<LabDraw | null> {
  if (!hasPermission(jobTitle, 'results.acknowledge')) return respond(null, 120)
  const r = await apiPost<LabDraw>(
    `/api/icu/results/labs/${encodeURIComponent(labId)}/unacknowledge`, 'unacknowledge', { reason })
  if (r.kind === 'ok') return r.data
  if (r.kind === 'denied') return null
  if (import.meta.env.VITE_APP_ENV !== 'production') return respond(applyUnacknowledgeLab(labId), 120)
  throw apiUnavailable('unacknowledge result')
}

/** POST /api/icu/results/imaging/:studyId/unacknowledge — same semantics. */
export async function unacknowledgeImaging(studyId: string, reason: string, jobTitle: JobTitle): Promise<ImagingStudy | null> {
  if (!hasPermission(jobTitle, 'results.acknowledge')) return respond(null, 120)
  const r = await apiPost<ImagingStudy>(
    `/api/icu/results/imaging/${encodeURIComponent(studyId)}/unacknowledge`, 'unacknowledge', { reason })
  if (r.kind === 'ok') return r.data
  if (r.kind === 'denied') return null
  if (import.meta.env.VITE_APP_ENV !== 'production') return respond(applyUnacknowledgeImaging(studyId), 120)
  throw apiUnavailable('unacknowledge result')
}

/* ---------------- Timeline domain (Screen 7) ----------------
   Read-only aggregation with NO store of its own — the same rule holds on
   the server (`GET /api/icu/timeline?patientId` derives, never stores).

   THE SEAM (Stage 10 Phase 3 Timeline): the server derives the four
   categories it can reach from real domains — order/med (order audit
   history incl. MAR administrations), lab, imaging. The four remaining
   sources are still mock this phase, so this adapter is a HYBRID: it
   fetches the real events and merges them client-side with the mock
   categories below, then sorts into one chronological feed. When those
   domains migrate they move server-side and simply drop out of
   MOCK_TIMELINE_CATEGORIES — the merge/sort code does NOT change. The
   split guarantees no event appears twice (the two sets are disjoint).
   Server-derived (do NOT also take from mock): order, med, lab, imaging. */
const MOCK_TIMELINE_CATEGORIES = ['task', 'io', 'consult', 'note'] as const
const isMockTimelineCategory = (c: TimelineEvent['category']): boolean =>
  (MOCK_TIMELINE_CATEGORIES as readonly string[]).includes(c)

/** GET /api/icu/timeline?patientId — server-derived events merged with the
 *  still-mock sources; newest first. Full mock feed on fallback. */
export async function getTimeline(patientId: string): Promise<TimelineEvent[]> {
  const real = await apiGet<TimelineEvent[]>(`/api/icu/timeline?patientId=${encodeURIComponent(patientId)}`, 'timeline')
  if (!real) {
    if (import.meta.env.VITE_APP_ENV !== 'production') return respond(deriveTimeline(patientId), 150)
    throw apiUnavailable('timeline')
  }
  /* merge: real server events (order/med/lab/imaging) + ONLY the still-mock
     categories from the mock derivation — no overlap, so no duplication.
     PRODUCTION serves the server-derived categories alone: the four mock
     feeds do not exist there (they are demo data), so the feed honestly
     shows what the system of record actually has. */
  if (import.meta.env.VITE_APP_ENV !== 'production') {
    const mockPart = deriveTimeline(patientId).filter(e => isMockTimelineCategory(e.category))
    const merged = [...real, ...mockPart].sort((a, b) => timestampMinutes(b.time) - timestampMinutes(a.time))
    return respond(merged, 0)
  }
  return respond([...real].sort((a, b) => timestampMinutes(b.time) - timestampMinutes(a.time)), 0)
}

/* getClinicalNotes is RETIRED (Phase 3 PR 1, owner's decision (c)): a
   dead export — no screen ever called it. Clinical notes remain a
   future domain; the mock notes STORE (data/notes.ts) still feeds the
   demo timeline's `note` category via deriveTimeline. */

/* ---------------- AI Assistant — grounded query chat ----------------
   THE SIMULATED RISK DOMAIN IS DELETED (remove, don't label): the seeded
   probabilities, the ranked rail, trend/factor derivations — all of it.
   What replaces it is ONE translation endpoint: the server turns a
   natural-language question into a structured tool call (the LLM emits a
   QUERY, never a VALUE) and audits the question as patient-data access.
   The CLIENT executes the returned tool through the canonical reads in
   this file, on the user's own token — see src/lib/ai/tools.ts. */

/** POST /api/icu/ai/query — translate a question into ONE tool call.
 *  REAL-ONLY (no mock model exists — a simulated translation would be the
 *  retired fabrication in a new coat): offline/dev-without-server gets the
 *  same honest "not reachable" the real-only reads use. Returns the
 *  translation, or a structured refusal { unanswerable }, or throws with
 *  the server's precise error (503 no model configured / 502 provider). */
export async function aiTranslateQuery(
  question: string, contextPatientId: string | null, history: { question: string; tool: string | null }[],
): Promise<AiQueryResponse> {
  const token = getToken()
  const controller = new AbortController()
  /* generous ceiling ABOVE the server's own AI_TIMEOUT_SECONDS bound
     (max 600 s): the server is the one honest timeout authority — the
     client must never undercut a CPU-only deployment's raised limit.
     Measured basis: a cold full-catalog translation took ~60 s on a
     4-vCPU host; warm calls ~5–12 s. */
  const timer = setTimeout(() => controller.abort(), 610000)
  try {
    const res = await fetch(`${API_BASE}/api/icu/ai/query`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({
        question,
        contextPatientId,
        /* conversation memory on the wire: the last 6 (question, tool)
           pairs — never tool RESULTS, so patient data never rides back */
        history: history.slice(-6).map(h => ({ question: h.question, tool: h.tool })),
      }),
    })
    const body = await res.json().catch(() => null)
    if (res.ok) return body as AiQueryResponse
    throw new Error((body as { error?: string } | null)?.error
      ?? `the AI query endpoint returned ${res.status}`)
  } catch (e) {
    if (e instanceof Error && e.name !== 'AbortError') throw e
    throw new Error('the AI service is not reachable in this session')
  } finally {
    clearTimeout(timer)
  }
}

/** POST /api/icu/ai/interpret — the INTERPRETATION LAYER (owner's
 *  2026-07-18 decision): labeled AI commentary on a data snapshot this
 *  client just fetched and rendered. REAL-ONLY like the query endpoint
 *  (no mock interpretation exists — simulated commentary would be the
 *  retired fabrication again). The snapshot is exactly what is on
 *  screen; the server reads no patient rows for this call. Throws with
 *  the server's precise error (honest 503 when no model / 502 provider). */
export async function aiInterpretCondition(
  question: string, patient: string, data: unknown,
): Promise<{ text: string }> {
  const token = getToken()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 610000)
  try {
    const res = await fetch(`${API_BASE}/api/icu/ai/interpret`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ question, patient, data }),
    })
    const body = await res.json().catch(() => null)
    if (res.ok) return body as { text: string }
    throw new Error((body as { error?: string } | null)?.error
      ?? `the AI interpret endpoint returned ${res.status}`)
  } catch (e) {
    if (e instanceof Error && e.name !== 'AbortError') throw e
    throw new Error('the AI service is not reachable in this session')
  } finally {
    clearTimeout(timer)
  }
}

/* ---------------- Layer 2 — ADT (Aurora Core) ----------------
   The first Core-native domain and the first write feature on the durable
   database. READS fall back to display-only mock derivations offline;
   WRITES are REAL-ONLY — ADT is the system of record, so an admission/
   discharge/transfer is never applied to local mock state (unlike the
   Stage 9-era offline apply of the transactional domains). A rejected
   write surfaces the server's precise {error}. */

export type AdtWriteResult<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'rejected'; error: string }
  | { kind: 'offline' }

async function adtPost<T>(path: string, what: string, body?: unknown,
  method: 'POST' | 'PUT' = 'POST'): Promise<AdtWriteResult<T>> {
  if (import.meta.env.VITE_APP_ENV !== 'production' && runtimeApiBase === null) return { kind: 'offline' }
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS)
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      signal: ctrl.signal,
      headers: { ...authHeaders(), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    clearTimeout(timer)
    if (res.ok) return { kind: 'ok', data: (await res.json()) as T }
    if (res.status === 401) {
      console.info(`[aurora] ${what} API responded 401 — ADT writes require the live server`)
      return { kind: 'offline' }
    }
    const err = (await res.json().catch(() => null)) as { error?: string } | null
    console.info(`[aurora] ${what} API rejected the action (${res.status})`)
    return { kind: 'rejected', error: err?.error ?? `Rejected (${res.status})` }
  } catch {
    console.info(`[aurora] ${what} API unreachable — ADT writes require the live server`)
    return { kind: 'offline' }
  }
}

/** GET /api/icu/adt/beds — bed registry with DERIVED occupancy (REAL
 *  endpoint; display-only mock fallback). */
export async function getAdtBeds(): Promise<AdtBed[]> {
  const real = await apiGet<AdtBed[]>('/api/icu/adt/beds', 'ADT beds')
  if (real != null) return real
  if (import.meta.env.VITE_APP_ENV !== 'production') return respond(mockAdtBeds(), 120)
  throw apiUnavailable('ADT beds')
}

/** GET /api/icu/adt/encounters?patientId&status — encounter list (REAL
 *  endpoint; display-only mock fallback derives OPEN encounters from the
 *  mock roster — historical/discharged encounters exist only server-side). */
export async function getEncounters(filter?: { patientId?: string; status?: 'open' | 'discharged' }): Promise<Encounter[]> {
  const params = new URLSearchParams()
  if (filter?.patientId) params.set('patientId', filter.patientId)
  if (filter?.status) params.set('status', filter.status)
  const qs = params.toString()
  const real = await apiGet<Encounter[]>(`/api/icu/adt/encounters${qs ? `?${qs}` : ''}`, 'ADT encounters')
  if (real) return real
  if (import.meta.env.VITE_APP_ENV !== 'production') {
    if (filter?.status === 'discharged') return respond([], 120)
    const open = allPatients()
      .filter(p => !filter?.patientId || p.patientId === filter.patientId)
      .map((p): Encounter => ({
        encounterId: `ENC-${p.patientId.slice(2)}`,
        patientId: p.patientId, patientName: p.name, bedId: p.bedId,
        diagnosis: p.diagnosis, attending: p.attending, status: 'open',
        admittedAt: '', admittedBy: '', events: [],
      }))
    return respond(open, 120)
  }
  throw apiUnavailable('encounters')
}

/** GET /api/icu/adt/patients/:patientId — the Core PATIENT-IDENTITY read
 *  (person-level identity by id; resolves whether or not the patient is
 *  admitted — the fix for the recorded discharged-patient identity gap).
 *  STRICTLY REAL-ONLY, deliberately: identity on a printed document must
 *  come from the system of record or be visibly absent — a mock/offline
 *  substitute here could print ANOTHER record's data as if it were the
 *  chart (adversarial-review finding). Every non-200 — a genuine 404,
 *  403/5xx, offline, or pure mock mode — resolves null, and the caller's
 *  remaining rungs (mock roster / encounter snapshot) carry the mock and
 *  offline cases with their own honest provenance. */
export async function getPatientIdentity(patientId: string): Promise<PatientIdentity | null> {
  if (import.meta.env.VITE_APP_ENV !== 'production' && runtimeApiBase === null) return null
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS)
    const res = await fetch(`${API_BASE}/api/icu/adt/patients/${encodeURIComponent(patientId)}`,
      { signal: ctrl.signal, headers: authHeaders() })
    clearTimeout(timer)
    if (res.ok) return (await res.json()) as PatientIdentity
    console.info(`[aurora] patient identity API responded ${res.status} — no fallback (real-only read)`)
  } catch {
    console.info('[aurora] patient identity API unreachable — no fallback (real-only read)')
  }
  return null
}

/** PUT /api/icu/adt/encounters/:encounterId/measurements — Weight & Height
 *  capture, ENCOUNTER-SCOPED: add when omitted at admission, correct a
 *  wrong value — amend-not-erase server-side (who/when/prior on THIS
 *  encounter's measurement history; other admissions' values are never
 *  touched). RBAC patients.measure (doctor/nurse). REAL-ONLY write;
 *  returns the updated Encounter. */
export function updateEncounterMeasurements(encounterId: string, draft: MeasureDraft): Promise<AdtWriteResult<Encounter>> {
  return adtPost<Encounter>(
    `/api/icu/adt/encounters/${encodeURIComponent(encounterId)}/measurements`,
    'ADT measurements', draft, 'PUT')
}

/** POST /api/icu/adt/admissions — doctor RBAC (adt.admit). REAL-ONLY write. */
export function admitPatient(draft: AdmitDraft): Promise<AdtWriteResult<AdmitResponse>> {
  return adtPost<AdmitResponse>('/api/icu/adt/admissions', 'ADT admission', draft)
}

/** POST /api/icu/adt/patients/match — the ON-SUBMIT identity match
 *  (match+overview design): checks for an existing patient BEFORE
 *  anything is created. READ-ONLY despite the verb (the national ID must
 *  never ride a URL). RBAC patients.view — the identity-only card is
 *  census-class data, so the registering clerk can run the check.
 *  REAL-ONLY like every ADT interaction: offline means the admission
 *  itself could not proceed either, so nothing is created. */
export function matchPatient(draft: MatchPatientDraft): Promise<AdtWriteResult<MatchPatientResponse>> {
  return adtPost<MatchPatientResponse>('/api/icu/adt/patients/match', 'patient match', draft)
}

/** PUT /api/icu/adt/patients/:patientId/identity — the AUDITED identity
 *  correction (office Administrator RBAC, identity.correct): name /
 *  national ID / DOB with a required reason; amend-never-erase — the
 *  previous identity is preserved in the patient's identity history.
 *  REAL-ONLY write; returns the updated PatientIdentity. */
export function correctPatientIdentity(patientId: string, draft: CorrectIdentityDraft): Promise<AdtWriteResult<PatientIdentity>> {
  return adtPost<PatientIdentity>(
    `/api/icu/adt/patients/${encodeURIComponent(patientId)}/identity`,
    'identity correction', draft, 'PUT')
}

/** Discharge-disposition vocabulary (matches the server's AdtLogic.Dispositions)
 *  with display labels — the OUTCOME of the ICU stay, captured at discharge.
 *  "died" over dispositioned discharges = ICU mortality (computable going
 *  forward; discharges without a recorded disposition are excluded from the
 *  denominator, never fabricated). */
export const DISPOSITIONS: { code: DispositionCode; label: string }[] = [
  { code: 'home', label: 'Home' },
  { code: 'ward', label: 'Ward (step-down / general floor)' },
  { code: 'transfer_out', label: 'Another facility / transfer out' },
  { code: 'higher_care', label: 'Higher care / another ICU' },
  { code: 'died', label: 'Died' },
  { code: 'other', label: 'Other' },
]

/** display label for a stored disposition code ('' for absent/unknown) */
export const dispositionLabel = (code: string | undefined): string =>
  DISPOSITIONS.find(d => d.code === code)?.label ?? ''

/** POST /api/icu/adt/encounters/:id/discharge — doctor RBAC (adt.discharge).
 *  REAL-ONLY write. The disposition (the stay's outcome) is REQUIRED by the
 *  UI flow; the API accepts its absence (recorded as "not recorded" — the
 *  body-less form every deployed suite's discharge/cleanup legs use). */
export function dischargeEncounter(encounterId: string, disposition?: DispositionCode): Promise<AdtWriteResult<Encounter>> {
  return adtPost<Encounter>(
    `/api/icu/adt/encounters/${encodeURIComponent(encounterId)}/discharge`, 'ADT discharge',
    disposition ? { disposition } : undefined)
}

/** POST /api/icu/adt/encounters/:id/transfer — NURSE RBAC (adt.transfer). REAL-ONLY write. */
export function transferEncounter(encounterId: string, bedId: string): Promise<AdtWriteResult<Encounter>> {
  return adtPost<Encounter>(`/api/icu/adt/encounters/${encodeURIComponent(encounterId)}/transfer`, 'ADT transfer', { bedId })
}

/* ---------------- Layer 3 — User Administration (Aurora Core) ----------------
   Administrator-only (users.manage — server-enforced on every endpoint;
   these client checks are defense in depth). Accounts are the durable
   system of record for identity, so WRITES are REAL-ONLY like ADT — a
   user is never created/edited against local mock state. The list READ
   falls back to a display-only derivation from the Stage 9 preset staff
   (no audit history offline). Deactivation is a status change, never a
   delete. */

async function usersWrite<T>(path: string, what: string, body?: unknown, method: 'POST' | 'PUT' | 'DELETE' = 'POST'): Promise<AdtWriteResult<T>> {
  if (import.meta.env.VITE_APP_ENV !== 'production' && runtimeApiBase === null) return { kind: 'offline' }
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS)
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      signal: ctrl.signal,
      headers: { ...authHeaders(), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    clearTimeout(timer)
    if (res.ok) return { kind: 'ok', data: (await res.json()) as T }
    if (res.status === 401) {
      console.info(`[aurora] ${what} API responded 401 — user administration requires the live server`)
      return { kind: 'offline' }
    }
    const err = (await res.json().catch(() => null)) as { error?: string } | null
    console.info(`[aurora] ${what} API rejected the action (${res.status})`)
    return { kind: 'rejected', error: err?.error ?? `Rejected (${res.status})` }
  } catch {
    console.info(`[aurora] ${what} API unreachable — user administration requires the live server`)
    return { kind: 'offline' }
  }
}

/** GET /api/icu/users — every account incl. deactivated (REAL endpoint;
 *  display-only fallback derives from the Stage 9 preset staff). */
export async function getUsers(): Promise<UserAccount[]> {
  const real = await apiGet<UserAccount[]>('/api/icu/users', 'users')
  if (real) return real
  if (import.meta.env.VITE_APP_ENV !== 'production') {
    const offline = SAMPLE_STAFF
      .map((s): UserAccount => ({
        username: usernameOf(s.name), name: s.name, jobTitle: s.jobTitle,
        roles: [s.jobTitle], active: true, mustChangePassword: false, events: [],
      }))
      .sort((a, b) => (a.username < b.username ? -1 : 1))
    return respond(offline, 120)
  }
  throw apiUnavailable('user accounts')
}

/** POST /api/icu/users — create an account (admin-set initial password;
 *  clinical titles require a justification). REAL-ONLY write. */
export function createUser(draft: CreateUserDraft): Promise<AdtWriteResult<UserAccount>> {
  return usersWrite<UserAccount>('/api/icu/users', 'user create', draft)
}

/** PUT /api/icu/users/:username — edit name/job title (clinical grants
 *  require a justification; self-demotion is server-rejected). REAL-ONLY. */
export function editUser(username: string, draft: EditUserDraft): Promise<AdtWriteResult<UserAccount>> {
  return usersWrite<UserAccount>(`/api/icu/users/${encodeURIComponent(username)}`, 'user edit', draft, 'PUT')
}

/** POST /api/icu/users/:username/deactivate — status change, never a
 *  delete (self and last-active-admin are server-rejected). REAL-ONLY. */
export function deactivateUser(username: string): Promise<AdtWriteResult<UserAccount>> {
  return usersWrite<UserAccount>(`/api/icu/users/${encodeURIComponent(username)}/deactivate`, 'user deactivate')
}

/** POST /api/icu/users/:username/reactivate — REAL-ONLY write. */
export function reactivateUser(username: string): Promise<AdtWriteResult<UserAccount>> {
  return usersWrite<UserAccount>(`/api/icu/users/${encodeURIComponent(username)}/reactivate`, 'user reactivate')
}

/** POST /api/icu/users/:username/reset-password — sets a new password;
 *  the old one is never revealed or transmitted. REAL-ONLY write. */
export function resetUserPassword(username: string, newPassword: string): Promise<AdtWriteResult<UserAccount>> {
  return usersWrite<UserAccount>(`/api/icu/users/${encodeURIComponent(username)}/reset-password`, 'password reset', { newPassword })
}

/* ---------------- Stage 11 — Observations (Aurora Core clinical store) ----------------
   REAL-ONLY domain, reads included: observations are the bedside clinical
   record and have NO mock store — the honest-data rule (design §5): a
   value with no real observation is blank, never simulated. A dev session
   without the API sees an explicit unavailable state instead of demo
   observations; writes are REAL-ONLY like ADT/users (a chart entry is
   never written to local mock state). RBAC is server-enforced
   (observations.record / observations.correct / observations.configure);
   the client checks are defense in depth. */

/** GET /api/icu/observations/catalog — the Observation Type Catalogue
 *  (Pillar 2): groups in clinical order with their type definitions;
 *  disabled groups included. Null = API unreachable (the screen says so). */
export async function getObservationCatalog(): Promise<ObsCatalogGroup[] | null> {
  const real = await apiGet<ObsCatalogGroup[]>('/api/icu/observations/catalog', 'observation catalogue')
  if (real) return real
  if (import.meta.env.VITE_APP_ENV !== 'production') return null
  throw apiUnavailable('observation catalogue')
}

/** GET /api/icu/observations?patientId(&encounterId) — the patient's
 *  chart, oldest first (server-ordered); optionally scoped to ONE
 *  encounter (bedside documents are episode-scoped — a readmission's
 *  flowsheet never carries a prior stay). Null = API unreachable —
 *  NEVER simulated. */
export async function getObservations(patientId: string, encounterId?: string): Promise<Observation[] | null> {
  const real = await apiGet<Observation[]>(
    `/api/icu/observations?patientId=${encodeURIComponent(patientId)}`
    + (encounterId ? `&encounterId=${encodeURIComponent(encounterId)}` : ''), 'observations')
  if (real) return real
  if (import.meta.env.VITE_APP_ENV !== 'production') return null
  throw apiUnavailable('observations')
}

/** POST /api/icu/observations — chart a manual round (many entries, one
 *  server-stamped clinicalTime) or an ad-hoc entry (one entry — same
 *  request, §10). The payload carries ONLY typeCode→value pairs:
 *  time/provenance/actor/unit/encounterId are server-owned (§2/§7) and a
 *  payload claiming them fails binding. REAL-ONLY write. */
export function chartObservations(patientId: string, entries: NewObservationEntry[]): Promise<AdtWriteResult<Observation[]>> {
  return usersWrite<Observation[]>('/api/icu/observations', 'observation charting', { patientId, entries })
}

/** POST /api/icu/observations/:id/correct — the §8 two-tier amendment.
 *  Tier-1 (own entry, inside the 5-minute window) sends only the value —
 *  no reason (Q1); tier-2 (Consultant-tier) requires the reason. The
 *  server decides the tier — the client hint is display only. REAL-ONLY. */
export function correctObservation(observationId: string, value: ObsEntryValue, reason?: string): Promise<AdtWriteResult<Observation>> {
  return usersWrite<Observation>(
    `/api/icu/observations/${encodeURIComponent(observationId)}/correct`,
    'observation correction',
    { value, ...(reason !== undefined && reason.trim() !== '' ? { reason } : {}) })
}
