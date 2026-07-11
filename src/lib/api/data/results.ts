import type {
  ImagingStudy, LabDraw, LabPanelKey, LabResultItem, Labs, ResultFlag, ResultInboxItem,
} from '../types'

/* Canonical Laboratory & Imaging results store — THE single source of truth
   for results. Screen 5 places lab/imaging ORDERS; this store holds what
   comes back. Mission Control's lab trend card and Doctor Workspace's
   "Results to Acknowledge" queue are derived views over this store.
   Replaced by the ASP.NET Core results service at Stage 10. */

/* ---------------- compact seed spec, expanded into LabDraw[] ---------------- */

interface AnalyteSpec {
  analyte: string
  unit: string
  refRange: string
  refLow: number
  refHigh: number
  critLow?: number
  critHigh?: number
  decimals?: number
  /** legacy Mission Control chart metadata (color/label/transform) —
      presentation mapping only, not part of the stored result */
  color?: string
  chartLabel?: string
  toChart?: (v: number) => number
  values: number[]
}

interface PanelSpec {
  panel: LabPanelKey
  analytes: AnalyteSpec[]
}

interface PatientLabSpec {
  patientId: string
  bedId: string
  patientName: string
  /** x-axis labels, oldest → newest (last = "Now") */
  labels: string[]
  /** collectedAt per draw, aligned with labels */
  collected: string[]
  /** resultedAt for the LATEST draw, per panel (older draws resulted at collection day 07:05) */
  latestResulted: Partial<Record<LabPanelKey, string>>
  panels: PanelSpec[]
  /** panels whose latest draw is still unacknowledged, with the inbox note */
  unackedLatest: Partial<Record<LabPanelKey, string>>
}

const flagFor = (v: number, a: AnalyteSpec): ResultFlag => {
  if ((a.critLow !== undefined && v <= a.critLow) || (a.critHigh !== undefined && v >= a.critHigh)) return 'critical'
  if (v < a.refLow || v > a.refHigh) return 'abnormal'
  return 'normal'
}

const worst = (flags: ResultFlag[]): ResultFlag =>
  flags.includes('critical') ? 'critical' : flags.includes('abnormal') ? 'abnormal' : 'normal'

