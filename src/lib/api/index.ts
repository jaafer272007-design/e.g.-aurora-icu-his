/* Mock API adapters.
   Each function mirrors a future ASP.NET Core endpoint (route noted per
   function) and resolves with the exact response shape the real endpoint
   will return. Replacing these bodies with `fetch` calls is the only change
   needed at API-integration time (Stage 10). */

import type {
  ActionQueuesResponse, BedsResponse, Consult, ImplementOrder, IoEntry, MarEntry,
  NurseAssignmentResponse, NursingTask, OrderSetsResponse, PatientDetailResponse,
  PatientSummary, RoundingListResponse, UnitSummaryResponse,
} from './types'
import { BEDS_RESPONSE, UNIT_SUMMARY } from './data/beds'
import { PATIENTS } from './data/patients'
import { GOALS, HEMODYNAMICS, INFUSIONS, LABS, PATIENT_ALERTS, TIMELINE, VENTILATOR } from './data/panels'
import { ACTION_QUEUES, CONSULTS, ORDER_SETS, ROUNDING_LIST } from './data/workspace'
import { IO_ENTRIES, MAR_ENTRIES, NURSE_ASSIGNMENT, NURSING_TASKS, ORDERS_TO_IMPLEMENT } from './data/nursing'

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

/** GET /api/icu/nursing/mar — medication administration record for the shift. */
export function getMarEntries(): Promise<MarEntry[]> {
  return respond(MAR_ENTRIES, 120)
}

/** GET /api/icu/nursing/orders-to-implement — physician orders awaiting nursing action. */
export function getOrdersToImplement(): Promise<ImplementOrder[]> {
  return respond(ORDERS_TO_IMPLEMENT, 120)
}

/** GET /api/icu/nursing/tasks — time-driven nursing task checklist. */
export function getNursingTasks(): Promise<NursingTask[]> {
  return respond(NURSING_TASKS, 120)
}

/** GET /api/icu/nursing/io — intake/output entries recorded this shift. */
export function getIoEntries(): Promise<IoEntry[]> {
  return respond(IO_ENTRIES, 120)
}
