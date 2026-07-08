/* Mock API adapters.
   Each function mirrors a future ASP.NET Core endpoint (route noted per
   function) and resolves with the exact response shape the real endpoint
   will return. Replacing these bodies with `fetch` calls is the only change
   needed at API-integration time (Stage 10). */

import type {
  ActionQueuesResponse, AdministrationAction, BedsResponse, ClinicalNote, Consult, FormularyDrug,
  ImagingStudy, InteractionRule, IoEntry, LabDraw, MarRow, MedicationDetails,
  NewIoEntry, NewOrderDraft, NurseAssignmentResponse, NursingTask, Order, OrderSetDef,
  OrderSetsResponse, PatientDetailResponse, PatientRiskProfile, PatientSummary, ResultInboxItem,
  RiskRankingRow, RosterRecordDto, RoundingListResponse, TimelineEvent, UnitSummaryResponse,
} from './types'
import { BEDS_RESPONSE, UNIT_SUMMARY } from './data/beds'
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
  applyAcknowledgeImaging, applyAcknowledgeLab, deriveMissionControlLabs, deriveResultInbox,
  imagingFor, labDrawsFor,
} from './data/results'
import { hasPermission, type JobTitle } from '../session'
import { dayOffsetOf, nowHm } from '../time'

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))
const respond = <T>(payload: T, latencyMs: number): Promise<T> =>
  new Promise(resolve => setTimeout(() => resolve(clone(payload)), latencyMs))

