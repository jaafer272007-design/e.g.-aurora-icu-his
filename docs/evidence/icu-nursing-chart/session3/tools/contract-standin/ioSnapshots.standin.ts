/* [SESSION-3 CONTRACT STAND-IN — NOT SESSION 1'S IMPLEMENTATION]
   src/lib/api/ioSnapshots.ts as frozen by the contract §5.3 (+ §9.3), written by Session 3 only to
   type-check and exercise its branch before Session 1's branch exists. Overlaid onto a scratch
   copy, never committed at this path. */
import type { ObsAmendment, Observation } from './types'

export const IO_INTAKE_TYPE = 'io_current_intake_ml'
export const IO_OUTPUT_TYPE = 'io_current_output_ml'
export const IO_SNAPSHOT_TYPE_CODES: readonly string[] = [IO_INTAKE_TYPE, IO_OUTPUT_TYPE]
export const IO_SNAPSHOT_MAX_ML = 20000
export type IoSnapshotKind = 'intake' | 'output'
export interface IoSnapshot {
  observationId: string
  kind: IoSnapshotKind
  typeCode: string
  valueMl: number
  originalValueMl: number
  clinicalTime: string
  enteredAt: string
  recordedBy: string
  amendments: ObsAmendment[]
}
export interface IoView {
  patientId: string
  encounterId: string
  intake: IoSnapshot | null
  output: IoSnapshot | null
  balanceMl: number | null
  history: IoSnapshot[]
}
export type IoRead =
  | { kind: 'ok'; view: IoView }
  | { kind: 'no-open-encounter' }
  | { kind: 'unavailable'; error: string; forbidden: boolean }
export interface IoSnapshotDraft { intakeMl?: number; outputMl?: number }
export type IoWriteResult =
  | { kind: 'ok'; observations: Observation[] }
  | { kind: 'rejected'; error: string; status?: number }
  | { kind: 'uncertain'; error: string }

const suffix = (id: string) => Number(/(\d+)$/.exec(id)?.[1] ?? 0)
const byEntry = (a: IoSnapshot, b: IoSnapshot) => a.enteredAt.localeCompare(b.enteredAt) || suffix(a.observationId) - suffix(b.observationId)

export function deriveIoView(patientId: string, encounterId: string, observations: Observation[]): IoView {
  const snaps: IoSnapshot[] = observations
    .filter(o => o.encounterId === encounterId && IO_SNAPSHOT_TYPE_CODES.includes(o.typeCode))
    .map(o => {
      const last = o.amendments.length ? o.amendments[o.amendments.length - 1].newValue : o.value
      return {
        observationId: o.observationId, kind: o.typeCode === IO_INTAKE_TYPE ? 'intake' : 'output', typeCode: o.typeCode,
        valueMl: Number(last), originalValueMl: Number(o.value), clinicalTime: o.clinicalTime, enteredAt: o.enteredAt,
        recordedBy: o.recordedBy, amendments: o.amendments,
      }
    })
  snaps.sort(byEntry)
  const latest = (k: IoSnapshotKind) => [...snaps].reverse().find(s => s.kind === k) ?? null
  const intake = latest('intake'), output = latest('output')
  return {
    patientId, encounterId, intake, output,
    balanceMl: intake && output ? intake.valueMl - output.valueMl : null,
    history: [...snaps].reverse(),
  }
}
