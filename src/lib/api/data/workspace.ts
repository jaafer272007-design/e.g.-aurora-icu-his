import type { ActionQueuesResponse, OrderSetsResponse } from '../types'

/* Sample data from reference/icu-doctor-workspace.html. ROUNDING_LIST is
   RETIRED (Patient Assignment & Responsibility): its own comment said the
   panel is "an explicit ASSIGNMENT … not attending-derived: it includes
   cross-cover patients" — a design intent that finally has a mechanism.
   The rounding list now derives from the signed-in doctor's REAL
   assignments (data/assignments.ts offline; /api/icu/assignments live). */

export const ACTION_QUEUES: ActionQueuesResponse = {
  notes: [
    { title: 'Daily progress note — B-01 Ahmed Al-Saadi', detail: 'Septic shock day 4 — due before 12:00 rounds', time: '' },
    { title: 'Daily progress note — B-04 Susan Wright', detail: 'AKI/CRRT day 6', time: '' },
    { title: 'Procedure note — B-13 Aisha Mahmoud', detail: 'Bedside paracentesis performed 06:20 — note pending', time: '' },
  ],
}

export const ORDER_SETS: OrderSetsResponse = {
  Medication: ['Sepsis Bundle', 'Insulin Sliding Scale', 'DVT Prophylaxis'],
  Lab: ['Daily AM Labs', 'ABG q4h', 'Blood Cultures ×2'],
  Imaging: ['Portable CXR', 'CT Abdomen/Pelvis', 'Bedside Echo'],
  Nursing: ['Hourly Neuro Checks', 'Turn q2h', 'Strict I/O'],
}
