import { Card } from '../../components/Card'
import { Badge } from '../../components/Badge'
import { agoLabel, useNow } from '../../lib/time'
import { canAcknowledgeResults, type SessionRole } from '../../lib/session'
import type { ResultInboxItem } from '../../lib/api/types'

interface ResultInboxCardProps {
  /** unacknowledged results scoped to the selected patient */
  items: ResultInboxItem[]
  role: SessionRole
  onAcknowledge: (item: ResultInboxItem) => void
}

/** Unacknowledged results for this patient — the same store that feeds
 *  Doctor Workspace's "Results to Acknowledge". Doctor RBAC to acknowledge. */
export function ResultInboxCard({ items, role, onAcknowledge }: ResultInboxCardProps) {
  const now = useNow()
  const canAck = canAcknowledgeResults(role)
  return (
    <Card
      icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.5 5.1L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.5-6.9A2 2 0 0016.7 4H7.3a2 2 0 00-1.8 1.1z" /></svg>}
      title="Unacknowledged Results"
      aside={canAck ? 'doctor sign-off required' : 'view only (nurse)'}
    >
      {items.length === 0 && <div className="liempty">All results acknowledged for this patient.</div>}
      {items.map(item => (
        <div className={`liinrow${item.flag === 'critical' ? ' crit' : ''}`} key={item.id}>
          <Badge color={item.flag === 'critical' ? 'red' : item.flag === 'abnormal' ? 'amber' : 'green'}>
            {item.kind === 'lab' ? 'LAB' : 'IMAGING'}
          </Badge>
          <div className="liintext">
            <b>{item.title}</b>
            <span>{item.detail}</span>
            <small className="num">{item.time} · {agoLabel(item.time, now)} · {item.flag.toUpperCase()}</small>
          </div>
          {canAck ? (
            <button className="liackbtn" onClick={() => onAcknowledge(item)} aria-label={`Acknowledge: ${item.title}`}>✓ Ack</button>
          ) : (
            <span className="liviewonly">view only</span>
          )}
        </div>
      ))}
    </Card>
  )
}
