/* Score-DERIVED display status — the ONE bridge from the Clinical Scoring
   Engine to every glanceable status surface: the bed-board severity dot,
   the nurse / doctor worklist card accents, the Mission Control
   observation tiles and the Patient Digital Twin.

   🔴 THE RULE (binding — recorded in 01_ARCHITECTURE.md): no clinical
   status surface may default an un-evaluated patient to a reassuring /
   green colour. Green is EARNED by a real score computed from real data —
   or it does not appear. A patient with no score data shows a neutral
   "not assessed" state on every surface. Every reassuring default is
   retired with this module's arrival: the roster `?? "stable"` severity,
   the all-"ok" organ constant, and the static severity/organ fixtures —
   the same class as the fabricated risk score deleted at the project's
   start and the fabricated EWS tile retired with NEWS2: a reassuring
   display not backed by real data, in the most glanceable places.

   THE SCORE-LOCK: these helpers READ the locked score definitions
   (news2.ts / sofa.ts) and define NO thresholds of their own — a display
   tier here is a pure restatement of an engine-computed score or band.
   No separate editable range exists behind any of these colours. */
import type { News2Computation, SofaComputation } from './index'

/** patient-level acuity derived from the WORST of {NEWS2 band, SOFA
 *  per-system scores}. 'unscored' is the honest neutral when no real
 *  verdict exists. Asymmetry by design: any real evidence of danger
 *  surfaces even from PARTIAL data (over-flagging is the safe error),
 *  but 'stable' (green) is EARNED only by a COMPLETE instrument —
 *  partial data can refuse reassurance, never grant it. */
export type DerivedSeverity = 'crit' | 'high' | 'stable' | 'unscored'

export function deriveSeverity(
  news2: News2Computation | null,
  sofa: SofaComputation | null,
): DerivedSeverity {
  /* the band exists ONLY on a complete NEWS2 (computeNews2 gates it);
     SOFA contributes its computed sub-scores (worst-24h primary view) —
     null sub-scores are P1 insufficient-data and contribute nothing */
  const band = news2?.band?.key ?? null
  const sofaScores = (sofa?.worst.components ?? [])
    .map(c => c.score)
    .filter((s): s is number => s !== null)

  if (band === 'high' || sofaScores.some(s => s >= 3)) return 'crit'
  if (band === 'medium' || band === 'low-medium' || sofaScores.some(s => s >= 1)) return 'high'
  /* green earned: a complete NEWS2 banded low/none, or a complete SOFA
     with every system scored 0 */
  if (band === 'low' || band === 'none') return 'stable'
  if (sofa?.worst.complete && sofaScores.every(s => s === 0)) return 'stable'
  return 'unscored'
}

/** one body system on the digital twin — a pure restatement of its SOFA
 *  sub-score: 0 earned-stable (green) · 1–2 watch · 3–4 critical · null =
 *  the P1 insufficient-data state, rendered grey "Not assessed" and
 *  NEVER green. */
export type SystemStatus = 'ok' | 'watch' | 'crit' | 'nd'
export const systemStatusFromScore = (score: number | null): SystemStatus =>
  score === null ? 'nd' : score === 0 ? 'ok' : score <= 2 ? 'watch' : 'crit'

/** NEWS2-parameter display tier for an observation-tile value (owner's
 *  ruling: 0 neutral · 1–2 amber · 3 red). A tile never renders green —
 *  a single parameter cannot claim the patient is well, so a scored 0
 *  stays neutral with its "0" chip as the honest receipt. */
export type TileTier = 'neutral' | 'amber' | 'red'
export const tileTierFromScore = (score: number | null): TileTier =>
  score === null || score === 0 ? 'neutral' : score === 3 ? 'red' : 'amber'