const AHMED: PatientLabSpec = {
  patientId: 'P-1001', bedId: 'B-01', patientName: 'Ahmed Al-Saadi',
  labels: ['D-6', 'D-5', 'D-4', 'D-3', 'D-2', 'D-1', 'Now'],
  collected: ['D-6 06:00', 'D-5 06:00', 'D-4 06:00', 'D-3 06:00', 'D-2 06:00', 'D-1 06:00', '06:00'],
  latestResulted: { Lactate: '09:42', CBC: '07:30' },
  unackedLatest: {
    Lactate: 'Repeat drawn 13:00, clearance <10% over 6 h',
    CBC: 'Down-trending 3rd consecutive draw',
  },
  panels: [
    {
      panel: 'CBC',
      analytes: [
        { analyte: 'WBC', unit: '×10⁹/L', refRange: '4.0–11.0', refLow: 4, refHigh: 11, critHigh: 25, decimals: 1, color: '#4da3ff', chartLabel: 'WBC ×10⁹/L', values: [9.8, 12.4, 16.2, 18.9, 17.4, 15.8, 14.2] },
        { analyte: 'Hgb', unit: 'g/dL', refRange: '12–16', refLow: 12, refHigh: 16, critLow: 7, decimals: 1, color: '#ff5d6c', chartLabel: 'Hgb g/dL', values: [11.2, 10.8, 10.1, 9.6, 9.2, 9.0, 8.8] },
        { analyte: 'Platelets', unit: '×10⁹/L', refRange: '150–400', refLow: 150, refHigh: 400, critLow: 100, color: '#3de8a0', chartLabel: 'Plt ×10⁹/L ÷10', toChart: v => v / 10, values: [210, 180, 140, 110, 98, 92, 96] },
        { analyte: 'Neut%', unit: '%', refRange: '40–75', refLow: 40, refHigh: 75, values: [70, 76, 82, 88, 89, 88, 88] },
      ],
    },
    {
      panel: 'ABG',
      analytes: [
        { analyte: 'pH', unit: '', refRange: '7.35–7.45', refLow: 7.35, refHigh: 7.45, critLow: 7.2, decimals: 2, color: '#4da3ff', chartLabel: 'pH ×10', toChart: v => v * 10 - 66, values: [7.41, 7.36, 7.31, 7.28, 7.3, 7.32, 7.33] },
        { analyte: 'PaO₂', unit: 'mmHg', refRange: '80–100', refLow: 80, refHigh: 100, critLow: 60, color: '#35e0d0', chartLabel: 'PaO₂/10 mmHg', toChart: v => v / 10, values: [98, 88, 74, 69, 76, 81, 82] },
        { analyte: 'PaCO₂', unit: 'mmHg', refRange: '35–45', refLow: 35, refHigh: 45, color: '#ffb454', chartLabel: 'PaCO₂/10', toChart: v => v / 10, values: [40, 44, 49, 52, 50, 47, 46] },
        { analyte: 'HCO₃', unit: 'mmol/L', refRange: '22–26', refLow: 22, refHigh: 26, values: [24, 23, 21, 19, 19, 19, 19] },
      ],
    },
    {
      panel: 'Electrolytes',
      analytes: [
        { analyte: 'Na⁺', unit: 'mmol/L', refRange: '135–145', refLow: 135, refHigh: 145, critLow: 120, critHigh: 160, color: '#4da3ff', chartLabel: 'Na⁺/10 mmol/L', toChart: v => v / 10, values: [138, 136, 134, 133, 134, 135, 136] },
        { analyte: 'K⁺', unit: 'mmol/L', refRange: '3.5–5.0', refLow: 3.5, refHigh: 5, critLow: 2.5, critHigh: 6, decimals: 1, color: '#ffb454', chartLabel: 'K⁺ mmol/L', values: [4.1, 4.4, 4.9, 5.3, 4.8, 4.4, 4.2] },
        { analyte: 'Mg²⁺', unit: 'mg/dL', refRange: '1.7–2.4', refLow: 1.7, refHigh: 2.4, decimals: 1, color: '#3de8a0', chartLabel: 'Mg²⁺ mg/dL', values: [1.9, 1.8, 1.7, 1.9, 2.0, 2.1, 2.0] },
        { analyte: 'Ca²⁺', unit: 'mg/dL', refRange: '8.5–10.5', refLow: 8.5, refHigh: 10.5, decimals: 1, values: [8.9, 8.7, 8.5, 8.4, 8.3, 8.4, 8.4] },
      ],
    },
    {
      panel: 'Renal',
      analytes: [
        { analyte: 'Creatinine', unit: 'mg/dL', refRange: '0.6–1.2', refLow: 0.6, refHigh: 1.2, critHigh: 1.8, decimals: 1, color: '#ff5d6c', chartLabel: 'Creatinine mg/dL', values: [0.9, 1.1, 1.4, 1.8, 2.1, 2.0, 1.9] },
        { analyte: 'BUN', unit: 'mg/dL', refRange: '8–20', refLow: 8, refHigh: 20, color: '#ffb454', chartLabel: 'BUN/10 mg/dL', toChart: v => v / 10, values: [18, 22, 30, 39, 46, 44, 42] },
        { analyte: 'eGFR', unit: 'mL/min', refRange: '> 60', refLow: 60, refHigh: 999, values: [88, 75, 58, 44, 36, 37, 36] },
      ],
    },
    {
      panel: 'Liver',
      analytes: [
        { analyte: 'AST', unit: 'U/L', refRange: '10–40', refLow: 10, refHigh: 40, color: '#4da3ff', chartLabel: 'AST /10 U/L', toChart: v => v / 10, values: [31, 34, 42, 58, 64, 59, 52] },
        { analyte: 'ALT', unit: 'U/L', refRange: '10–40', refLow: 10, refHigh: 40, color: '#35e0d0', chartLabel: 'ALT /10 U/L', toChart: v => v / 10, values: [28, 30, 36, 49, 56, 54, 50] },
        { analyte: 'T.Bili', unit: 'mg/dL', refRange: '0.2–1.2', refLow: 0.2, refHigh: 1.2, decimals: 1, color: '#ffb454', chartLabel: 'Bili mg/dL', values: [0.8, 0.9, 1.2, 1.6, 1.9, 1.8, 1.7] },
        { analyte: 'Albumin', unit: 'g/dL', refRange: '3.5–5.0', refLow: 3.5, refHigh: 5, decimals: 1, values: [3.4, 3.2, 3.0, 2.8, 2.7, 2.6, 2.6] },
      ],
    },
    {
      panel: 'Coagulation',
      analytes: [
        { analyte: 'INR', unit: '', refRange: '0.9–1.2', refLow: 0.9, refHigh: 1.2, critHigh: 3, decimals: 1, color: '#ff5d6c', chartLabel: 'INR', values: [1.1, 1.2, 1.3, 1.5, 1.6, 1.5, 1.4] },
        { analyte: 'aPTT', unit: 's', refRange: '25–35', refLow: 25, refHigh: 35, color: '#4da3ff', chartLabel: 'aPTT /10 s', toChart: v => v / 10, values: [30, 32, 36, 41, 44, 42, 40] },
        { analyte: 'Fibrinogen', unit: 'mg/dL', refRange: '200–400', refLow: 200, refHigh: 400, color: '#3de8a0', chartLabel: 'Fibrinogen /100', toChart: v => v / 100, values: [380, 340, 290, 240, 220, 230, 250] },
        { analyte: 'D-dimer', unit: 'µg/mL', refRange: '< 0.5', refLow: 0, refHigh: 0.5, critHigh: 4, decimals: 1, values: [1.2, 1.8, 2.6, 3.8, 4.5, 4.6, 4.8] },
      ],
    },
    {
      panel: 'Lactate',
      analytes: [
        { analyte: 'Lactate', unit: 'mmol/L', refRange: '0.5–2.0', refLow: 0.5, refHigh: 2, critHigh: 3.5, decimals: 1, color: '#ff5d6c', chartLabel: 'Lactate mmol/L', values: [1.4, 1.9, 2.8, 4.6, 4.1, 3.9, 3.8] },
      ],
    },
  ],
}

