import type { FormularyDrug, InteractionRule, OrderSetDef } from '../types'

/* ICU medication formulary sample. allergyBlock tags hard-stop an order;
   allergyWarn tags (cross-reactivity) require an acknowledged override. */

export const FORMULARY: FormularyDrug[] = [
  {
    drugId: 'noradrenaline', name: 'Noradrenaline', drugClass: 'Vasopressor',
    doses: ['0.05 µg/kg/min', '0.1 µg/kg/min', '0.2 µg/kg/min', '0.32 µg/kg/min', '0.5 µg/kg/min'],
    brandNames: ['Levophed'], form: 'solution for infusion',
    strengths: ['4 mg/4 mL'], defaultDose: '0.05 µg/kg/min',
    doseLimits: { perKg: '1 µg/kg/min max' },
    routes: ['IV infusion (central)'], frequencies: ['continuous'], prnCapable: false, active: true,
    allergyBlock: [], allergyWarn: [],
  },
  {
    drugId: 'vasopressin', name: 'Vasopressin', drugClass: 'Vasopressor',
    doses: ['0.01 U/min', '0.02 U/min', '0.03 U/min'], routes: ['IV infusion (central)'],
    brandNames: ['Pitressin'], form: 'solution for infusion',
    strengths: ['20 U/mL'], defaultDose: '0.02 U/min',
    doseLimits: { max: '0.04 U/min' },
    frequencies: ['continuous'], prnCapable: false, active: true, allergyBlock: [], allergyWarn: [],
  },
  {
    drugId: 'piperacillin-tazobactam', name: 'Piperacillin-Tazobactam', drugClass: 'Antibiotic · penicillin',
    doses: ['4.5 g', '2.25 g'], routes: ['IV over 30 min'], frequencies: ['q6h', 'q8h'],
    brandNames: ['Tazocin', 'Zosyn'], form: 'powder for injection',
    strengths: ['4.5 g vial', '2.25 g vial'], defaultDose: '4.5 g',
    doseLimits: { max: '4.5 g', maxDaily: '18 g/day' },
    prnCapable: false, active: true, allergyBlock: ['penicillin'], allergyWarn: [],
  },
  {
    drugId: 'amoxicillin-clavulanate', name: 'Amoxicillin-Clavulanate', drugClass: 'Antibiotic · penicillin',
    doses: ['1.2 g', '600 mg'], routes: ['IV', 'PO'], frequencies: ['q8h', 'q12h'],
    brandNames: ['Augmentin'], form: 'powder for injection · tablet',
    strengths: ['1.2 g vial', '625 mg tablet'], defaultDose: '1.2 g',
    doseLimits: { max: '1.2 g', maxDaily: '4.8 g/day' },
    prnCapable: false, active: true, allergyBlock: ['penicillin'], allergyWarn: [],
  },
  {
    drugId: 'meropenem', name: 'Meropenem', drugClass: 'Antibiotic · carbapenem',
    doses: ['500 mg', '1 g', '2 g'], routes: ['IV over 30 min', 'IV extended infusion'],
    brandNames: ['Meronem', 'Merrem'], form: 'powder for injection',
    strengths: ['500 mg vial', '1 g vial'], defaultDose: '1 g',
    doseLimits: { max: '2 g', maxDaily: '6 g/day' },
    frequencies: ['q8h', 'q12h'], prnCapable: false, active: true,
    allergyBlock: [], allergyWarn: ['penicillin'],
  },
  {
    drugId: 'ceftriaxone', name: 'Ceftriaxone', drugClass: 'Antibiotic · cephalosporin',
    brandNames: ['Rocephin'], form: 'powder for injection',
    strengths: ['1 g vial', '2 g vial'], defaultDose: '1 g',
    doseLimits: { max: '2 g', maxDaily: '4 g/day' },
    doses: ['1 g', '2 g'], routes: ['IV'], frequencies: ['daily', 'q12h'], prnCapable: false, active: true,
    allergyBlock: [], allergyWarn: ['penicillin'],
  },
  {
    drugId: 'vancomycin', name: 'Vancomycin', drugClass: 'Antibiotic · glycopeptide',
    doses: ['1 g', '1.5 g', '25 mg/kg load'], routes: ['IV over 60 min'],
    brandNames: ['Vancocin'], form: 'powder for injection',
    strengths: ['500 mg vial', '1 g vial'], defaultDose: '1 g',
    doseLimits: { max: '2 g', perKg: '25 mg/kg loading' },
    frequencies: ['q12h', 'q24h', 'per level'], prnCapable: false, active: true,
    allergyBlock: ['vancomycin'], allergyWarn: [],
  },
  {
    drugId: 'sulfamethoxazole-trimethoprim', name: 'Co-trimoxazole (SMX-TMP)', drugClass: 'Antibiotic · sulfonamide',
    doses: ['960 mg', '480 mg'], routes: ['IV', 'PO'], frequencies: ['q12h', 'daily'],
    brandNames: ['Bactrim', 'Septrin'], form: 'ampoule · tablet',
    strengths: ['480 mg/5 mL ampoule', '480 mg tablet'], defaultDose: '960 mg',
    doseLimits: { max: '960 mg', maxDaily: '2.88 g/day' },
    prnCapable: false, active: true, allergyBlock: ['sulfa'], allergyWarn: [],
  },
  {
    drugId: 'insulin-actrapid', name: 'Insulin (Actrapid)', drugClass: 'Insulin',
    doses: ['0.5 U/h', '1 U/h', '2.5 U/h', 'sliding scale'], routes: ['IV infusion', 'SC'],
    brandNames: ['Actrapid'], form: 'solution for injection',
    strengths: ['100 U/mL vial'], defaultDose: 'sliding scale',
    frequencies: ['continuous', 'q6h', 'sliding scale'], prnCapable: false, active: true,
    allergyBlock: [], allergyWarn: [],
  },
  {
    drugId: 'enoxaparin', name: 'Enoxaparin', drugClass: 'Anticoagulant · LMWH',
    doses: ['20 mg', '40 mg', '1 mg/kg'], routes: ['SC'], frequencies: ['daily', 'q12h'],
    brandNames: ['Clexane', 'Lovenox'], form: 'pre-filled syringe',
    strengths: ['20 mg/0.2 mL', '40 mg/0.4 mL', '80 mg/0.8 mL'], defaultDose: '40 mg',
    doseLimits: { perKg: '1 mg/kg/dose' },
    prnCapable: false, active: true, allergyBlock: ['heparin'], allergyWarn: [],
  },
  {
    drugId: 'heparin', name: 'Heparin (unfractionated)', drugClass: 'Anticoagulant',
    doses: ['5000 U', '18 U/kg/h'], routes: ['SC', 'IV infusion'], frequencies: ['q8h', 'continuous'],
    brandNames: [], form: 'solution for injection',
    strengths: ['5,000 U/mL vial', '25,000 U/5 mL vial'], defaultDose: '5000 U',
    doseLimits: { perKg: '18 U/kg/h infusion' },
    prnCapable: false, active: true, allergyBlock: ['heparin'], allergyWarn: [],
  },
  {
    drugId: 'paracetamol', name: 'Paracetamol', drugClass: 'Analgesic · antipyretic',
    doses: ['500 mg', '1 g'], routes: ['IV', 'PO', 'PR'], frequencies: ['q6h', 'q8h'],
    brandNames: ['Perfalgan', 'Panadol'], form: 'solution for infusion · tablet',
    strengths: ['1 g/100 mL vial', '500 mg tablet'], defaultDose: '1 g',
    doseLimits: { max: '1 g', maxDaily: '4 g/day' },
    prnCapable: true, active: true, allergyBlock: ['paracetamol'], allergyWarn: [],
  },
  {
    drugId: 'ketorolac', name: 'Ketorolac', drugClass: 'Analgesic · NSAID',
    doses: ['15 mg', '30 mg'], routes: ['IV', 'IM'], frequencies: ['q6h', 'q8h'],
    brandNames: ['Toradol'], form: 'ampoule',
    strengths: ['30 mg/mL ampoule'], defaultDose: '30 mg',
    doseLimits: { max: '30 mg', maxDaily: '120 mg/day' },
    prnCapable: true, active: true, allergyBlock: ['nsaid', 'aspirin'], allergyWarn: [],
  },
  {
    drugId: 'morphine', name: 'Morphine', drugClass: 'Analgesic · opioid',
    doses: ['2 mg', '5 mg', '1–2 mg/h'], routes: ['IV', 'IV infusion', 'SC'],
    brandNames: [], form: 'ampoule',
    strengths: ['10 mg/mL ampoule'], defaultDose: '2 mg',
    doseLimits: { min: '1 mg', max: '10 mg' },
    frequencies: ['q4h', 'continuous'], prnCapable: true, active: true,
    allergyBlock: ['morphine'], allergyWarn: ['codeine'],
  },
  {
    drugId: 'fentanyl', name: 'Fentanyl', drugClass: 'Analgesic · opioid',
    doses: ['25 µg/h', '50 µg/h', '100 µg/h'], routes: ['IV infusion'], frequencies: ['continuous'],
    brandNames: ['Sublimaze'], form: 'ampoule',
    strengths: ['100 µg/2 mL ampoule', '500 µg/10 mL ampoule'], defaultDose: '25 µg/h',
    doseLimits: { max: '200 µg/h infusion' },
    prnCapable: false, active: true, allergyBlock: ['fentanyl'], allergyWarn: [],
  },
  {
    drugId: 'metoprolol', name: 'Metoprolol', drugClass: 'Beta-blocker',
    doses: ['12.5 mg', '25 mg', '50 mg'], routes: ['PO', 'IV'], frequencies: ['bid', 'daily'],
    brandNames: ['Betaloc', 'Lopressor'], form: 'tablet · ampoule',
    strengths: ['25 mg tablet', '50 mg tablet', '5 mg/5 mL ampoule'], defaultDose: '25 mg',
    doseLimits: { min: '12.5 mg', maxDaily: '200 mg/day' },
    prnCapable: false, active: true, allergyBlock: [], allergyWarn: [],
  },
  {
    drugId: 'diltiazem', name: 'Diltiazem', drugClass: 'Calcium-channel blocker',
    doses: ['30 mg', '60 mg', '5–15 mg/h'], routes: ['PO', 'IV infusion'], frequencies: ['q6h', 'continuous'],
    brandNames: ['Cardizem', 'Dilzem'], form: 'tablet · powder for injection',
    strengths: ['30 mg tablet', '60 mg tablet', '25 mg vial'], defaultDose: '30 mg',
    doseLimits: { maxDaily: '360 mg/day' },
    prnCapable: false, active: true, allergyBlock: [], allergyWarn: [],
  },
  {
    drugId: 'pantoprazole', name: 'Pantoprazole', drugClass: 'PPI · stress-ulcer prophylaxis',
    doses: ['40 mg', '80 mg'], routes: ['IV', 'PO'], frequencies: ['daily', 'bid'],
    brandNames: ['Protonix', 'Controloc'], form: 'powder for injection · tablet',
    strengths: ['40 mg vial', '40 mg tablet'], defaultDose: '40 mg',
    doseLimits: { max: '80 mg', maxDaily: '160 mg/day' },
    prnCapable: false, active: true, allergyBlock: [], allergyWarn: [],
  },
  {
    drugId: 'furosemide', name: 'Furosemide', drugClass: 'Loop diuretic',
    doses: ['20 mg', '40 mg', '5–10 mg/h'], routes: ['IV', 'IV infusion', 'PO'],
    brandNames: ['Lasix'], form: 'ampoule · tablet',
    strengths: ['20 mg/2 mL ampoule', '40 mg tablet', '250 mg/25 mL ampoule'], defaultDose: '40 mg',
    doseLimits: { max: '250 mg infusion', maxDaily: '600 mg/day' },
    frequencies: ['daily', 'bid', 'continuous'], prnCapable: true, active: true,
    allergyBlock: [], allergyWarn: ['sulfa'],
  },
]

/* The NAMED medication-frequency vocabulary (Layer 4 master data — moved
   here from the server's OrderLogic, where "per CRRT protocol" was
   ICU-specific content hardcoded in Core). The server validates order
   frequencies against THIS vocabulary ∪ q<1-48>h — behavior byte-identical
   to the pre-Layer-4 hardcoded list. Seed source for
   server/Data/frequencies-seed.json (generated — never hand-edit). */
export const NAMED_FREQUENCIES: string[] = [
  'continuous', 'daily', 'bid', 'tid', 'qid', 'once',
  'sliding scale', 'per level', 'per CRRT protocol',
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
