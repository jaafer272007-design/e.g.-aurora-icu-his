import type {
  ImplementOrder, IoEntry, MarEntry, NurseAssignmentResponse, NursingTask,
} from '../types'

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

export const MAR_ENTRIES: MarEntry[] = [
  {
    marId: 'MAR-3001', patientId: 'P-1001', bedId: 'B-01', medication: 'Noradrenaline',
    dose: '0.32 µg/kg/min', route: 'IV infusion · titration doc q1h', scheduledTime: '11:00',
    status: 'overdue', orderedBy: 'Dr. S. Rahman',
  },
  {
    marId: 'MAR-3002', patientId: 'P-1001', bedId: 'B-01', medication: 'Insulin (Actrapid)',
    dose: '2.5 U/h', route: 'IV infusion · glucose check q1h', scheduledTime: '11:30',
    status: 'due', orderedBy: 'Dr. S. Rahman',
  },
  {
    marId: 'MAR-3003', patientId: 'P-1001', bedId: 'B-01', medication: 'Meropenem',
    dose: '1 g', route: 'IV over 30 min · q8h (day 4)', scheduledTime: '12:00',
    status: 'due', orderedBy: 'Dr. S. Rahman',
  },
  {
    marId: 'MAR-3004', patientId: 'P-1001', bedId: 'B-01', medication: 'Paracetamol',
    dose: '1 g', route: 'IV q6h PRN · temp ≥ 38.3 °C', scheduledTime: '',
    status: 'prn', orderedBy: 'Dr. S. Rahman',
  },
  {
    marId: 'MAR-3005', patientId: 'P-1001', bedId: 'B-01', medication: 'Enoxaparin',
    dose: '40 mg', route: 'SC daily', scheduledTime: '18:00',
    status: 'upcoming', orderedBy: 'Dr. S. Rahman',
  },
  {
    marId: 'MAR-3006', patientId: 'P-1004', bedId: 'B-04', medication: 'Pantoprazole',
    dose: '40 mg', route: 'IV daily', scheduledTime: '08:00',
    status: 'given', documentedTime: '08:04', orderedBy: 'Dr. S. Rahman',
  },
  {
    marId: 'MAR-3007', patientId: 'P-1004', bedId: 'B-04', medication: 'Calcium gluconate',
    dose: '10 mL 10%', route: 'IV · CRRT protocol', scheduledTime: '10:00',
    status: 'given', documentedTime: '10:12', orderedBy: 'Dr. S. Rahman',
  },
  {
    marId: 'MAR-3008', patientId: 'P-1004', bedId: 'B-04', medication: 'Phosphate (K-Phos)',
    dose: '15 mmol', route: 'IV over 4 h', scheduledTime: '12:00',
    status: 'due', orderedBy: 'Dr. S. Rahman',
  },
  {
    marId: 'MAR-3009', patientId: 'P-1004', bedId: 'B-04', medication: 'Metoprolol',
    dose: '25 mg', route: 'PO bid · hold if HR < 60 or SBP < 100', scheduledTime: '12:00',
    status: 'due', orderedBy: 'Dr. S. Rahman',
  },
]

export const ORDERS_TO_IMPLEMENT: ImplementOrder[] = [
  {
    orderId: 'ORD-7001', patientId: 'P-1001', bedId: 'B-01', priority: 'STAT',
    text: 'Repeat lactate + ScvO₂ with the 13:00 draw — sample from arterial line',
    orderedBy: 'Dr. S. Rahman', time: '09:42', done: false,
  },
  {
    orderId: 'ORD-7002', patientId: 'P-1001', bedId: 'B-01', priority: 'Urgent',
    text: 'Titrate noradrenaline to MAP ≥ 65 — new ceiling 0.5 µg/kg/min',
    orderedBy: 'Dr. S. Rahman', time: '09:31', done: false,
  },
  {
    orderId: 'ORD-7003', patientId: 'P-1004', bedId: 'B-04', priority: 'Urgent',
    text: 'Prime and stage CRRT filter change kit at bedside before 22:00',
    orderedBy: 'Dr. S. Rahman', time: '08:55', done: false,
  },
  {
    orderId: 'ORD-7004', patientId: 'P-1001', bedId: 'B-01', priority: 'Routine',
    text: 'Change right IJ central line dressing during day shift',
    orderedBy: 'Dr. S. Rahman', time: '07:50', done: false,
  },
  {
    orderId: 'ORD-7005', patientId: 'P-1004', bedId: 'B-04', priority: 'Routine',
    text: 'Daily weight on bed scale before 08:00 tomorrow',
    orderedBy: 'Dr. S. Rahman', time: '08:30', done: false,
  },
]

export const NURSING_TASKS: NursingTask[] = [
  { taskId: 'TSK-4001', patientId: 'P-1001', bedId: 'B-01', label: 'Hourly urine output', dueTime: '11:00', recurrence: 'q1h', dueState: 'overdue', done: false },
  { taskId: 'TSK-4002', patientId: 'P-1001', bedId: 'B-01', label: 'Sedation score (RASS) documentation', dueTime: '11:00', recurrence: 'q2h', dueState: 'overdue', done: false },
  { taskId: 'TSK-4003', patientId: 'P-1001', bedId: 'B-01', label: 'Glucose check — insulin infusion', dueTime: '11:30', recurrence: 'q1h', dueState: 'due', done: false },
  { taskId: 'TSK-4004', patientId: 'P-1001', bedId: 'B-01', label: 'Turn & reposition', dueTime: '12:00', recurrence: 'q2h', dueState: 'upcoming', done: false },
  { taskId: 'TSK-4005', patientId: 'P-1001', bedId: 'B-01', label: 'Oral care — VAP bundle', dueTime: '12:00', recurrence: 'q4h', dueState: 'upcoming', done: false },
  { taskId: 'TSK-4006', patientId: 'P-1004', bedId: 'B-04', label: 'CRRT circuit pressure check', dueTime: '12:00', recurrence: 'q2h', dueState: 'upcoming', done: false },
  { taskId: 'TSK-4007', patientId: 'P-1004', bedId: 'B-04', label: 'Vascath site assessment', dueTime: '13:00', recurrence: 'q shift', dueState: 'upcoming', done: false },
  { taskId: 'TSK-4008', patientId: 'P-1004', bedId: 'B-04', label: 'Turn & reposition', dueTime: '10:00', recurrence: 'q2h', dueState: 'due', done: true },
]

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
