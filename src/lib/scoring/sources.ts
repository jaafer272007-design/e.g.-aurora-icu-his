/* SOFA input resolution — turns the CANONICAL reads (labs, observations,
   the structured Infusion Module, encounter weight) into the timed samples
   the SOFA components score. No forks, no mocks: the same adapters the rest
   of the app uses (getLabDraws / getObservations / getPatientOrders /
   getEncounters) feed this. Everything here is derived at render.

   Time handling (SOFA spec §2.2 — 24h recency windows):
   - Observations carry a real dated UTC clinicalTime ("yyyy-MM-dd HH:mm") —
     windowed by true elapsed time.
   - Lab draws carry the store-wide DISPLAY convention ("HH:mm" today /
     "D-n HH:mm" prior days) — NOT an absolute resulted timestamp. We read
     it with the app's own established convention (mirrors
     src/lib/time.ts timestampMinutes: D-n = n days before today), so a lab
     labelled "D-0/today" is treated as today and "D-2" as ~48h ago. This
     is the honest best-available reading; a real absolute lab-resulted
     timestamp is a recorded future improvement (like coded analyte
     identity). The helper is DUPLICATED here (not imported from time.ts)
     so the scoring engine has no React dependency and stays unit-testable
     headless. */

import type { LabDraw, Observation, Order, InfusionDose } from '../api/types'
import { normalisedMcgKgMin, parseInfusionPreset } from '../infusion'

/** one timed reading feeding a component */
export interface Sample {
  value: number
  timeLabel: string
  /** minutes before `now` (the render clock) — the single frame both
   *  labs and observations are projected onto */
  minutesAgo: number
}

/** an active vasopressor infusion contributing to the cardiovascular score */
export interface PressorReading {
  drugId: string
  drugName: string
  /** the dose normalised to µg/kg/min (the per-kg structured entry is
   *  already weight-relative — the SOFA bands read µg/kg/min directly);
   *  null when an active vasopressor's dose is NOT machine-readable */
  mcgKgMin: number | null
  doseText: string
}

/** the rolling-24h urine total, with the honest completeness verdict
 *  (SOFA spec §1.5 — a partial frame is NEVER extrapolated) */
export interface UrineTotal {
  /** mL summed over real charted urine in the window; null when no urine
   *  at all was charted in the window */
  total: number | null
  /** true only when the charted urine actually BRACKETS the 24h window
   *  (data near both ends) — otherwise the frame is partial and urine is
   *  not usable as a 24h total (creatinine-only renal, §1.5) */
  complete: boolean
  /** human note about coverage, for the breakdown */
  coverage: string
}

/* ---- the exact analyte names in the seeded lab catalogue (catalog.ts) ---- */
export const ANALYTE = {
  platelets: 'Platelets', // panel CBC, ×10⁹/L (== ×10³/µL numerically)
  creatinine: 'Creatinine', // panel Renal, mg/dL
  bilirubin: 'T.Bili', // panel Liver, mg/dL
  pao2: 'PaO₂', // panel ABG, mmHg
} as const

export const PANEL = { platelets: 'CBC', creatinine: 'Renal', bilirubin: 'Liver', pao2: 'ABG' } as const

/* ---- SOFA cardiovascular vasopressors (classic — vasopressin and
       phenylephrine are DELIBERATELY excluded, SOFA spec §1.6) ---- */
export const SOFA_VASOPRESSORS = ['dopamine', 'dobutamine', 'adrenaline', 'noradrenaline'] as const
export const EXCLUDED_VASOPRESSORS = ['vasopressin', 'phenylephrine'] as const

/* ---------- time projection onto a single "minutes ago" frame ---------- */

/** minutes-before-today-00:00 for the "HH:mm | D-n HH:mm" convention —
 *  mirrors src/lib/time.ts timestampMinutes (duplicated to keep this
 *  module React-free and headless-testable) */
