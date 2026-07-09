import type { AdtBed, Bed, BedPatient, BedsResponse, RosterRecordDto, UnitAlert, UnitSummaryResponse } from '../types'
import { ROSTER, type UnitPatientRecord } from './roster'

/* Bed board — Unit 4B, 16 beds. The bed LAYOUT (bed ↔ location ↔ occupant
   id) lives here; every patient field is derived from the canonical roster
   (roster.ts). A bed is a place, not a patient record. */

const DOCS = ['Dr. S. Rahman', 'Dr. L. Osei', 'Dr. E. Marchetti', 'Dr. H. Nakamura']

interface BedSlot {
  bedId: string
  area: string
  /** occupant — null = bed available */
  patientId: string | null
}

const BED_LAYOUT: BedSlot[] = [
  { bedId: 'B-01', area: 'Pod A', patientId: 'P-1001' },
  { bedId: 'B-02', area: 'Pod A', patientId: 'P-1002' },
  { bedId: 'B-03', area: 'Pod A', patientId: 'P-1003' },
  { bedId: 'B-04', area: 'Pod A', patientId: 'P-1004' },
  { bedId: 'B-05', area: 'Pod A', patientId: 'P-1005' },
  { bedId: 'B-06', area: 'Pod A', patientId: 'P-1006' },
  { bedId: 'B-07', area: 'Pod A', patientId: 'P-1007' },
  { bedId: 'B-08', area: 'Pod A', patientId: null },
  { bedId: 'B-09', area: 'Pod B', patientId: 'P-1008' },
  { bedId: 'B-10', area: 'Pod B', patientId: 'P-1009' },
  { bedId: 'B-11', area: 'Pod B', patientId: 'P-1010' },
  { bedId: 'B-12', area: 'Pod B', patientId: 'P-1011' },
  { bedId: 'B-13', area: 'Pod B', patientId: 'P-1012' },
  { bedId: 'B-14', area: 'Pod B', patientId: 'P-1013' },
  { bedId: 'B-15', area: 'Pod B', patientId: 'P-1014' },
  { bedId: 'B-16', area: 'Pod B', patientId: null },
]

/* RosterRecordDto (the real wire shape) and UnitPatientRecord (the mock
   record) are structurally identical for these fields — one mapper serves
   both the mock board and the Layer 2 real composition. */
const toBedPatient = (r: UnitPatientRecord | RosterRecordDto): BedPatient => ({
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

const toBed = ({ bedId, area, patientId }: BedSlot): Bed => {
  const record = patientId ? ROSTER.find(r => r.patientId === patientId) : undefined
  return { bedId, area, patient: record ? toBedPatient(record) : null }
}

export const BEDS_RESPONSE: BedsResponse = {
  unitId: '4B',
  capacity: 16,
  physicians: DOCS,
  areas: ['Pod A', 'Pod B'],
  beds: BED_LAYOUT.map(toBed),
}

/* High-priority unit alerts — DERIVED from the roster's bed alerts (crit
   first, then by raised time), never a hand-maintained parallel list. */
function deriveHighPriorityAlerts(): UnitAlert[] {
  return ROSTER
    .filter(r => r.bedAlert.severity === 'crit' || r.bedAlert.severity === 'high')
    .map(r => ({
      severity: r.bedAlert.severity as UnitAlert['severity'],
      message: `${r.bedId} · ${r.bedAlert.message}`,
      time: r.bedAlert.time,
    }))
    .sort((a, b) =>
      a.severity === b.severity ? b.time.localeCompare(a.time) : a.severity === 'crit' ? -1 : 1)
}

export const UNIT_SUMMARY: UnitSummaryResponse = {
  unitId: '4B',
  admissionsInProgress: 3,
  dischargesPlanned: 2,
  pendingConsults: 4,
  highPriorityAlerts: deriveHighPriorityAlerts(),
  stats: [
    { label: 'Admissions Today', value: '3', delta: '+1 vs avg', trend: 'up' },
    { label: 'Discharges Today', value: '2', delta: 'on plan', trend: 'fl' },
    { label: 'Mortality (30 d)', value: '6.8%', delta: '−1.2%', trend: 'up' },
    { label: 'Readmissions (48 h)', value: '1', delta: '−', trend: 'fl' },
    { label: 'Vent Utilization', value: '5 / 16', delta: '31%', trend: 'fl' },
    { label: 'Avg ICU Stay', value: '3.6 d', delta: '−0.4 d', trend: 'up' },
  ],
}


/* ---------------- Layer 2 — real bed-board composition ----------------
   The REAL board = the ADT bed registry (layout + derived occupancy) joined
   with the REAL roster (per-patient bedside snapshot). Admissions appear,
   discharges drop off, and transfers move beds because both inputs derive
   from Core encounters. The mock BEDS_RESPONSE above remains the offline
   fallback. */
export function composeBedsResponse(adtBeds: AdtBed[], roster: RosterRecordDto[]): BedsResponse {
  const byId = new Map(roster.map(r => [r.patientId, r]))
  return {
    unitId: '4B',
    capacity: adtBeds.length,
    physicians: DOCS,
    areas: [...new Set(adtBeds.map(b => b.area))],
    beds: adtBeds.map(({ bedId, area, patientId }): Bed => {
      const record = patientId ? byId.get(patientId) : undefined
      return { bedId, area, patient: record ? toBedPatient(record) : null }
    }),
  }
}

/* offline fallback for the ADT bed registry — derived from the mock layout
   and roster with the SAME encounter-id convention the server seeds use
   (P-1001 → ENC-1001), display-only */
export function mockAdtBeds(): AdtBed[] {
  return BED_LAYOUT.map(({ bedId, area, patientId }) => {
    const r = patientId ? ROSTER.find(x => x.patientId === patientId) : undefined
    return {
      bedId, area,
      ...(r ? { patientId: r.patientId, patientName: r.name, encounterId: `ENC-${r.patientId.slice(2)}` } : {}),
    }
  })
}