const SUSAN: PatientLabSpec = {
  patientId: 'P-1004', bedId: 'B-04', patientName: 'Susan Wright',
  labels: ['D-4', 'D-3', 'D-2', 'D-1', 'Now'],
  collected: ['D-4 06:00', 'D-3 06:00', 'D-2 06:00', 'D-1 06:00', '06:00'],
  latestResulted: {},
  unackedLatest: {},
  panels: [
    {
      panel: 'Renal',
      analytes: [
        { analyte: 'Creatinine', unit: 'mg/dL', refRange: '0.6–1.2', refLow: 0.6, refHigh: 1.2, critHigh: 4, decimals: 1, color: '#ff5d6c', chartLabel: 'Creatinine mg/dL', values: [3.4, 3.1, 2.8, 2.4, 2.1] },
        { analyte: 'BUN', unit: 'mg/dL', refRange: '8–20', refLow: 8, refHigh: 20, color: '#ffb454', chartLabel: 'BUN/10 mg/dL', toChart: v => v / 10, values: [58, 52, 47, 41, 36] },
        { analyte: 'eGFR', unit: 'mL/min', refRange: '> 60', refLow: 60, refHigh: 999, values: [14, 16, 18, 22, 26] },
      ],
    },
    {
      panel: 'Electrolytes',
      analytes: [
        { analyte: 'K⁺', unit: 'mmol/L', refRange: '3.5–5.0', refLow: 3.5, refHigh: 5, critHigh: 6, decimals: 1, color: '#ffb454', chartLabel: 'K⁺ mmol/L', values: [5.8, 5.2, 4.8, 4.5, 4.4] },
        { analyte: 'Na⁺', unit: 'mmol/L', refRange: '135–145', refLow: 135, refHigh: 145, color: '#4da3ff', chartLabel: 'Na⁺/10 mmol/L', toChart: v => v / 10, values: [131, 132, 133, 134, 135] },
        { analyte: 'Mg²⁺', unit: 'mg/dL', refRange: '1.7–2.4', refLow: 1.7, refHigh: 2.4, decimals: 1, color: '#3de8a0', chartLabel: 'Mg²⁺ mg/dL', values: [2.3, 2.2, 2.1, 2.0, 2.0] },
      ],
    },
    {
      panel: 'CBC',
      analytes: [
        { analyte: 'WBC', unit: '×10⁹/L', refRange: '4.0–11.0', refLow: 4, refHigh: 11, decimals: 1, color: '#4da3ff', chartLabel: 'WBC ×10⁹/L', values: [11.8, 11.2, 10.6, 10.1, 9.8] },
        { analyte: 'Hgb', unit: 'g/dL', refRange: '12–16', refLow: 12, refHigh: 16, critLow: 7, decimals: 1, color: '#ff5d6c', chartLabel: 'Hgb g/dL', values: [9.9, 9.7, 9.6, 9.5, 9.5] },
        { analyte: 'Platelets', unit: '×10⁹/L', refRange: '150–400', refLow: 150, refHigh: 400, critLow: 100, color: '#3de8a0', chartLabel: 'Plt ×10⁹/L ÷10', toChart: v => v / 10, values: [195, 188, 182, 180, 178] },
      ],
    },
  ],
}

