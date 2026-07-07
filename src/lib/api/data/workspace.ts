import type { ActionQueuesResponse, Consult, OrderSetsResponse, RoundingListResponse } from '../types'

/* Sample data from reference/icu-doctor-workspace.html — Dr. Rahman's panel. */

export const ROUNDING_LIST: RoundingListResponse = {
  physician: { name: 'Dr. Sara Rahman', initials: 'SR', role: 'Intensivist · Panel: Pod A/B' },
  patients: [
    { bedId: 'B-01', name: 'Ahmed Al-Saadi', diagnosis: 'Septic shock · Pneumonia', flags: ['vent', 'pressor'], sofa: 11, severity: 'crit' },
    { bedId: 'B-04', name: 'Susan Wright', diagnosis: 'AKI stage 3 · CRRT', flags: ['crrt'], sofa: 8, severity: 'high' },
    { bedId: 'B-07', name: 'Robert Miller', diagnosis: 'Influenza A pneumonia', flags: ['vent'], sofa: 9, severity: 'crit' },
    { bedId: 'B-09', name: 'Nadia Karim', diagnosis: 'Upper GI bleed · post-EGD', flags: [], sofa: 4, severity: 'high' },
    { bedId: 'B-13', name: 'Aisha Mahmoud', diagnosis: 'Necrotizing pancreatitis', flags: ['vent', 'pressor'], sofa: 10, severity: 'crit' },
    { bedId: 'B-14', name: 'Peter Novak', diagnosis: 'Status epilepticus · resolved', flags: [], sofa: 3, severity: 'stable' },
  ],
}

export const ACTION_QUEUES: ActionQueuesResponse = {
  orders: [
    { title: 'Noradrenaline titration order — B-01 Ahmed Al-Saadi', detail: 'MAP target ≥65, current dose 0.32 µg/kg/min', time: '09:20' },
    { title: 'CRRT prescription renewal — B-04 Susan Wright', detail: '24 h renewal due, filter change anticipated 22:00', time: '08:55' },
    { title: 'Meropenem day-4 review — B-01 Ahmed Al-Saadi', detail: 'De-escalate per culture sensitivity, ID recommends narrow', time: '07:40' },
    { title: 'Proning protocol order — B-07 Robert Miller', detail: 'P/F 176, RT requesting order to proceed', time: '07:15' },
  ],
  results: [
    { title: 'Lactate 3.8 mmol/L — B-01 Ahmed Al-Saadi', detail: 'Repeat drawn 13:00, clearance <10% over 6 h', time: '09:42' },
    { title: 'Platelets 96 ×10⁹/L — B-01 Ahmed Al-Saadi', detail: 'Down-trending 3rd consecutive draw', time: '07:30' },
    { title: 'CT abdomen prelim — B-13 Aisha Mahmoud', detail: 'Radiology: increasing peripancreatic fluid collection', time: '06:50' },
  ],
  notes: [
    { title: 'Daily progress note — B-01 Ahmed Al-Saadi', detail: 'Septic shock day 4 — due before 12:00 rounds', time: '' },
    { title: 'Daily progress note — B-04 Susan Wright', detail: 'AKI/CRRT day 6', time: '' },
    { title: 'Procedure note — B-13 Aisha Mahmoud', detail: 'Bedside paracentesis performed 06:20 — note pending', time: '' },
  ],
}

export const CONSULTS: Consult[] = [
  { specialty: 'Nephrology', message: 'Re: B-04 Susan Wright — CRRT circuit clotting recurring, requests bedside review', time: '08:10' },
  { specialty: 'General Surgery', message: 'Re: B-13 Aisha Mahmoud — new fluid collection, considering drainage', time: '07:05' },
  { specialty: 'Infectious Disease', message: 'Re: B-01 Ahmed Al-Saadi — culture sensitivities back, de-escalation advice pending your ack', time: '06:40' },
]

export const ORDER_SETS: OrderSetsResponse = {
  Medication: ['Sepsis Bundle', 'Insulin Sliding Scale', 'DVT Prophylaxis'],
  Lab: ['Daily AM Labs', 'ABG q4h', 'Blood Cultures ×2'],
  Imaging: ['Portable CXR', 'CT Abdomen/Pelvis', 'Bedside Echo'],
  Nursing: ['Hourly Neuro Checks', 'Turn q2h', 'Strict I/O'],
}
