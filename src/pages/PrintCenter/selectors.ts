import {
  getEncounters, getImagingStudies, getLabDraws, getPatientIdentity, getPatientOrders, getRosterRecord, getTimeline,
} from '../../lib/api'
import type { Encounter, LabDraw, Order, PatientIdentity, RosterRecordDto } from '../../lib/api/types'
import { dayOffsetOf } from '../../lib/time'
import type {
  AdmissionNoteData, DailyProgressData, DischargeSummaryData, PrintContext, PrintEncounterInfo,
  PrintMedLine, PrintPatientIdentity, PrintVitals,
} from './types'

/* ==================== Print Center selectors ====================
   Read-only. Every function here composes EXISTING adapters — the same
   ones the application screens call — into template-ready view models.
   No store is queried by a template directly, no business logic is
   duplicated, nothing is written.

   ABSOLUTE RULE — HISTORICAL RENDERING NEVER CONSULTS THE LIVE FORMULARY.
   This module must never import getFormulary / getLabCatalog or any
   master-data adapter. Medications render from the persisted order
   record (drug text, dose, route, frequency, audit history,
   administrations) exactly as originally recorded; deactivating or
   removing a drug from the formulary after the fact MUST NOT change any
   printed document (the ORD-168 guarantee, one level up). */

/** The exact audit reason the server's discharge cascade records
 *  (server/Core/Orders/OrderLogic.cs — DischargeCascade). An order
 *  discontinued with THIS reason was active at the moment of discharge:
 *  that is what makes "medications at discharge" derivable from history
 *  alone, with no print-specific domain model. */
export const DISCHARGE_CASCADE_REASON = 'patient discharged — auto-discontinued at discharge'

const isChartedTime = (t: string | undefined): boolean => !!t && !/^\d{4}-\d{2}-\d{2}/.test(t)

function toIdentity(r: RosterRecordDto): PrintPatientIdentity {
  return {
    patientId: r.patientId, name: r.name, mrn: r.mrn, age: r.age, sex: r.sex,
    allergies: r.allergies, attending: r.attending, codeStatus: r.codeStatus,
    bedId: r.bedId, diagnosis: r.diagnosis, source: 'roster',
  }
}

/** THE MIDDLE RUNG (closes the recorded discharged-patient identity gap):
 *  person-level identity from the Core patient-identity read — the SAME
 *  server-side resolver the roster serves — joined with the encounter's
 *  own display fields (bed, diagnosis, attending). Code status stays
 *  bedside state (roster-only), not identity. */
function recordIdentity(p: PatientIdentity, e: Encounter): PrintPatientIdentity {
  return {
    patientId: p.patientId, name: p.name, mrn: p.mrn, age: p.age, sex: p.sex,
    allergies: p.allergies, attending: e.attending, codeStatus: null,
    bedId: e.bedId, diagnosis: e.diagnosis, source: 'patient-record',
  }
}

/** Last resort — identity read unreachable AND patient off the roster:
 *  the encounter's own display snapshot, and the document SAYS so instead
 *  of fabricating the missing fields. */
function snapshotIdentity(e: Encounter): PrintPatientIdentity {
  return {
    patientId: e.patientId, name: e.patientName, mrn: null, age: null, sex: null,
    allergies: null, attending: e.attending, codeStatus: null,
    bedId: e.bedId, diagnosis: e.diagnosis, source: 'encounter-snapshot',
  }
}

function toEncounterInfo(target: Encounter, all: Encounter[]): PrintEncounterInfo {
  return {
    encounterId: target.encounterId,
    status: target.status,
    admittedAt: target.admittedAt,
    admittedBy: target.admittedBy,
    dischargedAt: target.dischargedAt,
    dischargedBy: target.dischargedBy,
    otherEncounterCount: all.filter(e => e.encounterId !== target.encounterId).length,
  }
}

export interface ResolvedContext {
  context: PrintContext
  roster: RosterRecordDto | null
  encounter: Encounter | null
  /** patient orders narrowed to the target encounter (falls back to ALL
   *  of the patient's orders when the data predates encounter scoping —
   *  the mock store — and the document notes the scope it used) */
  orders: Order[]
  encounterScoped: boolean
}

/** Shared context resolution for every template: identity + target
 *  encounter + that encounter's orders. `preferred` picks the target when
 *  several encounters exist; otherwise the open encounter wins, then the
 *  most recent discharged one. */
export async function resolveContext(patientId: string, preferredEncounterId?: string): Promise<ResolvedContext | null> {
  const [roster, encounters, allOrders] = await Promise.all([
    getRosterRecord(patientId),
    getEncounters({ patientId }),
    getPatientOrders(patientId),
  ])
  const target =
    (preferredEncounterId && encounters.find(e => e.encounterId === preferredEncounterId)) ||
    encounters.find(e => e.status === 'open') ||
    encounters[encounters.length - 1] ||
    null
  if (!roster && !target) return null

  /* the print identity LADDER: roster record (admitted) → the Core
     patient-identity read (by id — resolves discharged patients) →
     encounter snapshot (last resort, offline). One rung per await:
     the identity read is only consulted when the roster misses. */
  const identity = roster ? null : await getPatientIdentity(patientId)
  const patient = roster ? toIdentity(roster)
    : identity ? recordIdentity(identity, target!)
    : snapshotIdentity(target!)
  const scoped = !!target && allOrders.some(o => o.encounterId)
  const orders = scoped ? allOrders.filter(o => o.encounterId === target!.encounterId) : allOrders
  const hasChartedTimes =
    orders.some(o => isChartedTime(o.orderedTime) || o.history.some(h => isChartedTime(h.time))) ||
    isChartedTime(target?.admittedAt)
  return {
    context: {
      patient,
      encounter: target ? toEncounterInfo(target, encounters) : null,
      hasChartedTimes,
    },
    roster, encounter: target, orders, encounterScoped: scoped,
  }
}