const AISHA: PatientLabSpec = {
  patientId: 'P-1012', bedId: 'B-13', patientName: 'Aisha Mahmoud',
  labels: ['D-2', 'D-1', 'Now'],
  collected: ['D-2 06:00', 'D-1 06:00', '06:00'],
  latestResulted: {},
  unackedLatest: {},
  panels: [
    {
      panel: 'Lactate',
      analytes: [
        { analyte: 'Lactate', unit: 'mmol/L', refRange: '0.5–2.0', refLow: 0.5, refHigh: 2, critHigh: 3.5, decimals: 1, color: '#ff5d6c', chartLabel: 'Lactate mmol/L', values: [2.1, 2.9, 3.1] },
      ],
    },
    {
      panel: 'Liver',
      analytes: [
        { analyte: 'AST', unit: 'U/L', refRange: '10–40', refLow: 10, refHigh: 40, color: '#4da3ff', chartLabel: 'AST /10 U/L', toChart: v => v / 10, values: [88, 112, 126] },
        { analyte: 'ALT', unit: 'U/L', refRange: '10–40', refLow: 10, refHigh: 40, color: '#35e0d0', chartLabel: 'ALT /10 U/L', toChart: v => v / 10, values: [74, 96, 104] },
        { analyte: 'T.Bili', unit: 'mg/dL', refRange: '0.2–1.2', refLow: 0.2, refHigh: 1.2, decimals: 1, color: '#ffb454', chartLabel: 'Bili mg/dL', values: [1.4, 1.9, 2.2] },
      ],
    },
    {
      panel: 'CBC',
      analytes: [
        { analyte: 'WBC', unit: '×10⁹/L', refRange: '4.0–11.0', refLow: 4, refHigh: 11, critHigh: 25, decimals: 1, color: '#4da3ff', chartLabel: 'WBC ×10⁹/L', values: [15.2, 17.6, 18.4] },
        { analyte: 'Hgb', unit: 'g/dL', refRange: '12–16', refLow: 12, refHigh: 16, critLow: 7, decimals: 1, color: '#ff5d6c', chartLabel: 'Hgb g/dL', values: [10.8, 10.2, 9.9] },
        { analyte: 'Platelets', unit: '×10⁹/L', refRange: '150–400', refLow: 150, refHigh: 400, critLow: 100, color: '#3de8a0', chartLabel: 'Plt ×10⁹/L ÷10', toChart: v => v / 10, values: [240, 210, 190] },
      ],
    },
  ],
}

