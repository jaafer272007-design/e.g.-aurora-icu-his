/* Mock API adapters.
   Each function mirrors a future ASP.NET Core endpoint (route noted per
   function) and resolves with the exact response shape the real endpoint
   will return. Replacing these bodies with `fetch` calls is the only change
   needed at API-integration time (Stage 10). */

import type {
  ActionQueuesResponse, AdministrationAction, BedsResponse, Consult, FormularyDrug,
  InteractionRule, IoEntry, MarRow, MedicationDetails, NewOrderDraft, NurseAssignmentResponse,
  NursingTask, Order, OrderSetDef, OrderSetsResponse, PatientDetailResponse,
  PatientSummary, RoundingListResponse, UnitSummaryResponse,
} from './types'
import { BEDS_RESPONSE, UNIT_SUMMARY } from './data/beds'
import { PATIENTS } from './data/patients'
import { GOALS, HEMODYNAMICS, INFUSIONS, LABS, PATIENT_ALERTS, TIMELINE, VENTILATOR } from './data/panels'
import { ACTION_QUEUES, CONSULTS, ORDER_SETS, ROUNDING_LIST } from './data/workspace'
import { IO_ENTRIES, NURSE_ASSIGNMENT, NURSING_TASKS } from './data/nursing'
import { FORMULARY, INTERACTION_RULES, ORDER_SET_DEFS } from './data/formulary'
import {
  allOrders, applyAdministration, applyDiscontinue, applyImplementation, applyModify,
  applySign, deriveMarRows, insertOrder,
} from './data/orders'

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

/** GET /api/icu/patients — sidebar roster for Mission Control. */
export function getPatients(): Promise<PatientSummary[]> {
  const summaries: PatientSummary[] = PATIENTS.map(
    ({ patientId, bedId, name, mrn, diagnosis, flags, isolation, alertCount }) =>
      ({ patientId, bedId, name, mrn, diagnosis, flags, isolation, alertCount }),
  )
  return respond(summaries, 120)
}

/** GET /api/icu/patients/:patientId — full Mission Control payload for one patient. */
export function getPatientDetail(patientId: string): Promise<PatientDetailResponse | null> {
  const patient = PATIENTS.find(p => p.patientId === patientId)
  if (!patient) return respond(null, 120)
  return respond(
    {
      patient,
      ventilator: VENTILATOR,
      hemodynamics: HEMODYNAMICS,
      infusions: INFUSIONS,
      labs: LABS,
      alerts: PATIENT_ALERTS,
      goals: GOALS,
      timeline: TIMELINE,
    },
    120,
  )
}

/** GET /api/icu/worklist/rounding — the signed-in physician's panel. */
export function getRoundingList(): Promise<RoundingListResponse> {
  return respond(ROUNDING_LIST, 120)
}

/** GET /api/icu/worklist/queues — orders to sign / results to ack / notes due. */
export function getActionQueues(): Promise<ActionQueuesResponse> {
  return respond(ACTION_QUEUES, 120)
}

/** GET /api/icu/worklist/consults — incoming consults for the physician. */
export function getConsults(): Promise<Consult[]> {
  return respond(CONSULTS, 120)
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
export function createOrders(drafts: NewOrderDraft[], actor: string, sign: boolean, note?: string): Promise<Order[]> {
  const created = drafts.map(d => {
    const pt = PATIENTS.find(p => p.patientId === d.patientId)
    return insertOrder(d, actor, sign, pt?.name ?? d.patientId, pt?.bedId ?? '—', note)
  })
  return respond(created, 150)
}

/** POST /api/icu/orders/:orderId/sign (doctor RBAC). */
export function signOrder(orderId: string, actor: string): Promise<Order | null> {
  return respond(applySign(orderId, actor), 120)
}

/** PUT /api/icu/orders/:orderId — modify medication fields; reason required (doctor RBAC). */
export function modifyOrder(
  orderId: string, changes: Partial<MedicationDetails>, reason: string, actor: string,
): Promise<Order | null> {
  return respond(applyModify(orderId, changes, reason, actor), 120)
}

/** POST /api/icu/orders/:orderId/discontinue — reason required (doctor RBAC). */
export function discontinueOrder(orderId: string, reason: string, actor: string): Promise<Order | null> {
  return respond(applyDiscontinue(orderId, reason, actor), 120)
}

/** POST /api/icu/orders/:orderId/implement (nurse RBAC — mark-done only). */
export function completeImplementation(orderId: string, actor: string): Promise<Order | null> {
  return respond(applyImplementation(orderId, actor), 120)
}

/** POST /api/icu/orders/:orderId/administrations/:adminId (nurse RBAC — document only). */
export function documentAdministration(
  orderId: string, adminId: string, action: AdministrationAction, actor: string,
): Promise<Order | null> {
  return respond(applyAdministration(orderId, adminId, action, actor), 120)
}
