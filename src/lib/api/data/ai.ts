import type {
  AiRisk, PatientAlert, PatientRiskProfile, RankedRisk, RiskCategory, RiskPrediction,
  RiskRankingRow, RiskTrend,
} from '../types'
import { ROSTER } from './roster'

/* Canonical AI risk store — THE single source of AI risk predictions.
   Mission Control's AI panel derives its one-line view from here, and
   threshold crossings surface through the existing alert center
   (getPatientDetail alerts) — never a separate alert system.

   EVERYTHING here is SIMULATED ("Simulated · updated q15min" framing):
   probabilities, histories, factors and suggestions are mock data until the
   real model service arrives with device integration (Stage 11). The
   assistant is advisory only — nothing in this domain places orders or
   takes autonomous action. */

/** last simulated model tick */
export const AI_UPDATED_AT = '09:45'

/** a risk at/above this probability raises an alert in the alert center */
export const AI_ALERT_THRESHOLD = 65
const AI_ALERT_CRIT = 80

/* ---------------- compact seed spec, expanded into profiles ---------------- */

type Drift = 'up' | 'down' | 'flat'

interface RiskSpec {
  c: RiskCategory
  /** current probability (== last history sample) */
  p: number
  d: Drift
  r: string
  /** [label, weight, mitigating?] */
  f: [string, number, boolean?][]
  s?: string[]
}

/* deterministic q15min histories (~2 h window, 8 ticks ending at p) —
   mock stand-ins for stored model output; trend is COMPUTED from these
   at read time, never stored */
const DRIFT_OFFSETS: Record<Drift, number[]> = {
  up: [-11, -10, -8, -7, -5, -4, -2, 0],
  down: [11, 10, 8, 7, 5, 4, 2, 0],
  flat: [-1, 1, 0, -1, 1, 0, -1, 0],
}

const clamp = (v: number) => Math.max(1, Math.min(99, v))
const historyFor = (p: number, d: Drift): number[] => DRIFT_OFFSETS[d].map(o => clamp(p + o))

/** trend from the q15min history — computed at read time (locked pattern) */
export function riskTrendOf(history: number[]): RiskTrend {
  const delta = history[history.length - 1] - history[0]
  return delta >= 4 ? 'rising' : delta <= -4 ? 'falling' : 'stable'
}

/** elevated = high now, or moderate and climbing — gates suggestions & ranking chips */
export const isElevated = (r: RiskPrediction): boolean =>
  r.probability >= 60 || (r.probability >= 45 && riskTrendOf(r.history) === 'rising')