const SPECS = [AHMED, SUSAN, AISHA]

let labSeq = 6000
function expandSpec(spec: PatientLabSpec): LabDraw[] {
  const draws: LabDraw[] = []
  for (const p of spec.panels) {
    spec.labels.forEach((label, i) => {
      const isLatest = i === spec.labels.length - 1
      const items: LabResultItem[] = p.analytes.map(a => ({
        analyte: a.analyte,
        value: a.values[i],
        unit: a.unit,
        refRange: a.refRange,
        refLow: a.refLow,
        refHigh: a.refHigh,
        flag: flagFor(a.values[i], a),
      }))
      const unackedNote = isLatest ? spec.unackedLatest[p.panel] : undefined
      draws.push({
        labId: `LAB-${++labSeq}`,
        patientId: spec.patientId,
        bedId: spec.bedId,
        patientName: spec.patientName,
        panel: p.panel,
        label,
        collectedAt: spec.collected[i],
        resultedAt: isLatest ? (spec.latestResulted[p.panel] ?? '07:05') : `${spec.collected[i].split(' ')[0]} 07:05`,
        items,
        flag: worst(items.map(x => x.flag)),
        note: unackedNote,
        acknowledged: !unackedNote,
        acknowledgedBy: unackedNote ? undefined : 'Dr. S. Rahman',
        acknowledgedAt: unackedNote ? undefined : (isLatest ? '08:15' : undefined),
      })
    })
  }
  return draws
}

const LAB_DRAWS: LabDraw[] = /* @__PURE__ */ SPECS.flatMap(expandSpec)

/* ---------------- imaging studies ---------------- */

