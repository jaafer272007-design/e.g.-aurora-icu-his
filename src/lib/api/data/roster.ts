import type {
  BedAlert, BedCardVitals, MonitorVitals, Sex, SupportFlag,
} from '../types'

/* Canonical unit roster — THE single source of patient identity, location,
   and bedside state. The bed board (beds.ts), Mission Control roster/detail
   (patients.ts), Doctor Workspace rounding list (workspace.ts), and Nurse
   Workspace assignment (nursing.ts) are ALL derived views over this store —
   never parallel copies. Orders/results/consults keep their own denormalized
   name/bed DISPLAY snapshots by design (audit records), but never redefine
   identity. Replaced by the ASP.NET Core patient service at Stage 10.

   `bedsideVitals` is the bed-card spot-check snapshot; `monitorVitals` is
   the richer live-monitor feed (device integration replaces both at
   Stage 11) — they are different measurements, not duplicates. */

export interface UnitPatientRecord {
  patientId: string
  /** current bed — location only, can change */
  bedId: string
  name: string
  mrn: string
  age: number
  sex: Sex
  diagnosis: string
  los: number
  allergies: string
  attending: string
  codeStatus: string
  codeStatusCode?: string | null
  codeStatusLegacy?: boolean
  rhythm: string
  flags: SupportFlag[]
  isolation: boolean
  /* severity + organs RETIRED (no-reassuring-default rule): acuity and
     organ status are DERIVED from the real scores at render — a static
     fixture claim was the reassuring-green bug */
  bedsideVitals: BedCardVitals
  bedAlert: BedAlert
  mapTrend: number[]
  monitorVitals: MonitorVitals
}

