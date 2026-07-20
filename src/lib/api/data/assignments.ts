import type { CoverageRow, CoveringNurse, MineWorklist, Removal } from '../types'
import { ROSTER } from './roster'

/* Assignment — OPT-OUT coverage MOCK STORE (offline demo parity).
   Mirrors server/Core/Assignments: every nurse covers every roster
   patient by default; the only persistent state is the REMOVAL
   exceptions. The demo nurse accounts below mirror the seeded staging
   users (the mock stand-in for the active Nurse-profile accounts
   coverage derives from). NO seed removals — the default IS the state. */

export const MOCK_NURSES: CoveringNurse[] = [
  { userId: 'maya.chen', name: 'RN Maya Chen', jobTitle: 'Staff Nurse' },
  { userId: 'priya.patel', name: 'RN Priya Patel', jobTitle: 'Staff Nurse' },
]

const REMOVALS: Removal[] = []
let seq = 0

const encOf = (patientId: string) => `ENC-${patientId.slice(patientId.indexOf('-') + 1)}`

const activeRemoval = (patientId: string, userId: string) =>
  REMOVALS.find(r => r.patientId === patientId && r.userId === userId && !r.restoredAt)

/** the unit-wide derived coverage (mock) */
export function mockCoverage(): CoverageRow[] {
  return ROSTER.map(r => {
    const removedHere = new Set(
      REMOVALS.filter(x => x.patientId === r.patientId && !x.restoredAt).map(x => x.userId))
    return {
      patientId: r.patientId, patientName: r.name, bedId: r.bedId, encounterId: encOf(r.patientId),
      nurses: MOCK_NURSES.filter(n => !removedHere.has(n.userId)),
      removals: REMOVALS.filter(x => x.patientId === r.patientId),
    }
  })
}

/** the signed-in clinician's worklist (mock — mirrors /assignments/mine) */
export function mockMine(kind: 'nurse' | 'doctor' | null, userId: string): MineWorklist {
  if (kind === null) return { kind: null, patientIds: [], removedPatientIds: [] }
  if (kind === 'doctor')
    return { kind: 'doctor', patientIds: ROSTER.map(r => r.patientId), removedPatientIds: [] }
  const removed = new Set(
    REMOVALS.filter(x => x.userId === userId && !x.restoredAt).map(x => x.patientId))
  return {
    kind: 'nurse',
    patientIds: ROSTER.map(r => r.patientId).filter(id => !removed.has(id)),
    removedPatientIds: ROSTER.map(r => r.patientId).filter(id => removed.has(id)),
  }
}

/** mock remove — mirrors the server rules that matter offline: real
 *  patient, real nurse, no replay, and 🔴 NEVER ZERO NURSES. */
export function mockRemove(
  patientId: string, userId: string, reason: string | undefined,
  actor: string, actorRole: string, now: string,
): Removal | { error: string } {
  const r = ROSTER.find(x => x.patientId === patientId)
  if (!r) return { error: `patient '${patientId}' has no open encounter — carving a coverage exception is not permitted: new care cannot be initiated on a closed episode` }
  const nurse = MOCK_NURSES.find(n => n.userId === userId)
  if (!nurse) return { error: `userId '${userId}' does not match any user account — coverage references real accounts, never free text` }
  if (activeRemoval(patientId, userId))
    return { error: `'${nurse.name}' is already removed from this patient — there is nothing to remove` }
  const removedHere = new Set(
    REMOVALS.filter(x => x.patientId === patientId && !x.restoredAt).map(x => x.userId))
  const remaining = MOCK_NURSES.filter(n => n.userId !== userId && !removedHere.has(n.userId))
  if (remaining.length === 0)
    return { error: `'${nurse.name}' is the LAST nurse covering this patient — a patient must never have zero nurse coverage, so this removal is refused (restore another nurse first, or add nurse accounts)` }
  const row: Removal = {
    removalId: `RMV-${1000 + ++seq}`,
    encounterId: encOf(patientId),
    patientId, patientName: r.name, bedId: r.bedId,
    userId, userName: nurse.name, userTitle: nurse.jobTitle,
    removedAt: now, removedBy: actor, removedByRole: actorRole,
    reason: reason?.trim() || null,
    restoredAt: null, restoredBy: null, restoredByRole: null,
  }
  REMOVALS.push(row)
  return row
}

/** mock restore — restored, never deleted */
export function mockRestore(
  patientId: string, userId: string, actor: string, actorRole: string, now: string,
): Removal | { error: string } {
  const row = activeRemoval(patientId, userId)
  if (!row) return { error: `'${userId}' is not removed from this patient — they are already covering (the default); there is nothing to restore` }
  row.restoredAt = now
  row.restoredBy = actor
  row.restoredByRole = actorRole
  return row
}