const IMAGING: ImagingStudy[] = [
  {
    studyId: 'IMG-7001', patientId: 'P-1001', bedId: 'B-01', patientName: 'Ahmed Al-Saadi',
    modality: 'CXR', description: 'Portable chest X-ray',
    orderedAt: 'D-1 21:40', performedAt: '06:10', reportedAt: '07:05', status: 'final',
    report: 'Bilateral lower-zone airspace opacities, worse on the right, consistent with multifocal pneumonia. Right IJ central venous catheter tip at cavoatrial junction. ET tube 4 cm above carina. No pneumothorax.',
    impression: 'Multifocal pneumonia with interval progression on the right. Lines and tubes appropriately positioned.',
    flag: 'abnormal', acknowledged: true, acknowledgedBy: 'Dr. S. Rahman', acknowledgedAt: '07:40',
  },
  {
    studyId: 'IMG-7002', patientId: 'P-1001', bedId: 'B-01', patientName: 'Ahmed Al-Saadi',
    modality: 'Echo', description: 'Bedside transthoracic echo',
    orderedAt: '07:30', performedAt: '08:20', reportedAt: '08:40', status: 'preliminary',
    report: 'Hyperdynamic left ventricle, visually estimated EF 65–70%. No regional wall motion abnormality. RV normal size and function. No pericardial effusion. IVC 1.8 cm with minimal respiratory collapse.',
    impression: 'Hyperdynamic circulation consistent with distributive shock; volume replete.',
    flag: 'abnormal', acknowledged: true, acknowledgedBy: 'Dr. S. Rahman', acknowledgedAt: '09:05',
  },
  {
    studyId: 'IMG-7003', patientId: 'P-1001', bedId: 'B-01', patientName: 'Ahmed Al-Saadi',
    modality: 'CT', description: 'CT chest with contrast',
    orderedAt: '09:50', status: 'in-progress',
    flag: 'normal', acknowledged: true,
  },
  {
    studyId: 'IMG-7004', patientId: 'P-1012', bedId: 'B-13', patientName: 'Aisha Mahmoud',
    modality: 'CT', description: 'CT abdomen',
    orderedAt: 'D-1 22:10', performedAt: '05:40', reportedAt: '06:50', status: 'preliminary',
    report: 'Extensive peripancreatic inflammatory change with an enlarging rim-enhancing fluid collection in the lesser sac, now 9.2 × 6.4 cm (previously 7.1 × 5.2 cm). No free air. Patent portal and splenic veins.',
    impression: 'Increasing peripancreatic fluid collection — findings concerning for evolving walled-off necrosis. Surgical review advised.',
    flag: 'critical', note: 'Radiology: increasing peripancreatic fluid collection',
    acknowledged: false,
  },
  {
    studyId: 'IMG-7005', patientId: 'P-1004', bedId: 'B-04', patientName: 'Susan Wright',
    modality: 'US', description: 'Renal ultrasound',
    orderedAt: 'D-2 10:00', performedAt: 'D-2 14:30', reportedAt: 'D-2 16:00', status: 'final',
    report: 'Both kidneys normal in size with increased cortical echogenicity. No hydronephrosis, no perinephric collection. Vascath in situ via right IJ.',
    impression: 'Echogenic kidneys consistent with acute parenchymal disease; no obstruction.',
    flag: 'abnormal', acknowledged: true, acknowledgedBy: 'Dr. S. Rahman', acknowledgedAt: 'D-2 17:10',
  },
  {
    studyId: 'IMG-7006', patientId: 'P-1004', bedId: 'B-04', patientName: 'Susan Wright',
    modality: 'CXR', description: 'Portable chest X-ray',
    orderedAt: '06:00', performedAt: '06:30', reportedAt: '07:15', status: 'final',
    report: 'Small bilateral pleural effusions, stable. No consolidation. Vascath tip in SVC.',
    impression: 'Stable small effusions; no acute change.',
    flag: 'abnormal', acknowledged: true, acknowledgedBy: 'Dr. S. Rahman', acknowledgedAt: '07:45',
  },
  {
    studyId: 'IMG-7007', patientId: 'P-1007', bedId: 'B-07', patientName: 'Robert Miller',
    modality: 'CXR', description: 'Portable chest X-ray',
    orderedAt: '05:50', performedAt: '06:20', reportedAt: '07:10', status: 'final',
    report: 'Diffuse bilateral interstitial and alveolar opacities, progressed from prior. ET tube in good position.',
    impression: 'Worsening multifocal viral pneumonia.',
    flag: 'abnormal', acknowledged: true, acknowledgedBy: 'Dr. S. Rahman', acknowledgedAt: '07:50',
  },
]

/* ---------------- accessors, derivations, mutations ---------------- */

export const labDrawsFor = (patientId: string): LabDraw[] =>
  LAB_DRAWS.filter(d => d.patientId === patientId)

export const imagingFor = (patientId: string): ImagingStudy[] =>
  IMAGING.filter(s => s.patientId === patientId)

const headline = (d: LabDraw): LabResultItem => {
  const crit = d.items.find(i => i.flag === 'critical')
  const abn = d.items.find(i => i.flag === 'abnormal')
  return crit ?? abn ?? d.items[0]
}

const fmt = (v: number): string => (Number.isInteger(v) ? String(v) : v.toFixed(1))

/** Unit-wide unacknowledged results — feeds Doctor Workspace's
    "Results to Acknowledge" queue and the Screen 6 inbox. */
