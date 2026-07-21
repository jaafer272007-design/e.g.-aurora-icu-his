import './SeverityDot.css'
import type { Severity } from '../lib/api/types'

const SEV_LABEL: Record<Severity, string> = {
  crit: 'Critical', high: 'High', stable: 'Stable', unscored: 'Not scored',
}

/** Severity indicator dot — DERIVED from the real scores (scoring/display.ts
 *  deriveSeverity), pulses on critical. 'unscored' is the neutral grey for a
 *  patient with no computable score: green is EARNED from a real score on
 *  real data, or it does not appear (the no-reassuring-default rule).
 *  Color is never the sole signal: an accessible text label is provided. */
export function SeverityDot({ sev }: { sev: Severity }) {
  return (
    <span
      className={`sevdot sd-${sev}`}
      role="img"
      aria-label={`Severity: ${SEV_LABEL[sev]}`}
      title={sev === 'unscored' ? 'Not scored — no computable NEWS2/SOFA data' : `Severity: ${SEV_LABEL[sev]} (score-derived)`}
    />
  )
}
