import './SeverityDot.css'
import type { Severity } from '../lib/api/types'

const SEV_LABEL: Record<Severity, string> = { crit: 'Critical', high: 'High', stable: 'Stable' }

/** Severity indicator dot — pulses on critical. Color is never the sole signal:
 *  an accessible text label is provided for screen readers. */
export function SeverityDot({ sev }: { sev: Severity }) {
  return (
    <span className={`sevdot sd-${sev}`} role="img" aria-label={`Severity: ${SEV_LABEL[sev]}`} />
  )
}
