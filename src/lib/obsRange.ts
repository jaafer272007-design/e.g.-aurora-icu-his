/* Observation flagging — derived at render from the catalogue's
   hospital-set ranges (Observations Catalogue tenant), NEVER stored on
   the record. The lab-analyte semantics reused: at-or-beyond a critical
   threshold → 'critical' (over-flagging is the safe error; precedence
   over abnormal); outside [refLow, refHigh] → 'abnormal'; inside → null
   (normal). A side with no bound gives no verdict on that side — ranges
   are never fabricated. Score computation NEVER reads these ranges
   (NEWS2/SOFA bands live in code); this is display flagging only. */

export interface ObsRangeSpec {
  refLow?: number | null
  refHigh?: number | null
  critLow?: number | null
  critHigh?: number | null
}

export type ObsFlag = 'critical' | 'abnormal' | null

/* != null (not !== undefined): the wire carries UNSET bounds as JSON
   null, and a naive `value <= null` coerces null to 0 — which would flag
   every non-positive value critical on a rangeless type */
export function obsRangeFlag(t: ObsRangeSpec, value: number): ObsFlag {
  if (!Number.isFinite(value)) return null
  if (t.critLow != null && value <= t.critLow) return 'critical'
  if (t.critHigh != null && value >= t.critHigh) return 'critical'
  if (t.refLow != null && value < t.refLow) return 'abnormal'
  if (t.refHigh != null && value > t.refHigh) return 'abnormal'
  return null
}