const SPECS: { patientId: string; risks: RiskSpec[] }[] = [
  {
    patientId: 'P-1001', /* Ahmed Al-Saadi — septic shock */
    risks: [
      {
        c: 'Sepsis', p: 86, d: 'up',
        r: 'SOFA ↑2 in 24 h, lactate 3.8 rising, persistent vasopressor need.',
        f: [
          ['Lactate 3.8 mmol/L — clearance <10% over 6 h', 34],
          ['Noradrenaline requirement rising (0.24 → 0.32 µg/kg/min)', 28],
          ['SOFA increased 2 points in 24 h', 22],
          ['WBC 14.2 with 88% neutrophilia', 16],
        ],
        s: [
          'Chase the 13:00 repeat lactate + ScvO₂ (already ordered) and reassess resuscitation',
          'Review meropenem de-escalation against culture sensitivities — ID advice pending acknowledgment',
          'Reassess MAP target and the pending noradrenaline-ceiling order at the bedside',
        ],
      },
      {
        c: 'AKI', p: 62, d: 'up',
        r: 'Urine output 0.4 mL/kg/h ×5 h; creatinine ↑ 38% from baseline.',
        f: [
          ['Urine output 0.4 mL/kg/h × 5 h', 40],
          ['Creatinine 1.9 mg/dL — ↑ 38% from baseline', 35],
          ['Repeated MAP < 65 mmHg episodes', 25],
        ],
        s: [
          'Trend hourly urine output against the 0.5 mL/kg/h threshold',
          'Screen nephrotoxic exposures; dose-adjust renally cleared drugs',
          'Early nephrology referral if oliguria persists beyond 2 h',
        ],
      },
      {
        c: 'ARDS', p: 71, d: 'flat',
        r: 'P/F ratio 148 on FiO₂ 0.55; bilateral infiltrates on imaging.',
        f: [
          ['P/F ratio 148 on FiO₂ 0.55', 38],
          ['Bilateral infiltrates on chest X-ray', 32],
          ['Driving pressure 14 cmH₂O', 30],
        ],
        s: [
          'Maintain lung-protective ventilation (TV 6 mL/kg, plateau < 30 cmH₂O)',
          'Consider PEEP/TV adjustment for driving pressure 14 cmH₂O',
        ],
      },
      {
        c: 'Delirium', p: 44, d: 'flat',
        r: 'Age + sedation depth (RASS −3) + sepsis raise risk; CAM-ICU due.',
        f: [['Sedation depth RASS −3', 40], ['Septic encephalopathy risk', 35], ['CAM-ICU assessment due', 25]],
      },
      {
        c: 'Mortality', p: 28, d: 'flat',
        r: 'APACHE II 24 → predicted in-ICU mortality; trending stable.',
        f: [['APACHE II 24 at admission', 55], ['Lactate not yet clearing', 45]],
      },
    ],
  },
  {
    patientId: 'P-1002', /* Maria Hansen — ARDS on ECMO */
    risks: [
      {
        c: 'ARDS', p: 92, d: 'flat',
        r: 'Established severe ARDS on ECMO day 5; compliance 18 mL/cmH₂O.',
        f: [
          ['Established severe ARDS — VV-ECMO day 5', 45],
          ['Static compliance 18 mL/cmH₂O', 35],
          ['Oxygenation dependent on sweep gas', 20],
        ],
        s: [
          'Continue ECMO lung-rest settings; circuit inspection due 10:00 (flow variability flagged)',
          'Assess weaning readiness with a sweep-gas reduction trial per protocol',
        ],
      },
      {
        c: 'Delirium', p: 58, d: 'up',
        r: 'Prolonged sedation and ECMO immobility elevate risk.',
        f: [['Sedation exposure 9 days', 40], ['ECMO-enforced immobility', 35], ['Sleep fragmentation', 25]],
        s: [
          'Lighten sedation toward RASS 0/−1 as ECMO flows allow; daily SAT',
          'Non-pharmacologic bundle: reorientation, day–night lighting, mobility within circuit limits',
        ],
      },
      {
        c: 'Sepsis', p: 31, d: 'down',
        r: 'No new fever; procalcitonin falling on day 6 of therapy.',
        f: [['Procalcitonin falling on therapy day 6', 60, true], ['Afebrile 48 h', 40, true]],
      },
      {
        c: 'AKI', p: 24, d: 'flat',
        r: 'Stable creatinine; adequate urine output on low-dose support.',
        f: [['Stable creatinine', 55, true], ['Adequate urine output on low-dose support', 45, true]],
      },
      {
        c: 'Mortality', p: 35, d: 'down',
        r: 'RESP score 2 → favorable ECMO survival category.',
        f: [['RESP score 2 — favorable ECMO category', 60, true], ['Single-organ failure only', 40, true]],
      },
    ],
  },
  {
    patientId: 'P-1003', /* Omar Khalil — TBI */
    risks: [
      {
        c: 'Delirium', p: 66, d: 'up',
        r: 'TBI itself is a major risk factor once sedation is weaned.',
        f: [
          ['Severe TBI — primary neurological injury', 45],
          ['Sedation wean in progress', 30],
          ['ICP 18–22 mmHg episodes', 25],
        ],
        s: [
          'CAM-ICU q shift as sedation weans; avoid benzodiazepines',
          'Cluster care to protect sleep within ICP precautions',
        ],
      },
      { c: 'Sepsis', p: 12, d: 'flat', r: 'No infectious signs; surveillance cultures negative.', f: [['Surveillance cultures negative', 60, true], ['Afebrile since admission', 40, true]] },
      { c: 'AKI', p: 18, d: 'flat', r: 'Hypertonic saline in use — monitoring sodium and creatinine.', f: [['Hypertonic saline load — Na⁺/creatinine watched', 60], ['Normal baseline renal function', 40, true]] },
      { c: 'ARDS', p: 22, d: 'flat', r: 'Lung-protective settings; oxygenation preserved.', f: [['Lung-protective settings maintained', 55, true], ['SpO₂ 99% — oxygenation preserved', 45, true]] },
      { c: 'Mortality', p: 21, d: 'flat', r: 'GCS motor 4, reactive pupils → intermediate IMPACT score.', f: [['GCS motor 4, reactive pupils', 55], ['Age 45', 45, true]] },
    ],
  },
  {
    patientId: 'P-1004', /* Susan Wright — AKI on CRRT */
    risks: [
      {
        c: 'AKI', p: 95, d: 'flat',
        r: 'Established stage 3 AKI on CRRT hour 41.',
        f: [
          ['Established stage 3 AKI — CRRT hour 41', 50],
          ['Native urine output 5 mL/h', 30],
          ['Underlying CKD', 20],
        ],
        s: [
          'CRRT prescription renewal due today — order pending signature',
          'Daily weight and strict I/O to steer net fluid removal',
          'Recheck potassium and phosphate on the 12:00 draw after repletion',
        ],
      },
      { c: 'Delirium', p: 52, d: 'flat', r: 'Age >70 and uremia both contribute; reorient q shift.', f: [['Age 72', 35], ['Uremia', 35], ['AFib on rate control', 30]] },
      { c: 'Mortality', p: 33, d: 'flat', r: 'AKI-on-CKD with cardiac history; goals discussed.', f: [['AKI-on-CKD with cardiac history', 60], ['Goals of care documented (DNR)', 40]] },
      { c: 'Sepsis', p: 26, d: 'flat', r: 'Line day 6 — site clean; low-grade risk from access.', f: [['Vascular access day 6', 60], ['Site clean, afebrile', 40, true]] },
      { c: 'ARDS', p: 15, d: 'flat', r: 'No respiratory failure; volume status controlled by CRRT.', f: [['Volume controlled by CRRT', 60, true], ['No respiratory failure', 40, true]] },
    ],
  },
  {
    patientId: 'P-1005', /* David Chen — post-CABG */
    risks: [
      { c: 'Delirium', p: 47, d: 'flat', r: 'Cardiac surgery + age → moderate postoperative risk.', f: [['Cardiac surgery, age 61', 55], ['Bypass time 118 min', 45]] },
      { c: 'AKI', p: 38, d: 'down', r: 'Bypass time 118 min; watching post-pump creatinine.', f: [['Post-bypass creatinine surveillance', 55], ['Urine output recovering (60 mL/h)', 45, true]] },
      { c: 'ARDS', p: 14, d: 'down', r: 'Extubated at hour 9; incentive spirometry started.', f: [['Extubated hour 9', 60, true], ['Incentive spirometry started', 40, true]] },
      { c: 'Sepsis', p: 9, d: 'flat', r: 'POD 1 — no infectious concern; prophylaxis on schedule.', f: [['Prophylaxis on schedule', 60, true], ['No fever', 40, true]] },
      { c: 'Mortality', p: 8, d: 'down', r: 'EuroSCORE II low; expected routine recovery.', f: [['EuroSCORE II low', 100, true]] },
    ],
  },
  {
    patientId: 'P-1006', /* Layla Hassan — DKA resolving */
    risks: [
      { c: 'AKI', p: 29, d: 'down', r: 'Prerenal pattern resolving with volume repletion.', f: [['Prerenal pattern, resolving', 55], ['Volume replete, UO 120 mL/h', 45, true]] },
      { c: 'Delirium', p: 12, d: 'flat', r: 'Young, awake, oriented — low risk.', f: [['Awake and oriented', 100, true]] },
      { c: 'Sepsis', p: 11, d: 'down', r: 'UTI trigger treated; afebrile 24 h.', f: [['UTI trigger on treatment', 55], ['Afebrile 24 h', 45, true]] },
      { c: 'ARDS', p: 5, d: 'flat', r: 'No pulmonary involvement.', f: [['No pulmonary involvement', 100, true]] },
      { c: 'Mortality', p: 3, d: 'down', r: 'Anion gap closed; transfer planning underway.', f: [['Anion gap closed', 100, true]] },
    ],
  },
  {
    patientId: 'P-1007', /* Robert Miller — influenza pneumonia */
    risks: [
      {
        c: 'Delirium', p: 78, d: 'up',
        r: 'Age 79, hypoxemia, ICU day 5 — CAM-ICU positive overnight.',
        f: [
          ['CAM-ICU positive overnight', 35],
          ['Age 79', 25],
          ['Hypoxemia — P/F 176', 22],
          ['ICU day 5, fragmented sleep', 18],
        ],
        s: [
          'Full delirium bundle: reorientation, sensory aids, family presence',
          'Audit sedative and anticholinergic burden; prefer dexmedetomidine if agitation',
          'Treat the driver — escalate hypoxemia management',
        ],
      },
      {
        c: 'ARDS', p: 63, d: 'up',
        r: 'P/F 176; droplet isolation, proning considered.',
        f: [
          ['P/F 176 and falling', 40],
          ['Diffuse bilateral opacities, progressed from prior', 35],
          ['Influenza A with suspected bacterial superinfection', 25],
        ],
        s: [
          'Proning order is pending signature — sign or reassess now',
          'Escalate PEEP/FiO₂ per protocol; conservative fluid strategy',
        ],
      },
      {
        c: 'Sepsis', p: 54, d: 'up',
        r: 'Secondary bacterial pneumonia suspected; cultures pending.',
        f: [['Secondary bacterial pneumonia suspected', 55], ['Cultures pending', 25], ['Recurring fever 38.1 °C', 20]],
        s: ['Chase pending cultures; reassess antimicrobial cover at rounds'],
      },
      { c: 'Mortality', p: 42, d: 'flat', r: 'CURB-65 4 with treatment limits in place.', f: [['CURB-65 score 4', 55], ['DNR/DNI limits documented', 45]] },
      { c: 'AKI', p: 41, d: 'flat', r: 'Creatinine drift + diuretic exposure — monitor closely.', f: [['Creatinine drifting up', 55], ['Diuretic exposure', 45]] },
    ],
  },
  {
    patientId: 'P-1008', /* Nadia Karim — GI bleed */
    risks: [
      { c: 'Delirium', p: 35, d: 'flat', r: 'Hepatic encephalopathy history — lactulose resumed.', f: [['Hepatic encephalopathy history', 60], ['Lactulose resumed', 40, true]] },
      { c: 'AKI', p: 27, d: 'down', r: 'Watching post-hemorrhage perfusion; urine output adequate.', f: [['Post-hemorrhage perfusion watch', 55], ['Urine output adequate', 45, true]] },
      { c: 'Mortality', p: 16, d: 'down', r: 'Rockall 5 → rebleed surveillance for 72 h.', f: [['Rockall 5 — 72 h surveillance', 60], ['Hemodynamically stable post-EGD', 40, true]] },
      { c: 'Sepsis', p: 13, d: 'flat', r: 'No fever; prophylactic ceftriaxone for cirrhosis.', f: [['Prophylactic ceftriaxone running', 60, true], ['Afebrile', 40, true]] },
      { c: 'ARDS', p: 7, d: 'flat', r: 'No transfusion-related lung injury observed.', f: [['No TRALI after transfusion', 100, true]] },
    ],
  },
  {
    patientId: 'P-1009', /* George Antoun — cardiogenic shock */
    risks: [
      {
        c: 'AKI', p: 58, d: 'up',
        r: 'Urine output 25 mL/h with rising creatinine on low CI.',
        f: [['Urine output 25 mL/h on low cardiac index', 45], ['Creatinine rising', 35], ['CVP 15 — venous congestion', 20]],
        s: [
          'Optimize MAP and cardiac index before diuretic escalation',
          'Hourly urine output tracking against the 0.5 mL/kg/h threshold',
        ],
      },
      {
        c: 'Mortality', p: 46, d: 'up',
        r: 'CI 1.9 despite inotropes → high-risk cardiogenic shock category.',
        f: [['CI 1.9 L/min/m² despite inotropes + IABP', 55], ['Escalating vasoactive requirement', 25], ['Age 66', 20]],
        s: [
          'Shock-team review for advanced mechanical-support candidacy',
          'Structured goals-of-care conversation with family today',
        ],
      },
      { c: 'Delirium', p: 49, d: 'flat', r: 'Low-output state and ICU environment raise risk; screen q shift.', f: [['Low cardiac output state', 55], ['ICU day 3 environment', 45]] },
      { c: 'ARDS', p: 26, d: 'flat', r: 'Mild pulmonary congestion; oxygenation adequate on HFNC.', f: [['Mild pulmonary congestion', 55], ['Adequate oxygenation on HFNC', 45, true]] },
      { c: 'Sepsis', p: 18, d: 'flat', r: 'No infectious source; device sites clean on IABP day 3.', f: [['IABP device sites clean', 60, true], ['No infectious source', 40, true]] },
    ],
  },
  {
    patientId: 'P-1010', /* Fatima Zahra — PPH recovering */
    risks: [
      { c: 'AKI', p: 15, d: 'down', r: 'Brief hypotension resolved; urine output 95 mL/h.', f: [['Hypotension resolved', 55, true], ['UO 95 mL/h', 45, true]] },
      { c: 'Sepsis', p: 10, d: 'flat', r: 'Afebrile post-op; prophylactic antibiotics complete.', f: [['Prophylaxis complete, afebrile', 100, true]] },
      { c: 'Delirium', p: 9, d: 'flat', r: 'Young, awake, oriented — low risk.', f: [['Awake and oriented', 100, true]] },
      { c: 'ARDS', p: 6, d: 'down', r: 'No transfusion-related lung injury after 4 units PRBC.', f: [['No TRALI after 4 units', 100, true]] },
      { c: 'Mortality', p: 4, d: 'down', r: 'Hemorrhage controlled; coags normalized — step-down planned.', f: [['Hemorrhage controlled, coags normal', 100, true]] },
    ],
  },
  {
    patientId: 'P-1011', /* Hans Becker — COPD on NIV */
    risks: [
      { c: 'Delirium', p: 55, d: 'flat', r: 'CO₂ retention and age — CAM-ICU screening q shift.', f: [['CO₂ retention (pCO₂ 61 mmHg)', 50], ['Age 71', 30], ['Nocturnal NIV mask intolerance', 20]] },
      { c: 'Mortality', p: 30, d: 'flat', r: 'pCO₂ 61 on NIV with DNR limits — reassess in 2 h.', f: [['Hypercapnia on NIV', 60], ['DNR limits documented', 40]] },
      { c: 'ARDS', p: 24, d: 'down', r: 'Hypercapnic failure, not hypoxemic — NIV tolerated.', f: [['Hypercapnic (not hypoxemic) failure', 55], ['NIV tolerated by day', 45, true]] },
      { c: 'Sepsis', p: 22, d: 'down', r: 'Purulent sputum treated day 3; CRP falling.', f: [['Sputum infection on treatment day 3', 55], ['CRP falling', 45, true]] },
      { c: 'AKI', p: 19, d: 'flat', r: 'Stable creatinine; adequate oral intake resumed.', f: [['Stable creatinine', 55, true], ['Oral intake resumed', 45, true]] },
    ],
  },
  {
    patientId: 'P-1012', /* Aisha Mahmoud — necrotizing pancreatitis */
    risks: [
      {
        c: 'Sepsis', p: 74, d: 'up',
        r: 'Infected necrosis suspected; fever 38.6 with rising pressor need.',
        f: [
          ['Enlarging rim-enhancing collection (9.2 × 6.4 cm)', 40],
          ['Fever 38.6 °C with rising pressor need', 35],
          ['WBC 18.4 and rising', 25],
        ],
        s: [
          'Source-control review with surgery — drainage of the collection under discussion (consult active)',
          'Culture at drainage; reassess empiric antimicrobial cover',
          'Acknowledge the critical CT abdomen preliminary report',
        ],
      },
      {
        c: 'AKI', p: 61, d: 'up',
        r: 'IAP 19 mmHg threatening renal perfusion; UO 30 mL/h.',
        f: [['IAP 19 mmHg threatening renal perfusion', 45], ['Urine output 30 mL/h', 35], ['High resuscitation volumes', 20]],
        s: [
          'Intra-abdominal pressure surveillance q4h',
          'Balance further resuscitation against intra-abdominal hypertension',
        ],
      },
      {
        c: 'ARDS', p: 48, d: 'up',
        r: 'Bilateral effusions day 7; P/F trending down.',
        f: [['Bilateral effusions day 7', 45], ['P/F trending down', 35], ['Pancreatitis-driven inflammation', 20]],
        s: ['Lung-protective settings; reassess after the fluid-strategy change'],
      },
      { c: 'Delirium', p: 41, d: 'flat', r: 'Day 7 of sedation; SAT attempted daily.', f: [['Sedation day 7', 55], ['Daily SAT attempted', 45, true]] },
      { c: 'Mortality', p: 38, d: 'flat', r: 'APACHE II 21 with abdominal compartment risk — surgical review.', f: [['APACHE II 21 + compartment risk', 60], ['Age 48', 40, true]] },
    ],
  },
  {
    patientId: 'P-1013', /* Peter Novak — status epilepticus resolved */
    risks: [
      { c: 'Delirium', p: 38, d: 'down', r: 'Post-ictal state clearing; EEG without epileptiform activity ×24 h.', f: [['Post-ictal state, clearing', 60], ['EEG clean ×24 h', 40, true]] },
      { c: 'AKI', p: 12, d: 'down', r: 'CK normalizing; no rhabdomyolysis sequelae.', f: [['CK normalizing', 100, true]] },
      { c: 'Sepsis', p: 8, d: 'flat', r: 'No infectious trigger identified; cultures negative.', f: [['Cultures negative', 100, true]] },
      { c: 'ARDS', p: 6, d: 'flat', r: 'Airway protected; no aspiration on imaging.', f: [['No aspiration on imaging', 100, true]] },
      { c: 'Mortality', p: 5, d: 'down', r: 'Seizure-free 24 h on levetiracetam; step-down review AM.', f: [['Seizure-free 24 h', 100, true]] },
    ],
  },
  {
    patientId: 'P-1014', /* Miriam Cohen — massive PE */
    risks: [
      { c: 'Delirium', p: 26, d: 'down', r: 'Hypoxemia resolved; low ongoing risk.', f: [['Hypoxemia resolved', 100, true]] },
      { c: 'Mortality', p: 24, d: 'down', r: 'RV strain on echo — PESI class IV, reassess post-heparin.', f: [['PESI class IV at admission', 55], ['RV strain improving on heparin', 45, true]] },
      { c: 'AKI', p: 21, d: 'flat', r: 'Contrast exposure from CTPA — creatinine surveillance.', f: [['CTPA contrast exposure', 60], ['Baseline renal function normal', 40, true]] },
      { c: 'ARDS', p: 19, d: 'down', r: 'V/Q mismatch improving on therapeutic heparin.', f: [['V/Q mismatch improving', 100, true]] },
      { c: 'Sepsis', p: 7, d: 'flat', r: 'No infectious signs; afebrile since admission.', f: [['Afebrile since admission', 100, true]] },
    ],
  },
]

