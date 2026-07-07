import type { Bed, BedPatient, BedsResponse, UnitSummaryResponse } from '../types'
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

const toBedPatient = (r: UnitPatientRecord): BedPatient => ({
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

export const UNIT_SUMMARY: UnitSummaryResponse = {
  unitId: '4B',
  admissionsInProgress: 3,
  dischargesPlanned: 2,
  pendingConsults: 4,
  highPriorityAlerts: [
    { severity: 'crit', message: 'B-01 · MAP <65 mmHg ×12 min despite norad 0.32', time: '09:31' },
    { severity: 'crit', message: 'B-10 · Cardiac index 1.9 — escalation in progress', time: '09:18' },
    { severity: 'crit', message: 'B-13 · IAP 19 mmHg — surgical review requested', time: '08:47' },
    { severity: 'high', message: 'B-07 · SpO₂ 92% on FiO₂ 60% — proning considered', time: '08:22' },
    { severity: 'high', message: 'B-12 · pCO₂ 61 on NIV — reassess in 2 h', time: '07:55' },
  ],
  stats: [
    { label: 'Admissions Today', value: '3', delta: '+1 vs avg', trend: 'up' },
    { label: 'Discharges Today', value: '2', delta: 'on plan', trend: 'fl' },
    { label: 'Mortality (30 d)', value: '6.8%', delta: '−1.2%', trend: 'up' },
    { label: 'Readmissions (48 h)', value: '1', delta: '−', trend: 'fl' },
    { label: 'Vent Utilization', value: '5 / 16', delta: '31%', trend: 'fl' },
    { label: 'Avg ICU Stay', value: '3.6 d', delta: '−0.4 d', trend: 'up' },
  ],
}
