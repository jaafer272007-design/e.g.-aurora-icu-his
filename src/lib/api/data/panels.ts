import type {
  Goal, Hemodynamics, Infusion, Labs, PatientAlert, TimelineEvent, Ventilator,
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

const PH_SCALED = [7.41, 7.36, 7.31, 7.28, 7.30, 7.32, 7.33].map(x => x * 10 - 66)

export const LABS: Labs = {
  drawTimes: ['D-6', 'D-5', 'D-4', 'D-3', 'D-2', 'D-1', 'Now'],
  panels: [
    {
      name: 'CBC',
      series: [
        { label: 'WBC ×10⁹/L', color: '#4da3ff', points: [9.8, 12.4, 16.2, 18.9, 17.4, 15.8, 14.2] },
        { label: 'Hgb g/dL', color: '#ff5d6c', points: [11.2, 10.8, 10.1, 9.6, 9.2, 9.0, 8.8] },
        { label: 'Plt ×10⁹/L ÷10', color: '#3de8a0', points: [21, 18, 14, 11, 9.8, 9.2, 9.6] },
      ],
      results: [
        { analyte: 'WBC', value: '14.2', flag: 'abn' },
        { analyte: 'Hgb', value: '8.8', flag: 'abn' },
        { analyte: 'Plt', value: '96', flag: 'crit2' },
        { analyte: 'Neut%', value: '88', flag: 'abn' },
      ],
    },
    {
      name: 'ABG',
      series: [
        { label: 'pH ×10', color: '#4da3ff', points: PH_SCALED },
        { label: 'PaO₂/10 mmHg', color: '#35e0d0', points: [9.8, 8.8, 7.4, 6.9, 7.6, 8.1, 8.2] },
        { label: 'PaCO₂/10', color: '#ffb454', points: [4.0, 4.4, 4.9, 5.2, 5.0, 4.7, 4.6] },
      ],
      results: [
        { analyte: 'pH', value: '7.33', flag: 'abn' },
        { analyte: 'PaO₂', value: '82', flag: 'abn' },
        { analyte: 'PaCO₂', value: '46', flag: '' },
        { analyte: 'HCO₃', value: '19', flag: 'abn' },
        { analyte: 'P/F', value: '148', flag: 'crit2' },
      ],
    },
    {
      name: 'Electrolytes',
      series: [
        { label: 'Na⁺/10 mmol/L', color: '#4da3ff', points: [13.8, 13.6, 13.4, 13.3, 13.4, 13.5, 13.6] },
        { label: 'K⁺ mmol/L', color: '#ffb454', points: [4.1, 4.4, 4.9, 5.3, 4.8, 4.4, 4.2] },
        { label: 'Mg²⁺ mg/dL', color: '#3de8a0', points: [1.9, 1.8, 1.7, 1.9, 2.0, 2.1, 2.0] },
      ],
      results: [
        { analyte: 'Na⁺', value: '136', flag: '' },
        { analyte: 'K⁺', value: '4.2', flag: '' },
        { analyte: 'Cl⁻', value: '104', flag: '' },
        { analyte: 'Mg²⁺', value: '2.0', flag: '' },
        { analyte: 'Ca²⁺', value: '8.4', flag: 'abn' },
      ],
    },
    {
      name: 'Renal',
      series: [
        { label: 'Creatinine mg/dL', color: '#ff5d6c', points: [0.9, 1.1, 1.4, 1.8, 2.1, 2.0, 1.9] },
        { label: 'BUN/10 mg/dL', color: '#ffb454', points: [1.8, 2.2, 3.0, 3.9, 4.6, 4.4, 4.2] },
      ],
      results: [
        { analyte: 'Creat', value: '1.9', flag: 'crit2' },
        { analyte: 'BUN', value: '42', flag: 'abn' },
        { analyte: 'eGFR', value: '36', flag: 'abn' },
        { analyte: 'UO 24 h', value: '680 mL', flag: 'abn' },
      ],
    },
    {
      name: 'Liver',
      series: [
        { label: 'AST /10 U/L', color: '#4da3ff', points: [3.1, 3.4, 4.2, 5.8, 6.4, 5.9, 5.2] },
        { label: 'ALT /10 U/L', color: '#35e0d0', points: [2.8, 3.0, 3.6, 4.9, 5.6, 5.4, 5.0] },
        { label: 'Bili mg/dL', color: '#ffb454', points: [0.8, 0.9, 1.2, 1.6, 1.9, 1.8, 1.7] },
      ],
      results: [
        { analyte: 'AST', value: '52', flag: 'abn' },
        { analyte: 'ALT', value: '50', flag: 'abn' },
        { analyte: 'T.Bili', value: '1.7', flag: 'abn' },
        { analyte: 'Albumin', value: '2.6', flag: 'abn' },
      ],
    },
    {
      name: 'Coagulation',
      series: [
        { label: 'INR', color: '#ff5d6c', points: [1.1, 1.2, 1.3, 1.5, 1.6, 1.5, 1.4] },
        { label: 'aPTT /10 s', color: '#4da3ff', points: [3.0, 3.2, 3.6, 4.1, 4.4, 4.2, 4.0] },
        { label: 'Fibrinogen /100', color: '#3de8a0', points: [3.8, 3.4, 2.9, 2.4, 2.2, 2.3, 2.5] },
      ],
      results: [
        { analyte: 'INR', value: '1.4', flag: 'abn' },
        { analyte: 'aPTT', value: '40', flag: 'abn' },
        { analyte: 'Fibrinogen', value: '250', flag: '' },
        { analyte: 'D-dimer', value: '4.8', flag: 'crit2' },
      ],
    },
    {
      name: 'Lactate',
      series: [
        { label: 'Lactate mmol/L', color: '#ff5d6c', points: [1.4, 1.9, 2.8, 4.6, 4.1, 3.9, 3.8] },
      ],
      results: [
        { analyte: 'Lactate', value: '3.8', flag: 'crit2' },
        { analyte: 'Cleared 6 h', value: '−8%', flag: 'abn' },
        { analyte: 'Base excess', value: '−6.2', flag: 'abn' },
      ],
    },
  ],
}

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

export const TIMELINE: TimelineEvent[] = [
  { time: '09:42', category: 'lab', categoryLabel: 'LAB', text: 'Lactate resulted 3.8 mmol/L — repeat ordered for 13:00 with ScvO₂.' },
  { time: '09:31', category: 'med', categoryLabel: 'MED', text: 'Noradrenaline titrated 0.24 → 0.32 µg/kg/min for MAP < 65.' },
  { time: '08:55', category: 'nte', categoryLabel: 'NURSING', text: 'Hourly urine output 25–30 mL; nephrology aware, foley patent.' },
  { time: '08:10', category: 'vnt', categoryLabel: 'VENT', text: 'PEEP increased 8 → 10 cmH₂O; FiO₂ weaned 60 → 55%.' },
  { time: '07:15', category: 'con', categoryLabel: 'CONSULT', text: 'Infectious Diseases: continue meropenem, day 4 of 7; de-escalate per cultures.' },
  { time: '06:30', category: 'med', categoryLabel: 'MED', text: 'Midazolam paused for spontaneous awakening trial at 10:00.' },
  { time: '05:40', category: 'prc', categoryLabel: 'PROCEDURE', text: 'Right IJ central line dressing changed; site clean, no erythema.' },
  { time: '04:20', category: 'txf', categoryLabel: 'TRANSFUSION', text: '1 unit PRBC completed for Hgb 7.9 → post-count 8.8 g/dL.' },
  { time: '02:10', category: 'lab', categoryLabel: 'LAB', text: 'ABG: pH 7.31 / PaCO₂ 49 / PaO₂ 74 on FiO₂ 60% — vent adjusted.' },
  { time: '00:45', category: 'nte', categoryLabel: 'PROGRESS', text: 'Night intensivist note: septic shock day 4, slow pressor wean attempted, reversed at 00:30.' },
  { time: '23:30', category: 'med', categoryLabel: 'MED', text: 'Dexmedetomidine started 0.2 µg/kg/h to facilitate sedation wean.' },
  { time: '22:15', category: 'prc', categoryLabel: 'PROCEDURE', text: 'Bedside ultrasound: IVC 1.8 cm, minimal collapse — volume replete.' },
]
