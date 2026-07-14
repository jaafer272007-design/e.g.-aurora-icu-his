/* Standard NEWS2 v1 — the Clinical Scoring Engine's SECOND score definition
   (the engine SOFA proved; engine.ts is unchanged — NEWS2 plugs in as
   another ScoreDefinition, confirming open item: no engine change needed).
   Thresholds are STANDARD NEWS2 (EWS/NEWS2 v1 Spec §2) — a validated
   instrument; no home-made rules. An ICU-EWS v2 (ventilated-patient
   adaptations, SpO₂ Scale 2) would be a SEPARATE definition, never an edit
   here (versioned, D1/D2).

   Each of the 7 parameters scores 0–3 (total 0–20). Missing a parameter →
   the component is INCOMPLETE (null) → the engine flags the total partial;
   NEWS2 requires ALL 7, so any missing → the whole score is INCOMPLETE
   (§4). Consciousness is ACVPU, read DIRECTLY from its own observation —
   NEVER derived from GCS (§3 / D3). */

import type { Observation } from '../api/types'
import type { ComponentResult, ScoreComponent, ScoreDefinition } from './engine'
import {
  enumObsSamples, latestSample, numericObsSamples, pickWindow,
  type EnumSample, type Sample,
} from './sources'

/* Recency window (§5, open item 2): aligned with the engine's existing
   observation windowing (the SOFA 24h frame) and STATED. Beyond it → the
   parameter is missing → INCOMPLETE (never a stale value). NEWS2 clinically
   reflects the CURRENT observation set, so a shorter window (the latest
   round) is a likely validator refinement — recorded/flagged, not silently
   chosen. */
export const NEWS2_WINDOW_MINUTES = 1440

/* Supplemental-oxygen source (§2 param 3 / open item 1): the FiO₂
   observation is the authoritative indicator of inspired oxygen —
   FiO₂ > 21 % = supplemental O₂ (score 2), FiO₂ ≤ 21 % = room air
   (score 0). resp_support (Yes/No) is about VENTILATORY support, a distinct
   concept, so it is deliberately NOT used here. FiO₂ not charted → the
   oxygen parameter is MISSING (never assumed air). LIMITATION (flagged): a
   ward patient on nasal-cannula O₂ needs FiO₂ charted to score this; a
   dedicated air/oxygen-delivery observation is a clean future addition. */
const ROOM_AIR_FIO2 = 21

export interface News2Param {
  latest: Sample | null
}
export interface News2Context {
  rr: News2Param
  spo2: News2Param
  fio2: News2Param
  sbp: News2Param
  hr: News2Param
  temp: News2Param
  acvpu: EnumSample | null
  /** true when a ventilator/NIV support observation says the patient is on
   *  respiratory support in-window — surfaces the D2 limitation in the UI */
  ventilated: boolean
}

function latestIn(samples: Sample[], asOfMinutesAgo: number, windowMinutes: number): Sample | null {
  return latestSample(pickWindow(samples, asOfMinutesAgo, windowMinutes))
}

export function buildNews2Context(
  args: { observations: Observation[]; now: Date },
  asOfMinutesAgo = 0,
  windowMinutes = NEWS2_WINDOW_MINUTES,
): News2Context {
  const { observations, now } = args
  const inWin = (s: EnumSample[]) => s.filter(x => x.minutesAgo >= asOfMinutesAgo - 1e-6 && x.minutesAgo <= asOfMinutesAgo + windowMinutes + 1e-6)
  const acvpuS = inWin(enumObsSamples(observations, 'acvpu', now))
  const acvpu = acvpuS.length ? acvpuS.reduce((b, s) => (s.minutesAgo < b.minutesAgo ? s : b)) : null
  const supportS = inWin(enumObsSamples(observations, 'resp_support', now))
  const latestSupport = supportS.length ? supportS.reduce((b, s) => (s.minutesAgo < b.minutesAgo ? s : b)) : null

  return {
    rr: { latest: latestIn(numericObsSamples(observations, 'rr', now), asOfMinutesAgo, windowMinutes) },
    spo2: { latest: latestIn(numericObsSamples(observations, 'spo2', now), asOfMinutesAgo, windowMinutes) },
    fio2: { latest: latestIn(numericObsSamples(observations, 'fio2', now), asOfMinutesAgo, windowMinutes) },
    sbp: { latest: latestIn(numericObsSamples(observations, 'sbp', now), asOfMinutesAgo, windowMinutes) },
    hr: { latest: latestIn(numericObsSamples(observations, 'hr', now), asOfMinutesAgo, windowMinutes) },
    temp: { latest: latestIn(numericObsSamples(observations, 'temp', now), asOfMinutesAgo, windowMinutes) },
    acvpu,
    ventilated: latestSupport ? latestSupport.value.toLowerCase() === 'yes' : false,
  }
}

const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))
const missing = (name: string): ComponentResult => ({ score: null, incompleteReason: `no ${name} in the window`, detail: `insufficient data — ${name} not charted`, contributors: [] })
const one = (label: string, sample: Sample, unit: string): ComponentResult['contributors'] => [{ label, display: `${num(sample.value)}${unit}`, timeLabel: sample.timeLabel }]

/* ---- the 7 parameters (standard NEWS2 thresholds, spec §2) ---- */

const respiration: ScoreComponent<News2Context> = {
  key: 'rr', label: 'Respiration rate', max: 3,
  score(ctx): ComponentResult {
    const s = ctx.rr.latest
    if (!s) return missing('respiration rate')
    const v = s.value
    const score = v <= 8 ? 3 : v <= 11 ? 1 : v <= 20 ? 0 : v <= 24 ? 2 : 3
    return { score, detail: `RR ${num(v)} /min`, contributors: one('RR', s, ' /min') }
  },
}

