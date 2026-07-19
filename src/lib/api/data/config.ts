import type { CodeStatusEntry } from '../types'

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
