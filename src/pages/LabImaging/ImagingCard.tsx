import { useState } from 'react'
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
}

/** Imaging study list with report/impression text and status progression.
 *  Acknowledge is doctor RBAC — nurses view only. */
export function ImagingCard({ studies, canAcknowledge: canAck, onAcknowledge }: ImagingCardProps) {
  const now = useNow()
  const [open, setOpen] = useState<Set<string>>(new Set())

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
                    <span className="liacked">✓ Acknowledged by {s.acknowledgedBy} · {s.acknowledgedAt}</span>
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
    </Card>
  )
}
