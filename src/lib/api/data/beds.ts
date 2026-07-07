import type { BedsResponse, UnitSummaryResponse } from '../types'

/* Sample data from reference/icu-bed-overview.html — 16 beds, Unit 4B. */

const DOCS = ['Dr. S. Rahman', 'Dr. L. Osei', 'Dr. E. Marchetti', 'Dr. H. Nakamura']

export const BEDS_RESPONSE: BedsResponse = {
  unitId: '4B',
  capacity: 16,
  physicians: DOCS,
  areas: ['Pod A', 'Pod B'],
  beds: [
    {
      bedId: 'B-01', area: 'Pod A',
      patient: {
        name: 'Ahmed Al-Saadi', age: 58, sex: 'M', diagnosis: 'Septic shock · Pneumonia', los: 4,
        flags: ['vent', 'pressor'], isolation: false, codeStatus: 'Full Code', sofa: 11, ews: 9,
        vitals: { hr: 118, map: 64, spo2: 93, temp: 38.4, uo: 28 },
        alert: { severity: 'crit', message: 'MAP <65 ×12 min — norad 0.32 µg/kg/min' },
        attending: DOCS[0], severity: 'crit', mapTrend: [72, 70, 68, 66, 65, 64, 64],
      },
    },
    {
      bedId: 'B-02', area: 'Pod A',
      patient: {
        name: 'Maria Hansen', age: 67, sex: 'F', diagnosis: 'Severe ARDS · VV-ECMO day 5', los: 9,
        flags: ['vent', 'ecmo'], isolation: false, codeStatus: 'Full Code', sofa: 12, ews: 8,
        vitals: { hr: 96, map: 76, spo2: 91, temp: 37.2, uo: 55 },
        alert: { severity: 'high', message: 'ECMO flow variability — circuit check 10:00' },
        attending: DOCS[1], severity: 'crit', mapTrend: [74, 75, 73, 76, 77, 76, 76],
      },
    },
    {
      bedId: 'B-03', area: 'Pod A',
      patient: {
        name: 'Omar Khalil', age: 45, sex: 'M', diagnosis: 'Severe TBI · ICP monitor', los: 2,
        flags: ['vent'], isolation: true, codeStatus: 'Full Code', sofa: 7, ews: 5,
        vitals: { hr: 64, map: 96, spo2: 99, temp: 36.8, uo: 110 },
        alert: { severity: 'high', message: 'ICP 18–22 mmHg — hypertonic saline q6h' },
        attending: DOCS[2], severity: 'high', mapTrend: [92, 94, 95, 97, 96, 95, 96],
      },
    },
    {
      bedId: 'B-04', area: 'Pod A',
      patient: {
        name: 'Susan Wright', age: 72, sex: 'F', diagnosis: 'AKI stage 3 · CRRT', los: 6,
        flags: ['crrt'], isolation: false, codeStatus: 'DNR', sofa: 8, ews: 4,
        vitals: { hr: 88, map: 77, spo2: 96, temp: 36.9, uo: 5 },
        alert: { severity: 'med', message: 'CRRT filter life 68% — change anticipated 22:00' },
        attending: DOCS[0], severity: 'high', mapTrend: [75, 76, 78, 77, 76, 77, 77],
      },
    },
    {
      bedId: 'B-05', area: 'Pod A',
      patient: {
        name: 'David Chen', age: 61, sex: 'M', diagnosis: 'Post-CABG day 1 · Low CO', los: 1,
        flags: ['pressor'], isolation: false, codeStatus: 'Full Code', sofa: 6, ews: 4,
        vitals: { hr: 90, map: 71, spo2: 97, temp: 36.2, uo: 60 },
        alert: { severity: 'med', message: 'Chest drain 40 mL/h — trending down' },
        attending: DOCS[1], severity: 'high', mapTrend: [66, 68, 70, 69, 71, 72, 71],
      },
    },
    {
      bedId: 'B-06', area: 'Pod A',
      patient: {
        name: 'Layla Hassan', age: 34, sex: 'F', diagnosis: 'DKA · resolving', los: 2,
        flags: [], isolation: false, codeStatus: 'Full Code', sofa: 2, ews: 2,
        vitals: { hr: 98, map: 86, spo2: 99, temp: 37.0, uo: 120 },
        alert: { severity: 'info', message: 'Anion gap closed — transition to SC insulin' },
        attending: DOCS[2], severity: 'stable', mapTrend: [80, 82, 84, 85, 86, 86, 86],
      },
    },
    {
      bedId: 'B-07', area: 'Pod A',
      patient: {
        name: 'Robert Miller', age: 79, sex: 'M', diagnosis: 'Influenza A pneumonia', los: 5,
        flags: ['vent'], isolation: true, codeStatus: 'DNR / DNI', sofa: 9, ews: 7,
        vitals: { hr: 112, map: 69, spo2: 92, temp: 38.1, uo: 40 },
        alert: { severity: 'crit', message: 'SpO₂ 92% on FiO₂ 60% — proning considered' },
        attending: DOCS[0], severity: 'crit', mapTrend: [74, 73, 72, 70, 70, 69, 69],
      },
    },
    { bedId: 'B-08', area: 'Pod A', patient: null },
    {
      bedId: 'B-09', area: 'Pod B',
      patient: {
        name: 'Nadia Karim', age: 52, sex: 'F', diagnosis: 'Upper GI bleed · post-EGD', los: 1,
        flags: [], isolation: false, codeStatus: 'Full Code', sofa: 4, ews: 3,
        vitals: { hr: 104, map: 77, spo2: 98, temp: 36.6, uo: 70 },
        alert: { severity: 'med', message: 'Hgb recheck 14:00 — rebleed surveillance' },
        attending: DOCS[1], severity: 'high', mapTrend: [70, 72, 74, 75, 76, 77, 77],
      },
    },
    {
      bedId: 'B-10', area: 'Pod B',
      patient: {
        name: 'George Antoun', age: 66, sex: 'M', diagnosis: 'Cardiogenic shock · IABP', los: 3,
        flags: ['pressor'], isolation: false, codeStatus: 'Full Code', sofa: 10, ews: 8,
        vitals: { hr: 108, map: 66, spo2: 95, temp: 36.4, uo: 25 },
        alert: { severity: 'crit', message: 'CI 1.9 L/min/m² — milrinone uptitrated' },
        attending: DOCS[3], severity: 'crit', mapTrend: [70, 69, 68, 67, 66, 66, 66],
      },
    },
    {
      bedId: 'B-11', area: 'Pod B',
      patient: {
        name: 'Fatima Zahra', age: 29, sex: 'F', diagnosis: 'Postpartum hemorrhage · POD 1', los: 1,
        flags: [], isolation: false, codeStatus: 'Full Code', sofa: 3, ews: 2,
        vitals: { hr: 92, map: 80, spo2: 99, temp: 37.1, uo: 95 },
        alert: { severity: 'info', message: 'Coags normalized — step-down review AM' },
        attending: DOCS[2], severity: 'stable', mapTrend: [72, 75, 77, 78, 79, 80, 80],
      },
    },
    {
      bedId: 'B-12', area: 'Pod B',
      patient: {
        name: 'Hans Becker', age: 71, sex: 'M', diagnosis: 'COPD exacerbation · NIV', los: 3,
        flags: [], isolation: false, codeStatus: 'DNR', sofa: 5, ews: 5,
        vitals: { hr: 96, map: 82, spo2: 90, temp: 36.7, uo: 75 },
        alert: { severity: 'high', message: 'pCO₂ 61 mmHg on NIV — ABG q4h' },
        attending: DOCS[3], severity: 'high', mapTrend: [80, 81, 82, 81, 82, 82, 82],
      },
    },
    {
      bedId: 'B-13', area: 'Pod B',
      patient: {
        name: 'Aisha Mahmoud', age: 48, sex: 'F', diagnosis: 'Necrotizing pancreatitis', los: 7,
        flags: ['vent', 'pressor'], isolation: false, codeStatus: 'Full Code', sofa: 10, ews: 7,
        vitals: { hr: 114, map: 68, spo2: 94, temp: 38.6, uo: 30 },
        alert: { severity: 'crit', message: 'Intra-abdominal pressure 19 mmHg — trending up' },
        attending: DOCS[0], severity: 'crit', mapTrend: [72, 71, 70, 69, 69, 68, 68],
      },
    },
    {
      bedId: 'B-14', area: 'Pod B',
      patient: {
        name: 'Peter Novak', age: 55, sex: 'M', diagnosis: 'Status epilepticus · resolved', los: 2,
        flags: [], isolation: false, codeStatus: 'Full Code', sofa: 3, ews: 2,
        vitals: { hr: 78, map: 88, spo2: 98, temp: 36.9, uo: 100 },
        alert: { severity: 'info', message: 'EEG: no epileptiform activity ×24 h' },
        attending: DOCS[3], severity: 'stable', mapTrend: [84, 85, 86, 87, 88, 88, 88],
      },
    },
    {
      bedId: 'B-15', area: 'Pod B',
      patient: {
        name: 'Miriam Cohen', age: 63, sex: 'F', diagnosis: 'Pulmonary embolism · massive', los: 2,
        flags: [], isolation: false, codeStatus: 'Full Code', sofa: 6, ews: 5,
        vitals: { hr: 102, map: 74, spo2: 94, temp: 37.0, uo: 65 },
        alert: { severity: 'high', message: 'RV strain on echo — heparin therapeutic' },
        attending: DOCS[1], severity: 'high', mapTrend: [68, 70, 71, 72, 73, 74, 74],
      },
    },
    { bedId: 'B-16', area: 'Pod B', patient: null },
  ],
}

