import type { FormularyDrug, InteractionRule, OrderSetDef } from '../types'

/* ICU medication formulary sample. allergyBlock tags hard-stop an order;
   allergyWarn tags (cross-reactivity) require an acknowledged override. */

export const FORMULARY: FormularyDrug[] = [
  {
    drugId: 'noradrenaline', name: 'Noradrenaline', drugClass: 'Vasopressor',
    doses: ['0.05 µg/kg/min', '0.1 µg/kg/min', '0.2 µg/kg/min', '0.32 µg/kg/min', '0.5 µg/kg/min'],
    routes: ['IV infusion (central)'], frequencies: ['continuous'], prnCapable: false,
    allergyBlock: [], allergyWarn: [],
  },
  {
    drugId: 'vasopressin', name: 'Vasopressin', drugClass: 'Vasopressor',
    doses: ['0.01 U/min', '0.02 U/min', '0.03 U/min'], routes: ['IV infusion (central)'],
    frequencies: ['continuous'], prnCapable: false, allergyBlock: [], allergyWarn: [],
  },
  {
    drugId: 'piperacillin-tazobactam', name: 'Piperacillin-Tazobactam', drugClass: 'Antibiotic · penicillin',
    doses: ['4.5 g', '2.25 g'], routes: ['IV over 30 min'], frequencies: ['q6h', 'q8h'],
    prnCapable: false, allergyBlock: ['penicillin'], allergyWarn: [],
  },
  {
    drugId: 'amoxicillin-clavulanate', name: 'Amoxicillin-Clavulanate', drugClass: 'Antibiotic · penicillin',
    doses: ['1.2 g', '600 mg'], routes: ['IV', 'PO'], frequencies: ['q8h', 'q12h'],
    prnCapable: false, allergyBlock: ['penicillin'], allergyWarn: [],
  },
  {
    drugId: 'meropenem', name: 'Meropenem', drugClass: 'Antibiotic · carbapenem',
    doses: ['500 mg', '1 g', '2 g'], routes: ['IV over 30 min', 'IV extended infusion'],
    frequencies: ['q8h', 'q12h'], prnCapable: false,
    allergyBlock: [], allergyWarn: ['penicillin'],
  },
  {
    drugId: 'ceftriaxone', name: 'Ceftriaxone', drugClass: 'Antibiotic · cephalosporin',
    doses: ['1 g', '2 g'], routes: ['IV'], frequencies: ['daily', 'q12h'], prnCapable: false,
    allergyBlock: [], allergyWarn: ['penicillin'],
  },
  {
    drugId: 'vancomycin', name: 'Vancomycin', drugClass: 'Antibiotic · glycopeptide',
    doses: ['1 g', '1.5 g', '25 mg/kg load'], routes: ['IV over 60 min'],
    frequencies: ['q12h', 'q24h', 'per level'], prnCapable: false,
    allergyBlock: ['vancomycin'], allergyWarn: [],
  },
  {
    drugId: 'sulfamethoxazole-trimethoprim', name: 'Co-trimoxazole (SMX-TMP)', drugClass: 'Antibiotic · sulfonamide',
    doses: ['960 mg', '480 mg'], routes: ['IV', 'PO'], frequencies: ['q12h', 'daily'],
    prnCapable: false, allergyBlock: ['sulfa'], allergyWarn: [],
  },
  {
    drugId: 'insulin-actrapid', name: 'Insulin (Actrapid)', drugClass: 'Insulin',
    doses: ['0.5 U/h', '1 U/h', '2.5 U/h', 'sliding scale'], routes: ['IV infusion', 'SC'],
    frequencies: ['continuous', 'q6h', 'sliding scale'], prnCapable: false,
    allergyBlock: [], allergyWarn: [],
  },
  {
    drugId: 'enoxaparin', name: 'Enoxaparin', drugClass: 'Anticoagulant · LMWH',
    doses: ['20 mg', '40 mg', '1 mg/kg'], routes: ['SC'], frequencies: ['daily', 'q12h'],
    prnCapable: false, allergyBlock: ['heparin'], allergyWarn: [],
  },
  {
    drugId: 'heparin', name: 'Heparin (unfractionated)', drugClass: 'Anticoagulant',
    doses: ['5000 U', '18 U/kg/h'], routes: ['SC', 'IV infusion'], frequencies: ['q8h', 'continuous'],
    prnCapable: false, allergyBlock: ['heparin'], allergyWarn: [],
  },
  {
    drugId: 'paracetamol', name: 'Paracetamol', drugClass: 'Analgesic · antipyretic',
    doses: ['500 mg', '1 g'], routes: ['IV', 'PO', 'PR'], frequencies: ['q6h', 'q8h'],
    prnCapable: true, allergyBlock: ['paracetamol'], allergyWarn: [],
  },
  {
    drugId: 'ketorolac', name: 'Ketorolac', drugClass: 'Analgesic · NSAID',
    doses: ['15 mg', '30 mg'], routes: ['IV', 'IM'], frequencies: ['q6h', 'q8h'],
    prnCapable: true, allergyBlock: ['nsaid', 'aspirin'], allergyWarn: [],
  },
  {
    drugId: 'morphine', name: 'Morphine', drugClass: 'Analgesic · opioid',
    doses: ['2 mg', '5 mg', '1–2 mg/h'], routes: ['IV', 'IV infusion', 'SC'],
    frequencies: ['q4h', 'continuous'], prnCapable: true,
    allergyBlock: ['morphine'], allergyWarn: ['codeine'],
  },
  {
    drugId: 'fentanyl', name: 'Fentanyl', drugClass: 'Analgesic · opioid',
    doses: ['25 µg/h', '50 µg/h', '100 µg/h'], routes: ['IV infusion'], frequencies: ['continuous'],
    prnCapable: false, allergyBlock: ['fentanyl'], allergyWarn: [],
  },
  {
    drugId: 'metoprolol', name: 'Metoprolol', drugClass: 'Beta-blocker',
    doses: ['12.5 mg', '25 mg', '50 mg'], routes: ['PO', 'IV'], frequencies: ['bid', 'daily'],
    prnCapable: false, allergyBlock: [], allergyWarn: [],
  },
  {
    drugId: 'diltiazem', name: 'Diltiazem', drugClass: 'Calcium-channel blocker',
    doses: ['30 mg', '60 mg', '5–15 mg/h'], routes: ['PO', 'IV infusion'], frequencies: ['q6h', 'continuous'],
    prnCapable: false, allergyBlock: [], allergyWarn: [],
  },
  {
    drugId: 'pantoprazole', name: 'Pantoprazole', drugClass: 'PPI · stress-ulcer prophylaxis',
    doses: ['40 mg', '80 mg'], routes: ['IV', 'PO'], frequencies: ['daily', 'bid'],
    prnCapable: false, allergyBlock: [], allergyWarn: [],
  },
  {
    drugId: 'furosemide', name: 'Furosemide', drugClass: 'Loop diuretic',
    doses: ['20 mg', '40 mg', '5–10 mg/h'], routes: ['IV', 'IV infusion', 'PO'],
    frequencies: ['daily', 'bid', 'continuous'], prnCapable: true,
    allergyBlock: [], allergyWarn: ['sulfa'],
  },
]

