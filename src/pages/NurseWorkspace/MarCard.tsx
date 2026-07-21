import { useEffect, useRef, useState } from 'react'
import { Card } from '../../components/Card'
import { BedChip } from '../../components/Tag'
import {
  LATE_THRESHOLD_MINUTES, displayStamp, dueStateFor, localStamp, minutesPastStamp,
  stampDiffMinutes, useNow, wireStampOfLocal,
} from '../../lib/time'
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
  onDocument: (orderId: string, adminId: string, action: AdministrationAction, reason?: string, administeredAt?: string) => void
}

type ReasonAction = 'held' | 'refused' | 'given-late'

/* Held/Refused require a documented reason (validated server-side like a
   discontinue). Given is one click ON TIME; a dose more than
   LATE_THRESHOLD_MINUTES past its scheduled instant opens this prompt in
   'given-late' mode instead (the overdue-delay-reason safety fix,
   server-enforced): the SAME reason pattern held/refused already use,
   plus the actual administration time — auto-filled with the current
   wall-clock time, editable (the #145 editable-timestamp pattern),
   converted to the UTC wire on confirm. The dose is never blocked. */
function MarReasonDialog(
  { row, action, lateLabel, onCancel, onConfirm }:
  {
    row: MarRow; action: ReasonAction; lateLabel?: string
    onCancel: () => void; onConfirm: (reason: string, administeredAt?: string) => void
  },
) {
  const [reason, setReason] = useState('')
  const [givenAt, setGivenAt] = useState(() => localStamp(Date.now()))
  const taRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    taRef.current?.focus()
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onCancel])
  const title = action === 'held' ? 'Hold dose' : action === 'refused' ? 'Refuse dose' : 'Give overdue dose'
  return (
    <div className="marscrim" onClick={onCancel}>
      <div className="mardialog" role="dialog" aria-modal="true" aria-labelledby="marRTitle" onClick={e => e.stopPropagation()}>
        <h2 id="marRTitle">{title} · <span className="num">{row.medication} {row.dose}</span></h2>
        {action === 'given-late' && (
          <p className="marlatehint" role="note">
            Scheduled <span className="num">{displayStamp(row.scheduledTime)}</span> — {lateLabel} overdue.
            The dose can still be given; document why it is late.
          </p>
        )}
        <div className="field">
          <label htmlFor="marReason">{action === 'given-late' ? 'Reason for the delay (required)' : 'Reason (required)'}</label>
          <textarea
            ref={taRef} id="marReason" value={reason}
            placeholder={action === 'held' ? 'e.g. SBP 82 — holding per parameters…'
              : action === 'refused' ? 'e.g. Patient declined — nausea…'
              : 'e.g. Patient off the floor for CT — given on return…'}
            onChange={e => setReason(e.target.value)}
          />
        </div>
        {action === 'given-late' && (
          <div className="field">
            <label htmlFor="marGivenAt">Actual administration time (editable)</label>
            <input
              id="marGivenAt" className="num" value={givenAt}
              onChange={e => setGivenAt(e.target.value)}
            />
          </div>
        )}
        <div className="mardfoot">
          <button className="btn ghost" onClick={onCancel}>Cancel</button>
          <button className={`btn ${action === 'refused' ? 'danger' : 'primary'}`} disabled={!reason.trim()}
            onClick={() => onConfirm(reason.trim(),
              /* typed as WALL TIME on the display clock; the wire stays
                 UTC — a malformed shape passes through raw so the
                 server's validation message stays the messenger */
              action === 'given-late' ? (wireStampOfLocal(givenAt.trim()) ?? givenAt.trim()) : undefined)}>
            {action === 'held' ? '⊘ Hold dose' : action === 'refused' ? '✕ Refuse dose' : '✓ Give dose (late)'}
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
  const [pending, setPending] = useState<{ row: MarRow; action: ReasonAction } | null>(null)
  /* the delay-reason trigger — minutes a DATED scheduled instance is past
     its instant (PRN/on-demand rows have no schedule and are never late);
     mirrors the server's enforcement threshold exactly */
  const lateMinutes = (r: MarRow): number =>
    r.prn || r.scheduleNote ? 0 : (minutesPastStamp(r.scheduledTime, now) ?? 0)
  const lateLabelOf = (mins: number) => `${Math.floor(mins / 60)}h ${String(Math.floor(mins % 60)).padStart(2, '0')}m`
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
                      {/* ON TIME: one click. Past the late threshold the
                          SAME button opens the delay-reason prompt — the
                          dose is never blocked, the lateness gets a
                          documented reason (server-enforced) */}
                      <button className="mab given"
                        onClick={() => lateMinutes(r) > LATE_THRESHOLD_MINUTES
                          ? setPending({ row: r, action: 'given-late' })
                          : onDocument(r.orderId, r.adminId, 'given')}
                        aria-label={`${r.medication}: given`}>✓ Given</button>
                      <button className="mab held" onClick={() => setPending({ row: r, action: 'held' })} aria-label={`${r.medication}: held`}>⊘ Held</button>
                      <button className="mab refused" onClick={() => setPending({ row: r, action: 'refused' })} aria-label={`${r.medication}: refused`}>✕ Refused</button>
                    </div>
                  ) : (
                    <span className="mardoc num">
                      documented {displayStamp(r.documentedTime)}
                      {/* the record shows lateness out loud: a given fact
                          beyond the threshold wears LATE, and any
                          documented reason (delay / held / refused)
                          renders on the row */}
                      {r.status === 'given'
                        && (stampDiffMinutes(r.scheduledTime, r.documentedTime) ?? 0) > LATE_THRESHOLD_MINUTES
                        && <span className="marlate">LATE</span>}
                      {r.reason && <span className="marreason">— {r.reason}</span>}
                    </span>
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
          lateLabel={pending.action === 'given-late' ? lateLabelOf(lateMinutes(pending.row)) : undefined}
          onCancel={() => setPending(null)}
          onConfirm={(reason, administeredAt) => {
            onDocument(pending.row.orderId, pending.row.adminId,
              pending.action === 'given-late' ? 'given' : pending.action, reason, administeredAt)
            setPending(null)
          }}
        />
      )}
    </Card>
  )
}
