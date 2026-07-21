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
  codeStatusCode: r.codeStatusCode,
  codeStatusLegacy: r.codeStatusLegacy,
  vitals: r.bedsideVitals,
  alert: r.bedAlert,
  attending: r.attending,
  /* severity is NOT copied from the wire: the card DERIVES acuity from
     the real scores (no-reassuring-default rule) */
  mapTrend: r.mapTrend,
})

/* Layer 2: the bed board composed from the REAL ADT bed registry joined
   with the REAL roster (per-patient bedside snapshot). Admissions appear,
   discharges drop off, and transfers move beds because both inputs derive
   from Core encounters. */
export function composeBedsResponse(adtBeds: AdtBed[], roster: RosterRecordDto[]): BedsResponse {
  const byId = new Map(roster.map(r => [r.patientId, r]))
  /* Bed Registry: the BOARD shows the unit's ACTIVE beds only — a retired
     bed leaves the layout (it cannot be occupied: retiring an occupied bed
     is refused server-side). Capacity and areas are COUNTED from the
     active registry, never a literal (the ?? 16 / ?? Pod A/B fallbacks
     are dead — a hospital sees exactly its own beds). */
  const active = adtBeds.filter(b => b.active)
  return {
    /* the pre-existing data-layer unit key — SINGLE-UNIT BOUNDARY
       (flagged, not deepened): display surfaces use #135's configured
       unit name, and the later multi-unit project replaces this key with
       real per-unit scoping. Nothing else reads '4B'. */
    unitId: '4B',
    capacity: active.length,
    physicians: import.meta.env.VITE_APP_ENV !== 'production'
      ? DEMO_DOCS
      : [...new Set(roster.map(r => r.attending).filter(Boolean))],
    areas: [...new Set(active.map(b => b.area))],
    beds: active.map(({ bedId, area, patientId }): Bed => {
      const record = patientId ? byId.get(patientId) : undefined
      return { bedId, area, patient: record ? toBedPatient(record) : null }
    }),
  }
}