const spo2Scale1: ScoreComponent<News2Context> = {
  key: 'spo2', label: 'SpO₂ (Scale 1)', max: 3,
  score(ctx): ComponentResult {
    const s = ctx.spo2.latest
    if (!s) return missing('SpO₂')
    const v = s.value
    const score = v <= 91 ? 3 : v <= 93 ? 2 : v <= 95 ? 1 : 0
    return { score, detail: `SpO₂ ${num(v)} %`, contributors: one('SpO₂', s, ' %') }
  },
}

const oxygen: ScoreComponent<News2Context> = {
  key: 'o2', label: 'Air or supplemental O₂', max: 3,
  score(ctx): ComponentResult {
    const s = ctx.fio2.latest
    if (!s) return missing('oxygen (FiO₂)')
    const supplemental = s.value > ROOM_AIR_FIO2
    return {
      score: supplemental ? 2 : 0,
      detail: supplemental ? `supplemental O₂ (FiO₂ ${num(s.value)} %)` : `room air (FiO₂ ${num(s.value)} %)`,
      contributors: [{ label: supplemental ? 'Supplemental O₂' : 'Air', display: `FiO₂ ${num(s.value)} %`, timeLabel: s.timeLabel }],
    }
  },
}

const systolic: ScoreComponent<News2Context> = {
  key: 'sbp', label: 'Systolic BP', max: 3,
  score(ctx): ComponentResult {
    const s = ctx.sbp.latest
    if (!s) return missing('systolic BP')
    const v = s.value
    const score = v <= 90 ? 3 : v <= 100 ? 2 : v <= 110 ? 1 : v <= 219 ? 0 : 3
    return { score, detail: `SBP ${num(v)} mmHg`, contributors: one('SBP', s, ' mmHg') }
  },
}

const pulse: ScoreComponent<News2Context> = {
  key: 'hr', label: 'Pulse', max: 3,
  score(ctx): ComponentResult {
    const s = ctx.hr.latest
    if (!s) return missing('pulse')
    const v = s.value
    const score = v <= 40 ? 3 : v <= 50 ? 1 : v <= 90 ? 0 : v <= 110 ? 1 : v <= 130 ? 2 : 3
    return { score, detail: `HR ${num(v)} bpm`, contributors: one('HR', s, ' bpm') }
  },
}

const consciousness: ScoreComponent<News2Context> = {
  key: 'acvpu', label: 'Consciousness (ACVPU)', max: 3,
  score(ctx): ComponentResult {
    const s = ctx.acvpu
    if (!s) return { score: null, incompleteReason: 'no ACVPU charted (GCS does NOT substitute)', detail: 'insufficient data — ACVPU not charted (never derived from GCS)', contributors: [] }
    const alert = s.value.toLowerCase() === 'alert'
    return {
      score: alert ? 0 : 3,
      detail: alert ? 'Alert' : `${s.value} (new)`,
      contributors: [{ label: 'ACVPU', display: s.value, timeLabel: s.timeLabel }],
    }
  },
}

const temperature: ScoreComponent<News2Context> = {
  key: 'temp', label: 'Temperature', max: 3,
  score(ctx): ComponentResult {
    const s = ctx.temp.latest
    if (!s) return missing('temperature')
    const v = s.value
    // ≤35.0→3 · 35.1–36.0→1 · 36.1–38.0→0 · 38.1–39.0→1 · ≥39.1→2
    const score = v <= 35.0 ? 3 : v <= 36.0 ? 1 : v <= 38.0 ? 0 : v <= 39.0 ? 1 : 2
    return { score, detail: `Temp ${num(v)} °C`, contributors: one('Temp', s, ' °C') }
  },
}

export const NEWS2_V1: ScoreDefinition<News2Context> = {
  id: 'news2',
  version: 'v1',
  label: 'NEWS2 (standard)',
  maxTotal: 20,
  components: [respiration, spo2Scale1, oxygen, systolic, pulse, consciousness, temperature],
}

/* ---- escalation band + colour (spec §6, D6 — DISPLAY ONLY, no alerts) ---- */

export type News2BandKey = 'none' | 'low' | 'low-medium' | 'medium' | 'high'
export interface News2Band {
  key: News2BandKey
  label: string
  /** design-system severity colour var — DISPLAY only, never fires anything */
  color: string
  response: string
}

/** the standard NEWS2 escalation band for an aggregate total + whether any
 *  single parameter scored 3 (the single-parameter-3 trigger, §6). This is
 *  pure DISPLAY classification — it emits no notification/paging (D6). */
export function news2Band(total: number, anyParamIs3: boolean): News2Band {
  if (total >= 7) return { key: 'high', label: 'HIGH', color: 'var(--red)', response: 'emergency threshold — urgent/emergency clinical response' }
  if (total >= 5) return { key: 'medium', label: 'MEDIUM', color: 'var(--amber)', response: 'urgent response by a clinician' }
  if (anyParamIs3) return { key: 'low-medium', label: 'LOW–MEDIUM', color: 'var(--amber)', response: 'single parameter scored 3 — urgent ward-based review' }
  if (total >= 1) return { key: 'low', label: 'LOW', color: 'var(--blue)', response: 'ward-based / team response' }
  return { key: 'none', label: 'LOW', color: 'var(--green)', response: 'routine monitoring' }
}
