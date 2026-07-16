import type { Assignment, CreateAssignmentDraft } from '../types'
import { ROSTER } from './roster'

/* Patient Assignment & Responsibility — MOCK STORE (offline demo parity).
   Mirrors server/Core/Assignments + the Seeder's demo assignments: RN
   Maya Chen on P-1001/P-1004 and Dr. Rahman's six-patient panel (the
   same patients the retired NURSE_ASSIGNMENT / ROUNDING_LIST fixtures
   claimed — now honest rows a signed-in user matches or doesn't).
   Seed rows carry empty audit stamps (historical data — the ADT
   convention: facts are never invented). */

const seedRow = (
  n: number, patientId: string, userId: string, userName: string,
  userTitle: string, kind: Assignment['kind'],
): Assignment => {
  const r = ROSTER.find(x => x.patientId === patientId)!
  return {
    assignmentId: `ASG-${1000 + n}`,
    encounterId: `ENC-${patientId.slice(patientId.indexOf('-') + 1)}`,
    patientId, patientName: r.name, bedId: r.bedId,
    userId, userName, userTitle,
    kind, role: 'primary', shift: 'day',
    assignedAt: '', assignedBy: '', assignedByRole: '',
    endedAt: null, endedBy: null, endedByRole: null, endReason: null,
  }
}

export const ASSIGNMENTS: Assignment[] = [
  seedRow(1, 'P-1001', 'maya.chen', 'RN Maya Chen', 'Staff Nurse', 'nurse'),
  seedRow(2, 'P-1004', 'maya.chen', 'RN Maya Chen', 'Staff Nurse', 'nurse'),
  seedRow(3, 'P-1001', 'sara.rahman', 'Dr. Sara Rahman', 'Consultant', 'doctor'),
  seedRow(4, 'P-1004', 'sara.rahman', 'Dr. Sara Rahman', 'Consultant', 'doctor'),
  seedRow(5, 'P-1007', 'sara.rahman', 'Dr. Sara Rahman', 'Consultant', 'doctor'),
  seedRow(6, 'P-1008', 'sara.rahman', 'Dr. Sara Rahman', 'Consultant', 'doctor'),
  seedRow(7, 'P-1012', 'sara.rahman', 'Dr. Sara Rahman', 'Consultant', 'doctor'),
  seedRow(8, 'P-1013', 'sara.rahman', 'Dr. Sara Rahman', 'Consultant', 'doctor'),
]

let seq = ASSIGNMENTS.length

/** mock create — mirrors the server's rules that matter offline: the
 *  patient must be on the roster (mock stand-in for the open-encounter
 *  chokepoint) and the SAME user+kind may not be actively duplicated;
 *  a SECOND nurse is never a conflict (locked decision 1). */
export function insertAssignment(
  draft: CreateAssignmentDraft, userName: string, userTitle: string,
  actor: string, actorRole: string, now: string,
): Assignment | { error: string } {
  const r = ROSTER.find(x => x.patientId === draft.patientId)
  if (!r) return { error: `patient '${draft.patientId}' has no open encounter — assigning responsibility is not permitted: new care cannot be initiated on a closed episode` }
  const dup = ASSIGNMENTS.find(a =>
    a.patientId === draft.patientId && a.userId === draft.userId && a.kind === draft.kind && !a.endedAt)
  if (dup) return { error: `'${userName}' is already actively assigned as ${dup.role} ${dup.kind} (${dup.assignmentId}) — end that assignment first (handover), or assign a different clinician` }
  const row: Assignment = {
    assignmentId: `ASG-${1000 + ++seq}`,
    encounterId: `ENC-${draft.patientId.slice(draft.patientId.indexOf('-') + 1)}`,
    patientId: draft.patientId, patientName: r.name, bedId: r.bedId,
    userId: draft.userId, userName, userTitle,
    kind: draft.kind, role: draft.role, shift: draft.shift,
    assignedAt: now, assignedBy: actor, assignedByRole: actorRole,
    endedAt: null, endedBy: null, endedByRole: null, endReason: null,
  }
  ASSIGNMENTS.push(row)
  return row
}

/** mock end — ended, never deleted */
export function applyAssignmentEnd(
  assignmentId: string, actor: string, actorRole: string, reason: string | undefined, now: string,
): Assignment | { error: string } {
  const row = ASSIGNMENTS.find(a => a.assignmentId === assignmentId)
  if (!row) return { error: 'Not found' }
  if (row.endedAt) return { error: `assignment '${assignmentId}' already ended by ${row.endedBy} at ${row.endedAt} — there is nothing to end` }
  row.endedAt = now
  row.endedBy = actor
  row.endedByRole = actorRole
  row.endReason = reason?.trim() || null
  return row
}
