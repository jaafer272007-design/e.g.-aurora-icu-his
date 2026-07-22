/* Mock API adapters.
   Each function mirrors a future ASP.NET Core endpoint (route noted per
   function) and resolves with the exact response shape the real endpoint
   will return. Replacing these bodies with `fetch` calls is the only change
   needed at API-integration time (Stage 10). */

import type {
  ActionQueuesResponse, AdministrationAction, AdmitDraft, AdmitResponse, AdtBed, AiQueryResponse, AssignedPatient, Assignment, AttendingOption, CorrectIdentityDraft, BedsResponse, Consult, CorrectImagingDraft, CorrectLabDraft, CodeStatusEntry, CoverageRow, CoverageStaff, CreateBedDraft, CreateDrugDraft, CreateImagingStudyDraft, CreateLabTestDraft, CreateUserDraft, DerivedUnitSummary, DispositionCode, DocumentCustomLabDraft, DocumentLabDraft, EditDrugDraft, EditHospitalIdentityDraft, EditImagingStudyDraft, EditLabTestDraft, EditUserDraft, Encounter, FormularyDrug, HospitalIdentity, HospitalIdentityWithHistory, LabTest, MatchPatientDraft, MatchPatientResponse, PatientSearchResponse, MeasureDraft, OrderSetItemTemplate,
  DocumentImagingDraft, FormularyEvent, HandoffEntry, ImagingStudy, InteractionRule, IoEntry, LabDraw, Labs, Infusion, MarRow, MedicationDetails,
  NewIoEntry, NewObservationEntry, NewOrderDraft, NursingTask, ObsCatalogGroup, ObsEntryValue, Observation, ObservationType, Order, OrderSetDef,
  ImagingStudyDef, Patient, PatientDetailResponse, PatientIdentity, PatientSummary, ResultInboxItem,
  MineWorklist, Removal, RosterRecordDto, RoundingPatient, TimelineEvent, UnitSummaryResponse, UserAccount,
  DispositionEntry, FrequencyEntry, IsolationTypeEntry, ShiftEntry,
} from './types'
import { runtimeApiBase } from '../runtimeConfig'
import { composeBedsResponse } from './bedboard'
import { BEDS_RESPONSE, UNIT_SUMMARY, mockAdtBeds } from './data/beds'
import { allPatients, derivedAlertCount } from './data/patients'
import { ROSTER, rosterFor } from './data/roster'
import { GOALS, INFUSIONS, PATIENT_ALERTS } from './data/panels'
import { latestObservations, projectHemodynamics, projectVentilator } from './bedside'
import { ACTION_QUEUES } from './data/workspace'
import { IO_ENTRIES, NURSING_TASKS, applyTaskToggle, insertIoEntry } from './data/nursing'
import { MOCK_NURSES, mockCoverage, mockMine, mockRemove, mockRestore } from './data/assignments'
import { allConsults } from './data/consults'
import { deriveTimeline } from './data/timeline'
import { FORMULARY, INTERACTION_RULES, NAMED_FREQUENCIES, ORDER_SET_DEFS } from './data/formulary'
import { CODE_STATUSES, DISPOSITION_ENTRIES, FREQUENCY_ENTRIES, HOSPITAL_IDENTITY, IMAGING_CATALOG, ISOLATION_TYPE_ENTRIES, SHIFT_ENTRIES } from './data/config'
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
import { datedEpoch, dayOffsetOf, localDayNumber, nowHm, setServerClock, timestampMinutes } from '../time'

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
 *  discharges falling on today's server-local day — the server stamps
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
  /* "today" on the DISPLAY CLOCK (Locale/Timezone §1): the day boundary
     staff experience is the server's local midnight, not UTC's — the
     stored stamps stay UTC and convert here at read */
  const todayNo = localDayNumber(Date.now())
  const isToday = (t: string | null | undefined): boolean => {
    const ms = t ? datedEpoch(t) : null
    return ms !== null && localDayNumber(ms) === todayNo
  }
  const criticalResults = inbox === null ? null : inbox.filter(r => r.flag === 'critical')
  return {
    admissionsToday: encounters.filter(e => isToday(e.admittedAt)).length,
    dischargesToday: encounters.filter(e => e.status === 'discharged' && isToday(e.dischargedAt)).length,
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
/* SERVER-CLOCK PRIME (Locale/Timezone §1.3): before the first data read
   of a session resolves, fetch the anonymous hospital-identity record —
   the one boot read — and hand its serverTimeZone/serverUtcOffsetMinutes
   to the display clock (src/lib/time.ts). Timestamps only render from
   fetched data, and every read below awaits this once, so no
   timestamp-bearing screen paints on the wrong clock. sessionStorage
   makes reloads synchronous; the serverless mock demo (apiBaseUrl null)
   has no server clock and honestly renders the device's own. An
   unreachable server resolves without a clock — those same reads are
   falling back to mock anyway, and the next successful session primes. */
const clockReady: Promise<void> = (() => {
  if (import.meta.env.VITE_APP_ENV !== 'production' && runtimeApiBase === null) return Promise.resolve()
  try { if (sessionStorage.getItem('aurora.serverClock') !== null) return Promise.resolve() } catch { /* private mode */ }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS)
  return fetch(`${API_BASE}/api/icu/hospital-identity`, { signal: ctrl.signal })
    .then(res => (res.ok ? (res.json() as Promise<HospitalIdentity>) : null))
    .then(d => {
      if (d?.serverTimeZone !== undefined && d.serverUtcOffsetMinutes !== undefined)
        setServerClock(d.serverTimeZone, d.serverUtcOffsetMinutes)
    })
    .catch(() => { /* asleep/unreachable — reads fall back to mock; primes next session */ })
    .finally(() => clearTimeout(timer))
})()

