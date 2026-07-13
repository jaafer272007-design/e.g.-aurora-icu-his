/* Derived anthropometrics — COMPUTED AT RENDER from the patient's recorded
   weight (kg) + height (cm), NEVER stored and never served on the wire
   (the derived-values discipline: Net Balance, GCS Total, clock-computed
   states). Each function returns null when an input is missing or outside
   the formula's domain — the honest-data rule: a BMI without both inputs
   is not shown, never fabricated.

   Formulas (stated per the design's open item #2):
   - BMI:  weight / height²          (kg/m²)
   - IBW:  DEVINE (1974) — M: 50 kg + 2.3 kg per inch over 60 in;
           F: 45.5 kg + 2.3 kg per inch over 60 in. The formula is defined
           for heights ≥ 60 in (152.4 cm); below that domain IBW is NOT
           shown rather than extrapolated to clinically meaningless values.
   - BSA:  MOSTELLER — √(height·weight / 3600)  (m²) */

import type { Sex } from './api/types'

const valid = (weightKg?: number | null, heightCm?: number | null): boolean =>
  typeof weightKg === 'number' && Number.isFinite(weightKg) && weightKg > 0 &&
  typeof heightCm === 'number' && Number.isFinite(heightCm) && heightCm > 0

/** kg/m², 1 decimal — null unless BOTH inputs exist */
export function bmi(weightKg?: number | null, heightCm?: number | null): number | null {
  if (!valid(weightKg, heightCm)) return null
  const m = heightCm! / 100
  return Math.round((weightKg! / (m * m)) * 10) / 10
}

/** Devine ideal body weight in kg, 1 decimal — null without height/sex or
 *  below the formula's 152.4 cm domain (never extrapolated). Weight is
 *  deliberately NOT an input: IBW derives from height and sex alone. */
export function ibwDevineKg(sex?: Sex | null, heightCm?: number | null): number | null {
  if (sex !== 'M' && sex !== 'F') return null
  if (typeof heightCm !== 'number' || !Number.isFinite(heightCm) || heightCm < 152.4) return null
  const inchesOver60 = heightCm / 2.54 - 60
  const base = sex === 'M' ? 50 : 45.5
  return Math.round((base + 2.3 * inchesOver60) * 10) / 10
}

/** Mosteller body surface area in m², 2 decimals — null unless BOTH
 *  inputs exist */
export function bsaMostellerM2(weightKg?: number | null, heightCm?: number | null): number | null {
  if (!valid(weightKg, heightCm)) return null
  return Math.round(Math.sqrt((heightCm! * weightKg!) / 3600) * 100) / 100
}