/* ---------------- expansion ---------------- */

const PROFILES: PatientRiskProfile[] = SPECS.map(spec => {
  const r = ROSTER.find(x => x.patientId === spec.patientId)!
  return {
    patientId: spec.patientId,
    bedId: r.bedId,
    patientName: r.name,
    updatedAt: AI_UPDATED_AT,
    risks: spec.risks.map((k): RiskPrediction => ({
      category: k.c,
      probability: k.p,
      history: historyFor(k.p, k.d),
      rationale: k.r,
      factors: k.f.map(([label, weight, mitigating]) => ({ label, weight, mitigating })),
      suggestions: k.s,
    })),
  }
})

/* ---------------- accessors & derivations ---------------- */

export const allRiskProfiles = (): PatientRiskProfile[] => PROFILES

export const riskProfileFor = (patientId: string): PatientRiskProfile | null =>
  PROFILES.find(p => p.patientId === patientId) ?? null

const toRanked = (r: RiskPrediction): RankedRisk => ({
  category: r.category,
  probability: r.probability,
  trend: riskTrendOf(r.history),
  delta: r.probability - r.history[0],
})

/** Unit-wide ranking by highest current risk across any category. */
export function deriveRiskRanking(): RiskRankingRow[] {
  return PROFILES
    .map(p => {
      const roster = ROSTER.find(x => x.patientId === p.patientId)!
      const sorted = [...p.risks].sort((a, b) => b.probability - a.probability)
      const top = sorted[0]
      return {
        patientId: p.patientId,
        bedId: p.bedId,
        patientName: p.patientName,
        diagnosis: roster.diagnosis,
        top: toRanked(top),
        topHistory: top.history,
        alsoElevated: sorted.slice(1).filter(isElevated).map(toRanked),
        updatedAt: p.updatedAt,
      }
    })
    .sort((a, b) => b.top.probability - a.top.probability)
}

/** Legacy Mission Control AI-panel view (one line per risk). */
export function deriveMissionControlRisks(patientId: string): AiRisk[] {
  const p = riskProfileFor(patientId)
  return p ? p.risks.map(r => ({ name: r.category, probability: r.probability, rationale: r.rationale })) : []
}

/** Risks at/above threshold surface in the EXISTING alert center
    (merged into getPatientDetail alerts) — never a separate alert list. */
export function deriveRiskAlerts(patientId: string): PatientAlert[] {
  const p = riskProfileFor(patientId)
  if (!p) return []
  return p.risks
    .filter(r => r.probability >= AI_ALERT_THRESHOLD)
    .sort((a, b) => b.probability - a.probability)
    .map(r => ({
      severity: r.probability >= AI_ALERT_CRIT ? 'crit' as const : 'high' as const,
      message: `AI risk (simulated): ${r.category} ${r.probability}% and ${riskTrendOf(r.history)} — ${r.rationale}`,
      time: p.updatedAt,
    }))
}
