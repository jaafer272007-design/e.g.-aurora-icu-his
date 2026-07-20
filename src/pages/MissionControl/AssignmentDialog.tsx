import { useEffect, useState } from 'react'
import { removeNurse, restoreNurse } from '../../lib/api'
import type { CoverageRow } from '../../lib/api/types'
import { displayStamp } from '../../lib/time'

/* NURSE COVERAGE (Assignment Simplification — the opt-out model): every
 * nurse covers every patient BY DEFAULT; this dialog carves and restores
 * the EXCEPTIONS. Doctors have no assignment concept (every doctor
 * covers every patient — nothing to manage). EVERYONE with patients.view
 * sees coverage (basic clinical safety); removing/restoring is gated on
 * assignments.manage (SeniorDoctor — the recorded interim; the follow-up
 * is a SeniorNurse profile holding the same atom).
 * 🔴 Coverage is a WORKLIST, never an authority — with zero exceptions:
 * a removed nurse still charts, administers and responds here.
 * 🔴 The server refuses removing the LAST covering nurse — a patient
 * never has zero coverage (prevented, not warned). */
export function AssignmentDialog(
  { coverage, canManage, actor, jobTitle, onClose, onChanged }:
  {
    coverage: CoverageRow
    canManage: boolean
    actor: string
    jobTitle: import('../../lib/session').JobTitle
    onClose: () => void
    onChanged: () => void
  },
) {
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])

  const activeRemovals = coverage.removals.filter(r => !r.restoredAt)
  const restoredRemovals = coverage.removals.filter(r => !!r.restoredAt)

  async function confirmRemove(userId: string) {
    setError(null)
    setBusy(true)
    const res = await removeNurse(coverage.patientId, userId, reason.trim() || undefined, actor, jobTitle)
    setBusy(false)
    setRemovingId(null)
    setReason('')
    if (res.kind === 'ok') onChanged()
    else setError(res.error)
  }

  async function confirmRestore(userId: string) {
    setError(null)
    setBusy(true)
    const res = await restoreNurse(coverage.patientId, userId, actor, jobTitle)
    setBusy(false)
    if (res.kind === 'ok') onChanged()
    else setError(res.error)
  }

  return (
    <div className="idscrim" onClick={onClose}>
      <div className="iddialog ctdialog" role="dialog" aria-modal="true" aria-labelledby="ctTitle" onClick={e => e.stopPropagation()}>
        <h2 id="ctTitle">Nurse coverage · {coverage.patientName} <span className="num">{coverage.patientId}</span></h2>
        <p className="idnote">
          Every nurse covers every patient <b>by default</b> — you carve exceptions here (a 1:1
          elsewhere, a nurse off this room), and doctors need no list at all (every doctor covers
          every patient). Coverage is a worklist, <b>never an authority</b>: a removed nurse still
          charts, administers and responds on this patient in an emergency. The last covering
          nurse can never be removed — a patient always has coverage.
        </p>

        <div className="cthead">Covering nurses ({coverage.nurses.length})</div>
        <div className="ctlist">
          {coverage.nurses.map(n => (
            <div className="ctrow" key={n.userId}>
              <span className="ctkind nurse">RN</span>
              <span className="ctwho">{n.name}<small>{n.jobTitle}</small></span>
              <span className="ctshift">covering (default)</span>
              {canManage && removingId !== n.userId && (
                <button className="btn ghost ctend" onClick={() => { setRemovingId(n.userId); setReason('') }}
                  aria-label={`Remove ${n.name} from this patient's coverage`}>Remove</button>
              )}
              {canManage && removingId === n.userId && (
                <span className="ctendrow">
                  <input
                    value={reason} onChange={e => setReason(e.target.value)}
                    placeholder="reason (optional — e.g. 1:1 with another patient)" aria-label="Removal reason (optional)"
                  />
                  <button className="btn primary" disabled={busy} onClick={() => confirmRemove(n.userId)}>Confirm remove</button>
                  <button className="btn ghost" onClick={() => setRemovingId(null)}>Keep</button>
                </span>
              )}
            </div>
          ))}
        </div>

        {activeRemovals.length > 0 && (
          <>
            <div className="cthead">Removed from this patient ({activeRemovals.length})</div>
            <div className="ctlist">
              {activeRemovals.map(r => (
                <div className="ctrow off" key={r.removalId}>
                  <span className="ctkind nurse">RN</span>
                  <span className="ctwho">{r.userName}<small>{r.userTitle}</small></span>
                  <span className="ctsince num">
                    removed {displayStamp(r.removedAt)} · by {r.removedBy}
                    {r.reason ? ` — ${r.reason}` : ''}
                  </span>
                  {canManage && (
                    <button className="btn ghost ctend" disabled={busy} onClick={() => confirmRestore(r.userId)}
                      aria-label={`Restore ${r.userName} to this patient's coverage`}>Restore</button>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        <div className="idfoot">
          {!canManage && <span className="ctro">Carving coverage exceptions requires the Senior Doctor authority.</span>}
          <button type="button" className="btn ghost" onClick={onClose}>Close</button>
        </div>
        {error && <div className="iderr" role="alert">{error}</div>}

        {restoredRemovals.length > 0 && (
          <div className="idhist">
            <div className="idhttl">Removal history — restored, never deleted</div>
            {restoredRemovals.map(r => (
              <div className="idhrow" key={r.removalId}>
                <span className="num">{displayStamp(r.removedAt)} → {displayStamp(r.restoredAt!)}</span>
                <span className="idha">{r.userName}{r.reason ? ` — ${r.reason}` : ''}</span>
                <span className="idhd">
                  removed by {r.removedBy} · restored by {r.restoredBy}{r.restoredByRole ? ` (${r.restoredByRole})` : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
