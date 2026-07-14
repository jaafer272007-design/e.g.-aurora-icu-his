/* Structured Infusion Ordering — dose helpers. The structured entry is
   stored FAITHFULLY as ordered (value + mass unit + time basis, per kg by
   design); everything here is DERIVED AT RENDER, never stored (the
   derived-values discipline: Net Balance, GCS Total, BMI/IBW/BSA).

   Normalisation (stated formula, per the design §2): the common unit for
   comparison/scoring is µg/kg/min —
     mg → µg: ×1000 · per hour → per min: ÷60
   so 2 mg/kg/hour = 2×1000÷60 ≈ 33.33 µg/kg/min. The original entry is
   preserved; the normalised value is computed here on demand (SOFA's
   cardiovascular bands are in µg/kg/min — the bands themselves are part
   of the deferred SOFA spec, NOT this module). */

import type { InfusionDose } from './api/types'

/** the dose normalised to µg/kg/min (derived — the entered value+unit
 *  stay canonical) */
export function normalisedMcgKgMin(d: InfusionDose): number {
  const mcg = d.massUnit === 'mg' ? d.value * 1000 : d.value
  return d.timeBasis === 'hour' ? mcg / 60 : mcg
}

/** display string faithful to the ENTERED unit — "0.3 µg/kg/min",
 *  "2 mg/kg/hour" (matches the server's composition) */
export function formatInfusionDose(d: InfusionDose): string {
  return `${trimNum(d.value)} ${d.massUnit === 'mcg' ? 'µg' : 'mg'}/kg/${d.timeBasis}`
}

/** the normalised display — "≈ 33.3 µg/kg/min"; identical-unit entries
 *  need no approximation marker */
export function formatNormalised(d: InfusionDose): string {
  const n = normalisedMcgKgMin(d)
  return `${trimNum(Math.round(n * 100) / 100)} µg/kg/min`
}

/** absolute mass rate for THIS patient from the encounter weight —
 *  µg/min (or per hour for hour-based entries). Returns null when the
 *  encounter weight is not recorded: the per-kg dose stands on its own
 *  and no absolute rate is fabricated (honest-data). */
export function absoluteRate(d: InfusionDose, weightKg?: number | null): string | null {
  if (typeof weightKg !== 'number' || !Number.isFinite(weightKg) || weightKg <= 0) return null
  const total = d.value * weightKg
  return `${trimNum(Math.round(total * 100) / 100)} ${d.massUnit === 'mcg' ? 'µg' : 'mg'}/${d.timeBasis}`
}

/** parse a formulary preset string like "0.05 µg/kg/min" / "2 mg/kg/hour"
 *  into a structured entry — presets that aren't kg-mass-rate shaped
 *  (e.g. vasopressin's "0.02 U/min") return null and stay free-text */
export function parseInfusionPreset(text: string): InfusionDose | null {
  const m = /^([\d.]+)\s*(µg|mcg|mg)\/kg\/(min|hour|h)$/i.exec(text.trim())
  if (!m) return null
  const value = Number(m[1])
  if (!Number.isFinite(value) || value <= 0) return null
  return {
    value,
    massUnit: m[2].toLowerCase() === 'mg' ? 'mg' : 'mcg',
    timeBasis: m[3].toLowerCase() === 'hour' || m[3].toLowerCase() === 'h' ? 'hour' : 'min',
  }
}

const trimNum = (n: number): string => {
  const s = n.toFixed(4)
  return s.replace(/\.?0+$/, '')
}
