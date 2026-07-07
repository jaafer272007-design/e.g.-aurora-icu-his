import './AlertRow.css'
import type { AlertSeverity } from '../lib/api/types'

const SEV_META: Record<AlertSeverity, string> = {
  crit: '🔴 Critical',
  high: '🟠 High',
  med: '🟡 Medium',
  info: '🔵 Information',
}

interface AlertRowProps {
  severity: AlertSeverity
  text: string
  time: string
  /** full: Mission Control smart alert with ✓ acknowledge · compact: right-panel high-priority row */
  variant?: 'full' | 'compact'
  leaving?: boolean
  onAck?: () => void
}

/** Alert list row — severity dot + message + timestamp, severity always paired with text. */
export function AlertRow({ severity, text, time, variant = 'full', leaving, onAck }: AlertRowProps) {
  if (variant === 'compact') {
    return (
      <div className={`hal ${severity}`}>
        <span className="dot" />
        <div className="ht">
          {text}
          <small>{time} · {severity === 'crit' ? 'Critical' : 'High'}</small>
        </div>
      </div>
    )
  }
  return (
    <div className={`al${severity === 'crit' ? ' s-critB' : ''}${leaving ? ' gone' : ''}`}>
      <span className={`dot s-${severity}`} />
      <div className="at">
        {text}
        <small>{time} · {SEV_META[severity]}</small>
      </div>
      {onAck && <button className="ack" title="Acknowledge" aria-label={`Acknowledge alert: ${text}`} onClick={onAck}>✓</button>}
    </div>
  )
}
