import { useEffect, useRef, useState } from 'react'
import { Card } from '../../components/Card'
import { Badge, type BadgeColor } from '../../components/Badge'
import { agoLabel, useNow } from '../../lib/time'
import type { ImagingStatus, ImagingStudy, ResultFlag } from '../../lib/api/types'

const STATUS_STEPS: ImagingStatus[] = ['ordered', 'in-progress', 'preliminary', 'final']
const STATUS_LABEL: Record<ImagingStatus, string> = {
  ordered: 'Ordered', 'in-progress': 'In progress', preliminary: 'Preliminary', final: 'Final',
}

const FLAG_BADGE: Record<ResultFlag, { color: BadgeColor; label: string }> = {
  normal: { color: 'green', label: 'NORMAL' },
  abnormal: { color: 'amber', label: 'ABNORMAL' },
  critical: { color: 'red', label: 'CRITICAL' },
}

interface ImagingCardProps {
  studies: ImagingStudy[]
  /** derived from the session's permissions (results.acknowledge) */
  canAcknowledge: boolean
  onAcknowledge: (studyId: string) => void
  /** reverse an acknowledgment — requires a documented reason (results
   *  audit PR); same permission as acknowledge */
  onUnacknowledge: (studyId: string, reason: string) => void
}

/* Reversing an acknowledgment requires a documented reason (validated
   server-side like discontinue); the original acknowledgment is preserved
   in the result's audit history — never deleted. */
function UnackReasonDialog(
  { study, onCancel, onConfirm }:
  { study: ImagingStudy; onCancel: () => void; onConfirm: (reason: string) => void },
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
    <div className="liscrim" onClick={onCancel}>
      <div className="lidialog" role="dialog" aria-modal="true" aria-labelledby="liUnackTitle" onClick={e => e.stopPropagation()}>
        <h2 id="liUnackTitle">Reverse acknowledgment · <span className="num">{study.description}</span></h2>
        <p className="lidnote">
          The original acknowledgment ({study.acknowledgedBy} · {study.acknowledgedAt}) is preserved in the
          audit history; the study returns to the results inbox.
        </p>
        <div className="field">
          <label htmlFor="liUnackReason">Reason (required)</label>
          <textarea
            ref={taRef} id="liUnackReason" value={reason}
            placeholder="e.g. Acknowledged in error — addendum pending review…"
            onChange={e => setReason(e.target.value)}
          />
        </div>
        <div className="lidfoot">
          <button className="btn ghost" onClick={onCancel}>Cancel</button>
          <button className="btn danger" disabled={!reason.trim()} onClick={() => onConfirm(reason.trim())}>
            ↩ Reverse acknowledgment
          </button>
        </div>
      </div>
    </div>
  )
}

/** Imaging study list with report/impression text and status progression.
 *  Acknowledge is doctor RBAC — nurses view only. */
export function ImagingCard({ studies, canAcknowledge: canAck, onAcknowledge, onUnacknowledge }: ImagingCardProps) {
  const now = useNow()
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [unackTarget, setUnackTarget] = useState<ImagingStudy | null>(null)

  const toggle = (id: string) =>
    setOpen(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <Card
      icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--violet)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="11" r="2.2" /><path d="M21 15l-4.5-4.5L9 18" /></svg>}
      title="Imaging Studies"
      aside={`${studies.length} studies · report + impression`}
    >
      {studies.length === 0 && <div className="liempty">No imaging studies for this patient yet.</div>}
      {studies.map(s => {
        const stepIdx = STATUS_STEPS.indexOf(s.status)
        const reported = s.status === 'preliminary' || s.status === 'final'
        const isOpen = open.has(s.studyId)
        return (
          <div className={`listudy${s.flag === 'critical' ? ' crit' : ''}`} key={s.studyId}>
            <div className="lisr1">
              <span className="limod">{s.modality}</span>
              <b className="lidesc">{s.description}</b>
              {reported && <Badge color={FLAG_BADGE[s.flag].color}>{FLAG_BADGE[s.flag].label}</Badge>}
            </div>
            <div className="listeps" aria-label={`Status: ${STATUS_LABEL[s.status]}`}>
              {STATUS_STEPS.map((st, i) => (
                <span key={st} className={`listep${i < stepIdx ? ' done' : ''}${i === stepIdx ? ' cur' : ''}`}>
                  {STATUS_LABEL[st]}
                </span>
              ))}
            </div>
            <div className="lismeta num">
              ordered {s.orderedAt}
              {s.performedAt && <> · performed {s.performedAt}</>}
              {s.reportedAt && <> · reported {s.reportedAt} ({agoLabel(s.reportedAt, now)})</>}
            </div>
            {reported ? (
              <>
                <button className="lisexp" aria-expanded={isOpen} onClick={() => toggle(s.studyId)}>
                  {isOpen ? 'Hide report ▴' : 'View report ▾'}
                </button>
                {isOpen && (
                  <div className="lisreport">
                    <div className="lisrsec"><span>Findings</span><p>{s.report}</p></div>
                    <div className="lisrsec"><span>Impression</span><p className={s.flag === 'critical' ? 'critimp' : ''}>{s.impression}</p></div>
                  </div>
                )}
                <div className="lisack">
                  {s.acknowledged ? (
                    <>
                      <span className="liacked">✓ Acknowledged by {s.acknowledgedBy} · {s.acknowledgedAt}</span>
                      {canAck && (
                        <button
                          className="liunackbtn"
                          onClick={() => setUnackTarget(s)}
                          aria-label={`Reverse acknowledgment of ${s.description}`}
                        >
                          ↩ Reverse
                        </button>
                      )}
                    </>
                  ) : canAck ? (
                    <button className="liackbtn" onClick={() => onAcknowledge(s.studyId)} aria-label={`Acknowledge ${s.description}`}>
                      ✓ Acknowledge
                    </button>
                  ) : (
                    <span className="liviewonly">View only — acknowledgement requires physician role</span>
                  )}
                </div>
              </>
            ) : (
              <div className="lispending">Report pending — {STATUS_LABEL[s.status].toLowerCase()}</div>
            )}
          </div>
        )
      })}
      {unackTarget && (
        <UnackReasonDialog
          study={unackTarget}
          onCancel={() => setUnackTarget(null)}
          onConfirm={reason => { onUnacknowledge(unackTarget.studyId, reason); setUnackTarget(null) }}
        />
      )}
    </Card>
  )
}
