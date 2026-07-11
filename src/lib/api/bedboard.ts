import type { AdtBed, Bed, BedPatient, BedsResponse, RosterRecordDto } from './types'

/* REAL bed-board composition (Layer 2) — extracted from data/beds.ts
   (§11 step 3): this join runs on the LIVE path (real ADT registry ×
   real roster), and living inside the mock module dragged the demo
   roster into the production bundle (bundle-inspection finding). The
   mock module imports these back for its offline composition, so there
   is still exactly one definition. */

/* the physicians filter strip: dev/staging keep the Stage-1 display
   list (byte-parity); production derives it from the REAL roster's
   attending physicians — no demo names exist there. */
const DEMO_DOCS = ['Dr. S. Rahman', 'Dr. L. Osei', 'Dr. E. Marchetti', 'Dr. H. Nakamura']

export const toBedPatient = (r: RosterRecordDto): BedPatient => ({
  patientId: r.patientId,
  name: r.name,
  age: r.age,
  sex: r.sex,
  diagnosis: r.diagnosis,
  los: r.los,
  flags: r.flags,
  isolation: r.isolation,
  codeStatus: r.codeStatus,
  sofa: r.sofa,
  ews: r.ews,
  vitals: r.bedsideVitals,
  alert: r.bedAlert,
  attending: r.attending,
  severity: r.severity,
  mapTrend: r.mapTrend,
})

/* Layer 2: the bed board composed from the REAL ADT bed registry joined
   with the REAL roster (per-patient bedside snapshot). Admissions appear,
   discharges drop off, and transfers move beds because both inputs derive
   from Core encounters. */
export function composeBedsResponse(adtBeds: AdtBed[], roster: RosterRecordDto[]): BedsResponse {
  const byId = new Map(roster.map(r => [r.patientId, r]))
  return {
    unitId: '4B',
    capacity: adtBeds.length,
    physicians: import.meta.env.VITE_APP_ENV !== 'production'
      ? DEMO_DOCS
      : [...new Set(roster.map(r => r.attending).filter(Boolean))],
    areas: [...new Set(adtBeds.map(b => b.area))],
    beds: adtBeds.map(({ bedId, area, patientId }): Bed => {
      const record = patientId ? byId.get(patientId) : undefined
      return { bedId, area, patient: record ? toBedPatient(record) : null }
    }),
  }
}