function toVitals(r: RosterRecordDto): PrintVitals {
  return {
    bedside: r.bedsideVitals, monitor: r.monitorVitals, rhythm: r.rhythm,
    sofa: r.sofa, ews: r.ews, flags: r.flags, organs: r.organs,
  }
}

/** One printable medication line from ONE persisted order — the drug is
 *  the order's own stored text, never a formulary lookup. */
function toMedLine(o: Order): PrintMedLine {
  const m = o.medication!
  const stopped = [...o.history].reverse().find(h => h.action === 'discontinued')
  const lastAdmin = [...(o.administrations ?? [])]
    .filter(a => a.status !== 'scheduled' && a.documentedTime)
    .slice(-1)[0]
  return {
    orderId: o.orderId, drug: m.drug, dose: m.dose, route: m.route,
    frequency: m.frequency, duration: m.duration, prn: m.prn,
    status: o.status, orderedBy: o.orderedBy, orderedTime: o.orderedTime,
    stoppedReason: o.statusReason ?? stopped?.detail,
    stoppedTime: stopped?.time,
    lastAdministration: lastAdmin
      ? { time: lastAdmin.documentedTime!, status: lastAdmin.status, by: lastAdmin.documentedBy ?? '' }
      : undefined,
  }
}

const medOrders = (orders: Order[]) => orders.filter(o => o.category === 'Medication' && o.medication)

/* ---------------- Template 1 — ICU Admission Note ---------------- */

export async function buildAdmissionNote(patientId: string, encounterId?: string): Promise<AdmissionNoteData | null> {
  const rc = await resolveContext(patientId, encounterId)
  if (!rc) return null
  return {
    context: rc.context,
    vitals: rc.roster ? toVitals(rc.roster) : null,
    medicationOrders: medOrders(rc.orders).map(toMedLine),
    investigations: rc.orders.filter(o => o.category === 'Lab' || o.category === 'Imaging'),
  }
}

/* ---------------- Template 2 — Daily Progress Note ---------------- */

export async function buildDailyProgress(patientId: string, encounterId?: string): Promise<DailyProgressData | null> {
  const rc = await resolveContext(patientId, encounterId)
  if (!rc) return null
  const [draws, timeline] = await Promise.all([getLabDraws(patientId), getTimeline(patientId)])

  const scopedDraws = rc.encounter && draws.some(d => d.encounterId)
    ? draws.filter(d => !d.encounterId || d.encounterId === rc.encounter!.encounterId)
    : draws
  const latestByPanel = new Map<string, LabDraw>()
  for (const d of scopedDraws) latestByPanel.set(d.panel, d) // draws arrive oldest→newest per panel

  const r = rc.roster
  const problems = [
    rc.context.patient.diagnosis,
    ...(r ? (Object.entries(r.organs) as [string, string][])
      .filter(([, s]) => s !== 'ok')
      .map(([organ, s]) => `${organ}: ${s === 'crit' ? 'critical' : 'watch'}`) : []),
  ]
  return {
    context: rc.context,
    vitals: r ? toVitals(r) : null,
    activeProblems: problems,
    ventilation: r
      ? { flagged: r.flags.includes('vent'), rhythm: r.rhythm, spo2: r.bedsideVitals.spo2, rr: r.monitorVitals.rr }
      : null,
    activeMeds: medOrders(rc.orders).filter(o => o.status === 'active').map(toMedLine),
    latestLabs: [...latestByPanel.values()],
    recentEvents: timeline.filter(e => dayOffsetOf(e.time) >= -1).slice(0, 24),
  }
}

/* ---------------- Template 3 — Discharge Summary ---------------- */

export async function buildDischargeSummary(patientId: string, encounterId?: string): Promise<DischargeSummaryData | null> {
  const rc = await resolveContext(patientId, encounterId)
  if (!rc) return null
  const [draws, imaging] = await Promise.all([getLabDraws(patientId), getImagingStudies(patientId)])
  const meds = medOrders(rc.orders)

  /* Meds ACTIVE AT DISCHARGE = discontinued by the discharge cascade
     (its persisted audit reason identifies them), plus — when printing
     BEFORE discharge — the currently active orders. Everything else that
     was discontinued stopped DURING the admission, with its own reason.
     History only; the live formulary is never consulted. */
  const dischargeMeds = meds.filter(o =>
    (o.status === 'discontinued' && o.statusReason === DISCHARGE_CASCADE_REASON) || o.status === 'active')
  const stoppedMeds = meds.filter(o =>
    o.status === 'discontinued' && o.statusReason !== DISCHARGE_CASCADE_REASON)

  const changes = meds.flatMap(o =>
    o.history.filter(h => h.action === 'modified').map(h => ({
      orderId: o.orderId, drug: o.medication!.drug, time: h.time, actor: h.actor, detail: h.detail ?? 'modified',
    })))

  const scopedDraws = rc.encounter && draws.some(d => d.encounterId)
    ? draws.filter(d => d.encounterId === rc.encounter!.encounterId)
    : draws

  return {
    context: rc.context,
    admissionDiagnosis: rc.encounter?.diagnosis ?? rc.context.patient.diagnosis,
    dischargeMeds: dischargeMeds.map(toMedLine),
    stoppedMeds: stoppedMeds.map(toMedLine),
    medicationChanges: changes,
    labCount: scopedDraws.length,
    imagingCount: imaging.length,
    medOrderCount: meds.length,
    encounterEvents: rc.encounter?.events ?? [],
  }
}
