import type { IoEntry, NewIoEntry, NurseAssignmentResponse, NursingTask } from '../types'

/* Nurse Workspace sample data — RN Maya Chen, day shift, assigned two
   patients (real ICU nurse:patient ratio). Patient identity fields mirror
   the unit roster in beds.ts/patients.ts; nursing records are their own
   domain models keyed by patientId. */

export const NURSE_ASSIGNMENT: NurseAssignmentResponse = {
  nurse: { name: 'RN Maya Chen', initials: 'MC', role: 'ICU Nurse · Beds B-01 / B-04', shift: '07:00–19:00' },
  patients: [
    {
      patientId: 'P-1001', bedId: 'B-01', name: 'Ahmed Al-Saadi', age: 58, sex: 'M',
      diagnosis: 'Septic shock · Pneumonia', allergies: 'Penicillin', codeStatus: 'Full Code',
      flags: ['vent', 'pressor'], isolation: false, severity: 'crit',
      vitals: { hr: 118, map: 64, spo2: 93, temp: 38.4, uo: 28 },
    },
    {
      patientId: 'P-1004', bedId: 'B-04', name: 'Susan Wright', age: 72, sex: 'F',
      diagnosis: 'AKI stage 3 · CRRT', allergies: 'Contrast dye', codeStatus: 'DNR',
      flags: ['crrt'], isolation: false, severity: 'high',
      vitals: { hr: 88, map: 77, spo2: 96, temp: 36.9, uo: 5 },
    },
  ],
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

export const IO_CATEGORIES: Record<'intake' | 'output', string[]> = {
  intake: ['IV fluids', 'PO fluids', 'Medication infusions', 'Enteral feed', 'Blood products'],
  output: ['Urine', 'CRRT net removal', 'Drain', 'NG aspirate', 'Emesis', 'Stool'],
}
