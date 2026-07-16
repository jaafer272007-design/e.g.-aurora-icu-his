import { useEffect, useRef, useState } from 'react'
import { Card } from '../../components/Card'
import { BedChip } from '../../components/Tag'
import { displayStamp, dueStateFor, useNow } from '../../lib/time'
import type { AdministrationAction, AssignedPatient, MarRow } from '../../lib/api/types'

const DOCUMENTED_META: Record<AdministrationAction, { label: string; cls: string }> = {
  given: { label: 'GIVEN', cls: 'st-given' },
  held: { label: 'HELD', cls: 'st-held' },
  refused: { label: 'REFUSED', cls: 'st-refused' },
}

const PENDING_META = {
  overdue: { label: 'OVERDUE', cls: 'st-overdue' },
  due: { label: 'DUE', cls: 'st-due' },
  upcoming: { label: 'LATER', cls: 'st-upcoming' },
  prn: { label: 'PRN', cls: 'st-prn' },
  /* an order whose frequency has no derivable dose grid (continuous,
     sliding scale, per protocol…) — the honest-source rule: the row says
     so instead of inventing a schedule; doses are documented on demand */
  ondemand: { label: 'ON DEMAND', cls: 'st-prn' },
}

/* the render-horizon summary: undocumented instances older than the
   window, counted out loud — never silently truncated */
const MISSED_META = { label: 'MISSED', cls: 'st-overdue' }

interface MarCardProps {
  rows: MarRow[]
  patients: AssignedPatient[]
  onDocument: (orderId: string, adminId: string, action: AdministrationAction, reason?: string) => void
}

/* Held/Refused require a documented reason (validated server-side like a
   discontinue). Given is one click; held/refused open this prompt. */
function MarReasonDialog(
  { row, action, onCancel, onConfirm }:
  { row: MarRow; action: 'held' | 'refused'; onCancel: () => void; onConfirm: (reason: string) => void },
) {
  const [reason, setReason] = useState('')
  const taRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    taRef.current?.focus()
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onCancel])
  return (
    <div className="marscrim" onClick={onCancel}>
      <div className="mardialog" role="dialog" aria-modal="true" aria-labelledby="marRTitle" onClick={e => e.stopPropagation()}>
        <h2 id="marRTitle">{action === 'held' ? 'Hold' : 'Refuse'} dose · <span className="num">{row.medication} {row.dose}</span></h2>
        <div className="field">
          <label htmlFor="marReason">Reason (required)</label>
          <textarea
            ref={taRef} id="marReason" value={reason}
            placeholder={action === 'held' ? 'e.g. SBP 82 — holding per parameters…' : 'e.g. Patient declined — nausea…'}
            onChange={e => setReason(e.target.value)}
          />
        </div>
        <div className="mardfoot">
          <button className="btn ghost" onClick={onCancel}>Cancel</button>
          <button className={`btn ${action === 'refused' ? 'danger' : 'primary'}`} disabled={!reason.trim()} onClick={() => onConfirm(reason.trim())}>
            {action === 'held' ? '⊘ Hold dose' : '✕ Refuse dose'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Medication Administration Record — a derived view over the canonical
 *  Order model (administrations of ACTIVE medication orders). Nurse RBAC:
 *  administer + document ONLY; every action is a documentation event on the
 *  order's audit history. Due states are computed against the clock. */
export function MarCard({ rows, patients, onDocument }: MarCardProps) {
  const now = useNow()
  const [pending, setPending] = useState<{ row: MarRow; action: 'held' | 'refused' } | null>(null)
  const stateOf = (r: MarRow) =>
    r.status === 'missed-earlier'
      ? MISSED_META
      : r.status !== 'scheduled'
        ? DOCUMENTED_META[r.status]
        : r.prn ? PENDING_META.prn
          : r.scheduleNote ? PENDING_META.ondemand
            : PENDING_META[dueStateFor(r.scheduledTime, now)]
  const dueCount = rows.filter(
    r => r.status === 'scheduled' && !r.prn && dueStateFor(r.scheduledTime, now) !== 'upcoming',
  ).length
  return (
    <Card
      icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="7" y="2" width="10" height="20" rx="4" /><path d="M7 9h10M7 15h10" /></svg>}
      title="Medication Administration Record"
      aside={`${dueCount} due · administer & document only`}
    >
      {patients.map(p => {
        const mine = rows.filter(r => r.patientId === p.patientId)
        if (!mine.length) return null
        return (
          <div className="margroup" key={p.patientId}>
            <div className="marpt"><BedChip bedId={p.bedId} /><b>{p.name}</b><span className="marallergy">⚠ {p.allergies}</span></div>
            {mine.map(r => {
              const meta = stateOf(r)
              if (r.status === 'missed-earlier')
                /* the horizon's explicit remainder — one non-actionable
                   line per order for the missed doses older than the
                   rendered window (they stay visible, aggregated) */
                return (
                  <div className={`marrow ${meta.cls}`} key={`${r.orderId}-${r.adminId}`}>
                    <span className="martime num">{displayStamp(r.scheduledTime)}</span>
                    <div className="marmed">
                      <div className="mn">{r.medication} <span className="mdose num">{r.dose}</span></div>
                      <div className="mroute">⚠ {r.missedEarlier} earlier expected dose{(r.missedEarlier ?? 0) > 1 ? 's' : ''} never documented (oldest shown) — not displayed individually</div>
                    </div>
                    <span className={`marstate ${meta.cls}`}>{meta.label}</span>
                  </div>
                )
              return (
                <div className={`marrow ${meta.cls}`} key={`${r.orderId}-${r.adminId}`}>
                  <span className="martime num">{displayStamp(r.scheduledTime) || '—'}</span>
                  <div className="marmed">
                    <div className="mn">{r.medication} <span className="mdose num">{r.dose}</span></div>
                    <div className="mroute">{r.scheduleNote ?? r.route}</div>
                  </div>
                  <span className={`marstate ${meta.cls}`}>{meta.label}</span>
                  {r.status === 'scheduled' ? (
                    <div className="maracts" role="group" aria-label={`Document ${r.medication} for ${p.name}`}>
                      <button className="mab given" onClick={() => onDocument(r.orderId, r.adminId, 'given')} aria-label={`${r.medication}: given`}>✓ Given</button>
                      <button className="mab held" onClick={() => setPending({ row: r, action: 'held' })} aria-label={`${r.medication}: held`}>⊘ Held</button>
                      <button className="mab refused" onClick={() => setPending({ row: r, action: 'refused' })} aria-label={`${r.medication}: refused`}>✕ Refused</button>
                    </div>
                  ) : (
                    <span className="mardoc num">documented {displayStamp(r.documentedTime)}</span>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
      {pending && (
        <MarReasonDialog
          row={pending.row}
          action={pending.action}
          onCancel={() => setPending(null)}
          onConfirm={reason => { onDocument(pending.row.orderId, pending.row.adminId, pending.action, reason); setPending(null) }}
        />
      )}
    </Card>
  )
}
