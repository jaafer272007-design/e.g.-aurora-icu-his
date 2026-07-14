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
import { NEWS2_V1, NEWS2_WINDOW_MINUTES, buildNews2Context, news2Band, type News2Band } from './news2'

export type { ScoreResult, ScoredComponent, ScoreMode, Contributor } from './engine'
export { SOFA_V1, SOFA_WINDOW_MINUTES } from './sofa'
export { NEWS2_V1, NEWS2_WINDOW_MINUTES, news2Band } from './news2'
export type { News2Band, News2BandKey } from './news2'

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

/* ================= NEWS2 (standard) v1 — the second score ================= */

export interface News2Inputs {
  observations: Observation[]
  now: Date
}

export interface News2Computation {
  result: ScoreResult
  /** the escalation band + colour (display only, D6). null when INCOMPLETE
   *  (no band on a score that could not be computed) */
  band: News2Band | null
  /** the single-parameter-3 escalation trigger (§6) — a component scored 3 */
  anyParamIs3: boolean
  /** D2 — the patient is on respiratory support, so standard NEWS2 has
   *  known limitations under mechanical ventilation (surfaced in the UI,
   *  never silently adjusted) */
  ventilated: boolean
}

/** compute standard NEWS2 v1 for a patient from the real observations. All
 *  7 parameters required; any missing → INCOMPLETE (no band). */
export function computeNews2(inputs: News2Inputs): News2Computation {
  const ctx = buildNews2Context({ observations: inputs.observations, now: inputs.now }, 0, NEWS2_WINDOW_MINUTES)
  const result = aggregate(NEWS2_V1, ctx, 'latest')
  const anyParamIs3 = result.components.some(c => c.score === 3)
  const band = result.complete ? news2Band(result.total, anyParamIs3) : null
  return { result, band, anyParamIs3, ventilated: ctx.ventilated }
}
