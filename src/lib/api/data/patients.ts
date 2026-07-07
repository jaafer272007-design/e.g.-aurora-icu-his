import type { Patient } from '../types'
import { ROSTER, type UnitPatientRecord } from './roster'

/* Mission Control patient view — DERIVED from the canonical roster
   (roster.ts); the API `Patient` shape is unchanged, so no UI changes.
   `vitals` here is the live-monitor feed (monitorVitals). */

const toPatient = (r: UnitPatientRecord): Patient => ({
  patientId: r.patientId,
  bedId: r.bedId,
  name: r.name,
  mrn: r.mrn,
  diagnosis: r.diagnosis,
  flags: r.flags,
  isolation: r.isolation,
  alertCount: r.alertCount,
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

export const PATIENTS: Patient[] = ROSTER.map(toPatient)