/** GET /api/icu/units/4B/beds — full bed board for the unit. */
export function getBeds(): Promise<BedsResponse> {
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

/** GET /api/icu/patients — sidebar roster for Mission Control.
 *  REAL endpoint (Stage 10 Phase 1); mock fallback documented above. */
export async function getPatients(): Promise<PatientSummary[]> {
  if (API_BASE) {
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS)
      const res = await fetch(`${API_BASE}/api/icu/patients`, { signal: ctrl.signal })
      clearTimeout(timer)
      if (res.ok) {
        const roster = (await res.json()) as RosterRecordDto[]
        if (Array.isArray(roster) && roster.length > 0) {
          patientsSource = 'api'
          return roster.map(toSummary)
        }
      }
      console.info(`[aurora] roster API responded ${res.status} — using mock roster`)
    } catch {
      console.info('[aurora] roster API unreachable (cold start?) — using mock roster')
    }
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

/** GET /api/icu/patients/:patientId/orders — full order list incl. audit history. */
export function getPatientOrders(patientId: string): Promise<Order[]> {
  return respond(allOrders().filter(o => o.patientId === patientId), 120)
}

/** GET /api/icu/orders?status=pending — orders awaiting physician signature. */
export function getPendingOrders(): Promise<Order[]> {
  return respond(allOrders().filter(o => o.status === 'pending'), 120)
}

/** GET /api/icu/orders?implement=true — active orders awaiting nursing implementation. */
export function getImplementationQueue(patientIds?: string[]): Promise<Order[]> {
  const q = allOrders().filter(
    o => o.status === 'active' && o.requiresImplementation && (!patientIds || patientIds.includes(o.patientId)),
  )
  return respond(q, 120)
}

/** GET /api/icu/nursing/mar — MAR rows derived from active medication orders. */
export function getMarRows(patientIds: string[]): Promise<MarRow[]> {
  return respond(deriveMarRows(patientIds), 120)
}

/** POST /api/icu/orders — create order(s); sign=true activates immediately (doctor RBAC).
 *  `note` (e.g. an acknowledged safety-warning override) is written to the audit history. */
export function createOrders(drafts: NewOrderDraft[], actor: string, sign: boolean, jobTitle: JobTitle, note?: string): Promise<Order[]> {
  if (!hasPermission(jobTitle, 'orders.create') || (sign && !hasPermission(jobTitle, 'orders.sign'))) return respond([], 120)
  const created = drafts.map(d => {
    const pt = allPatients().find(p => p.patientId === d.patientId)
    return insertOrder(d, actor, sign, pt?.name ?? d.patientId, pt?.bedId ?? '—', note)
  })
  return respond(created, 150)
}

/** POST /api/icu/orders/:orderId/sign (doctor RBAC). */
export function signOrder(orderId: string, actor: string, jobTitle: JobTitle): Promise<Order | null> {
  if (!hasPermission(jobTitle, 'orders.sign')) return respond(null, 120)
  return respond(applySign(orderId, actor), 120)
}

/** PUT /api/icu/orders/:orderId — modify medication fields; reason required (doctor RBAC). */
export function modifyOrder(
  orderId: string, changes: Partial<MedicationDetails>, reason: string, actor: string, jobTitle: JobTitle,
): Promise<Order | null> {
  if (!hasPermission(jobTitle, 'orders.modify')) return respond(null, 120)
  return respond(applyModify(orderId, changes, reason, actor), 120)
}

/** POST /api/icu/orders/:orderId/discontinue — reason required (doctor RBAC). */
export function discontinueOrder(orderId: string, reason: string, actor: string, jobTitle: JobTitle): Promise<Order | null> {
  if (!hasPermission(jobTitle, 'orders.discontinue')) return respond(null, 120)
  return respond(applyDiscontinue(orderId, reason, actor), 120)
}

/** POST /api/icu/orders/:orderId/implement (nurse RBAC — mark-done only). */
export function completeImplementation(orderId: string, actor: string, jobTitle: JobTitle): Promise<Order | null> {
  if (!hasPermission(jobTitle, 'orders.implement')) return respond(null, 120)
  return respond(applyImplementation(orderId, actor), 120)
}

/** POST /api/icu/orders/:orderId/administrations/:adminId (nurse RBAC — document only). */
export function documentAdministration(
  orderId: string, adminId: string, action: AdministrationAction, actor: string, jobTitle: JobTitle,
): Promise<Order | null> {
  if (!hasPermission(jobTitle, 'meds.administer')) return respond(null, 120)
  return respond(applyAdministration(orderId, adminId, action, actor), 120)
}

/* ---------------- Laboratory & Imaging results domain (Screen 6) ----------------
   The canonical results service. Screen 5 places lab/imaging orders; these
   adapters expose what RESULTED. Mission Control's lab card and Doctor
   Workspace's "Results to Acknowledge" read the same store. Acknowledge is
   doctor RBAC — enforced here in the service layer (and again server-side
   at Stage 10), not just hidden in the UI:
   POST /api/icu/results/labs/:labId/acknowledge
   POST /api/icu/results/imaging/:studyId/acknowledge */

/** GET /api/icu/results/labs?patientId — all lab draws for a patient, oldest first. */
export function getLabDraws(patientId: string): Promise<LabDraw[]> {
  return respond(labDrawsFor(patientId), 120)
}

/** GET /api/icu/results/imaging?patientId — imaging studies incl. reports. */
export function getImagingStudies(patientId: string): Promise<ImagingStudy[]> {
  return respond(imagingFor(patientId), 120)
}

/** GET /api/icu/results/inbox — unit-wide unacknowledged results (labs + imaging). */
export function getResultInbox(): Promise<ResultInboxItem[]> {
  return respond(deriveResultInbox(), 120)
}

/** POST /api/icu/results/labs/:labId/acknowledge — requires results.acknowledge; null if not permitted. */
export function acknowledgeLab(labId: string, actor: string, jobTitle: JobTitle): Promise<LabDraw | null> {
  if (!hasPermission(jobTitle, 'results.acknowledge')) return respond(null, 120)
  return respond(applyAcknowledgeLab(labId, actor, nowHm()), 120)
}

/** POST /api/icu/results/imaging/:studyId/acknowledge — requires results.acknowledge; null if not permitted. */
export function acknowledgeImaging(studyId: string, actor: string, jobTitle: JobTitle): Promise<ImagingStudy | null> {
  if (!hasPermission(jobTitle, 'results.acknowledge')) return respond(null, 120)
  return respond(applyAcknowledgeImaging(studyId, actor, nowHm()), 120)
}

/** Convenience dispatcher for inbox items (lab or imaging). Resolves truthy on success. */
export function acknowledgeResult(
  kind: 'lab' | 'imaging', id: string, actor: string, jobTitle: JobTitle,
): Promise<LabDraw | ImagingStudy | null> {
  return kind === 'lab' ? acknowledgeLab(id, actor, jobTitle) : acknowledgeImaging(id, actor, jobTitle)
}

/* ---------------- Timeline domain (Screen 7) ----------------
   Read-only aggregation over the canonical stores — no store of its own.
   Mission Control's timeline card reads the same derivation. */

/** GET /api/icu/patients/:patientId/timeline — aggregated feed, newest first. */
export function getTimeline(patientId: string): Promise<TimelineEvent[]> {
  return respond(deriveTimeline(patientId), 150)
}

/** GET /api/icu/patients/:patientId/notes — freeform clinical notes. */
export function getClinicalNotes(patientId: string): Promise<ClinicalNote[]> {
  return respond(notesFor(patientId), 120)
}

/* ---------------- AI Clinical Assistant domain (Screen 8) ----------------
   The canonical AI risk service. All predictions are SIMULATED mock data
   until Stage 11 (real model + device integration). Advisory only — no
   endpoint here mutates anything or places orders. */

/** GET /api/icu/ai/risks — every patient's simulated risk profile. */
export function getRiskProfiles(): Promise<PatientRiskProfile[]> {
  return respond(allRiskProfiles(), 150)
}

/** GET /api/icu/ai/risks/:patientId — one patient's profile; null if unknown. */
export function getRiskProfile(patientId: string): Promise<PatientRiskProfile | null> {
  return respond(riskProfileFor(patientId), 120)
}

/** GET /api/icu/ai/ranking — unit-wide ranking by highest current risk. */
export function getRiskRanking(): Promise<RiskRankingRow[]> {
  return respond(deriveRiskRanking(), 150)
}

/* pure client-side helpers for the AI domain (trend from history, elevation
   rule) — computed at render, never stored (locked pattern) */
export { AI_ALERT_THRESHOLD, isElevated, riskTrendOf } from './data/ai'
