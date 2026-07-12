/* Mock API adapters.
   Each function mirrors a future ASP.NET Core endpoint (route noted per
   function) and resolves with the exact response shape the real endpoint
   will return. Replacing these bodies with `fetch` calls is the only change
   needed at API-integration time (Stage 10). */

import type {
  ActionQueuesResponse, AdministrationAction, AdmitDraft, AdmitResponse, AdtBed, BedsResponse, ClinicalNote, Consult, CreateDrugDraft, CreateLabTestDraft, CreateUserDraft, EditDrugDraft, EditLabTestDraft, EditUserDraft, Encounter, FormularyDrug, LabTest, OrderSetItemTemplate,
  ImagingStudy, InteractionRule, IoEntry, LabDraw, MarRow, MedicationDetails,
  NewIoEntry, NewOrderDraft, NurseAssignmentResponse, NursingTask, Observation, ObservationTypeDef, Order, OrderSetDef,
  OrderSetsResponse, Patient, PatientDetailResponse, PatientIdentity, PatientRiskProfile, PatientSummary, RecordObservationsDraft, ResultInboxItem,
  RiskRankingRow, RosterRecordDto, RoundingListResponse, TimelineEvent, UnitSummaryResponse, UserAccount,
} from './types'
import { composeBedsResponse } from './bedboard'
import { BEDS_RESPONSE, UNIT_SUMMARY, mockAdtBeds } from './data/beds'
import { allPatients, derivedAlertCount } from './data/patients'
import { rosterFor } from './data/roster'
import { GOALS, HEMODYNAMICS, INFUSIONS, PATIENT_ALERTS, VENTILATOR } from './data/panels'
import { ACTION_QUEUES, ORDER_SETS, ROUNDING_LIST } from './data/workspace'
import { IO_ENTRIES, NURSE_ASSIGNMENT, NURSING_TASKS, applyTaskToggle, insertIoEntry } from './data/nursing'
import { allConsults } from './data/consults'
import { allRiskProfiles, deriveMissionControlRisks, deriveRiskAlerts, deriveRiskRanking, riskProfileFor } from './data/ai'
import { notesFor } from './data/notes'
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
import { SAMPLE_STAFF, getToken, hasPermission, usernameOf, type JobTitle } from '../session'
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
function apiUnavailable(what: string): ApiUnavailableError {
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

/** GET /api/icu/units/4B/summary — occupancy ring, KPI strip, unit alerts. */
export function getUnitSummary(): Promise<UnitSummaryResponse> {
  if (import.meta.env.VITE_APP_ENV !== 'production') return respond(UNIT_SUMMARY, 120)
  return Promise.reject(apiUnavailable('unit summary (Stage 11 scope)'))
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
   the artifact carries NO hostname to point at a wrong environment, and
   an accidentally-present VITE_API_BASE_URL is ignored. Dev/staging keep
   the absolute cross-origin base (Pages → Render), governed by the API's
   CORS allowlist exactly as before. */
const API_BASE = import.meta.env.VITE_APP_ENV === 'production'
  ? ''
  : (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')
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

/** false in pure mock mode (no VITE_API_BASE_URL) — the Login screen then
 *  labels sign-ins as Stage 9 local sessions up front */
export const authApiConfigured = import.meta.env.VITE_APP_ENV === 'production' || API_BASE !== ''

/** the wired API's /healthz URL for the runtime environment cross-check
 *  (EnvironmentGate) — null in a pure-mock dev session (no API at all,
 *  nothing to cross-check); production is always same-origin '/healthz'. */
export function apiHealthUrl(): string | null {
  if (import.meta.env.VITE_APP_ENV !== 'production' && !API_BASE) return null
  return `${API_BASE}/healthz`
}

export type LoginResult =
  | { ok: true; name: string; jobTitle: string; token: string }
  | { ok: false; reason: 'invalid' | 'unreachable' }

/** POST /api/auth/login — real credential check (Stage 10 Phase 2). */
export async function login(username: string, password: string): Promise<LoginResult> {
  if (import.meta.env.VITE_APP_ENV !== 'production' && !API_BASE) return { ok: false, reason: 'unreachable' }
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
      const body = (await res.json()) as { token?: string; name?: string; jobTitle?: string }
      if (body.token && body.name && body.jobTitle)
        return { ok: true, name: body.name, jobTitle: body.jobTitle, token: body.token }
    }
    console.info(`[aurora] auth API responded ${res.status} — falling back to local session`)
  } catch {
    console.info('[aurora] auth API unreachable (cold start?) — falling back to local session')
  }
  return { ok: false, reason: 'unreachable' }
}

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
  if (import.meta.env.VITE_APP_ENV !== 'production' && !API_BASE) return null
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
  if (import.meta.env.VITE_APP_ENV !== 'production' && !API_BASE) return { kind: 'offline' }
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
  if (import.meta.env.VITE_APP_ENV !== 'production' && !API_BASE) return null
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

export function getPatientDetail(patientId: string): Promise<PatientDetailResponse | null> {
  /* the composite's PANELS are still mock-composed (Stage 11 absorbs the
     bedside snapshot) — in production this screen refuses until the
     domain is real; the identity fix below is the dev/staging path */
  if (import.meta.env.VITE_APP_ENV === 'production') return Promise.reject(apiUnavailable('patient detail (Stage 11 scope)'))
  return getPatientDetailMock(patientId)
}

async function getPatientDetailMock(patientId: string): Promise<PatientDetailResponse | null> {
  /* IDENTITY comes from the REAL roster first (the system of record for
     who is admitted where) and only falls back to the mock store when
     the live roster is unreachable or doesn't know the id (pure-mock
     dev, or a seeded-only mock session). The per-patient derived views
     below legitimately resolve EMPTY for a fresh admission — the mock
     ai/results stores have no entry for it — which renders as "no data",
     never as "no patient". */
  const roster = await fetchRosterRecords()
  const real = roster?.find(r => r.patientId === patientId)
  const patient = real ? rosterToPatient(real)
    : allPatients().find(p => p.patientId === patientId)
  if (!patient) return respond(null, 120)
  return respond(
    {
      patient,
      /* one-line AI risk view derived from the canonical AI domain (Screen 8) */
      aiRisks: deriveMissionControlRisks(patientId),
      ventilator: VENTILATOR,
      hemodynamics: HEMODYNAMICS,
      infusions: INFUSIONS,
      /* lab trends are a derived view over the canonical results store (Screen 6) */
      labs: deriveMissionControlLabs(patientId),
      /* AI risks crossing threshold surface in the EXISTING alert center */
      alerts: [...deriveRiskAlerts(patientId), ...PATIENT_ALERTS],
      goals: GOALS,
      /* the timeline card is a derived view over the aggregated feed
         (Screen 7) — last ~24 h, capped for the horizontal strip */
      timeline: deriveTimeline(patientId).filter(e => dayOffsetOf(e.time) >= -1).slice(0, 20),
    },
    120,
  )
}

/** GET /api/icu/worklist/rounding — the signed-in physician's panel. */
export function getRoundingList(): Promise<RoundingListResponse> {
  if (import.meta.env.VITE_APP_ENV !== 'production') return respond(ROUNDING_LIST, 120)
  return Promise.reject(apiUnavailable('rounding list (Stage 11 scope)'))
}

/** GET /api/icu/worklist/queues — notes due (orders/results queues are derived views). */
export function getActionQueues(): Promise<ActionQueuesResponse> {
  if (import.meta.env.VITE_APP_ENV !== 'production') return respond(ACTION_QUEUES, 120)
  return Promise.reject(apiUnavailable('action queues (Stage 11 scope)'))
}

/** GET /api/icu/consults — incoming consults (shared store; the Timeline
 *  reads the same records per patient). */
export function getConsults(): Promise<Consult[]> {
  if (import.meta.env.VITE_APP_ENV !== 'production') return respond(allConsults(), 120)
  return Promise.reject(apiUnavailable('consults (Stage 11 scope)'))
}

/** GET /api/icu/order-sets — quick order sets by order type. */
export function getOrderSets(): Promise<OrderSetsResponse> {
  if (import.meta.env.VITE_APP_ENV !== 'production') return respond(ORDER_SETS, 120)
  return Promise.reject(apiUnavailable('workspace order sets (Stage 11 scope)'))
}

/* ---------------- Nursing domain (Screen 4) ----------------
   Write actions (document administration, complete order/task, record I&O,
   save handoff) are POSTs in the real API; the UI applies them to local
   state today so wiring them later is additive, not a rewrite:
   POST /api/icu/nursing/mar/:marId/administration   { action, time }
   POST /api/icu/nursing/orders/:orderId/complete
   POST /api/icu/nursing/tasks/:taskId/complete
   POST /api/icu/nursing/io                          { patientId, kind, category, volumeMl }
   PUT  /api/icu/nursing/handoff/:patientId          { s, b, a, r }              */

/* I&O category vocabulary — re-exported so pages never import a data store
   directly (service-layer rule); becomes master data at Layer 4 */
export { IO_CATEGORIES } from './logic'

/** GET /api/icu/nursing/assignment — the signed-in nurse and assigned patients. */
export function getNurseAssignment(): Promise<NurseAssignmentResponse> {
  if (import.meta.env.VITE_APP_ENV !== 'production') return respond(NURSE_ASSIGNMENT, 120)
  return Promise.reject(apiUnavailable('nurse assignment (Stage 11 scope)'))
}

/** GET /api/icu/nursing/tasks — time-driven nursing task checklist. */
export function getNursingTasks(): Promise<NursingTask[]> {
  if (import.meta.env.VITE_APP_ENV !== 'production') return respond(NURSING_TASKS, 120)
  return Promise.reject(apiUnavailable('nursing tasks (Stage 11 scope)'))
}

/** GET /api/icu/nursing/io — intake/output entries recorded this shift. */
export function getIoEntries(): Promise<IoEntry[]> {
  if (import.meta.env.VITE_APP_ENV !== 'production') return respond(IO_ENTRIES, 120)
  return Promise.reject(apiUnavailable('I&O entries (Stage 11 scope)'))
}

/** POST /api/icu/nursing/tasks/:taskId/toggle — document (or undo) a task
 *  completion in the store, so derived views (Timeline) see it.
 *  Requires notes.document (enforced here in the service layer). */
export function toggleNursingTask(taskId: string, actor: string, jobTitle: JobTitle): Promise<NursingTask | null> {
  if (!hasPermission(jobTitle, 'notes.document')) return respond(null, 120)
  if (import.meta.env.VITE_APP_ENV !== 'production') return respond(applyTaskToggle(taskId, actor, nowHm()), 120)
  return Promise.reject(apiUnavailable('nursing task documentation (Stage 11 scope)'))
}

/** POST /api/icu/nursing/io — record an intake/output entry in the store.
 *  Requires notes.document; null when the profile lacks it. */
export function recordIoEntry(draft: NewIoEntry, jobTitle: JobTitle): Promise<IoEntry | null> {
  if (!hasPermission(jobTitle, 'notes.document')) return respond(null, 120)
  if (import.meta.env.VITE_APP_ENV !== 'production') return respond(insertIoEntry(draft, nowHm()), 120)
  return Promise.reject(apiUnavailable('I&O documentation (Stage 11 scope)'))
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
    const q = allOrders().filter(
      o => o.status === 'active' && o.requiresImplementation && (!patientIds || patientIds.includes(o.patientId)),
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

/** GET /api/icu/patients/:patientId/notes — freeform clinical notes. */
export function getClinicalNotes(patientId: string): Promise<ClinicalNote[]> {
  if (import.meta.env.VITE_APP_ENV !== 'production') return respond(notesFor(patientId), 120)
  return Promise.reject(apiUnavailable('clinical notes (Stage 11 scope)'))
}

/* ---------------- AI Clinical Assistant domain (Screen 8) ----------------
   The canonical AI risk service — REAL authenticated endpoints since Stage
   10 Phase 3 (the FINAL domain migration), with graceful mock fallback.
   All predictions remain SIMULATED mock model output until Stage 11 (real
   model + device integration); the server just serves them from SQLite now.
   Read-only for every role (both doctor and nurse read) — no endpoint here
   mutates anything or places orders. Risk trend/delta are computed
   server-side at read from each risk's history — never stored (locked rule).

   Mission Control's AI panel and the alert-center integration still derive
   their single-patient views from the SAME mock store (via getPatientDetail
   — deriveMissionControlRisks / deriveRiskAlerts), which reads ai.ts — the
   exact data the AI table seeds from, so there is no parallel copy. Those
   move to the real endpoint when getPatientDetail migrates (documented drift,
   like the MC lab-trend and timeline cards). */

/** GET /api/icu/ai/risks — every patient's simulated risk profile. No server
 *  endpoint serves the full set (ranking + per-patient cover the pages);
 *  kept as a mock convenience accessor. */
export function getRiskProfiles(): Promise<PatientRiskProfile[]> {
  if (import.meta.env.VITE_APP_ENV !== 'production') return respond(allRiskProfiles(), 150)
  return Promise.reject(apiUnavailable('AI risk profiles (mock convenience accessor)'))
}

/** GET /api/icu/ai/risks?patientId — one patient's profile (REAL endpoint;
 *  mock fallback). Null when the patient has no profile / is unresolved. */
export async function getRiskProfile(patientId: string): Promise<PatientRiskProfile | null> {
  const real = await apiGet<PatientRiskProfile | null>(
    `/api/icu/ai/risks?patientId=${encodeURIComponent(patientId)}`, 'AI risks')
  if (real != null) return real
  if (import.meta.env.VITE_APP_ENV !== 'production') return respond(riskProfileFor(patientId), 120)
  throw apiUnavailable('AI risks')
}

/** GET /api/icu/ai/ranking — unit-wide ranking by highest current risk,
 *  derived server-side at read (REAL endpoint; mock fallback). */
export async function getRiskRanking(): Promise<RiskRankingRow[]> {
  const real = await apiGet<RiskRankingRow[]>('/api/icu/ai/ranking', 'AI ranking')
  if (real != null) return real
  if (import.meta.env.VITE_APP_ENV !== 'production') return respond(deriveRiskRanking(), 150)
  throw apiUnavailable('AI ranking')
}

/* pure client-side helpers for the AI domain (trend from history, elevation
   rule) — computed at render, never stored (locked pattern) */
export { AI_ALERT_THRESHOLD, isElevated, riskTrendOf } from './logic'

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

async function adtPost<T>(path: string, what: string, body?: unknown): Promise<AdtWriteResult<T>> {
  if (import.meta.env.VITE_APP_ENV !== 'production' && !API_BASE) return { kind: 'offline' }
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS)
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
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
  if (import.meta.env.VITE_APP_ENV !== 'production' && !API_BASE) return null
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

/** POST /api/icu/adt/admissions — doctor RBAC (adt.admit). REAL-ONLY write. */
export function admitPatient(draft: AdmitDraft): Promise<AdtWriteResult<AdmitResponse>> {
  return adtPost<AdmitResponse>('/api/icu/adt/admissions', 'ADT admission', draft)
}

/** POST /api/icu/adt/encounters/:id/discharge — doctor RBAC (adt.discharge). REAL-ONLY write. */
export function dischargeEncounter(encounterId: string): Promise<AdtWriteResult<Encounter>> {
  return adtPost<Encounter>(`/api/icu/adt/encounters/${encodeURIComponent(encounterId)}/discharge`, 'ADT discharge')
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

async function usersWrite<T>(path: string, what: string, body?: unknown, method: 'POST' | 'PUT' = 'POST'): Promise<AdtWriteResult<T>> {
  if (import.meta.env.VITE_APP_ENV !== 'production' && !API_BASE) return { kind: 'offline' }
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
        active: true, events: [],
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

/* ---------------- Observations (Stage 11 — first half: Manual) ----------------
   REAL-ONLY domain: no mock store exists or will exist — the Observation
   model is born server-side (the locked one-way flow: writer → Observation
   Service → Clinical Store → derived views). In pure-mock dev the reads
   resolve empty/absent and the screen states that honestly. */

/** GET /api/icu/observations/types — the closed type vocabulary (ONE
 *  source of truth; the frontend never duplicates it). REAL-ONLY read. */
export async function getObservationTypes(): Promise<ObservationTypeDef[] | null> {
  return apiGet<ObservationTypeDef[]>('/api/icu/observations/types', 'observation types')
}

/** GET /api/icu/observations?patientId — the chart, oldest first.
 *  REAL-ONLY read: null means the API is unreachable (never fabricated). */
export async function getObservations(
  patientId: string, filter?: { type?: string; encounterId?: string }): Promise<Observation[] | null> {
  const params = new URLSearchParams({ patientId })
  if (filter?.type) params.set('type', filter.type)
  if (filter?.encounterId) params.set('encounterId', filter.encounterId)
  return apiGet<Observation[]>(`/api/icu/observations?${params}`, 'observations')
}

/** POST /api/icu/observations — chart a manual observation SET (validated
 *  whole, persisted atomically; source is SERVER-stamped 'manual').
 *  observations.record RBAC (doctor + nurse). REAL-ONLY write. */
export function recordObservations(draft: RecordObservationsDraft): Promise<AdtWriteResult<Observation[]>> {
  return adtPost<Observation[]>('/api/icu/observations', 'observations record', draft)
}

/** POST /api/icu/observations/:id/override — correct a mis-charted value
 *  with a REQUIRED reason; the original value is never rewritten
 *  (never-destroy). REAL-ONLY write. */
export function overrideObservation(observationId: string, value: string, reason: string): Promise<AdtWriteResult<Observation>> {
  return adtPost<Observation>(`/api/icu/observations/${encodeURIComponent(observationId)}/override`,
    'observation override', { value, reason })
}
