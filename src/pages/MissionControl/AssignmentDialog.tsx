import { useEffect, useMemo, useState } from 'react'
import { createAssignment, endAssignment, getAssignableStaff } from '../../lib/api'
import type {
  AssignableStaff, Assignment, AssignmentKind, AssignmentRole, AssignmentShift,
} from '../../lib/api/types'
import { displayStamp } from '../../lib/time'

/* CARE TEAM (Patient Assignment & Responsibility) — who is responsible
 * for this patient right now. EVERYONE with patients.view sees the list
 * (basic clinical safety); assigning/ending is gated on
 * assignments.manage (SeniorDoctor — the recorded interim; the follow-up
 * is a SeniorNurse profile holding the same atom). Assignment is a
 * WORKLIST, never an authority: nothing here gates administration.
 * Many-to-many by design — a second nurse is never blocked; two active
 * primaries render plainly (normal for ten minutes at handover, a
 * data-quality signal at six hours) instead of being refused. Ended
 * assignments stay visible forever (ended, never deleted). */
export function AssignmentDialog(
  { patientId, patientName, assignments, canManage, actor, jobTitle, onClose, onChanged }:
  {
    patientId: string
    patientName: string
    assignments: Assignment[]
    canManage: boolean
    actor: string
    jobTitle: import('../../lib/session').JobTitle
    onClose: () => void
    onChanged: () => void
  },
) {
  const [staff, setStaff] = useState<AssignableStaff[] | null>(null)
  const [kind, setKind] = useState<AssignmentKind>('nurse')
  const [userId, setUserId] = useState('')
  const [role, setRole] = useState<AssignmentRole>('primary')
  const [shift, setShift] = useState<AssignmentShift>('day')
  const [endingId, setEndingId] = useState<string | null>(null)
  const [endReason, setEndReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (canManage) getAssignableStaff().then(setStaff).catch(() => setStaff([]))
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [canManage, onClose])

  const active = assignments.filter(a => !a.endedAt)
  const ended = assignments.filter(a => !!a.endedAt)
  const options = useMemo(
    () => (staff ?? []).filter(s => s.kinds.includes(kind)),
    [staff, kind],
  )
  /* two active primaries of one kind — permitted and rendered plainly
     (the flagged recommendation: never block, make it visible) */
  const doublePrimary = (['nurse', 'doctor'] as const).filter(k =>
    active.filter(a => a.kind === k && a.role === 'primary').length > 1)

  async function assign(e: React.FormEvent) {
    e.preventDefault()
    if (!userId) return
    setError(null)
    setBusy(true)
    const res = await createAssignment({ patientId, userId, kind, role, shift }, actor, jobTitle)
    setBusy(false)
    if (res.kind === 'ok') { setUserId(''); onChanged() }
    else setError(res.error)
  }

  async function confirmEnd(assignmentId: string) {
    setError(null)
    setBusy(true)
    const res = await endAssignment(assignmentId, endReason.trim() || undefined, actor, jobTitle)
    setBusy(false)
    setEndingId(null)
    setEndReason('')
    if (res.kind === 'ok') onChanged()
    else setError(res.error)
  }

  const kindTag = (k: AssignmentKind) => (k === 'nurse' ? 'RN' : 'Dr')

  return (
    <div className="idscrim" onClick={onClose}>
      <div className="iddialog ctdialog" role="dialog" aria-modal="true" aria-labelledby="ctTitle" onClick={e => e.stopPropagation()}>
        <h2 id="ctTitle">Care team · {patientName} <span className="num">{patientId}</span></h2>
        <p className="idnote">
          Responsibility follows the <b>patient</b>, never the bed — a transfer changes nothing here.
          Assignment is a worklist, not an authority: in an emergency any nurse may administer and
          document regardless of this list.
        </p>

        <div className="cthead">Active assignments</div>
        {active.length === 0 && (
          <div className="ctempty" role="alert">
            UNASSIGNED — no active {['nurse', 'doctor'].filter(k => !active.some(a => a.kind === k)).join(' or ')}.
            This patient is on nobody's worklist until someone is assigned.
          </div>
        )}
        {active.length > 0 && (
          <div className="ctlist">
            {active.map(a => (
              <div className="ctrow" key={a.assignmentId}>
                <span className={`ctkind ${a.kind}`}>{kindTag(a.kind)}</span>
                <span className="ctwho">{a.userName}<small>{a.userTitle}</small></span>
                <span className={`ctrole ${a.role}`}>{a.role}</span>
                <span className="ctshift">{a.shift} shift</span>
                <span className="ctsince num">
                  {a.assignedAt ? `since ${displayStamp(a.assignedAt)}` : 'seeded'}
                  {a.assignedBy ? ` · by ${a.assignedBy}` : ''}
                </span>
                {canManage && endingId !== a.assignmentId && (
                  <button className="btn ghost ctend" onClick={() => { setEndingId(a.assignmentId); setEndReason('') }}
                    aria-label={`End assignment of ${a.userName}`}>End</button>
                )}
                {canManage && endingId === a.assignmentId && (
                  <span className="ctendrow">
                    <input
                      value={endReason} onChange={e => setEndReason(e.target.value)}
                      placeholder="reason (optional — e.g. handover)" aria-label="End reason (optional)"
                    />
                    <button className="btn primary" disabled={busy} onClick={() => confirmEnd(a.assignmentId)}>Confirm end</button>
                    <button className="btn ghost" onClick={() => setEndingId(null)}>Keep</button>
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
        {doublePrimary.length > 0 && (
          <div className="ctdouble">
            {doublePrimary.map(k => (
              <span key={k}>Two active primary {k}s — normal briefly at handover; end one when the handover completes.</span>
            ))}
          </div>
        )}

        {canManage && (
          <form onSubmit={assign} className="ctform">
            <div className="cthead">Assign responsibility</div>
            <div className="ctgrid">
              <label>Kind
                <select value={kind} onChange={e => { setKind(e.target.value as AssignmentKind); setUserId('') }}>
                  <option value="nurse">Nurse</option>
                  <option value="doctor">Doctor</option>
                </select>
              </label>
              <label>Clinician <i>real accounts only</i>
                <select value={userId} onChange={e => setUserId(e.target.value)}>
                  <option value="">{staff ? 'Select…' : 'Loading…'}</option>
                  {options.map(s => <option key={s.userId} value={s.userId}>{s.name} · {s.jobTitle}</option>)}
                </select>
              </label>
              <label>Role
                <select value={role} onChange={e => setRole(e.target.value as AssignmentRole)}>
                  <option value="primary">Primary</option>
                  <option value="secondary">Secondary</option>
                </select>
              </label>
              <label>Shift <i>label, chosen by you</i>
                <select value={shift} onChange={e => setShift(e.target.value as AssignmentShift)}>
                  <option value="day">Day (07–19)</option>
                  <option value="night">Night (19–07)</option>
                </select>
              </label>
            </div>
            <div className="idfoot">
              <button type="button" className="btn ghost" onClick={onClose}>Close</button>
              <button type="submit" className="btn primary" disabled={busy || !userId}>
                {busy ? 'Assigning…' : '+ Assign'}
              </button>
            </div>
          </form>
        )}
        {!canManage && (
          <div className="idfoot">
            <span className="ctro">Managing assignments requires the Senior Doctor authority.</span>
            <button type="button" className="btn ghost" onClick={onClose}>Close</button>
          </div>
        )}
        {error && <div className="iderr" role="alert">{error}</div>}

        {ended.length > 0 && (
          <div className="idhist">
            <div className="idhttl">Assignment history — ended, never deleted</div>
            {ended.map(a => (
              <div className="idhrow" key={a.assignmentId}>
                <span className="num">{a.assignedAt ? displayStamp(a.assignedAt) : '—'} → {displayStamp(a.endedAt!)}</span>
                <span className="idha">{a.userName} · {a.role} {a.kind} · {a.shift}</span>
                <span className="idhd">
                  ended by {a.endedBy}{a.endedByRole ? ` (${a.endedByRole})` : ''}
                  {a.endReason ? ` — ${a.endReason}` : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
