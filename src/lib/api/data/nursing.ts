import type { AssignedPatient, IoEntry, NewIoEntry, NurseAssignmentResponse, NursingTask } from '../types'
import { ROSTER } from './roster'

/* Nurse Workspace sample data — RN Maya Chen, day shift, assigned two
   patients (real ICU nurse:patient ratio). The assignment is a list of
   patient ids; every patient field derives from the canonical roster
   (roster.ts). Nursing records below are their own domain models keyed
   by patientId. */

const ASSIGNED_PATIENT_IDS = ['P-1001', 'P-1004']

const toAssignedPatient = (patientId: string): AssignedPatient => {
  const r = ROSTER.find(x => x.patientId === patientId)!
  return {
    patientId: r.patientId, bedId: r.bedId, name: r.name, age: r.age, sex: r.sex,
    diagnosis: r.diagnosis, allergies: r.allergies, codeStatus: r.codeStatus,
    flags: r.flags, isolation: r.isolation, severity: r.severity,
    vitals: r.bedsideVitals,
  }
}

export const NURSE_ASSIGNMENT: NurseAssignmentResponse = {
  nurse: { name: 'RN Maya Chen', initials: 'MC', role: 'ICU Nurse · Beds B-01 / B-04', shift: '07:00–19:00' },
  patients: /* @__PURE__ */ ASSIGNED_PATIENT_IDS.map(toAssignedPatient),
}

export const NURSING_TASKS: NursingTask[] = [
  { taskId: 'TSK-4001', patientId: 'P-1001', bedId: 'B-01', label: 'Hourly urine output', dueTime: '11:00', recurrence: 'q1h', done: false },
  { taskId: 'TSK-4002', patientId: 'P-1001', bedId: 'B-01', label: 'Sedation score (RASS) documentation', dueTime: '11:00', recurrence: 'q2h', done: false },
  { taskId: 'TSK-4003', patientId: 'P-1001', bedId: 'B-01', label: 'Glucose check — insulin infusion', dueTime: '11:30', recurrence: 'q1h', done: false },
  { taskId: 'TSK-4004', patientId: 'P-1001', bedId: 'B-01', label: 'Turn & reposition', dueTime: '12:00', recurrence: 'q2h', done: false },
  { taskId: 'TSK-4005', patientId: 'P-1001', bedId: 'B-01', label: 'Oral care — VAP bundle', dueTime: '12:00', recurrence: 'q4h', done: false },
  { taskId: 'TSK-4006', patientId: 'P-1004', bedId: 'B-04', label: 'CRRT circuit pressure check', dueTime: '12:00', recurrence: 'q2h', done: false },
  { taskId: 'TSK-4007', patientId: 'P-1004', bedId: 'B-04', label: 'Vascath site assessment', dueTime: '13:00', recurrence: 'q shift', done: false },
  { taskId: 'TSK-4008', patientId: 'P-1004', bedId: 'B-04', label: 'Turn & reposition', dueTime: '10:00', recurrence: 'q2h', done: true, completedAt: '10:05', completedBy: 'RN M. Chen' },
]

/* Store mutators — task completion and I&O entry write to THIS store (not
   page-local state) so derived views like the Timeline see them. They map to
   POST /api/icu/nursing/tasks/:taskId/toggle and POST /api/icu/nursing/io. */

export function applyTaskToggle(taskId: string, actor: string, time: string): NursingTask | null {
  const t = NURSING_TASKS.find(x => x.taskId === taskId)
  if (!t) return null
  t.done = !t.done
  t.completedAt = t.done ? time : undefined
  t.completedBy = t.done ? actor : undefined
  return t
}

let ioSeq = 5100
export function insertIoEntry(draft: NewIoEntry, time: string): IoEntry {
  const entry: IoEntry = { entryId: `IO-${++ioSeq}`, ...draft, time }
  IO_ENTRIES.push(entry)
  return entry
}

export const IO_ENTRIES: IoEntry[] = [
  { entryId: 'IO-5001', patientId: 'P-1001', kind: 'intake', category: 'IV fluids', volumeMl: 450, time: '09:30' },
  { entryId: 'IO-5002', patientId: 'P-1001', kind: 'intake', category: 'Medication infusions', volumeMl: 120, time: '10:00' },
  { entryId: 'IO-5003', patientId: 'P-1001', kind: 'output', category: 'Urine', volumeMl: 140, time: '11:00' },
  { entryId: 'IO-5004', patientId: 'P-1004', kind: 'intake', category: 'PO fluids', volumeMl: 200, time: '08:30' },
  { entryId: 'IO-5005', patientId: 'P-1004', kind: 'intake', category: 'IV fluids', volumeMl: 300, time: '10:00' },
  { entryId: 'IO-5006', patientId: 'P-1004', kind: 'output', category: 'CRRT net removal', volumeMl: 800, time: '11:00' },
  { entryId: 'IO-5007', patientId: 'P-1004', kind: 'output', category: 'Urine', volumeMl: 20, time: '11:00' },
]

import { IO_CATEGORIES } from '../logic'
export { IO_CATEGORIES }
