import type { CodeStatusEntry, DispositionEntry, FrequencyEntry, IsolationTypeEntry, ShiftEntry } from '../types'

/* Code Status vocabulary — MOCK store (dev/staging read fallback only;
   writes are REAL-ONLY). Mirrors the server seed exactly: the
   PLACEHOLDER starting set the clinical owner finalises through the
   Configuration manager. Codes here must stay in sync with the
   codeStatusCode values on the mock roster records. */
export const CODE_STATUSES: CodeStatusEntry[] = [
  { code: 'full_code', label: 'Full Code', seq: 1, active: true, history: [] },
  { code: 'dnr', label: 'DNR', seq: 2, active: true, history: [] },
  { code: 'dnr_dni', label: 'DNR / DNI', seq: 3, active: true, history: [] },
  { code: 'comfort_care', label: 'Comfort care', seq: 4, active: true, history: [] },
]

/* Hospital identity — MOCK record (dev/staging read fallback only;
   writes are REAL-ONLY). Mirrors the demo server seed exactly: the
   identity every surface hardcoded until the Config Home work — now
   DATA, so staging renders visually unchanged. Address is empty (the
   demo letterhead never carried one). */
export const HOSPITAL_IDENTITY = {
  name: 'Aurora General Hospital',
  unitName: 'Unit 4B',
  shortName: 'AURORA',
  address: '',
  configured: true,
} as const

/* Imaging Catalogue — MOCK store (dev/staging read fallback only; writes
   are REAL-ONLY). Mirrors the demo server seed exactly: the three
   studies the retired ORDER_SETS.Imaging mock offered, now coded — so
   staging ordering renders byte-identical chips. */
export const IMAGING_CATALOG = [
  { studyId: 'portable_cxr', name: 'Portable CXR', modality: 'CXR', region: 'Chest', contrast: false, portable: true, active: true, history: [] },
  { studyId: 'ct_abdomen_pelvis', name: 'CT Abdomen/Pelvis', modality: 'CT', region: 'Abdomen/Pelvis', contrast: true, portable: false, active: true, history: [] },
  { studyId: 'bedside_echo', name: 'Bedside Echo', modality: 'Echo', region: 'Cardiac', contrast: false, portable: true, active: true, history: [] },
] as const

/* ---- Configuration Vocabularies — MOCK stores (dev/staging read
   fallback only; writes are REAL-ONLY). Each mirrors the server seed
   exactly: placeholder starting sets each hospital finalises live. ---- */

export const DISPOSITION_ENTRIES: DispositionEntry[] = [
  { code: 'home', label: 'Home', seq: 1, active: true, isDeath: false, history: [] },
  { code: 'ward', label: 'Ward (step-down / general floor)', seq: 2, active: true, isDeath: false, history: [] },
  { code: 'transfer_out', label: 'Another facility / transfer out', seq: 3, active: true, isDeath: false, history: [] },
  { code: 'higher_care', label: 'Higher care / another ICU', seq: 4, active: true, isDeath: false, history: [] },
  { code: 'died', label: 'Died', seq: 5, active: true, isDeath: true, history: [] },
  { code: 'other', label: 'Other', seq: 6, active: true, isDeath: false, history: [] },
]

export const ISOLATION_TYPE_ENTRIES: IsolationTypeEntry[] = [
  { code: 'contact', label: 'Contact', seq: 1, active: true, history: [] },
  { code: 'droplet', label: 'Droplet', seq: 2, active: true, history: [] },
  { code: 'airborne', label: 'Airborne', seq: 3, active: true, history: [] },
  { code: 'protective', label: 'Protective (reverse)', seq: 4, active: true, history: [] },
  { code: 'unspecified', label: 'Isolation (unspecified)', seq: 5, active: true, history: [] },
]

export const SHIFT_ENTRIES: ShiftEntry[] = [
  { code: 'day', label: 'Day (07–19)', seq: 1, active: true, history: [] },
  { code: 'night', label: 'Night (19–07)', seq: 2, active: true, history: [] },
]

/* mirrors NAMED_FREQUENCIES (data/formulary.ts) with the managed-entry
   shape; referencedBy stays [] in the mock (a display-only convenience
   the live server computes from the real formulary) */
export const FREQUENCY_ENTRIES: FrequencyEntry[] = [
  'continuous', 'daily', 'bid', 'tid', 'qid', 'once', 'sliding scale', 'per level', 'per CRRT protocol',
].map((value, i) => ({ value, seq: i + 1, active: true, referencedBy: [], history: [] }))
