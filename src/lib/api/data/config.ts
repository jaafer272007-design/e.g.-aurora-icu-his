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
