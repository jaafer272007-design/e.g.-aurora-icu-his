import type { RiskPrediction, RiskTrend } from './types'

/* Pure, data-free domain logic that SCREENS consume via the service layer.
   Extracted from the mock data modules (§11 step 3): these helpers are
   real vocabulary/derivation rules — not demo data — and importing them
   THROUGH data/ai.ts / data/nursing.ts dragged the demo stores into the
   production bundle (bundle-inspection finding). Living here they are
   part of the real graph in every environment; the mock modules import
   them back, so there is still exactly one definition. */

/** AI risks at/above this probability surface in the alert center. */
export const AI_ALERT_THRESHOLD = 65

/** trend from a risk's history — computed at render, never stored (locked rule) */
export function riskTrendOf(history: number[]): RiskTrend {
  const delta = history[history.length - 1] - history[0]
  return delta >= 4 ? 'rising' : delta <= -4 ? 'falling' : 'stable'
}

/** elevated = high now, or moderate and climbing — gates suggestions & ranking chips */
export const isElevated = (r: RiskPrediction): boolean =>
  r.probability >= 60 || (r.probability >= 45 && riskTrendOf(r.history) === 'rising')

/* I&O category vocabulary (becomes master data at Layer 4) */
export const IO_CATEGORIES: Record<'intake' | 'output', string[]> = {
  intake: ['IV fluids', 'PO fluids', 'Medication infusions', 'Enteral feed', 'Blood products'],
  output: ['Urine', 'CRRT net removal', 'Drain', 'NG aspirate', 'Emesis', 'Stool'],
}
