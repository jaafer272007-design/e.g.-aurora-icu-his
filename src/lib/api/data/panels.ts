import type {
  Goal, Hemodynamics, Infusion, PatientAlert, Ventilator,
} from '../types'

/* Clinical panel sample data from reference/icu-mission-control.html.
   The prototype shows the same panels for every patient; the mock API keeps
   that behavior by attaching these to each patient-detail response. */

export const VENTILATOR: Ventilator = {
  mode: 'PC-AC (Lung Protective)',
  tiles: [
    { label: 'Tidal Volume', value: '420', unit: 'mL (6 mL/kg)', warn: false },
    { label: 'Set Rate', value: '18', unit: '/min', warn: false },
    { label: 'FiO₂', value: '55', unit: '%', warn: true },
    { label: 'PEEP', value: '10', unit: 'cmH₂O', warn: false },
    { label: 'Peak Pressure', value: '28', unit: 'cmH₂O', warn: true },
    { label: 'Plateau', value: '24', unit: 'cmH₂O', warn: false },
    { label: 'Driving Pressure', value: '14', unit: 'cmH₂O', warn: true },
    { label: 'Compliance', value: '30', unit: 'mL/cmH₂O', warn: false },
    { label: 'Minute Vent.', value: '8.9', unit: 'L/min', warn: false },
    { label: 'I:E', value: '1:2', unit: '', warn: false },
  ],
}

export const HEMODYNAMICS: Hemodynamics = {
  metrics: [
    { label: 'Cardiac Output', value: '5.1', unit: 'L/min', warn: false },
    { label: 'Cardiac Index', value: '2.4', unit: 'L/min/m²', warn: false },
    { label: 'SVR', value: '680', unit: 'dyn·s/cm⁵', warn: true },
    { label: 'SVV', value: '16', unit: '%', warn: true },
    { label: 'Lactate', value: '3.8', unit: 'mmol/L', warn: true },
    { label: 'Urine Output', value: '28', unit: 'mL/h', warn: true },
  ],
  fluidBalance: { value: '+1,850 mL', percent: 34 },
}

export const INFUSIONS: Infusion[] = [
  { name: 'Noradrenaline', dose: '0.32 µg/kg/min', rate: '12.4 mL/h', status: 'hi', trend: [0.1, 0.14, 0.2, 0.24, 0.3, 0.32, 0.32] },
  { name: 'Vasopressin', dose: '0.03 U/min', rate: '1.8 mL/h', status: 'md', trend: [0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03] },
  { name: 'Adrenaline', dose: '— standby', rate: '0 mL/h', status: 'ok', trend: [0, 0, 0, 0, 0, 0, 0] },
  { name: 'Dobutamine', dose: '3.0 µg/kg/min', rate: '6.1 mL/h', status: 'ok', trend: [0, 0, 2, 2.5, 3, 3, 3] },
  { name: 'Milrinone', dose: '— standby', rate: '0 mL/h', status: 'ok', trend: [0, 0, 0, 0, 0, 0, 0] },
  { name: 'Propofol', dose: '35 mg/h', rate: '3.5 mL/h', status: 'ok', trend: [50, 45, 40, 40, 35, 35, 35] },
  { name: 'Midazolam', dose: '— paused (SAT)', rate: '0 mL/h', status: 'md', trend: [2, 2, 2, 1, 0, 0, 0] },
  { name: 'Dexmedetomidine', dose: '0.4 µg/kg/h', rate: '4.0 mL/h', status: 'ok', trend: [0, 0, 0.2, 0.3, 0.4, 0.4, 0.4] },
  { name: 'Fentanyl', dose: '50 µg/h', rate: '2.5 mL/h', status: 'ok', trend: [75, 75, 60, 50, 50, 50, 50] },
  { name: 'Insulin', dose: '2.5 U/h', rate: '2.5 mL/h', status: 'ok', trend: [4, 4, 3, 3, 2.5, 2.5, 2.5] },
]

export const PATIENT_ALERTS: PatientAlert[] = [
  { severity: 'crit', message: 'Lactate 3.8 mmol/L — clearance <10% over 6 h despite resuscitation', time: '09:42' },
  { severity: 'crit', message: 'MAP < 65 mmHg for 12 min — noradrenaline at 0.32 µg/kg/min', time: '09:31' },
  { severity: 'high', message: 'Urine output 0.4 mL/kg/h × 5 h — AKI criteria approaching', time: '08:55' },
  { severity: 'high', message: 'Driving pressure 14 cmH₂O — consider TV / PEEP adjustment', time: '08:10' },
  { severity: 'med', message: 'Platelets 96 ×10⁹/L — down-trending, recheck with 14:00 draw', time: '07:40' },
  { severity: 'med', message: 'Potassium 4.2 → replaced; repeat level due 12:00', time: '06:58' },
  { severity: 'info', message: 'SAT window opens 10:00 — midazolam paused per protocol', time: '06:30' },
  { severity: 'info', message: 'Blood culture ×2 collected — preliminary result expected 18:00', time: '05:12' },
]

export const GOALS: Goal[] = [
  { label: 'Sedation Target', done: false },
  { label: 'RASS Goal −1 to 0', done: false },
  { label: 'SAT (Awakening Trial)', done: false },
  { label: 'SBT (Breathing Trial)', done: false },
  { label: 'Nutrition ≥ 80% goal', done: false },
  { label: 'DVT Prophylaxis', done: true },
  { label: 'GI Prophylaxis', done: true },
  { label: 'Antibiotic Review (Day 4)', done: false },
  { label: 'Central Line Review', done: false },
  { label: 'Foley Review', done: false },
  { label: 'Family Meeting', done: false },
]