export function deriveResultInbox(): ResultInboxItem[] {
  const labs: ResultInboxItem[] = LAB_DRAWS.filter(d => !d.acknowledged).map(d => {
    const h = headline(d)
    return {
      kind: 'lab' as const, id: d.labId, patientId: d.patientId, bedId: d.bedId, patientName: d.patientName,
      title: `${h.analyte} ${fmt(h.value)} ${h.unit} — ${d.bedId} ${d.patientName}`.replace('  ', ' '),
      detail: d.note ?? `${d.panel} panel resulted`,
      time: d.resultedAt, flag: d.flag,
    }
  })
  const imaging: ResultInboxItem[] = IMAGING.filter(s => !s.acknowledged).map(s => ({
    kind: 'imaging' as const, id: s.studyId, patientId: s.patientId, bedId: s.bedId, patientName: s.patientName,
    title: `${s.description} ${s.status === 'preliminary' ? 'prelim' : s.status} — ${s.bedId} ${s.patientName}`,
    detail: s.note ?? s.impression ?? '',
    time: s.reportedAt ?? s.orderedAt, flag: s.flag,
  }))
  return [...labs, ...imaging].sort((a, b) => b.time.localeCompare(a.time))
}

/** live unacknowledged results for one patient (labs + imaging) — feeds the
    derived roster alertCount */
export const unackedResultCountFor = (patientId: string): number =>
  LAB_DRAWS.filter(d => d.patientId === patientId && !d.acknowledged).length +
  IMAGING.filter(x => x.patientId === patientId && !x.acknowledged).length

/* permission is enforced in the service layer (api/index.ts) — the store
   applies the state change only */
export function applyAcknowledgeLab(labId: string, actor: string, time: string): LabDraw | null {
  const d = LAB_DRAWS.find(x => x.labId === labId && !x.acknowledged)
  if (!d) return null
  d.acknowledged = true
  d.acknowledgedBy = actor
  d.acknowledgedAt = time
  return d
}

export function applyAcknowledgeImaging(studyId: string, actor: string, time: string): ImagingStudy | null {
  const s = IMAGING.find(x => x.studyId === studyId && !x.acknowledged)
  if (!s) return null
  s.acknowledged = true
  s.acknowledgedBy = actor
  s.acknowledgedAt = time
  return s
}

/* un-acknowledge (results audit PR): the offline/mock apply mirrors the
   server's never-destroy semantics as far as the mock store can — the
   current-state summary clears and the result re-enters the derived inbox.
   (The mock store keeps no event history; the audited record is the
   SERVER's — offline reversal is a Stage 9 display convenience only.) */
export function applyUnacknowledgeLab(labId: string): LabDraw | null {
  const d = LAB_DRAWS.find(x => x.labId === labId && x.acknowledged)
  if (!d) return null
  d.acknowledged = false
  d.acknowledgedBy = undefined
  d.acknowledgedAt = undefined
  return d
}

export function applyUnacknowledgeImaging(studyId: string): ImagingStudy | null {
  const s = IMAGING.find(x => x.studyId === studyId && x.acknowledged)
  if (!s) return null
  s.acknowledged = false
  s.acknowledgedBy = undefined
  s.acknowledgedAt = undefined
  return s
}

/** Legacy Mission Control lab-trend view, derived from the canonical draws
    (same scaled series/colors as the approved prototype). */
export function deriveMissionControlLabs(patientId: string): Labs {
  const spec = SPECS.find(s => s.patientId === patientId)
  if (!spec) return { drawTimes: [], panels: [] }
  return {
    drawTimes: spec.labels,
    panels: spec.panels.map(p => ({
      name: p.panel,
      series: p.analytes
        .filter(a => a.chartLabel)
        .map(a => ({
          label: a.chartLabel!,
          color: a.color ?? '#4da3ff',
          points: a.values.map(v => (a.toChart ? a.toChart(v) : v)),
        })),
      results: p.analytes.map(a => {
        const v = a.values[a.values.length - 1]
        const f = flagFor(v, a)
        return {
          analyte: a.analyte,
          value: a.decimals !== undefined ? v.toFixed(a.decimals) : fmt(v),
          flag: (f === 'critical' ? 'crit2' : f === 'abnormal' ? 'abn' : '') as '' | 'abn' | 'crit2',
        }
      }),
    })),
  }
}