function labClockMinutes(t: string): number {
  const dayOffset = /^D-(\d+)/.exec(t)
  const day = dayOffset ? -Number(dayOffset[1]) : 0
  const parts = t.split(' ')
  const hm = parts[parts.length - 1]
  const [h, m] = hm.split(':').map(Number)
  return day * 1440 + (h || 0) * 60 + (m || 0)
}

/** minutesAgo for a lab display time, relative to `now` (UTC wall clock) */
export function labMinutesAgo(resultedAt: string, now: Date): number {
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes()
  return nowMin - labClockMinutes(resultedAt)
}

/** minutesAgo for an observation's dated UTC clinicalTime */
export function obsMinutesAgo(clinicalTime: string, now: Date): number {
  const t = Date.parse(clinicalTime.replace(' ', 'T') + ':00Z')
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY
  return (now.getTime() - t) / 60000
}

/* ---------- sample selection within a window ---------- */

/** samples within [asOfAgo, asOfAgo + windowMinutes] */
function inWindow(samples: Sample[], asOfAgo: number, windowMinutes: number): Sample[] {
  return samples.filter(s => s.minutesAgo >= asOfAgo - 1e-6 && s.minutesAgo <= asOfAgo + windowMinutes + 1e-6)
}

/** the worst sample by direction ('low' = lowest value is worst, e.g.
 *  platelets / PaO₂ / MAP / GCS; 'high' = highest is worst, e.g.
 *  creatinine / bilirubin / FiO₂) */
export function worstSample(samples: Sample[], worseWhen: 'low' | 'high'): Sample | null {
  if (samples.length === 0) return null
  return samples.reduce((best, s) =>
    worseWhen === 'low' ? (s.value < best.value ? s : best) : (s.value > best.value ? s : best))
}

/** the latest sample (smallest minutesAgo) */
export function latestSample(samples: Sample[]): Sample | null {
  if (samples.length === 0) return null
  return samples.reduce((best, s) => (s.minutesAgo < best.minutesAgo ? s : best))
}

/* ---------- building the per-input series from canonical reads ---------- */

/** lab analyte → samples (one per draw that carries the analyte) */
export function labSamples(draws: LabDraw[], panel: string, analyte: string, now: Date): Sample[] {
  const out: Sample[] = []
  for (const d of draws) {
    if (d.panel !== panel || d.custom) continue
    const items = Array.isArray(d.items) ? d.items : []
    for (const it of items) {
      if (it.analyte !== analyte || typeof it.value !== 'number') continue
      out.push({ value: it.value, timeLabel: d.resultedAt || d.collectedAt || '', minutesAgo: labMinutesAgo(d.resultedAt || d.collectedAt || '', now) })
    }
  }
  return out
}

/** the effective value of an observation — the last amendment's newValue
 *  when amended, else the original (amend-not-erase) */
function effectiveObsValue(o: Observation): string {
  if (o.amendments && o.amendments.length > 0) return o.amendments[o.amendments.length - 1].newValue
  return o.value
}

/** a numeric observation type → samples */
export function numericObsSamples(obs: Observation[], typeCode: string, now: Date): Sample[] {
  const out: Sample[] = []
  for (const o of obs) {
    if (o.typeCode !== typeCode) continue
    const v = Number(effectiveObsValue(o))
    if (!Number.isFinite(v)) continue
    out.push({ value: v, timeLabel: o.clinicalTime, minutesAgo: obsMinutesAgo(o.clinicalTime, now) })
  }
  return out
}

/** GCS Total samples — DERIVED from the `gcs` compound (eye+verbal+motor),
 *  the same computation the flowsheet does at read (gcs_total is a derived
 *  catalogue type the server never stores). A `gcs_total` observation, if
 *  ever present, is honoured too. */
