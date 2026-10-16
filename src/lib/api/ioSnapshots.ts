import type { ObsAmendment, Observation } from './types'

/* Intake & Output — MANUAL SNAPSHOTS (docs/design/icu-update-nursing-patient-chart.md
   §3 "Intake & Output"; contracts §5). Two separately named observation types
   charted through the existing observations API — no I&O store of its own:
   the nurse's latest entered intake and output for the CURRENT admission.
   Entering 200 after 500 displays 200; 500 stays in history. Values never
   expire or reset at midnight; a new admission starts blank. These are NOT
   per-interval fluid amounts: nothing here sums anything, and no fluid total,
   fluid-balance strip or score reads these codes. Pure — the adapters live
   in ./index.ts. */

export const IO_INTAKE_TYPE = 'io_current_intake_ml'
export const IO_OUTPUT_TYPE = 'io_current_output_ml'
export const IO_SNAPSHOT_TYPE_CODES: readonly string[] = [IO_INTAKE_TYPE, IO_OUTPUT_TYPE]
/** the catalogue's plausibility bound (the derived Total Input/Output's) */
export const IO_SNAPSHOT_MAX_ML = 20000

export type IoSnapshotKind = 'intake' | 'output'

export interface IoSnapshot {
  observationId: string
  kind: IoSnapshotKind
  typeCode: string
  /** effective value: the last amendment's newValue, else the charted value */
  valueMl: number
  /** as first charted (amend-not-erase) */
  originalValueMl: number
  /** server-stamped UTC wire 'yyyy-MM-dd HH:mm' */
  clinicalTime: string
  /** server entry stamp, UTC 'yyyy-MM-dd HH:mm:ss' */
  enteredAt: string
  recordedBy: string
  amendments: ObsAmendment[]
}

export interface IoView {
  patientId: string
  encounterId: string
  /** the latest intake snapshot of this admission, or null = "Not recorded" */
  intake: IoSnapshot | null
  output: IoSnapshot | null
  /** intake − output, only when BOTH exist — never computed against a missing value */
  balanceMl: number | null
  /** both kinds, newest entry first, this admission only */
  history: IoSnapshot[]
}

export type IoRead =
  | { kind: 'ok'; view: IoView }
  /** the patient has no open admission — nothing to show or chart */
  | { kind: 'no-open-encounter' }
  /** unreachable, refused (forbidden) or mock mode — never simulated */
  | { kind: 'unavailable'; error: string; forbidden: boolean }

/** ≥ 1 value; whole mL, 0 … IO_SNAPSHOT_MAX_ML (zero is a real value) */
export interface IoSnapshotDraft {
  intakeMl?: number
  outputMl?: number
}

export type IoWriteResult =
  | { kind: 'ok'; observations: Observation[] }
  /** the server answered with a refusal — nothing was recorded */
  | { kind: 'rejected'; error: string; status?: number }
  /** no answer (or a server error) — the save MAY be on the record: re-read,
   *  and never resend automatically (observations carry no attempt id) */
  | { kind: 'uncertain'; error: string }

const effective = (o: Observation): string =>
  o.amendments.length > 0 ? o.amendments[o.amendments.length - 1].newValue : o.value

/** numeric suffix of "OBS-1234" — the server's monotonic counter */
const idSeq = (id: string): number => {
  const n = Number(id.slice(id.indexOf('-') + 1))
  return Number.isFinite(n) ? n : 0
}

/** entry order: enteredAt, then the id counter — two saves in the same
 *  minute (or second) still resolve deterministically, and an amendment
 *  never makes an older snapshot current */
const byEntry = (a: Observation, b: Observation): number =>
  a.enteredAt < b.enteredAt ? -1 : a.enteredAt > b.enteredAt ? 1 : idSeq(a.observationId) - idSeq(b.observationId)

function toSnapshot(o: Observation): IoSnapshot | null {
  const kind: IoSnapshotKind | null = o.typeCode === IO_INTAKE_TYPE ? 'intake' : o.typeCode === IO_OUTPUT_TYPE ? 'output' : null
  const valueMl = Number(effective(o))
  const originalValueMl = Number(o.value)
  if (kind === null || !Number.isFinite(valueMl) || !Number.isFinite(originalValueMl)) return null
  return {
    observationId: o.observationId, kind, typeCode: o.typeCode, valueMl, originalValueMl,
    clinicalTime: o.clinicalTime, enteredAt: o.enteredAt, recordedBy: o.recordedBy, amendments: o.amendments,
  }
}

/** the I&O view of ONE admission from its observations (any order, any
 *  other types — they are ignored) */
export function deriveIoView(patientId: string, encounterId: string, observations: Observation[]): IoView {
  const mine = observations
    .filter(o => o.patientId === patientId && o.encounterId === encounterId && IO_SNAPSHOT_TYPE_CODES.includes(o.typeCode))
    .sort(byEntry)
  const snapshots = mine.map(toSnapshot).filter((s): s is IoSnapshot => s !== null)
  const latest = (kind: IoSnapshotKind) => [...snapshots].reverse().find(s => s.kind === kind) ?? null
  const intake = latest('intake')
  const output = latest('output')
  return {
    patientId, encounterId, intake, output,
    balanceMl: intake && output ? intake.valueMl - output.valueMl : null,
    history: [...snapshots].reverse(),
  }
}

/** client-side shape check before a save — null when valid, else the reason */
export function ioDraftProblem(draft: IoSnapshotDraft): string | null {
  const values = [draft.intakeMl, draft.outputMl].filter((v): v is number => v !== undefined)
  if (values.length === 0) return 'enter an intake or an output value'
  if (values.some(v => !Number.isInteger(v) || v < 0 || v > IO_SNAPSHOT_MAX_ML))
    return `values are whole mL from 0 to ${IO_SNAPSHOT_MAX_ML}`
  return null
}