/* Pairwise interaction rules checked against the patient's ACTIVE medication
   orders. Symmetric — checked in both directions. */
export const INTERACTION_RULES: InteractionRule[] = [
  { a: 'enoxaparin', b: 'heparin', severity: 'block', note: 'Duplicate therapeutic anticoagulation — bleeding risk.' },
  { a: 'enoxaparin', b: 'ketorolac', severity: 'warn', note: 'NSAID + LMWH increases bleeding risk — review indication.' },
  { a: 'heparin', b: 'ketorolac', severity: 'warn', note: 'NSAID + heparin increases bleeding risk — review indication.' },
  { a: 'metoprolol', b: 'diltiazem', severity: 'warn', note: 'Additive AV-nodal blockade — bradycardia/hypotension risk.' },
  { a: 'morphine', b: 'fentanyl', severity: 'warn', note: 'Duplicate opioid therapy — sedation and respiratory depression risk.' },
  { a: 'furosemide', b: 'vancomycin', severity: 'warn', note: 'Additive nephro-/ototoxicity — monitor levels and renal function.' },
]

export const ORDER_SET_DEFS: OrderSetDef[] = [
  {
    setId: 'sepsis-bundle', name: 'Sepsis Bundle',
    description: 'Hour-1 bundle: cultures, lactate, broad-spectrum cover, fluids.',
    items: [
      { category: 'Lab', summary: 'Blood cultures ×2 (peripheral + line) before antibiotics', priority: 'STAT', requiresImplementation: true },
      { category: 'Lab', summary: 'Lactate now, repeat q4h until < 2 mmol/L', priority: 'STAT', requiresImplementation: true },
      {
        category: 'Medication', priority: 'STAT',
        medication: { drugId: 'piperacillin-tazobactam', drug: 'Piperacillin-Tazobactam', dose: '4.5 g', route: 'IV over 30 min', frequency: 'q8h', duration: '7 days', prn: false },
      },
      { category: 'Nursing', summary: 'Balanced crystalloid 30 mL/kg over 3 h — reassess after each 500 mL', priority: 'Urgent', requiresImplementation: true },
    ],
  },
  {
    setId: 'dvt-prophylaxis', name: 'DVT Prophylaxis',
    description: 'Pharmacologic + mechanical prophylaxis.',
    items: [
      {
        category: 'Medication', priority: 'Routine',
        medication: { drugId: 'enoxaparin', drug: 'Enoxaparin', dose: '40 mg', route: 'SC', frequency: 'daily', duration: 'ongoing', prn: false },
      },
      { category: 'Nursing', summary: 'Apply intermittent pneumatic compression, both legs', priority: 'Routine', requiresImplementation: true },
    ],
  },
  {
    setId: 'insulin-sliding-scale', name: 'Insulin Sliding Scale',
    description: 'SC correction scale with q6h glucose checks.',
    items: [
      {
        category: 'Medication', priority: 'Routine',
        medication: { drugId: 'insulin-actrapid', drug: 'Insulin (Actrapid)', dose: 'sliding scale', route: 'SC', frequency: 'q6h', duration: 'ongoing', prn: false },
      },
      { category: 'Nursing', summary: 'Capillary glucose q6h — notify if < 4 or > 12 mmol/L', priority: 'Routine', requiresImplementation: true },
    ],
  },
  {
    setId: 'daily-am-labs', name: 'Daily AM Labs',
    description: 'Standard 06:00 draw panel.',
    items: [
      { category: 'Lab', summary: 'CBC, U&E, Mg/PO₄, LFTs with 06:00 draw', priority: 'Routine', requiresImplementation: true },
      { category: 'Lab', summary: 'ABG with 06:00 draw if ventilated', priority: 'Routine', requiresImplementation: true },
    ],
  },
]