export function gcsTotalSamples(obs: Observation[], now: Date): Sample[] {
  const out: Sample[] = []
  for (const o of obs) {
    let total: number | null = null
    if (o.typeCode === 'gcs_total') {
      const v = Number(effectiveObsValue(o))
      total = Number.isFinite(v) ? v : null
    } else if (o.typeCode === 'gcs') {
      try {
        const c = JSON.parse(effectiveObsValue(o)) as Record<string, number | string>
        const e = Number(c.eye), vb = Number(c.verbal), m = Number(c.motor)
        if (Number.isFinite(e) && Number.isFinite(vb) && Number.isFinite(m)) total = e + vb + m
      } catch { total = null }
    }
    if (total !== null) out.push({ value: total, timeLabel: o.clinicalTime, minutesAgo: obsMinutesAgo(o.clinicalTime, now) })
  }
  return out
}

/** respiratory-support samples as booleans-in-time (enum "Yes"/"No") */
export function respSupportSamples(obs: Observation[], now: Date): { yes: boolean; minutesAgo: number; timeLabel: string }[] {
  const out: { yes: boolean; minutesAgo: number; timeLabel: string }[] = []
  for (const o of obs) {
    if (o.typeCode !== 'resp_support') continue
    out.push({ yes: effectiveObsValue(o).trim().toLowerCase() === 'yes', minutesAgo: obsMinutesAgo(o.clinicalTime, now), timeLabel: o.clinicalTime })
  }
  return out
}

/** the rolling-24h urine total with the completeness verdict. NEVER
 *  extrapolates: it only ever sums real charted urine; it decides whether
 *  the charted intervals actually BRACKET the window (data near both the
 *  old and recent ends) and, if not, declares the frame partial so renal
 *  falls back to creatinine-only (SOFA spec §1.5). */
export function urine24hTotal(obs: Observation[], now: Date, asOfAgo: number, windowMinutes: number): UrineTotal {
  const all = numericObsSamples(obs, 'urine_output', now)
  const win = inWindow(all, asOfAgo, windowMinutes)
  if (win.length === 0) return { total: null, complete: false, coverage: 'no urine output charted in the window' }
  const total = win.reduce((s, x) => s + x.value, 0)
  // bracketing: real data in the OLDEST quarter and the MOST-RECENT quarter
  // of the 24h — a short recent burst is a partial frame, not a 24h total.
  const oldEdge = asOfAgo + windowMinutes * 0.75
  const recentEdge = asOfAgo + windowMinutes * 0.25
  const hasOld = win.some(x => x.minutesAgo >= oldEdge - 1e-6)
  const hasRecent = win.some(x => x.minutesAgo <= recentEdge + 1e-6)
  const complete = hasOld && hasRecent
  const span = Math.round((Math.max(...win.map(x => x.minutesAgo)) - Math.min(...win.map(x => x.minutesAgo))) / 60)
  return {
    total,
    complete,
    coverage: complete
      ? `${win.length} charted entries spanning ~${span} h → ${Math.round(total)} mL/24 h`
      : `only ${win.length} entries spanning ~${span} h — not a full 24 h frame; NOT extrapolated`,
  }
}

/** active SOFA-relevant vasopressors from the structured Infusion Module.
 *  Reads the structured `infusion` dose first (canonical); falls back to
 *  parsing a kg-mass-rate free-text dose. Vasopressin/phenylephrine are
 *  excluded before we get here. */
export function activePressors(orders: Order[]): PressorReading[] {
  const out: PressorReading[] = []
  for (const o of orders) {
    if (o.status !== 'active' || o.category !== 'Medication' || !o.medication) continue
    const drugId = o.medication.drugId
    if (!(SOFA_VASOPRESSORS as readonly string[]).includes(drugId)) continue
    let dose: InfusionDose | null = o.medication.infusion ?? null
    if (!dose) dose = parseInfusionPreset(o.medication.dose)
    out.push({
      drugId,
      drugName: o.medication.drug,
      mcgKgMin: dose ? normalisedMcgKgMin(dose) : null,
      doseText: o.medication.dose,
    })
  }
  return out
}

/* selection helpers bound to a window, used by sofa.ts buildContext */
export function pickWindow(samples: Sample[], asOfAgo: number, windowMinutes: number): Sample[] {
  return inWindow(samples, asOfAgo, windowMinutes)
}