export const ROSTER: UnitPatientRecord[] = [
  {
    patientId: 'P-1001', bedId: 'B-01', name: 'Ahmed Al-Saadi', mrn: 'MRN-482913', age: 58, sex: 'M',
    diagnosis: 'Septic shock · Pneumonia', los: 4, allergies: 'Penicillin', attending: 'Dr. S. Rahman',
    codeStatus: 'Full Code', codeStatusCode: 'full_code', flags: ['vent', 'pressor'], isolation: false, rhythm: 'Sinus Tach',
    bedsideVitals: { hr: 118, map: 64, spo2: 93, temp: 38.4, uo: 28 },
    bedAlert: { severity: 'crit', message: 'MAP <65 ×12 min — norad 0.32 µg/kg/min', time: '09:31' },
    mapTrend: [72, 70, 68, 66, 65, 64, 64],
    monitorVitals: { hr: 118, sys: 92, dia: 54, map: 67, nibpSys: 96, nibpDia: 58, spo2: 93, rr: 24, temp: 38.4, etco2: 34, cvp: 12 },
  },
  {
    patientId: 'P-1002', bedId: 'B-02', name: 'Maria Hansen', mrn: 'MRN-771204', age: 67, sex: 'F',
    diagnosis: 'Severe ARDS · VV-ECMO day 5', los: 9, allergies: 'None known', attending: 'Dr. L. Osei',
    codeStatus: 'Full Code', codeStatusCode: 'full_code', flags: ['vent', 'ecmo'], isolation: false, rhythm: 'Sinus',
    bedsideVitals: { hr: 96, map: 76, spo2: 91, temp: 37.2, uo: 55 },
    bedAlert: { severity: 'high', message: 'ECMO flow variability — circuit check 10:00', time: '09:12' },
    mapTrend: [74, 75, 73, 76, 77, 76, 76],
    monitorVitals: { hr: 96, sys: 104, dia: 62, map: 76, nibpSys: 108, nibpDia: 64, spo2: 91, rr: 14, temp: 37.2, etco2: 31, cvp: 10 },
  },
  {
    patientId: 'P-1003', bedId: 'B-03', name: 'Omar Khalil', mrn: 'MRN-390155', age: 45, sex: 'M',
    diagnosis: 'Severe TBI · ICP monitor', los: 2, allergies: 'Sulfa', attending: 'Dr. E. Marchetti',
    codeStatus: 'Full Code', codeStatusCode: 'full_code', flags: ['vent'], isolation: true, rhythm: 'Sinus',
    bedsideVitals: { hr: 64, map: 96, spo2: 99, temp: 36.8, uo: 110 },
    bedAlert: { severity: 'high', message: 'ICP 18–22 mmHg — hypertonic saline q6h', time: '08:40' },
    mapTrend: [92, 94, 95, 97, 96, 95, 96],
    monitorVitals: { hr: 64, sys: 138, dia: 74, map: 96, nibpSys: 142, nibpDia: 78, spo2: 99, rr: 16, temp: 36.8, etco2: 35, cvp: 8 },
  },
  {
    patientId: 'P-1004', bedId: 'B-04', name: 'Susan Wright', mrn: 'MRN-560981', age: 72, sex: 'F',
    diagnosis: 'AKI stage 3 · CRRT', los: 6, allergies: 'Contrast dye', attending: 'Dr. S. Rahman',
    codeStatus: 'DNR', codeStatusCode: 'dnr', flags: ['crrt'], isolation: false, rhythm: 'AFib',
    bedsideVitals: { hr: 88, map: 77, spo2: 96, temp: 36.9, uo: 5 },
    bedAlert: { severity: 'med', message: 'CRRT filter life 68% — change anticipated 22:00', time: '07:58' },
    mapTrend: [75, 76, 78, 77, 76, 77, 77],
    monitorVitals: { hr: 88, sys: 110, dia: 60, map: 77, nibpSys: 112, nibpDia: 62, spo2: 96, rr: 18, temp: 36.9, etco2: 33, cvp: 14 },
  },
  {
    patientId: 'P-1005', bedId: 'B-05', name: 'David Chen', mrn: 'MRN-118472', age: 61, sex: 'M',
    diagnosis: 'Post-CABG day 1 · Low CO', los: 1, allergies: 'Aspirin (GI)', attending: 'Dr. L. Osei',
    codeStatus: 'Full Code', codeStatusCode: 'full_code', flags: ['pressor'], isolation: false, rhythm: 'Paced',
    bedsideVitals: { hr: 90, map: 71, spo2: 97, temp: 36.2, uo: 60 },
    bedAlert: { severity: 'med', message: 'Chest drain 40 mL/h — trending down', time: '08:05' },
    mapTrend: [66, 68, 70, 69, 71, 72, 71],
    monitorVitals: { hr: 90, sys: 98, dia: 58, map: 71, nibpSys: 100, nibpDia: 60, spo2: 97, rr: 15, temp: 36.2, etco2: 36, cvp: 11 },
  },
  {
    patientId: 'P-1006', bedId: 'B-06', name: 'Layla Hassan', mrn: 'MRN-204863', age: 34, sex: 'F',
    diagnosis: 'DKA · resolving', los: 2, allergies: 'None known', attending: 'Dr. E. Marchetti',
    codeStatus: 'Full Code', codeStatusCode: 'full_code', flags: [], isolation: false, rhythm: 'Sinus',
    bedsideVitals: { hr: 98, map: 86, spo2: 99, temp: 37.0, uo: 120 },
    bedAlert: { severity: 'info', message: 'Anion gap closed — transition to SC insulin', time: '06:45' },
    mapTrend: [80, 82, 84, 85, 86, 86, 86],
    monitorVitals: { hr: 98, sys: 118, dia: 70, map: 86, nibpSys: 120, nibpDia: 72, spo2: 99, rr: 18, temp: 37.0, etco2: 38, cvp: 6 },
  },
  {
    patientId: 'P-1007', bedId: 'B-07', name: 'Robert Miller', mrn: 'MRN-667310', age: 79, sex: 'M',
    diagnosis: 'Influenza A pneumonia', los: 5, allergies: 'Codeine', attending: 'Dr. S. Rahman',
    codeStatus: 'DNR / DNI', codeStatusCode: 'dnr_dni', flags: ['vent'], isolation: true, rhythm: 'AFib RVR',
    bedsideVitals: { hr: 112, map: 69, spo2: 92, temp: 38.1, uo: 40 },
    bedAlert: { severity: 'crit', message: 'SpO₂ 92% on FiO₂ 60% — proning considered', time: '08:22' },
    mapTrend: [74, 73, 72, 70, 70, 69, 69],
    monitorVitals: { hr: 112, sys: 96, dia: 55, map: 69, nibpSys: 98, nibpDia: 57, spo2: 92, rr: 26, temp: 38.1, etco2: 30, cvp: 9 },
  },
  {
    patientId: 'P-1008', bedId: 'B-09', name: 'Nadia Karim', mrn: 'MRN-935027', age: 52, sex: 'F',
    diagnosis: 'Upper GI bleed · post-EGD', los: 1, allergies: 'Latex', attending: 'Dr. L. Osei',
    codeStatus: 'Full Code', codeStatusCode: 'full_code', flags: [], isolation: false, rhythm: 'Sinus',
    bedsideVitals: { hr: 104, map: 77, spo2: 98, temp: 36.6, uo: 70 },
    bedAlert: { severity: 'med', message: 'Hgb recheck 14:00 — rebleed surveillance', time: '08:31' },
    mapTrend: [70, 72, 74, 75, 76, 77, 77],
    monitorVitals: { hr: 104, sys: 102, dia: 64, map: 77, nibpSys: 104, nibpDia: 66, spo2: 98, rr: 17, temp: 36.6, etco2: 37, cvp: 5 },
  },
  {
    patientId: 'P-1009', bedId: 'B-10', name: 'George Antoun', mrn: 'MRN-204518', age: 66, sex: 'M',
    diagnosis: 'Cardiogenic shock · IABP', los: 3, allergies: 'None known', attending: 'Dr. H. Nakamura',
    codeStatus: 'Full Code', codeStatusCode: 'full_code', flags: ['pressor'], isolation: false, rhythm: 'Sinus Tach',
    bedsideVitals: { hr: 108, map: 66, spo2: 95, temp: 36.4, uo: 25 },
    bedAlert: { severity: 'crit', message: 'CI 1.9 L/min/m² — milrinone uptitrated', time: '09:18' },
    mapTrend: [70, 69, 68, 67, 66, 66, 66],
    monitorVitals: { hr: 108, sys: 88, dia: 55, map: 66, nibpSys: 92, nibpDia: 58, spo2: 95, rr: 22, temp: 36.4, etco2: 32, cvp: 15 },
  },
  {
    patientId: 'P-1010', bedId: 'B-11', name: 'Fatima Zahra', mrn: 'MRN-582047', age: 29, sex: 'F',
    diagnosis: 'Postpartum hemorrhage · POD 1', los: 1, allergies: 'None known', attending: 'Dr. E. Marchetti',
    codeStatus: 'Full Code', codeStatusCode: 'full_code', flags: [], isolation: false, rhythm: 'Sinus',
    bedsideVitals: { hr: 92, map: 80, spo2: 99, temp: 37.1, uo: 95 },
    bedAlert: { severity: 'info', message: 'Coags normalized — step-down review AM', time: '07:20' },
    mapTrend: [72, 75, 77, 78, 79, 80, 80],
    monitorVitals: { hr: 92, sys: 108, dia: 66, map: 80, nibpSys: 110, nibpDia: 68, spo2: 99, rr: 16, temp: 37.1, etco2: 37, cvp: 6 },
  },
  {
    patientId: 'P-1011', bedId: 'B-12', name: 'Hans Becker', mrn: 'MRN-661093', age: 71, sex: 'M',
    diagnosis: 'COPD exacerbation · NIV', los: 3, allergies: 'Penicillin', attending: 'Dr. H. Nakamura',
    codeStatus: 'DNR', codeStatusCode: 'dnr', flags: [], isolation: false, rhythm: 'Sinus',
    bedsideVitals: { hr: 96, map: 82, spo2: 90, temp: 36.7, uo: 75 },
    bedAlert: { severity: 'high', message: 'pCO₂ 61 mmHg on NIV — ABG q4h', time: '07:55' },
    mapTrend: [80, 81, 82, 81, 82, 82, 82],
    monitorVitals: { hr: 96, sys: 118, dia: 64, map: 82, nibpSys: 120, nibpDia: 66, spo2: 90, rr: 24, temp: 36.7, etco2: 52, cvp: 8 },
  },
  {
    patientId: 'P-1012', bedId: 'B-13', name: 'Aisha Mahmoud', mrn: 'MRN-118834', age: 48, sex: 'F',
    diagnosis: 'Necrotizing pancreatitis', los: 7, allergies: 'Morphine', attending: 'Dr. S. Rahman',
    codeStatus: 'Full Code', codeStatusCode: 'full_code', flags: ['vent', 'pressor'], isolation: false, rhythm: 'Sinus Tach',
    bedsideVitals: { hr: 114, map: 68, spo2: 94, temp: 38.6, uo: 30 },
    bedAlert: { severity: 'crit', message: 'Intra-abdominal pressure 19 mmHg — trending up', time: '08:47' },
    mapTrend: [72, 71, 70, 69, 69, 68, 68],
    monitorVitals: { hr: 114, sys: 90, dia: 57, map: 68, nibpSys: 94, nibpDia: 60, spo2: 94, rr: 22, temp: 38.6, etco2: 33, cvp: 13 },
  },
  {
    patientId: 'P-1013', bedId: 'B-14', name: 'Peter Novak', mrn: 'MRN-447120', age: 55, sex: 'M',
    diagnosis: 'Status epilepticus · resolved', los: 2, allergies: 'None known', attending: 'Dr. H. Nakamura',
    codeStatus: 'Full Code', codeStatusCode: 'full_code', flags: [], isolation: false, rhythm: 'Sinus',
    bedsideVitals: { hr: 78, map: 88, spo2: 98, temp: 36.9, uo: 100 },
    bedAlert: { severity: 'info', message: 'EEG: no epileptiform activity ×24 h', time: '06:15' },
    mapTrend: [84, 85, 86, 87, 88, 88, 88],
    monitorVitals: { hr: 78, sys: 124, dia: 70, map: 88, nibpSys: 126, nibpDia: 72, spo2: 98, rr: 15, temp: 36.9, etco2: 39, cvp: 7 },
  },
  {
    patientId: 'P-1014', bedId: 'B-15', name: 'Miriam Cohen', mrn: 'MRN-905331', age: 63, sex: 'F',
    diagnosis: 'Pulmonary embolism · massive', los: 2, allergies: 'NSAIDs', attending: 'Dr. L. Osei',
    codeStatus: 'Full Code', codeStatusCode: 'full_code', flags: [], isolation: false, rhythm: 'Sinus Tach',
    bedsideVitals: { hr: 102, map: 74, spo2: 94, temp: 37.0, uo: 65 },
    bedAlert: { severity: 'high', message: 'RV strain on echo — heparin therapeutic', time: '07:38' },
    mapTrend: [68, 70, 71, 72, 73, 74, 74],
    monitorVitals: { hr: 102, sys: 98, dia: 62, map: 74, nibpSys: 102, nibpDia: 64, spo2: 94, rr: 22, temp: 37.0, etco2: 30, cvp: 12 },
  },
]

export const rosterFor = (patientId: string): UnitPatientRecord | undefined =>
  ROSTER.find(r => r.patientId === patientId)
