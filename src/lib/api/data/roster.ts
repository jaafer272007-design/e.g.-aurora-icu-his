import type {
  AiRisk, BedAlert, BedCardVitals, MonitorVitals, OrganName, OrganStatus, Severity, Sex, SupportFlag,
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
  rhythm: string
  flags: SupportFlag[]
  isolation: boolean
  alertCount: number
  severity: Severity
  sofa: number
  ews: number
  bedsideVitals: BedCardVitals
  bedAlert: BedAlert
  mapTrend: number[]
  monitorVitals: MonitorVitals
  organs: Record<OrganName, OrganStatus>
  aiRisks: AiRisk[]
}

export const ROSTER: UnitPatientRecord[] = [
  {
    patientId: 'P-1001', bedId: 'B-01', name: 'Ahmed Al-Saadi', mrn: 'MRN-482913', age: 58, sex: 'M',
    diagnosis: 'Septic shock · Pneumonia', los: 4, allergies: 'Penicillin', attending: 'Dr. S. Rahman',
    codeStatus: 'Full Code', flags: ['vent', 'pressor'], isolation: false, alertCount: 3, rhythm: 'Sinus Tach',
    severity: 'crit', sofa: 11, ews: 9,
    bedsideVitals: { hr: 118, map: 64, spo2: 93, temp: 38.4, uo: 28 },
    bedAlert: { severity: 'crit', message: 'MAP <65 ×12 min — norad 0.32 µg/kg/min' },
    mapTrend: [72, 70, 68, 66, 65, 64, 64],
    monitorVitals: { hr: 118, sys: 92, dia: 54, map: 67, nibpSys: 96, nibpDia: 58, spo2: 93, rr: 24, temp: 38.4, etco2: 34, cvp: 12 },
    organs: { Brain: 'watch', Heart: 'watch', Lungs: 'crit', Kidneys: 'watch', Liver: 'ok', Circulation: 'crit' },
    aiRisks: [
      { name: 'Sepsis', probability: 86, rationale: 'SOFA ↑2 in 24 h, lactate 3.8 rising, persistent vasopressor need.' },
      { name: 'AKI', probability: 62, rationale: 'Urine output 0.4 mL/kg/h ×5 h; creatinine ↑ 38% from baseline.' },
      { name: 'ARDS', probability: 71, rationale: 'P/F ratio 148 on FiO₂ 0.55; bilateral infiltrates on imaging.' },
      { name: 'Delirium', probability: 44, rationale: 'Age + sedation depth (RASS −3) + sepsis raise risk; CAM-ICU due.' },
      { name: 'Mortality', probability: 28, rationale: 'APACHE II 24 → predicted in-ICU mortality; trending stable.' },
    ],
  },
  {
    patientId: 'P-1002', bedId: 'B-02', name: 'Maria Hansen', mrn: 'MRN-771204', age: 67, sex: 'F',
    diagnosis: 'Severe ARDS · VV-ECMO day 5', los: 9, allergies: 'None known', attending: 'Dr. L. Osei',
    codeStatus: 'Full Code', flags: ['vent', 'ecmo'], isolation: false, alertCount: 2, rhythm: 'Sinus',
    severity: 'crit', sofa: 12, ews: 8,
    bedsideVitals: { hr: 96, map: 76, spo2: 91, temp: 37.2, uo: 55 },
    bedAlert: { severity: 'high', message: 'ECMO flow variability — circuit check 10:00' },
    mapTrend: [74, 75, 73, 76, 77, 76, 76],
    monitorVitals: { hr: 96, sys: 104, dia: 62, map: 76, nibpSys: 108, nibpDia: 64, spo2: 91, rr: 14, temp: 37.2, etco2: 31, cvp: 10 },
    organs: { Brain: 'ok', Heart: 'ok', Lungs: 'crit', Kidneys: 'ok', Liver: 'ok', Circulation: 'watch' },
    aiRisks: [
      { name: 'Sepsis', probability: 31, rationale: 'No new fever; procalcitonin falling on day 6 of therapy.' },
      { name: 'AKI', probability: 24, rationale: 'Stable creatinine; adequate urine output on low-dose support.' },
      { name: 'ARDS', probability: 92, rationale: 'Established severe ARDS on ECMO day 5; compliance 18 mL/cmH₂O.' },
      { name: 'Delirium', probability: 58, rationale: 'Prolonged sedation and ECMO immobility elevate risk.' },
      { name: 'Mortality', probability: 35, rationale: 'RESP score 2 → favorable ECMO survival category.' },
    ],
  },
  {
    patientId: 'P-1003', bedId: 'B-03', name: 'Omar Khalil', mrn: 'MRN-390155', age: 45, sex: 'M',
    diagnosis: 'Severe TBI · ICP monitor', los: 2, allergies: 'Sulfa', attending: 'Dr. E. Marchetti',
    codeStatus: 'Full Code', flags: ['vent'], isolation: true, alertCount: 1, rhythm: 'Sinus',
    severity: 'high', sofa: 7, ews: 5,
    bedsideVitals: { hr: 64, map: 96, spo2: 99, temp: 36.8, uo: 110 },
    bedAlert: { severity: 'high', message: 'ICP 18–22 mmHg — hypertonic saline q6h' },
    mapTrend: [92, 94, 95, 97, 96, 95, 96],
    monitorVitals: { hr: 64, sys: 138, dia: 74, map: 96, nibpSys: 142, nibpDia: 78, spo2: 99, rr: 16, temp: 36.8, etco2: 35, cvp: 8 },
    organs: { Brain: 'crit', Heart: 'ok', Lungs: 'ok', Kidneys: 'ok', Liver: 'ok', Circulation: 'ok' },
    aiRisks: [
      { name: 'Sepsis', probability: 12, rationale: 'No infectious signs; surveillance cultures negative.' },
      { name: 'AKI', probability: 18, rationale: 'Hypertonic saline in use — monitoring sodium and creatinine.' },
      { name: 'ARDS', probability: 22, rationale: 'Lung-protective settings; oxygenation preserved.' },
      { name: 'Delirium', probability: 66, rationale: 'TBI itself is a major risk factor once sedation is weaned.' },
      { name: 'Mortality', probability: 21, rationale: 'GCS motor 4, reactive pupils → intermediate IMPACT score.' },
    ],
  },
  {
    patientId: 'P-1004', bedId: 'B-04', name: 'Susan Wright', mrn: 'MRN-560981', age: 72, sex: 'F',
    diagnosis: 'AKI stage 3 · CRRT', los: 6, allergies: 'Contrast dye', attending: 'Dr. S. Rahman',
    codeStatus: 'DNR', flags: ['crrt'], isolation: false, alertCount: 1, rhythm: 'AFib',
    severity: 'high', sofa: 8, ews: 4,
    bedsideVitals: { hr: 88, map: 77, spo2: 96, temp: 36.9, uo: 5 },
    bedAlert: { severity: 'med', message: 'CRRT filter life 68% — change anticipated 22:00' },
    mapTrend: [75, 76, 78, 77, 76, 77, 77],
    monitorVitals: { hr: 88, sys: 110, dia: 60, map: 77, nibpSys: 112, nibpDia: 62, spo2: 96, rr: 18, temp: 36.9, etco2: 33, cvp: 14 },
    organs: { Brain: 'ok', Heart: 'watch', Lungs: 'ok', Kidneys: 'crit', Liver: 'ok', Circulation: 'ok' },
    aiRisks: [
      { name: 'Sepsis', probability: 26, rationale: 'Line day 6 — site clean; low-grade risk from access.' },
      { name: 'AKI', probability: 95, rationale: 'Established stage 3 AKI on CRRT hour 41.' },
      { name: 'ARDS', probability: 15, rationale: 'No respiratory failure; volume status controlled by CRRT.' },
      { name: 'Delirium', probability: 52, rationale: 'Age >70 and uremia both contribute; reorient q shift.' },
      { name: 'Mortality', probability: 33, rationale: 'AKI-on-CKD with cardiac history; goals discussed.' },
    ],
  },
  {
    patientId: 'P-1005', bedId: 'B-05', name: 'David Chen', mrn: 'MRN-118472', age: 61, sex: 'M',
    diagnosis: 'Post-CABG day 1 · Low CO', los: 1, allergies: 'Aspirin (GI)', attending: 'Dr. L. Osei',
    codeStatus: 'Full Code', flags: ['pressor'], isolation: false, alertCount: 2, rhythm: 'Paced',
    severity: 'high', sofa: 6, ews: 4,
    bedsideVitals: { hr: 90, map: 71, spo2: 97, temp: 36.2, uo: 60 },
    bedAlert: { severity: 'med', message: 'Chest drain 40 mL/h — trending down' },
    mapTrend: [66, 68, 70, 69, 71, 72, 71],
    monitorVitals: { hr: 90, sys: 98, dia: 58, map: 71, nibpSys: 100, nibpDia: 60, spo2: 97, rr: 15, temp: 36.2, etco2: 36, cvp: 11 },
    organs: { Brain: 'ok', Heart: 'watch', Lungs: 'ok', Kidneys: 'ok', Liver: 'ok', Circulation: 'watch' },
    aiRisks: [
      { name: 'Sepsis', probability: 9, rationale: 'POD 1 — no infectious concern; prophylaxis on schedule.' },
      { name: 'AKI', probability: 38, rationale: 'Bypass time 118 min; watching post-pump creatinine.' },
      { name: 'ARDS', probability: 14, rationale: 'Extubated at hour 9; incentive spirometry started.' },
      { name: 'Delirium', probability: 47, rationale: 'Cardiac surgery + age → moderate postoperative risk.' },
      { name: 'Mortality', probability: 8, rationale: 'EuroSCORE II low; expected routine recovery.' },
    ],
  },
  {
    patientId: 'P-1006', bedId: 'B-06', name: 'Layla Hassan', mrn: 'MRN-204863', age: 34, sex: 'F',
    diagnosis: 'DKA · resolving', los: 2, allergies: 'None known', attending: 'Dr. E. Marchetti',
    codeStatus: 'Full Code', flags: [], isolation: false, alertCount: 0, rhythm: 'Sinus',
    severity: 'stable', sofa: 2, ews: 2,
    bedsideVitals: { hr: 98, map: 86, spo2: 99, temp: 37.0, uo: 120 },
    bedAlert: { severity: 'info', message: 'Anion gap closed — transition to SC insulin' },
    mapTrend: [80, 82, 84, 85, 86, 86, 86],
    monitorVitals: { hr: 98, sys: 118, dia: 70, map: 86, nibpSys: 120, nibpDia: 72, spo2: 99, rr: 18, temp: 37.0, etco2: 38, cvp: 6 },
    organs: { Brain: 'ok', Heart: 'ok', Lungs: 'ok', Kidneys: 'watch', Liver: 'ok', Circulation: 'ok' },
    aiRisks: [
      { name: 'Sepsis', probability: 11, rationale: 'UTI trigger treated; afebrile 24 h.' },
      { name: 'AKI', probability: 29, rationale: 'Prerenal pattern resolving with volume repletion.' },
      { name: 'ARDS', probability: 5, rationale: 'No pulmonary involvement.' },
      { name: 'Delirium', probability: 12, rationale: 'Young, awake, oriented — low risk.' },
      { name: 'Mortality', probability: 3, rationale: 'Anion gap closed; transfer planning underway.' },
    ],
  },
  {
    patientId: 'P-1007', bedId: 'B-07', name: 'Robert Miller', mrn: 'MRN-667310', age: 79, sex: 'M',
    diagnosis: 'Influenza A pneumonia', los: 5, allergies: 'Codeine', attending: 'Dr. S. Rahman',
    codeStatus: 'DNR / DNI', flags: ['vent'], isolation: true, alertCount: 2, rhythm: 'AFib RVR',
    severity: 'crit', sofa: 9, ews: 7,
    bedsideVitals: { hr: 112, map: 69, spo2: 92, temp: 38.1, uo: 40 },
    bedAlert: { severity: 'crit', message: 'SpO₂ 92% on FiO₂ 60% — proning considered' },
    mapTrend: [74, 73, 72, 70, 70, 69, 69],
    monitorVitals: { hr: 112, sys: 96, dia: 55, map: 69, nibpSys: 98, nibpDia: 57, spo2: 92, rr: 26, temp: 38.1, etco2: 30, cvp: 9 },
    organs: { Brain: 'watch', Heart: 'watch', Lungs: 'crit', Kidneys: 'ok', Liver: 'ok', Circulation: 'watch' },
    aiRisks: [
      { name: 'Sepsis', probability: 54, rationale: 'Secondary bacterial pneumonia suspected; cultures pending.' },
      { name: 'AKI', probability: 41, rationale: 'Creatinine drift + diuretic exposure — monitor closely.' },
      { name: 'ARDS', probability: 63, rationale: 'P/F 176; droplet isolation, proning considered.' },
      { name: 'Delirium', probability: 78, rationale: 'Age 79, hypoxemia, ICU day 5 — CAM-ICU positive overnight.' },
      { name: 'Mortality', probability: 42, rationale: 'CURB-65 4 with treatment limits in place.' },
    ],
  },
  {
    patientId: 'P-1008', bedId: 'B-09', name: 'Nadia Karim', mrn: 'MRN-935027', age: 52, sex: 'F',
    diagnosis: 'Upper GI bleed · post-EGD', los: 1, allergies: 'Latex', attending: 'Dr. L. Osei',
    codeStatus: 'Full Code', flags: [], isolation: false, alertCount: 1, rhythm: 'Sinus',
    severity: 'high', sofa: 4, ews: 3,
    bedsideVitals: { hr: 104, map: 77, spo2: 98, temp: 36.6, uo: 70 },
    bedAlert: { severity: 'med', message: 'Hgb recheck 14:00 — rebleed surveillance' },
    mapTrend: [70, 72, 74, 75, 76, 77, 77],
    monitorVitals: { hr: 104, sys: 102, dia: 64, map: 77, nibpSys: 104, nibpDia: 66, spo2: 98, rr: 17, temp: 36.6, etco2: 37, cvp: 5 },
    organs: { Brain: 'ok', Heart: 'ok', Lungs: 'ok', Kidneys: 'ok', Liver: 'watch', Circulation: 'watch' },
    aiRisks: [
      { name: 'Sepsis', probability: 13, rationale: 'No fever; prophylactic ceftriaxone for cirrhosis.' },
      { name: 'AKI', probability: 27, rationale: 'Watching post-hemorrhage perfusion; urine output adequate.' },
      { name: 'ARDS', probability: 7, rationale: 'No transfusion-related lung injury observed.' },
      { name: 'Delirium', probability: 35, rationale: 'Hepatic encephalopathy history — lactulose resumed.' },
      { name: 'Mortality', probability: 16, rationale: 'Rockall 5 → rebleed surveillance for 72 h.' },
    ],
  },
  {
    patientId: 'P-1009', bedId: 'B-10', name: 'George Antoun', mrn: 'MRN-204518', age: 66, sex: 'M',
    diagnosis: 'Cardiogenic shock · IABP', los: 3, allergies: 'None known', attending: 'Dr. H. Nakamura',
    codeStatus: 'Full Code', flags: ['pressor'], isolation: false, alertCount: 2, rhythm: 'Sinus Tach',
    severity: 'crit', sofa: 10, ews: 8,
    bedsideVitals: { hr: 108, map: 66, spo2: 95, temp: 36.4, uo: 25 },
    bedAlert: { severity: 'crit', message: 'CI 1.9 L/min/m² — milrinone uptitrated' },
    mapTrend: [70, 69, 68, 67, 66, 66, 66],
    monitorVitals: { hr: 108, sys: 88, dia: 55, map: 66, nibpSys: 92, nibpDia: 58, spo2: 95, rr: 22, temp: 36.4, etco2: 32, cvp: 15 },
    organs: { Brain: 'ok', Heart: 'crit', Lungs: 'watch', Kidneys: 'watch', Liver: 'ok', Circulation: 'crit' },
    aiRisks: [
      { name: 'Sepsis', probability: 18, rationale: 'No infectious source; device sites clean on IABP day 3.' },
      { name: 'AKI', probability: 58, rationale: 'Urine output 25 mL/h with rising creatinine on low CI.' },
      { name: 'ARDS', probability: 26, rationale: 'Mild pulmonary congestion; oxygenation adequate on HFNC.' },
      { name: 'Delirium', probability: 49, rationale: 'Low-output state and ICU environment raise risk; screen q shift.' },
      { name: 'Mortality', probability: 46, rationale: 'CI 1.9 despite inotropes → high-risk cardiogenic shock category.' },
    ],
  },
  {
    patientId: 'P-1010', bedId: 'B-11', name: 'Fatima Zahra', mrn: 'MRN-582047', age: 29, sex: 'F',
    diagnosis: 'Postpartum hemorrhage · POD 1', los: 1, allergies: 'None known', attending: 'Dr. E. Marchetti',
    codeStatus: 'Full Code', flags: [], isolation: false, alertCount: 0, rhythm: 'Sinus',
    severity: 'stable', sofa: 3, ews: 2,
    bedsideVitals: { hr: 92, map: 80, spo2: 99, temp: 37.1, uo: 95 },
    bedAlert: { severity: 'info', message: 'Coags normalized — step-down review AM' },
    mapTrend: [72, 75, 77, 78, 79, 80, 80],
    monitorVitals: { hr: 92, sys: 108, dia: 66, map: 80, nibpSys: 110, nibpDia: 68, spo2: 99, rr: 16, temp: 37.1, etco2: 37, cvp: 6 },
    organs: { Brain: 'ok', Heart: 'ok', Lungs: 'ok', Kidneys: 'ok', Liver: 'ok', Circulation: 'watch' },
    aiRisks: [
      { name: 'Sepsis', probability: 10, rationale: 'Afebrile post-op; prophylactic antibiotics complete.' },
      { name: 'AKI', probability: 15, rationale: 'Brief hypotension resolved; urine output 95 mL/h.' },
      { name: 'ARDS', probability: 6, rationale: 'No transfusion-related lung injury after 4 units PRBC.' },
      { name: 'Delirium', probability: 9, rationale: 'Young, awake, oriented — low risk.' },
      { name: 'Mortality', probability: 4, rationale: 'Hemorrhage controlled; coags normalized — step-down planned.' },
    ],
  },
  {
    patientId: 'P-1011', bedId: 'B-12', name: 'Hans Becker', mrn: 'MRN-661093', age: 71, sex: 'M',
    diagnosis: 'COPD exacerbation · NIV', los: 3, allergies: 'Penicillin', attending: 'Dr. H. Nakamura',
    codeStatus: 'DNR', flags: [], isolation: false, alertCount: 1, rhythm: 'Sinus',
    severity: 'high', sofa: 5, ews: 5,
    bedsideVitals: { hr: 96, map: 82, spo2: 90, temp: 36.7, uo: 75 },
    bedAlert: { severity: 'high', message: 'pCO₂ 61 mmHg on NIV — ABG q4h' },
    mapTrend: [80, 81, 82, 81, 82, 82, 82],
    monitorVitals: { hr: 96, sys: 118, dia: 64, map: 82, nibpSys: 120, nibpDia: 66, spo2: 90, rr: 24, temp: 36.7, etco2: 52, cvp: 8 },
    organs: { Brain: 'watch', Heart: 'watch', Lungs: 'crit', Kidneys: 'ok', Liver: 'ok', Circulation: 'ok' },
    aiRisks: [
      { name: 'Sepsis', probability: 22, rationale: 'Purulent sputum treated day 3; CRP falling.' },
      { name: 'AKI', probability: 19, rationale: 'Stable creatinine; adequate oral intake resumed.' },
      { name: 'ARDS', probability: 24, rationale: 'Hypercapnic failure, not hypoxemic — NIV tolerated.' },
      { name: 'Delirium', probability: 55, rationale: 'CO₂ retention and age — CAM-ICU screening q shift.' },
      { name: 'Mortality', probability: 30, rationale: 'pCO₂ 61 on NIV with DNR limits — reassess in 2 h.' },
    ],
  },
  {
    patientId: 'P-1012', bedId: 'B-13', name: 'Aisha Mahmoud', mrn: 'MRN-118834', age: 48, sex: 'F',
    diagnosis: 'Necrotizing pancreatitis', los: 7, allergies: 'Morphine', attending: 'Dr. S. Rahman',
    codeStatus: 'Full Code', flags: ['vent', 'pressor'], isolation: false, alertCount: 2, rhythm: 'Sinus Tach',
    severity: 'crit', sofa: 10, ews: 7,
    bedsideVitals: { hr: 114, map: 68, spo2: 94, temp: 38.6, uo: 30 },
    bedAlert: { severity: 'crit', message: 'Intra-abdominal pressure 19 mmHg — trending up' },
    mapTrend: [72, 71, 70, 69, 69, 68, 68],
    monitorVitals: { hr: 114, sys: 90, dia: 57, map: 68, nibpSys: 94, nibpDia: 60, spo2: 94, rr: 22, temp: 38.6, etco2: 33, cvp: 13 },
    organs: { Brain: 'ok', Heart: 'watch', Lungs: 'watch', Kidneys: 'watch', Liver: 'watch', Circulation: 'crit' },
    aiRisks: [
      { name: 'Sepsis', probability: 74, rationale: 'Infected necrosis suspected; fever 38.6 with rising pressor need.' },
      { name: 'AKI', probability: 61, rationale: 'IAP 19 mmHg threatening renal perfusion; UO 30 mL/h.' },
      { name: 'ARDS', probability: 48, rationale: 'Bilateral effusions day 7; P/F trending down.' },
      { name: 'Delirium', probability: 41, rationale: 'Day 7 of sedation; SAT attempted daily.' },
      { name: 'Mortality', probability: 38, rationale: 'APACHE II 21 with abdominal compartment risk — surgical review.' },
    ],
  },
  {
    patientId: 'P-1013', bedId: 'B-14', name: 'Peter Novak', mrn: 'MRN-447120', age: 55, sex: 'M',
    diagnosis: 'Status epilepticus · resolved', los: 2, allergies: 'None known', attending: 'Dr. H. Nakamura',
    codeStatus: 'Full Code', flags: [], isolation: false, alertCount: 0, rhythm: 'Sinus',
    severity: 'stable', sofa: 3, ews: 2,
    bedsideVitals: { hr: 78, map: 88, spo2: 98, temp: 36.9, uo: 100 },
    bedAlert: { severity: 'info', message: 'EEG: no epileptiform activity ×24 h' },
    mapTrend: [84, 85, 86, 87, 88, 88, 88],
    monitorVitals: { hr: 78, sys: 124, dia: 70, map: 88, nibpSys: 126, nibpDia: 72, spo2: 98, rr: 15, temp: 36.9, etco2: 39, cvp: 7 },
    organs: { Brain: 'watch', Heart: 'ok', Lungs: 'ok', Kidneys: 'ok', Liver: 'ok', Circulation: 'ok' },
    aiRisks: [
      { name: 'Sepsis', probability: 8, rationale: 'No infectious trigger identified; cultures negative.' },
      { name: 'AKI', probability: 12, rationale: 'CK normalizing; no rhabdomyolysis sequelae.' },
      { name: 'ARDS', probability: 6, rationale: 'Airway protected; no aspiration on imaging.' },
      { name: 'Delirium', probability: 38, rationale: 'Post-ictal state clearing; EEG without epileptiform activity ×24 h.' },
      { name: 'Mortality', probability: 5, rationale: 'Seizure-free 24 h on levetiracetam; step-down review AM.' },
    ],
  },
  {
    patientId: 'P-1014', bedId: 'B-15', name: 'Miriam Cohen', mrn: 'MRN-905331', age: 63, sex: 'F',
    diagnosis: 'Pulmonary embolism · massive', los: 2, allergies: 'NSAIDs', attending: 'Dr. L. Osei',
    codeStatus: 'Full Code', flags: [], isolation: false, alertCount: 1, rhythm: 'Sinus Tach',
    severity: 'high', sofa: 6, ews: 5,
    bedsideVitals: { hr: 102, map: 74, spo2: 94, temp: 37.0, uo: 65 },
    bedAlert: { severity: 'high', message: 'RV strain on echo — heparin therapeutic' },
    mapTrend: [68, 70, 71, 72, 73, 74, 74],
    monitorVitals: { hr: 102, sys: 98, dia: 62, map: 74, nibpSys: 102, nibpDia: 64, spo2: 94, rr: 22, temp: 37.0, etco2: 30, cvp: 12 },
    organs: { Brain: 'ok', Heart: 'watch', Lungs: 'watch', Kidneys: 'ok', Liver: 'ok', Circulation: 'watch' },
    aiRisks: [
      { name: 'Sepsis', probability: 7, rationale: 'No infectious signs; afebrile since admission.' },
      { name: 'AKI', probability: 21, rationale: 'Contrast exposure from CTPA — creatinine surveillance.' },
      { name: 'ARDS', probability: 19, rationale: 'V/Q mismatch improving on therapeutic heparin.' },
      { name: 'Delirium', probability: 26, rationale: 'Hypoxemia resolved; low ongoing risk.' },
      { name: 'Mortality', probability: 24, rationale: 'RV strain on echo — PESI class IV, reassess post-heparin.' },
    ],
  },
]

export const rosterFor = (patientId: string): UnitPatientRecord | undefined =>
  ROSTER.find(r => r.patientId === patientId)
