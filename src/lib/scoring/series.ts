/* Historical score series — "the worst period" asked honestly (AI design
   §6/§7). The engine already computes a score AS OF any past moment
   (buildSofaContext/buildNews2Context take asOfMinutesAgo), so a series
   is just the canonical computation repeated at earlier window ends —
   NEVER an approximation, never interpolation, never a different rule.
   The peak is only ever chosen among COMPLETE points (a partial total is
   not a comparable severity — the ΔSOFA discipline), and the denominator
   states how many points could not be computed (P1: missing data is
   INCOMPLETE, never "low"). */

import type { LabDraw, Observation, Order } from '../api/types'
import { aggregate, type ScoreResult } from './engine'
import { SOFA_V1, SOFA_WINDOW_MINUTES, buildSofaContext } from './sofa'
import { NEWS2_V1, NEWS2_WINDOW_MINUTES, buildNews2Context } from './news2'
import { labMinutesAgo, obsMinutesAgo } from './sources'

export type SeriesInstrument = 'sofa' | 'news2'

export interface SeriesPoint {
  /** minutes before now the scoring window ENDS (0 = the current score) */
  endedMinutesAgo: number
  result: ScoreResult
}

export interface WorstPeriodSeries {
  instrument: SeriesInstrument
  /** newest first (endedMinutesAgo ascending) */
  points: SeriesPoint[]
  /** the highest COMPLETE total — null when no point is complete (the
   *  honest cannot-answer: nothing here may stand in for it) */
  peak: SeriesPoint | null
  completeCount: number
  incompleteCount: number
  /** how far back the charted data allowed the series to reach */
  spanHours: number
  /** hours between consecutive points */
  stepHours: number
}

const STEP_MINUTES = 6 * 60
/* series depth cap: 14 days of 6-hourly points (57 computations) — the
   full engine run stays instant, and an ICU admission's clinical span is
   covered; data older than the cap is stated as out of view, not scored */
const MAX_SPAN_MINUTES = 14 * 24 * 60

export interface SeriesInputs {
  labs: LabDraw[]
  observations: Observation[]
  orders: Order[]
  weightKg: number | null
  now: Date
}

/** the series reaches back to the OLDEST charted input (observation or
 *  lab), capped — beyond the data there is nothing to score */
function dataSpanMinutes(inputs: SeriesInputs): number {
  let oldest = 0
  for (const o of inputs.observations) {
    const m = obsMinutesAgo(o.clinicalTime, inputs.now)
    if (Number.isFinite(m) && m > oldest) oldest = m
  }
  for (const d of inputs.labs) {
    const m = labMinutesAgo(d.resultedAt || d.collectedAt || '', inputs.now)
    if (Number.isFinite(m) && m > oldest) oldest = m
  }
  return Math.min(oldest, MAX_SPAN_MINUTES)
}

/** compute the score at every window end from now back across the charted
 *  data — the same definition, mode and window the live cards use (SOFA:
 *  worst-in-24h; NEWS2: latest-in-window) */
export function buildWorstPeriodSeries(instrument: SeriesInstrument, inputs: SeriesInputs): WorstPeriodSeries {
  const span = dataSpanMinutes(inputs)
  const points: SeriesPoint[] = []
  for (let asOf = 0; asOf <= span; asOf += STEP_MINUTES) {
    const result = instrument === 'sofa'
      ? aggregate(SOFA_V1, buildSofaContext(
          { labs: inputs.labs, observations: inputs.observations, orders: inputs.orders, weightKg: inputs.weightKg, now: inputs.now },
          asOf, SOFA_WINDOW_MINUTES), 'worst')
      : aggregate(NEWS2_V1, buildNews2Context(
          { observations: inputs.observations, now: inputs.now },
          asOf, NEWS2_WINDOW_MINUTES), 'latest')
    points.push({ endedMinutesAgo: asOf, result })
  }
  const complete = points.filter(p => p.result.complete)
  /* the PEAK: highest complete total; ties resolve to the EARLIEST such
     period (the first time the patient was that sick) */
  let peak: SeriesPoint | null = null
  for (const p of complete)
    if (!peak || p.result.total > peak.result.total
      || (p.result.total === peak.result.total && p.endedMinutesAgo > peak.endedMinutesAgo)) peak = p
  return {
    instrument,
    points,
    peak,
    completeCount: complete.length,
    incompleteCount: points.length - complete.length,
    spanHours: Math.round(span / 60),
    stepHours: STEP_MINUTES / 60,
  }
}
