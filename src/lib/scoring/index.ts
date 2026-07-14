/* Clinical Scoring Engine — public API. SOFA v1 is the first score; the
   engine (engine.ts) is generic so qSOFA / APACHE II / NEWS2 follow as
   more definitions. Everything is computed at render from the canonical
   reads, never stored (P5). Consumers: the Mission Control SOFA card.

   DECISION-SUPPORT: a computed SOFA is decision-support and REQUIRES
   clinical validation before it informs care (P7 / spec §2.8). The UI
   must surface it as such — never as an authoritative vital. */

import type { LabDraw, Observation, Order } from '../api/types'
import { aggregate, type ScoreResult } from './engine'
import { SOFA_V1, SOFA_WINDOW_MINUTES, buildSofaContext, type SofaContext } from './sofa'

export type { ScoreResult, ScoredComponent, ScoreMode, Contributor } from './engine'
export { SOFA_V1, SOFA_WINDOW_MINUTES } from './sofa'

export interface SofaInputs {
  labs: LabDraw[]
  observations: Observation[]
  orders: Order[]
  weightKg: number | null
  /** the render clock; injected so the computation is pure/testable */
  now: Date
}

/** one point on the ΔSOFA trend — the primary (worst-in-24h) total at an
 *  earlier window, with its completeness so a partial point is honest */
export interface SofaTrendPoint {
  /** hours before now the 24h window ENDS (0 = now, 24 = the day before…) */
  endedHoursAgo: number
  label: string
  result: ScoreResult
}

export interface SofaComputation {
  /** primary view — worst value of each input in the last 24h (spec §2.3) */
  worst: ScoreResult
  /** secondary view — the current-latest value of each input */
  latest: ScoreResult
  /** the weight the cardiovascular per-kg doses are inherently relative to
   *  (µg/kg/min needs no division; surfaced for context / honesty) */
  weightKg: number | null
  /** ΔSOFA trend of the primary total over prior 24h windows (P4); only
   *  points whose window carries data appear as computable */
  trend: SofaTrendPoint[]
  /** ΔSOFA between the two most-recent COMPLETE trend points, or null when
   *  fewer than two complete points exist (never a fabricated delta) */
  deltaFromPrevious: number | null
}

function contextAt(inputs: SofaInputs, asOfMinutesAgo: number): SofaContext {
  return buildSofaContext(
    { labs: inputs.labs, observations: inputs.observations, orders: inputs.orders, weightKg: inputs.weightKg, now: inputs.now },
    asOfMinutesAgo,
    SOFA_WINDOW_MINUTES,
  )
}

/** compute classic SOFA v1 for a patient from the canonical reads */
export function computeSofa(inputs: SofaInputs): SofaComputation {
  const nowCtx = contextAt(inputs, 0)
  const worst = aggregate(SOFA_V1, nowCtx, 'worst')
  const latest = aggregate(SOFA_V1, nowCtx, 'latest')

  // trend: the primary (worst-in-24h) total at a few prior daily windows
  const offsets = [0, 24, 48] // hours ago the window ends
  const trend: SofaTrendPoint[] = offsets.map(h => ({
    endedHoursAgo: h,
    label: h === 0 ? 'now' : `${h} h ago`,
    result: aggregate(SOFA_V1, contextAt(inputs, h * 60), 'worst'),
  }))

  // ΔSOFA only between two COMPLETE points (a partial total isn't a
  // comparable severity — never a fabricated delta)
  const complete = trend.filter(p => p.result.complete)
  const deltaFromPrevious = complete.length >= 2 ? complete[0].result.total - complete[1].result.total : null

  return { worst, latest, weightKg: inputs.weightKg, trend, deltaFromPrevious }
}
