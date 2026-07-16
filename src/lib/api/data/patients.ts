import type { Patient } from '../types'
import { ROSTER, type UnitPatientRecord } from './roster'
import { unackedResultCountFor } from './results'

/* Mission Control patient view — DERIVED from the canonical roster
   (roster.ts); the API `Patient` shape is unchanged, so no UI changes.
   `vitals` here is the live-monitor feed (monitorVitals). */

/* alertCount is DERIVED from the same sources that produce actual alert
   lists — unacknowledged results and an active crit/high bed alert —
   never stored as its own number. (The fabricated AI-threshold term died
   with the simulated risk domain; the static PATIENT_ALERTS list in
   panels.ts is deliberately excluded: it is known deferred debt attached
   identically to every patient.) */
export const derivedAlertCount = (patientId: string, bedAlertSeverity: string): number =>
  unackedResultCountFor(patientId) +
  (bedAlertSeverity === 'crit' || bedAlertSeverity === 'high' ? 1 : 0)

const alertCountFor = (r: UnitPatientRecord): number =>
  derivedAlertCount(r.patientId, r.bedAlert.severity)

const toPatient = (r: UnitPatientRecord): Patient => ({
  patientId: r.patientId,
  bedId: r.bedId,
  name: r.name,
  mrn: r.mrn,
  diagnosis: r.diagnosis,
  flags: r.flags,
  isolation: r.isolation,
  alertCount: alertCountFor(r),
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

/** computed per call so acknowledgments move the counts live */
export const allPatients = (): Patient[] => ROSTER.map(toPatient)
