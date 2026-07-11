import type { ActionQueuesResponse, OrderSetsResponse, RoundingListResponse, RoundingPatient } from '../types'
import { ROSTER } from './roster'

/* Sample data from reference/icu-doctor-workspace.html — Dr. Rahman's panel.
   The panel is an explicit ASSIGNMENT (a list of patient ids — it is not
   attending-derived: it includes cross-cover patients); every display field
   comes from the canonical roster. */

const PANEL_PATIENT_IDS = ['P-1001', 'P-1004', 'P-1007', 'P-1008', 'P-1012', 'P-1013']

const toRoundingPatient = (patientId: string): RoundingPatient => {
  const r = ROSTER.find(x => x.patientId === patientId)!
  return {
    patientId: r.patientId, bedId: r.bedId, name: r.name, diagnosis: r.diagnosis,
    flags: r.flags, sofa: r.sofa, severity: r.severity,
  }
}

export const ROUNDING_LIST: RoundingListResponse = {
  physician: { name: 'Dr. Sara Rahman', initials: 'SR', role: 'Intensivist · Panel: Pod A/B' },
  patients: /* @__PURE__ */ PANEL_PATIENT_IDS.map(toRoundingPatient),
}

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