async function apiGet<T>(path: string, what: string): Promise<T | null> {
  if (import.meta.env.VITE_APP_ENV !== 'production' && runtimeApiBase === null) return null
  await clockReady
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
  await clockReady
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
  isolationTypes: r.isolationTypes,
  fullName: r.fullName,
  nationalId: r.nationalId,
  fileNumber: r.fileNumber,
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
      /* an EMPTY roster is a real answer in production (a fresh install
         has zero patients — the bed board renders empty, never the
         API-unavailable refusal). Dev/staging keep treating empty as
         "fall back to the demo roster" so the prototype stays populated
         against an unseeded local server. Found by the Config Home
         fresh-install verification. */
      if (Array.isArray(roster) &&
        (roster.length > 0 || import.meta.env.VITE_APP_ENV === 'production')) return roster
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
  codeStatusCode: r.codeStatusCode,
  codeStatusLegacy: r.codeStatusLegacy,
  rhythm: r.rhythm,
  vitals: r.monitorVitals,
  /* organs is GONE from the wire — the digital twin derives organ status
     from the computed SOFA (score-backed or not made) */
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

/* ---------------- Assignment — the OPT-OUT coverage model (Aurora Core) ----------------
   REAL endpoints (/api/icu/assignments…) with the usual offline mock
   fallback. Doctors have NO assignment concept (every doctor covers
   every patient); every nurse covers every patient by default and
   exceptions are carved as removals. Worklist, never authority — with
   ZERO exceptions: nothing here gates any clinical action (the SBAR
   handoff gate is dropped), and the server refuses removing the LAST
   covering nurse (a patient never has zero coverage). */

const toAssignedPatient = (r: RosterRecordDto): AssignedPatient => ({
  patientId: r.patientId, bedId: r.bedId, name: r.name, age: r.age, sex: r.sex,
  diagnosis: r.diagnosis, allergies: r.allergies, codeStatus: r.codeStatus,
  codeStatusCode: r.codeStatusCode, codeStatusLegacy: r.codeStatusLegacy,
  flags: r.flags, isolation: r.isolation,
  vitals: r.bedsideVitals,
})

const toRoundingPatient = (r: RosterRecordDto): RoundingPatient => ({
  patientId: r.patientId, bedId: r.bedId, name: r.name, diagnosis: r.diagnosis,
  flags: r.flags,
})

/** the roster records for the join (real read; mock fallback offline) */
async function assignmentRoster(): Promise<RosterRecordDto[]> {
  const real = await fetchRosterRecords()
  if (real) return real
  if (import.meta.env.VITE_APP_ENV !== 'production') return clone(ROSTER) as RosterRecordDto[]
  throw apiUnavailable('roster')
}

/** GET /api/icu/assignments — the unit-wide COVERAGE read (everyone with
 *  patients.view: who is covering is basic clinical safety). Every open
 *  encounter with its covering nurses + removal exceptions. */
export async function getCoverage(patientId?: string): Promise<CoverageRow[]> {
  const q = patientId ? `?patientId=${encodeURIComponent(patientId)}` : ''
  const real = await apiGet<CoverageRow[]>(`/api/icu/assignments${q}`, 'coverage')
  if (real) return real
  if (import.meta.env.VITE_APP_ENV !== 'production') {
    const rows = mockCoverage()
    return respond(patientId ? rows.filter(r => r.patientId === patientId) : rows, 120)
  }
  throw apiUnavailable('coverage')
}

/** GET /api/icu/assignments/mine — the signed-in clinician's worklist.
 *  Server-derived from the TOKEN (#104); the wire states the model:
 *  nurse = all open patients minus my removals, doctor = ALL patients
 *  (no assignment concept). The mock mirrors the same rule locally. */
export async function getMyWorklist(name: string, jobTitle: JobTitle): Promise<MineWorklist> {
  const real = await apiGet<MineWorklist>('/api/icu/assignments/mine', 'my worklist')
  if (real) return real
  if (import.meta.env.VITE_APP_ENV !== 'production') {
    const profile = profileOf(jobTitle)
    const kind = profile === 'Nurse' ? 'nurse' as const
      : profile === 'Doctor' || profile === 'SeniorDoctor' ? 'doctor' as const : null
    return respond(mockMine(kind, usernameOf(name)), 120)
  }
  throw apiUnavailable('my worklist')
}

/** GET /api/icu/assignments/staff — the coverage-manager picker: the
 *  active nurses coverage derives from (assignments.manage). */
export async function getCoverageStaff(): Promise<CoverageStaff[]> {
  const real = await apiGet<CoverageStaff[]>('/api/icu/assignments/staff', 'coverage staff')
  if (real) return real
  if (import.meta.env.VITE_APP_ENV !== 'production') return respond(MOCK_NURSES, 120)
  throw apiUnavailable('coverage staff')
}

/** GET /api/icu/assignments/history — the superseded #114 opt-in rows
 *  (audit preserved forever; no new rows are ever created). */
export async function getAssignmentHistory(patientId?: string): Promise<Assignment[]> {
  const q = patientId ? `?patientId=${encodeURIComponent(patientId)}` : ''
  const real = await apiGet<Assignment[]>(`/api/icu/assignments/history${q}`, 'assignment history')
  if (real) return real
  if (import.meta.env.VITE_APP_ENV !== 'production') return respond([], 120)
  throw apiUnavailable('assignment history')
}

export type RemovalWriteResult = { kind: 'ok'; removal: Removal } | { kind: 'rejected'; error: string }

/** POST /api/icu/assignments/remove — carve the exception
 *  (assignments.manage). 🔴 The server refuses removing the LAST
 *  covering nurse — a patient never has zero coverage. */
export async function removeNurse(
  patientId: string, userId: string, reason: string | undefined,
  actor: string, jobTitle: JobTitle,
): Promise<RemovalWriteResult> {
  if (!hasPermission(jobTitle, 'assignments.manage'))
    return { kind: 'rejected', error: 'Insufficient permissions' }
  const res = await adtPost<Removal>('/api/icu/assignments/remove', 'coverage removal',
    reason ? { patientId, userId, reason } : { patientId, userId })
  if (res.kind === 'ok') return { kind: 'ok', removal: res.data }
  if (res.kind === 'rejected') return { kind: 'rejected', error: res.error }
  if (import.meta.env.VITE_APP_ENV !== 'production') {
    const row = mockRemove(patientId, userId, reason, actor, jobTitle, nowHm())
    return 'error' in row ? { kind: 'rejected', error: row.error } : { kind: 'ok', removal: clone(row) }
  }
  throw apiUnavailable('coverage removal')
}

/** POST /api/icu/assignments/restore — undo the exception
 *  (assignments.manage; restored, never deleted). */
export async function restoreNurse(
  patientId: string, userId: string, actor: string, jobTitle: JobTitle,
): Promise<RemovalWriteResult> {
  if (!hasPermission(jobTitle, 'assignments.manage'))
    return { kind: 'rejected', error: 'Insufficient permissions' }
  const res = await adtPost<Removal>('/api/icu/assignments/restore', 'coverage restore', { patientId, userId })
  if (res.kind === 'ok') return { kind: 'ok', removal: res.data }
  if (res.kind === 'rejected') return { kind: 'rejected', error: res.error }
  if (import.meta.env.VITE_APP_ENV !== 'production') {
    const row = mockRestore(patientId, userId, actor, jobTitle, nowHm())
    return 'error' in row ? { kind: 'rejected', error: row.error } : { kind: 'ok', removal: clone(row) }
  }
  throw apiUnavailable('coverage restore')
}

/** the nurse workspace worklist: everything I cover (the OPT-OUT
 *  default: all patients minus my removals), joined with the roster for
 *  the bedside display fields. No setup needed — a fresh install's
 *  nurse sees the whole unit. */
export async function getNurseWorklist(
  name: string, jobTitle: JobTitle,
): Promise<{ mine: MineWorklist; patients: AssignedPatient[] }> {
  const [mine, roster] = await Promise.all([
    getMyWorklist(name, jobTitle), assignmentRoster(),
  ])
  const byId = new Map(roster.map(r => [r.patientId, r]))
  const patients = mine.patientIds
    .map(id => byId.get(id)).filter((r): r is RosterRecordDto => !!r)
    .map(toAssignedPatient)
  return { mine, patients }
}

/** the doctor workspace rounding list — ALL patients (doctors have NO
 *  assignment concept; every doctor covers every patient). */
export async function getRoundingWorklist(
  name: string, jobTitle: JobTitle,
): Promise<{ mine: MineWorklist; patients: RoundingPatient[] }> {
  const [mine, roster] = await Promise.all([
    getMyWorklist(name, jobTitle), assignmentRoster(),
  ])
  const byId = new Map(roster.map(r => [r.patientId, r]))
  const patients = mine.patientIds
    .map(id => byId.get(id)).filter((r): r is RosterRecordDto => !!r)
    .map(toRoundingPatient)
  return { mine, patients }
}

/* getUnassignedPatients / endAssignment / createAssignment are RETIRED
   (Assignment Simplification): the opt-out default + the server's
   last-nurse 409 make an uncovered patient IMPOSSIBLE — the Unassigned
   panel's job moved from "visible" to "prevented"; the opt-in flow is
   replaced by removeNurse/restoreNurse above. */

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

/* ------------- Imaging Catalogue (Master Data, Aurora Core) -------------
   The Imaging Catalogue design: the study vocabulary the imaging order
   card consumes is REAL master data now (the mock ORDER_SETS.Imaging —
   which nulled out in production and BLOCKED production imaging ordering
   — is retired). Managed from the Configuration area
   (imagingcatalog.manage — Ancillary + SeniorDoctor, the lab-catalogue
   gating). Reads fall back to the mock store offline; writes REAL-ONLY. */

/** GET /api/icu/imaging-catalog — all studies incl. inactive (a retired
 *  study must keep resolving on orders that carry it; ordering excludes
 *  inactive). NULL in production = service unreachable (the card renders
 *  the honest unavailable state, never a fabricated list). */
export async function getImagingCatalog(): Promise<ImagingStudyDef[] | null> {
  const real = await apiGet<ImagingStudyDef[]>('/api/icu/imaging-catalog', 'imaging catalogue')
  if (real) return real
  if (import.meta.env.VITE_APP_ENV !== 'production')
    return respond(IMAGING_CATALOG.map(s => ({ ...s, history: [] as FormularyEvent[] })), 120)
  return null
}

/** POST /api/icu/imaging-catalog — add a study. REAL-ONLY write. */
export function createImagingStudy(draft: CreateImagingStudyDraft): Promise<AdtWriteResult<ImagingStudyDef>> {
  return usersWrite<ImagingStudyDef>('/api/icu/imaging-catalog', 'imaging-catalogue create', draft)
}

/** PUT /api/icu/imaging-catalog/:studyId — edit fields (id immutable). */
export function updateImagingStudy(studyId: string, draft: EditImagingStudyDraft): Promise<AdtWriteResult<ImagingStudyDef>> {
  return usersWrite<ImagingStudyDef>(`/api/icu/imaging-catalog/${encodeURIComponent(studyId)}`, 'imaging-catalogue edit', draft, 'PUT')
}

/** POST /api/icu/imaging-catalog/:studyId/deactivate — RETIRE. */
export function deactivateImagingStudy(studyId: string): Promise<AdtWriteResult<ImagingStudyDef>> {
  return usersWrite<ImagingStudyDef>(`/api/icu/imaging-catalog/${encodeURIComponent(studyId)}/deactivate`, 'imaging-catalogue retire')
}

/** POST /api/icu/imaging-catalog/:studyId/reactivate */
export function reactivateImagingStudy(studyId: string): Promise<AdtWriteResult<ImagingStudyDef>> {
  return usersWrite<ImagingStudyDef>(`/api/icu/imaging-catalog/${encodeURIComponent(studyId)}/reactivate`, 'imaging-catalogue reactivate')
}

/** DELETE /api/icu/imaging-catalog/:studyId — TRUE delete, never-used
 *  studies only (the lab rule; a referenced study 409s directing retire). */
export function deleteImagingStudy(studyId: string): Promise<AdtWriteResult<ImagingStudyDef>> {
  return usersWrite<ImagingStudyDef>(`/api/icu/imaging-catalog/${encodeURIComponent(studyId)}`, 'imaging-catalogue delete', undefined, 'DELETE')
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
 *  the user's own token; the server gates on handoff.document only —
 *  the #114 assignment gate is GONE (Assignment Simplification: any
 *  nurse hands over any patient) — and stamps author/role/time. */
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

/** GET /api/icu/formulary/frequencies — the ACTIVE named frequency
 *  vocabulary (order frequencies validate against these ∪ q<1-48>h
 *  server-side; retired values are excluded — they keep rendering on
 *  stored orders but are not newly selectable). */
export async function getFrequencyVocabulary(): Promise<string[]> {
  const real = await apiGet<string[]>('/api/icu/formulary/frequencies', 'frequency vocabulary')
  if (real) return real
  if (import.meta.env.VITE_APP_ENV !== 'production') return respond(NAMED_FREQUENCIES, 120)
  throw apiUnavailable('frequency vocabulary')
}

/** GET /api/icu/formulary/frequencies/entries — the MANAGEMENT view:
 *  every named frequency incl. retired, with the formulary drugs whose
 *  per-drug list carries it (the allowed-but-surfaced retirement). */
export async function getFrequencyEntries(): Promise<FrequencyEntry[]> {
  const real = await apiGet<FrequencyEntry[]>('/api/icu/formulary/frequencies/entries', 'frequency entries')
  if (real) return real
  if (import.meta.env.VITE_APP_ENV !== 'production') return respond(FREQUENCY_ENTRIES, 120)
  throw apiUnavailable('frequency vocabulary')
}

/** POST /api/icu/formulary/frequencies — add a NAMED frequency
 *  (frequencies.manage, Pharmacy). The structured q<n>h pattern is
 *  built in and refused here. REAL-ONLY write. */
export function createFrequency(value: string): Promise<AdtWriteResult<FrequencyEntry>> {
  return usersWrite<FrequencyEntry>('/api/icu/formulary/frequencies', 'frequency create', { value })
}
export function deactivateFrequency(value: string): Promise<AdtWriteResult<FrequencyEntry>> {
  return usersWrite<FrequencyEntry>(`/api/icu/formulary/frequencies/${encodeURIComponent(value)}/deactivate`, 'frequency retire')
}
export function reactivateFrequency(value: string): Promise<AdtWriteResult<FrequencyEntry>> {
  return usersWrite<FrequencyEntry>(`/api/icu/formulary/frequencies/${encodeURIComponent(value)}/reactivate`, 'frequency reactivate')
}

/** POST /api/icu/formulary — add a drug (Pharmacy RBAC, formulary.manage).
 *  REAL-ONLY write. */
export function createFormularyDrug(draft: CreateDrugDraft): Promise<AdtWriteResult<FormularyDrug>> {
  return usersWrite<FormularyDrug>('/api/icu/formulary', 'formulary create', draft)
}

/* ==================== Code Status governed vocabulary (SAFETY FIX) ====================
   The per-hospital resuscitation-instruction vocabulary — Master Data on
   the formulary/lab-catalogue pattern, managed from the Configuration
   area (codestatus.manage, SeniorDoctor). Reads fall back to the mock
   store offline; every WRITE is REAL-ONLY (reference data is a durable
   system of record). Assigning a code status to a PATIENT is the
   encounter-scoped clinical write below (codestatus.set). */

/** GET /api/icu/code-statuses — all entries incl. inactive (a retired
 *  entry must keep resolving on records that carry it). */
export async function getCodeStatuses(): Promise<CodeStatusEntry[]> {
  const real = await apiGet<CodeStatusEntry[]>('/api/icu/code-statuses', 'code statuses')
  if (real) return real
  if (import.meta.env.VITE_APP_ENV !== 'production') return respond(CODE_STATUSES, 120)
  throw apiUnavailable('code-status vocabulary')
}

/** POST /api/icu/code-statuses — add an entry. REAL-ONLY write.
 *  code is a hidden internal key — omitted by the UI (server-generated). */
export function createCodeStatus(draft: { code?: string; label: string }): Promise<AdtWriteResult<CodeStatusEntry>> {
  return usersWrite<CodeStatusEntry>('/api/icu/code-statuses', 'code-status create', draft)
}

/** PUT /api/icu/code-statuses/:code — edit the label (code immutable). */
export function updateCodeStatus(code: string, draft: { label: string }): Promise<AdtWriteResult<CodeStatusEntry>> {
  return usersWrite<CodeStatusEntry>(`/api/icu/code-statuses/${encodeURIComponent(code)}`, 'code-status edit', draft, 'PUT')
}

/** POST /api/icu/code-statuses/:code/deactivate — RETIRE, never delete. */
export function deactivateCodeStatus(code: string): Promise<AdtWriteResult<CodeStatusEntry>> {
  return usersWrite<CodeStatusEntry>(`/api/icu/code-statuses/${encodeURIComponent(code)}/deactivate`, 'code-status retire')
}

/** POST /api/icu/code-statuses/:code/reactivate */
export function reactivateCodeStatus(code: string): Promise<AdtWriteResult<CodeStatusEntry>> {
  return usersWrite<CodeStatusEntry>(`/api/icu/code-statuses/${encodeURIComponent(code)}/reactivate`, 'code-status reactivate')
}

/** POST /api/icu/adt/encounters/:encounterId/code-status — set/change the
 *  OPEN encounter's code status (codestatus.set — physician authority;
 *  audited who/when/role/prior server-side). SELECTED, never typed.
 *  REAL-ONLY write: a resuscitation instruction is never mock-recorded. */
export function setEncounterCodeStatus(encounterId: string, code: string): Promise<AdtWriteResult<Encounter>> {
  return usersWrite<Encounter>(
    `/api/icu/adt/encounters/${encodeURIComponent(encounterId)}/code-status`, 'code-status set', { code })
}

/* ------------- Hospital Identity (Configuration, Aurora Core) -------------
   The install's OWN identity — one record, administratively governed
   (hospital.configure, office Administrator). The public read is
   ANONYMOUS server-side (the login screen renders it pre-auth) and
   returns NULL on failure rather than throwing: identity chrome must
   never take a screen down — the resolver renders the neutral
   placeholder instead. Writes are REAL-ONLY. */

/** GET /api/icu/hospital-identity — the public identity (no history).
 *  null = unreachable (surfaces render the neutral placeholder). */
export async function getHospitalIdentity(): Promise<HospitalIdentity | null> {
  const real = await apiGet<HospitalIdentity>('/api/icu/hospital-identity', 'hospital identity')
  if (real) {
    /* keep the display clock current — the same fields the session prime
       reads (a zone change on the server reaches clients here) */
    if (real.serverTimeZone !== undefined && real.serverUtcOffsetMinutes !== undefined)
      setServerClock(real.serverTimeZone, real.serverUtcOffsetMinutes)
    return real
  }
  if (import.meta.env.VITE_APP_ENV !== 'production') return respond(HOSPITAL_IDENTITY, 80)
  return null
}

/** GET /api/icu/hospital-identity/history — identity + audit history
 *  (hospital.configure — actors by name are never served anonymously). */
export async function getHospitalIdentityHistory(): Promise<HospitalIdentityWithHistory> {
  const real = await apiGet<HospitalIdentityWithHistory>('/api/icu/hospital-identity/history', 'hospital identity history')
  if (real) return real
  if (import.meta.env.VITE_APP_ENV !== 'production') return respond({ ...HOSPITAL_IDENTITY, history: [] }, 80)
  throw apiUnavailable('hospital identity history')
}

/** PUT /api/icu/hospital-identity — amend the record (audited per-field
 *  prior→next diff, amend-never-erase). REAL-ONLY write. */
export function updateHospitalIdentity(draft: EditHospitalIdentityDraft): Promise<AdtWriteResult<HospitalIdentityWithHistory>> {
  return usersWrite<HospitalIdentityWithHistory>('/api/icu/hospital-identity', 'hospital-identity edit', draft, 'PUT')
}

/* ---- letterhead logo (Print Center branding) — the byte endpoint is
   anonymous like the identity fields; the client builds its URL here so
   every surface (Configuration preview, print letterhead) points at the
   same place, cache-busted by logoVersion. null while no logo is set
   (or in a pure-mock session with no API at all). */
export function hospitalLogoUrl(hasLogo: boolean, logoVersion: number): string | null {
  if (!hasLogo) return null
  if (import.meta.env.VITE_APP_ENV !== 'production' && runtimeApiBase === null) return null
  return `${API_BASE}/api/icu/hospital-identity/logo?v=${logoVersion}`
}

/** POST /api/icu/hospital-identity/logo — upload the letterhead logo
 *  (PNG/JPEG, ≤512 KB decoded; magic-byte checked server-side). */
export function setHospitalLogo(mime: string, dataBase64: string): Promise<AdtWriteResult<HospitalIdentityWithHistory>> {
  return usersWrite<HospitalIdentityWithHistory>('/api/icu/hospital-identity/logo', 'hospital logo', { mime, dataBase64 })
}

/** POST /api/icu/hospital-identity/logo/clear — remove the logo (409
 *  when none is set). */
export function clearHospitalLogo(): Promise<AdtWriteResult<HospitalIdentityWithHistory>> {
  return usersWrite<HospitalIdentityWithHistory>('/api/icu/hospital-identity/logo/clear', 'hospital logo clear', {})
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
   and the CONSULTANT tier (ordersets.manage — clinical protocol
   authorship, moved from Pharmacy 2026-07-20) maintain — REAL-ONLY
   writes like every master-data domain; reads fall back to the mock
   stores offline.
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

/** POST /api/icu/order-sets — author a set (ordersets.manage). REAL-ONLY.
 *  setId is a hidden internal key — omitted by the UI (server-generated). */
export function createOrderSet(draft: { setId?: string; name: string; description: string; items: OrderSetItemTemplate[] }): Promise<AdtWriteResult<OrderSetDef>> {
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
 *  server-side). Held/Refused require a reason; GIVEN requires a DELAY
 *  reason when the dose is more than LATE_THRESHOLD_MINUTES past its
 *  scheduled instant (server-enforced — the overdue-delay-reason safety
 *  fix). administeredAt (given only, UTC wire stamp) records the actual
 *  administration time when it differs from the documenting moment (the
 *  #145 editable-timestamp pattern). REAL endpoint; mock fallback only
 *  when offline. Returns the updated Order. */
export async function documentAdministration(
  orderId: string, adminId: string, action: AdministrationAction, actor: string, jobTitle: JobTitle,
  reason?: string, administeredAt?: string,
): Promise<Order | null> {
  if (!hasPermission(jobTitle, 'meds.administer')) return respond(null, 120)
  const r = await apiPost<Order>(
    `/api/icu/mar/${encodeURIComponent(orderId)}/administrations/${encodeURIComponent(adminId)}`,
    'administer', { action, ...(reason ? { reason } : {}), ...(administeredAt ? { administeredAt } : {}) })
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

/* ---- Bed Registry management (4th Configuration tenant, beds.manage:
   SeniorDoctor + office Administrator — the validator's decision).
   Add / retire / reactivate ONLY: beds are NEVER renamed (a renamed
   occupied bed is a wrong-patient-location risk) and never deleted
   (historical records reference FK-free bedId strings). */

/** POST /api/icu/adt/beds — add a bed (permanent bedId; a retired bedId
 *  being re-added answers 409 directing reactivate). */
export function createBed(draft: CreateBedDraft): Promise<AdtWriteResult<AdtBed>> {
  return usersWrite<AdtBed>('/api/icu/adt/beds', 'bed-registry create', draft)
}

/** POST /api/icu/adt/beds/:bedId/deactivate — RETIRE. Refused (409)
 *  while the bed is OCCUPIED — the live-occupancy rule. */
export function retireBed(bedId: string): Promise<AdtWriteResult<AdtBed>> {
  return usersWrite<AdtBed>(`/api/icu/adt/beds/${encodeURIComponent(bedId)}/deactivate`, 'bed-registry retire')
}

/** POST /api/icu/adt/beds/:bedId/reactivate */
export function reactivateBed(bedId: string): Promise<AdtWriteResult<AdtBed>> {
  return usersWrite<AdtBed>(`/api/icu/adt/beds/${encodeURIComponent(bedId)}/reactivate`, 'bed-registry reactivate')
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

/** GET /api/icu/adt/patients/search — PARTIAL patient lookup for
 *  retrieval (the discharged-record go-live gap). scope='discharged'
 *  browses/searches all NOT-currently-admitted patients (q optional);
 *  scope='all' requires q ≥ 2 chars. Substring across name / MRN / file
 *  number / national ID. REAL-ONLY: retrieval reads the durable record,
 *  never a mock — null = the live server is unreachable (rendered
 *  honestly, never a fabricated result). */
export async function searchPatients(
  q: string, scope: 'all' | 'discharged' = 'all', limit = 50,
): Promise<PatientSearchResponse | null> {
  const params = new URLSearchParams({ scope, limit: String(limit) })
  if (q.trim()) params.set('q', q.trim())
  return apiGet<PatientSearchResponse>(`/api/icu/adt/patients/search?${params.toString()}`, 'patient search')
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

/* ------------- Configuration Vocabularies (Aurora Core Master Data) -------------
   The LAST FOUR of the configurability arc: dispositions, isolation
   types, shifts (+ the named-frequency management under the formulary
   section below). Reads fall back to the mock stores offline; every
   WRITE is REAL-ONLY. Each successful read PRIMES the label caches the
   sync resolvers below serve — pages that render stored codes call the
   getter in their load effect, and print selectors await it before
   building view models. */

let dispositionCache: DispositionEntry[] | null = null
let isolationTypeCache: IsolationTypeEntry[] | null = null
let shiftCache: ShiftEntry[] | null = null

/** GET /api/icu/dispositions — all entries incl. inactive (a retired
 *  entry must keep resolving on the historical records that carry it). */
export async function getDispositions(): Promise<DispositionEntry[]> {
  const real = await apiGet<DispositionEntry[]>('/api/icu/dispositions', 'dispositions')
  if (real) { dispositionCache = real; return real }
  if (import.meta.env.VITE_APP_ENV !== 'production') {
    dispositionCache = DISPOSITION_ENTRIES
    return respond(DISPOSITION_ENTRIES, 120)
  }
  throw apiUnavailable('disposition vocabulary')
}

export function createDisposition(draft: { code?: string; label: string; isDeath?: boolean }): Promise<AdtWriteResult<DispositionEntry>> {
  return usersWrite<DispositionEntry>('/api/icu/dispositions', 'disposition create', draft)
}
export function updateDisposition(code: string, draft: { label: string }): Promise<AdtWriteResult<DispositionEntry>> {
  return usersWrite<DispositionEntry>(`/api/icu/dispositions/${encodeURIComponent(code)}`, 'disposition edit', draft, 'PUT')
}
export function deactivateDisposition(code: string): Promise<AdtWriteResult<DispositionEntry>> {
  return usersWrite<DispositionEntry>(`/api/icu/dispositions/${encodeURIComponent(code)}/deactivate`, 'disposition retire')
}
export function reactivateDisposition(code: string): Promise<AdtWriteResult<DispositionEntry>> {
  return usersWrite<DispositionEntry>(`/api/icu/dispositions/${encodeURIComponent(code)}/reactivate`, 'disposition reactivate')
}

/** GET /api/icu/isolation-types — all entries incl. inactive. */
export async function getIsolationTypes(): Promise<IsolationTypeEntry[]> {
  const real = await apiGet<IsolationTypeEntry[]>('/api/icu/isolation-types', 'isolation types')
  if (real) { isolationTypeCache = real; return real }
  if (import.meta.env.VITE_APP_ENV !== 'production') {
    isolationTypeCache = ISOLATION_TYPE_ENTRIES
    return respond(ISOLATION_TYPE_ENTRIES, 120)
  }
  throw apiUnavailable('isolation-type vocabulary')
}

export function createIsolationType(draft: { code?: string; label: string }): Promise<AdtWriteResult<IsolationTypeEntry>> {
  return usersWrite<IsolationTypeEntry>('/api/icu/isolation-types', 'isolation-type create', draft)
}
export function updateIsolationType(code: string, draft: { label: string }): Promise<AdtWriteResult<IsolationTypeEntry>> {
  return usersWrite<IsolationTypeEntry>(`/api/icu/isolation-types/${encodeURIComponent(code)}`, 'isolation-type edit', draft, 'PUT')
}
export function deactivateIsolationType(code: string): Promise<AdtWriteResult<IsolationTypeEntry>> {
  return usersWrite<IsolationTypeEntry>(`/api/icu/isolation-types/${encodeURIComponent(code)}/deactivate`, 'isolation-type retire')
}
export function reactivateIsolationType(code: string): Promise<AdtWriteResult<IsolationTypeEntry>> {
  return usersWrite<IsolationTypeEntry>(`/api/icu/isolation-types/${encodeURIComponent(code)}/reactivate`, 'isolation-type reactivate')
}

/** GET /api/icu/shifts — all entries incl. inactive. */
export async function getShifts(): Promise<ShiftEntry[]> {
  const real = await apiGet<ShiftEntry[]>('/api/icu/shifts', 'shifts')
  if (real) { shiftCache = real; return real }
  if (import.meta.env.VITE_APP_ENV !== 'production') {
    shiftCache = SHIFT_ENTRIES
    return respond(SHIFT_ENTRIES, 120)
  }
  throw apiUnavailable('shift vocabulary')
}

export function createShift(draft: { code?: string; label: string }): Promise<AdtWriteResult<ShiftEntry>> {
  return usersWrite<ShiftEntry>('/api/icu/shifts', 'shift create', draft)
}
export function updateShift(code: string, draft: { label: string }): Promise<AdtWriteResult<ShiftEntry>> {
  return usersWrite<ShiftEntry>(`/api/icu/shifts/${encodeURIComponent(code)}`, 'shift edit', draft, 'PUT')
}
export function deactivateShift(code: string): Promise<AdtWriteResult<ShiftEntry>> {
  return usersWrite<ShiftEntry>(`/api/icu/shifts/${encodeURIComponent(code)}/deactivate`, 'shift retire')
}
export function reactivateShift(code: string): Promise<AdtWriteResult<ShiftEntry>> {
  return usersWrite<ShiftEntry>(`/api/icu/shifts/${encodeURIComponent(code)}/reactivate`, 'shift reactivate')
}

/** POST /api/icu/adt/encounters/:id/isolation — set the OPEN encounter's
 *  isolation precautions (observations.record — any doctor or nurse;
 *  audited with the prior set server-side). The REPLACEMENT set of
 *  active vocabulary codes; [] clears. REAL-ONLY write. */
export function setEncounterIsolation(encounterId: string, types: string[]): Promise<AdtWriteResult<Encounter>> {
  return usersWrite<Encounter>(
    `/api/icu/adt/encounters/${encodeURIComponent(encounterId)}/isolation`, 'isolation set', { types })
}

/** MOCK-fallback disposition rows (kept for the no-API demo and as the
 *  last-resort label source before any fetch primes the cache) */
export const DISPOSITIONS: { code: DispositionCode; label: string }[] =
  DISPOSITION_ENTRIES.map(d => ({ code: d.code, label: d.label }))

/** display label for a stored disposition code ('' for absent/unknown).
 *  Resolves through the vocabulary cache (retired entries resolve too —
 *  historical rendering never breaks), falling back to the seeded mock
 *  labels, then to the raw code (shown verbatim, never fabricated). */
export const dispositionLabel = (code: string | undefined): string => {
  if (!code) return ''
  return dispositionCache?.find(d => d.code === code)?.label
    ?? DISPOSITIONS.find(d => d.code === code)?.label
    ?? code
}

/** does a stored disposition code count as DEATH? Resolves the
 *  vocabulary's immutable isDeath attribute (mortality + the deceased
 *  banner key on this, never the label); before any fetch primes the
 *  cache, only the seeded 'died' counts (the mock mirror). */
export const isDeathDisposition = (code: string | undefined): boolean => {
  if (!code) return false
  const row = dispositionCache?.find(d => d.code === code) ?? DISPOSITION_ENTRIES.find(d => d.code === code)
  return row?.isDeath ?? false
}

/** display label for a stored shift code (falls back to the raw code —
 *  a retired or hospital-added shift keeps rendering on old rows) */
export const shiftLabel = (code: string | undefined): string => {
  if (!code) return ''
  return shiftCache?.find(s => s.code === code)?.label
    ?? SHIFT_ENTRIES.find(s => s.code === code)?.label
    ?? code
}

/** display label for a stored isolation-type code (raw-code fallback) */
export const isolationTypeLabel = (code: string): string =>
  isolationTypeCache?.find(t => t.code === code)?.label
  ?? ISOLATION_TYPE_ENTRIES.find(t => t.code === code)?.label
  ?? code

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

/** GET /api/icu/adt/attendings — the admission form's Attending picker:
 *  the ACTIVE accounts holding a SeniorDoctor-profile role (the
 *  consultants who attend), gated on adt.admit. This is the clinician-
 *  readable staff read the free-text-attending SAFETY FIX needs — the
 *  user directory (/api/icu/users) is System-Administrator-only by design
 *  and never clinical, so it can never feed a doctor's admission form.
 *  Offline fallback: SAMPLE_STAFF filtered to the SeniorDoctor profile. */
export async function getAttendings(): Promise<AttendingOption[]> {
  const real = await apiGet<AttendingOption[]>('/api/icu/adt/attendings', 'attendings')
  if (real) return real
  if (import.meta.env.VITE_APP_ENV !== 'production') {
    const offline = SAMPLE_STAFF
      .filter(s => profileOf(s.jobTitle as JobTitle) === 'SeniorDoctor')
      .map((s): AttendingOption => ({ username: usernameOf(s.name), name: s.name, jobTitle: s.jobTitle }))
      .sort((a, b) => (a.name < b.name ? -1 : 1))
    return respond(offline, 120)
  }
  throw apiUnavailable('attendings')
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

/* ---- Observations Catalogue management (observations.configure — the
   SeniorDoctor tenant; REAL-ONLY writes). The typeCode is a hidden
   internal key (obs_…, server-generated); the user types only a
   free-text name. Score-input types answer 409 LOCKED on every write. */
export function createObservationType(draft: {
  name: string; group: string; unit?: string; min: number; max: number
  refLow?: number; refHigh?: number; critLow?: number; critHigh?: number
}): Promise<AdtWriteResult<ObservationType>> {
  return usersWrite<ObservationType>('/api/icu/observation-catalog', 'observation create', draft)
}
export function updateObservationType(typeCode: string, draft: {
  name?: string; unit?: string; min?: number; max?: number
  refLow?: number; refHigh?: number; critLow?: number; critHigh?: number
}): Promise<AdtWriteResult<ObservationType>> {
  return usersWrite<ObservationType>(`/api/icu/observation-catalog/${encodeURIComponent(typeCode)}`, 'observation edit', draft, 'PUT')
}
export function deactivateObservationType(typeCode: string): Promise<AdtWriteResult<ObservationType>> {
  return usersWrite<ObservationType>(`/api/icu/observation-catalog/${encodeURIComponent(typeCode)}/deactivate`, 'observation retire')
}
export function reactivateObservationType(typeCode: string): Promise<AdtWriteResult<ObservationType>> {
  return usersWrite<ObservationType>(`/api/icu/observation-catalog/${encodeURIComponent(typeCode)}/reactivate`, 'observation reactivate')
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

/* ---------------- Backup & Disaster Recovery (the hard go-live gate) ----------------
   REAL-ONLY end to end — reads AND writes. There is deliberately no mock
   backup state: a pretend "backup succeeded" in an offline demo is the
   exact false comfort the design forbids (a backup that has never been
   restored is a hope; one that never ran is not even that). Offline /
   demo mode renders the honest "server unavailable" state instead.
   All endpoints are System-Administrator-gated server-side
   (backup.manage); a clinical token gets the generic 403. */

import type {
  BackupEvent, BackupHistoryEntry, BackupManifestSummary,
  BackupRotateKeyResult, BackupStatus, BackupTestRestoreResult,
  BackupVerifyResult,
} from './types'

/** backup operations run pg_dump + a scratch-database restore server-side
 *  — minutes on a real hospital DB, far beyond the interactive 8s budget */
const BACKUP_TIMEOUT_MS = 300000

async function backupPost<T>(path: string, what: string, body?: unknown): Promise<AdtWriteResult<T>> {
  if (import.meta.env.VITE_APP_ENV !== 'production' && runtimeApiBase === null) return { kind: 'offline' }
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), BACKUP_TIMEOUT_MS)
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { ...authHeaders(), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    clearTimeout(timer)
    if (res.ok) return { kind: 'ok', data: (await res.json()) as T }
    if (res.status === 401) {
      console.info(`[aurora] ${what} API responded 401 — backup operations require the live server`)
      return { kind: 'offline' }
    }
    const err = (await res.json().catch(() => null)) as { error?: string } | null
    console.info(`[aurora] ${what} API rejected the action (${res.status})`)
    return { kind: 'rejected', error: err?.error ?? `Rejected (${res.status})` }
  } catch {
    console.info(`[aurora] ${what} API unreachable — backup operations require the live server`)
    return { kind: 'offline' }
  }
}

/** GET /api/backup/status — dashboard health/schedule/retention/key.
 *  Null = server unreachable or demo mode (rendered honestly, never ok). */
export function getBackupStatus(): Promise<BackupStatus | null> {
  return apiGet<BackupStatus>('/api/backup/status', 'backup status')
}

/** GET /api/backup/history — every held backup, newest first. */
export function getBackupHistory(): Promise<BackupHistoryEntry[] | null> {
  return apiGet<BackupHistoryEntry[]>('/api/backup/history', 'backup history')
}

/** GET /api/backup/events — the immutable audit trail, newest first. */
export function getBackupEvents(limit = 200): Promise<BackupEvent[] | null> {
  return apiGet<BackupEvent[]>(`/api/backup/events?limit=${limit}`, 'backup events')
}

/** POST /api/backup/run — "Backup now": synchronous; the response is the
 *  born-restore-verified manifest. */
export function runBackupNow(): Promise<AdtWriteResult<BackupManifestSummary>> {
  return backupPost<BackupManifestSummary>('/api/backup/run', 'backup run')
}

/** POST /api/backup/verify — integrity without a restore. Supplying key
 *  (hex) proves a RECORDED off-server copy decrypts (the envelope drill). */
export function verifyBackup(file: string, key?: string): Promise<AdtWriteResult<BackupVerifyResult>> {
  return backupPost<BackupVerifyResult>('/api/backup/verify', 'backup verify',
    { file, ...(key && key.trim() !== '' ? { key: key.trim() } : {}) })
}

/** POST /api/backup/test-restore — full reconstruction into an ISOLATED
 *  scratch database; source-vs-restored counts + digests; live data
 *  untouched. */
export function testRestoreBackup(file: string): Promise<AdtWriteResult<BackupTestRestoreResult>> {
  return backupPost<BackupTestRestoreResult>('/api/backup/test-restore', 'backup test-restore', { file })
}

/** POST /api/backup/rotate-key — the response carries the NEW key exactly
 *  once for the envelope ceremony; nothing can read it back later. */
export function rotateBackupKey(): Promise<AdtWriteResult<BackupRotateKeyResult>> {
  return backupPost<BackupRotateKeyResult>('/api/backup/rotate-key', 'backup rotate-key')
}
