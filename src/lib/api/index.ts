/* Mock API adapters.
   Each function mirrors a future ASP.NET Core endpoint (route noted per
   function) and resolves with the exact response shape the real endpoint
   will return. Replacing these bodies with `fetch` calls is the only change
   needed at API-integration time (Stage 10). */

import type {
  ActionQueuesResponse, AdministrationAction, AdmitDraft, AdmitResponse, AdtBed, BedsResponse, ClinicalNote, Consult, CreateUserDraft, EditUserDraft, Encounter, FormularyDrug,
  ImagingStudy, InteractionRule, IoEntry, LabDraw, MarRow, MedicationDetails,
  NewIoEntry, NewOrderDraft, NurseAssignmentResponse, NursingTask, Order, OrderSetDef,
  OrderSetsResponse, PatientDetailResponse, PatientRiskProfile, PatientSummary, ResultInboxItem,
  RiskRankingRow, RosterRecordDto, RoundingListResponse, TimelineEvent, UnitSummaryResponse, UserAccount,
} from './types'
import { BEDS_RESPONSE, UNIT_SUMMARY, composeBedsResponse, mockAdtBeds } from './data/beds'
import { allPatients, derivedAlertCount } from './data/patients'
import { GOALS, HEMODYNAMICS, INFUSIONS, PATIENT_ALERTS, VENTILATOR } from './data/panels'
import { ACTION_QUEUES, ORDER_SETS, ROUNDING_LIST } from './data/workspace'
import { IO_ENTRIES, NURSE_ASSIGNMENT, NURSING_TASKS, applyTaskToggle, insertIoEntry } from './data/nursing'
import { allConsults } from './data/consults'
import { allRiskProfiles, deriveMissionControlRisks, deriveRiskAlerts, deriveRiskRanking, riskProfileFor } from './data/ai'
import { notesFor } from './data/notes'
import { deriveTimeline } from './data/timeline'
import { FORMULARY, INTERACTION_RULES, ORDER_SET_DEFS } from './data/formulary'
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
  return respond(BEDS_RESPONSE, 850)
}

/** GET /api/icu/units/4B/summary — occupancy ring, KPI strip, unit alerts. */
export function getUnitSummary(): Promise<UnitSummaryResponse> {
  return respond(UNIT_SUMMARY, 120)
}

/* ---------------- Stage 10 Phase 1 — REAL roster endpoint ----------------
   GET /api/icu/patients is served by the ASP.NET Core + SQLite service in
   /server. The base URL comes from VITE_API_BASE_URL (never hardcoded);
   when it is unset or the service is unreachable (Render free tier cold
   starts take ~30-60 s), the adapter falls back to the local mock so the
   app keeps working — the first request also wakes the service for the
   next load. Every OTHER adapter below remains mock until its own Stage 10
   phase. */

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')
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
export const authApiConfigured = API_BASE !== ''

export type LoginResult =
  | { ok: true; name: string; jobTitle: string; token: string }
  | { ok: false; reason: 'invalid' | 'unreachable' }

/** POST /api/auth/login — real credential check (Stage 10 Phase 2). */
export async function login(username: string, password: string): Promise<LoginResult> {
  if (!API_BASE) return { ok: false, reason: 'unreachable' }
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
  if (!API_BASE) return null
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
 *  - denied: the server REJECTED it (403 RBAC / 404 already-applied) —
 *    the caller must NOT apply the mock mutation; enforcement is real
 *  - offline: unreachable, or a 401 tokenless/stale session whose READS
 *    are already coming from mock — the caller applies the mock mutation
 *    so the Stage 9 offline experience stays coherent */
type ApiPostResult<T> = { kind: 'ok'; data: T } | { kind: 'denied' } | { kind: 'offline' }
async function apiPost<T>(
  path: string, what: string, body?: unknown, method: 'POST' | 'PUT' = 'POST',
): Promise<ApiPostResult<T>> {
  if (!API_BASE) return { kind: 'offline' }
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
  /* alertCount stays client-derived — see the wire-contract note in types.ts */
  alertCount: derivedAlertCount(r.patientId, r.bedAlert.severity),
})

/** shared real-roster fetch — getPatients' summaries and the Layer 2 bed
 *  board composition both read it; null = fall back to mock */