export const UNIT_SUMMARY: UnitSummaryResponse = {
  unitId: '4B',
  admissionsInProgress: 3,
  dischargesPlanned: 2,
  pendingConsults: 4,
  highPriorityAlerts: [
    { severity: 'crit', message: 'B-01 · MAP <65 mmHg ×12 min despite norad 0.32', time: '09:31' },
    { severity: 'crit', message: 'B-10 · Cardiac index 1.9 — escalation in progress', time: '09:18' },
    { severity: 'crit', message: 'B-13 · IAP 19 mmHg — surgical review requested', time: '08:47' },
    { severity: 'high', message: 'B-07 · SpO₂ 92% on FiO₂ 60% — proning considered', time: '08:22' },
    { severity: 'high', message: 'B-12 · pCO₂ 61 on NIV — reassess in 2 h', time: '07:55' },
  ],
  stats: [
    { label: 'Admissions Today', value: '3', delta: '+1 vs avg', trend: 'up' },
    { label: 'Discharges Today', value: '2', delta: 'on plan', trend: 'fl' },
    { label: 'Mortality (30 d)', value: '6.8%', delta: '−1.2%', trend: 'up' },
    { label: 'Readmissions (48 h)', value: '1', delta: '−', trend: 'fl' },
    { label: 'Vent Utilization', value: '5 / 16', delta: '31%', trend: 'fl' },
    { label: 'Avg ICU Stay', value: '3.6 d', delta: '−0.4 d', trend: 'up' },
  ],
}