async function fetchRosterRecords(): Promise<RosterRecordDto[] | null> {
  if (!API_BASE) return null
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

/** GET /api/icu/patients — sidebar roster for Mission Control.
 *  REAL endpoint (Stage 10 Phase 1); mock fallback documented above. */
export async function getPatients(): Promise<PatientSummary[]> {
  const roster = await fetchRosterRecords()
  if (roster) {
    patientsSource = 'api'
    return roster.map(toSummary)
  }
  patientsSource = 'mock'
  const summaries: PatientSummary[] = allPatients().map(
    ({ patientId, bedId, name, mrn, diagnosis, flags, isolation, alertCount }) =>
      ({ patientId, bedId, name, mrn, diagnosis, flags, isolation, alertCount }),
  )
  return respond(summaries, 120)
}

/** GET /api/icu/patients/:patientId — full Mission Control payload for one patient. */
export function getPatientDetail(patientId: string): Promise<PatientDetailResponse | null> {
  const patient = allPatients().find(p => p.patientId === patientId)
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
  return respond(ROUNDING_LIST, 120)
}

/** GET /api/icu/worklist/queues — notes due (orders/results queues are derived views). */
export function getActionQueues(): Promise<ActionQueuesResponse> {
  return respond(ACTION_QUEUES, 120)
}

/** GET /api/icu/consults — incoming consults (shared store; the Timeline
 *  reads the same records per patient). */
export function getConsults(): Promise<Consult[]> {
  return respond(allConsults(), 120)
}

/** GET /api/icu/order-sets — quick order sets by order type. */
export function getOrderSets(): Promise<OrderSetsResponse> {
  return respond(ORDER_SETS, 120)
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
export { IO_CATEGORIES } from './data/nursing'

/** GET /api/icu/nursing/assignment — the signed-in nurse and assigned patients. */
export function getNurseAssignment(): Promise<NurseAssignmentResponse> {
  return respond(NURSE_ASSIGNMENT, 120)
}

/** GET /api/icu/nursing/tasks — time-driven nursing task checklist. */
export function getNursingTasks(): Promise<NursingTask[]> {
  return respond(NURSING_TASKS, 120)
}

/** GET /api/icu/nursing/io — intake/output entries recorded this shift. */
export function getIoEntries(): Promise<IoEntry[]> {
  return respond(IO_ENTRIES, 120)
}

/** POST /api/icu/nursing/tasks/:taskId/toggle — document (or undo) a task
 *  completion in the store, so derived views (Timeline) see it.
 *  Requires notes.document (enforced here in the service layer). */
export function toggleNursingTask(taskId: string, actor: string, jobTitle: JobTitle): Promise<NursingTask | null> {
  if (!hasPermission(jobTitle, 'notes.document')) return respond(null, 120)
  return respond(applyTaskToggle(taskId, actor, nowHm()), 120)
}

/** POST /api/icu/nursing/io — record an intake/output entry in the store.
 *  Requires notes.document; null when the profile lacks it. */
export function recordIoEntry(draft: NewIoEntry, jobTitle: JobTitle): Promise<IoEntry | null> {
  if (!hasPermission(jobTitle, 'notes.document')) return respond(null, 120)
  return respond(insertIoEntry(draft, nowHm()), 120)
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

/** GET /api/icu/formulary — searchable medication formulary. */
export function getFormulary(): Promise<FormularyDrug[]> {
  return respond(FORMULARY, 120)
}

/** GET /api/icu/formulary/interactions — pairwise interaction rules. */
export function getInteractionRules(): Promise<InteractionRule[]> {
  return respond(INTERACTION_RULES, 120)
}

/** GET /api/icu/order-sets/definitions — order sets with expandable items. */
export function getOrderSetDefs(): Promise<OrderSetDef[]> {
  return respond(ORDER_SET_DEFS, 120)
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
  return real ?? respond(allOrders().filter(o => o.patientId === patientId), 120)
}

/** GET /api/icu/orders?status=pending — signature queue (REAL; mock fallback). */
export async function getPendingOrders(): Promise<Order[]> {
  const real = await apiGet<Order[]>('/api/icu/orders?status=pending', 'orders')
  return real ?? respond(allOrders().filter(o => o.status === 'pending'), 120)
}

/** GET /api/icu/orders?implement=true — nursing implementation queue (REAL;
 *  mock fallback). The patientIds narrowing stays client-side — the same
 *  derivation as before, repointed at the real store. */
export async function getImplementationQueue(patientIds?: string[]): Promise<Order[]> {
  const real = await apiGet<Order[]>('/api/icu/orders?implement=true', 'orders')
  if (real) return real.filter(o => !patientIds || patientIds.includes(o.patientId))
  const q = allOrders().filter(
    o => o.status === 'active' && o.requiresImplementation && (!patientIds || patientIds.includes(o.patientId)),
  )
  return respond(q, 120)
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
  return respond(deriveMarRows(patientIds), 120)
}

/** POST /api/icu/orders — create order(s); sign=true activates immediately (doctor RBAC).
 *  `note` (e.g. an acknowledged safety-warning override) is written to the audit history.
 *  REAL endpoint; patient name/bed resolved server-side from the roster. */
export async function createOrders(drafts: NewOrderDraft[], actor: string, sign: boolean, jobTitle: JobTitle, note?: string): Promise<Order[]> {
  if (!hasPermission(jobTitle, 'orders.create') || (sign && !hasPermission(jobTitle, 'orders.sign'))) return respond([], 120)
  const r = await apiPost<Order[]>('/api/icu/orders', 'create order', { drafts, sign, note })
  if (r.kind === 'ok') return r.data
  if (r.kind === 'denied') return []
  const created = drafts.map(d => {
    const pt = allPatients().find(p => p.patientId === d.patientId)
    return insertOrder(d, actor, sign, pt?.name ?? d.patientId, pt?.bedId ?? '—', note)
  })
  return respond(created, 150)
}

/** POST /api/icu/orders/:orderId/sign (doctor RBAC; REAL endpoint). */
export async function signOrder(orderId: string, actor: string, jobTitle: JobTitle): Promise<Order | null> {
  if (!hasPermission(jobTitle, 'orders.sign')) return respond(null, 120)
  const r = await apiPost<Order>(`/api/icu/orders/${encodeURIComponent(orderId)}/sign`, 'sign order')
  if (r.kind === 'ok') return r.data
  if (r.kind === 'denied') return null
  return respond(applySign(orderId, actor), 120)
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
  return respond(applyModify(orderId, changes, reason, actor), 120)
}

/** POST /api/icu/orders/:orderId/discontinue — reason required (doctor RBAC; REAL endpoint). */
export async function discontinueOrder(orderId: string, reason: string, actor: string, jobTitle: JobTitle): Promise<Order | null> {
  if (!hasPermission(jobTitle, 'orders.discontinue')) return respond(null, 120)
  const r = await apiPost<Order>(`/api/icu/orders/${encodeURIComponent(orderId)}/discontinue`, 'discontinue order', { reason })
  if (r.kind === 'ok') return r.data
  if (r.kind === 'denied') return null
  return respond(applyDiscontinue(orderId, reason, actor), 120)
}

/** POST /api/icu/orders/:orderId/implement (nurse RBAC — mark-done only; REAL endpoint). */
export async function completeImplementation(orderId: string, actor: string, jobTitle: JobTitle): Promise<Order | null> {
  if (!hasPermission(jobTitle, 'orders.implement')) return respond(null, 120)
  const r = await apiPost<Order>(`/api/icu/orders/${encodeURIComponent(orderId)}/implement`, 'implement order')
  if (r.kind === 'ok') return r.data
  if (r.kind === 'denied') return null
  return respond(applyImplementation(orderId, actor), 120)
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
  return respond(applyAdministration(orderId, adminId, action, actor, reason), 120)
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
  return real ?? respond(labDrawsFor(patientId), 120)
}

/** GET /api/icu/results/imaging?patientId — REAL endpoint; mock fallback. */
export async function getImagingStudies(patientId: string): Promise<ImagingStudy[]> {
  const real = await apiGet<ImagingStudy[]>(`/api/icu/results/imaging?patientId=${encodeURIComponent(patientId)}`, 'imaging')
  return real ?? respond(imagingFor(patientId), 120)
}

/** GET /api/icu/results/inbox — unit-wide unacknowledged results, DERIVED
 *  server-side at read time (REAL endpoint; mock fallback). */
export async function getResultInbox(): Promise<ResultInboxItem[]> {
  const real = await apiGet<ResultInboxItem[]>('/api/icu/results/inbox', 'results inbox')
  return real ?? respond(deriveResultInbox(), 120)
}

/** POST /api/icu/results/labs/:labId/acknowledge — REAL endpoint; requires
 *  results.acknowledge (checked client-side AND re-enforced server-side). */
export async function acknowledgeLab(labId: string, actor: string, jobTitle: JobTitle): Promise<LabDraw | null> {
  if (!hasPermission(jobTitle, 'results.acknowledge')) return respond(null, 120)
  const r = await apiPost<LabDraw>(`/api/icu/results/labs/${encodeURIComponent(labId)}/acknowledge`, 'acknowledge')
  if (r.kind === 'ok') return r.data
  if (r.kind === 'denied') return null
  return respond(applyAcknowledgeLab(labId, actor, nowHm()), 120)
}

/** POST /api/icu/results/imaging/:studyId/acknowledge — REAL endpoint; same RBAC. */
export async function acknowledgeImaging(studyId: string, actor: string, jobTitle: JobTitle): Promise<ImagingStudy | null> {
  if (!hasPermission(jobTitle, 'results.acknowledge')) return respond(null, 120)
  const r = await apiPost<ImagingStudy>(`/api/icu/results/imaging/${encodeURIComponent(studyId)}/acknowledge`, 'acknowledge')
  if (r.kind === 'ok') return r.data
  if (r.kind === 'denied') return null
  return respond(applyAcknowledgeImaging(studyId, actor, nowHm()), 120)
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
  return respond(applyUnacknowledgeLab(labId), 120)
}

/** POST /api/icu/results/imaging/:studyId/unacknowledge — same semantics. */
export async function unacknowledgeImaging(studyId: string, reason: string, jobTitle: JobTitle): Promise<ImagingStudy | null> {
  if (!hasPermission(jobTitle, 'results.acknowledge')) return respond(null, 120)
  const r = await apiPost<ImagingStudy>(
    `/api/icu/results/imaging/${encodeURIComponent(studyId)}/unacknowledge`, 'unacknowledge', { reason })
  if (r.kind === 'ok') return r.data
  if (r.kind === 'denied') return null
  return respond(applyUnacknowledgeImaging(studyId), 120)
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
  if (!real) return respond(deriveTimeline(patientId), 150)
  /* merge: real server events (order/med/lab/imaging) + ONLY the still-mock
     categories from the mock derivation — no overlap, so no duplication */
  const mockPart = deriveTimeline(patientId).filter(e => isMockTimelineCategory(e.category))
  const merged = [...real, ...mockPart].sort((a, b) => timestampMinutes(b.time) - timestampMinutes(a.time))
  return respond(merged, 0)
}

/** GET /api/icu/patients/:patientId/notes — freeform clinical notes. */
export function getClinicalNotes(patientId: string): Promise<ClinicalNote[]> {
  return respond(notesFor(patientId), 120)
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
  return respond(allRiskProfiles(), 150)
}

/** GET /api/icu/ai/risks?patientId — one patient's profile (REAL endpoint;
 *  mock fallback). Null when the patient has no profile / is unresolved. */
export async function getRiskProfile(patientId: string): Promise<PatientRiskProfile | null> {
  const real = await apiGet<PatientRiskProfile | null>(
    `/api/icu/ai/risks?patientId=${encodeURIComponent(patientId)}`, 'AI risks')
  return real ?? respond(riskProfileFor(patientId), 120)
}

/** GET /api/icu/ai/ranking — unit-wide ranking by highest current risk,
 *  derived server-side at read (REAL endpoint; mock fallback). */
export async function getRiskRanking(): Promise<RiskRankingRow[]> {
  const real = await apiGet<RiskRankingRow[]>('/api/icu/ai/ranking', 'AI ranking')
  return real ?? respond(deriveRiskRanking(), 150)
}

/* pure client-side helpers for the AI domain (trend from history, elevation
   rule) — computed at render, never stored (locked pattern) */
export { AI_ALERT_THRESHOLD, isElevated, riskTrendOf } from './data/ai'

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
  if (!API_BASE) return { kind: 'offline' }
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
  return real ?? respond(mockAdtBeds(), 120)
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
  if (!API_BASE) return { kind: 'offline' }
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
  const offline = SAMPLE_STAFF
    .map((s): UserAccount => ({
      username: usernameOf(s.name), name: s.name, jobTitle: s.jobTitle,
      active: true, events: [],
    }))
    .sort((a, b) => (a.username < b.username ? -1 : 1))
  return respond(offline, 120)
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
