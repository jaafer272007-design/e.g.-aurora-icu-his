/* Classic SOFA v1 — the score DEFINITION on the generic engine
   (src/lib/scoring/engine.ts). Thresholds are the validator-confirmed
   classic SOFA (docs/design/sofa-scoring-specification.md §1). This file
   is faithful-to-classic and versioned: a Modified SOFA (vasopressin /
   phenylephrine mappings, etc.) would be a SEPARATE definition, never an
   edit here (spec §2.7).

   Each component returns a score 0..4 or null (insufficient data → the
   engine marks the total partial; never 0 for missing — P1). */

import type { LabDraw, Observation, Order } from '../api/types'
import type { ComponentResult, ScoreComponent, ScoreDefinition, ScoreMode } from './engine'
import {
  ANALYTE, PANEL,
  activePressors, gcsTotalSamples, labSamples, latestSample, numericObsSamples,
  pickWindow, respSupportSamples, urine24hTotal, worstSample,
  type PressorReading, type Sample, type UrineTotal,
} from './sources'

export const SOFA_WINDOW_MINUTES = 1440 // §2.2 — 24h for labs and observations

/** a resolved input: the worst-in-window and latest-in-window sample */
interface ResolvedInput {
  worst: Sample | null
  latest: Sample | null
  count: number
}

/** everything the 6 components read, resolved once per (mode-independent)
 *  context; the components pick worst vs latest by mode */
export interface SofaContext {
  pao2: ResolvedInput
  fio2: ResolvedInput
  platelets: ResolvedInput
  bilirubin: ResolvedInput
  gcs: ResolvedInput
  creatinine: ResolvedInput
  map: ResolvedInput
  urine: UrineTotal
  respSupport: { anyYes: boolean; latestYes: boolean | null; latestLabel: string }
  pressors: PressorReading[]
  weightKg: number | null
}

function resolve(samples: Sample[], worseWhen: 'low' | 'high'): ResolvedInput {
  return { worst: worstSample(samples, worseWhen), latest: latestSample(samples), count: samples.length }
}

/** resolve every SOFA input from the canonical reads for a given asOf point
 *  (asOfMinutesAgo = 0 is "now"; >0 shifts the 24h window back for the
 *  trend). Pure — `now` is the render clock passed in. */
export function buildSofaContext(
  args: { labs: LabDraw[]; observations: Observation[]; orders: Order[]; weightKg: number | null; now: Date },
  asOfMinutesAgo = 0,
  windowMinutes = SOFA_WINDOW_MINUTES,
): SofaContext {
  const { labs, observations, orders, weightKg, now } = args
  const win = (s: Sample[]) => pickWindow(s, asOfMinutesAgo, windowMinutes)

  const support = respSupportSamples(observations, now).filter(
    s => s.minutesAgo >= asOfMinutesAgo - 1e-6 && s.minutesAgo <= asOfMinutesAgo + windowMinutes + 1e-6,
  )
  const latestSupport = support.length ? support.reduce((b, s) => (s.minutesAgo < b.minutesAgo ? s : b)) : null

  return {
    pao2: resolve(win(labSamples(labs, PANEL.pao2, ANALYTE.pao2, now)), 'low'),
    fio2: resolve(win(numericObsSamples(observations, 'fio2', now)), 'high'),
    platelets: resolve(win(labSamples(labs, PANEL.platelets, ANALYTE.platelets, now)), 'low'),
    bilirubin: resolve(win(labSamples(labs, PANEL.bilirubin, ANALYTE.bilirubin, now)), 'high'),
    gcs: resolve(win(gcsTotalSamples(observations, now)), 'low'),
    creatinine: resolve(win(labSamples(labs, PANEL.creatinine, ANALYTE.creatinine, now)), 'high'),
    map: resolve(win(numericObsSamples(observations, 'map', now)), 'low'),
    urine: urine24hTotal(observations, now, asOfMinutesAgo, windowMinutes),
    respSupport: {
      anyYes: support.some(s => s.yes),
      latestYes: latestSupport ? latestSupport.yes : null,
      latestLabel: latestSupport ? latestSupport.timeLabel : '',
    },
    pressors: activePressors(orders),
    weightKg,
  }
}

const pick = (r: ResolvedInput, mode: ScoreMode) => (mode === 'worst' ? r.worst : r.latest)
const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

/* ---------------- the 6 components ---------------- */

/** 1.1 Respiratory — PaO₂/FiO₂; 3–4 require charted respiratory support,
 *  else capped at 2 (spec §1.1) */
const respiratory: ScoreComponent<SofaContext> = {
  key: 'respiratory', label: 'Respiratory', max: 4,
  score(ctx, mode): ComponentResult {
    const pao2 = pick(ctx.pao2, mode)
    const fio2 = pick(ctx.fio2, mode)
    if (!pao2 || !fio2) {
      const missing = [!pao2 ? 'PaO₂ (ABG)' : null, !fio2 ? 'FiO₂' : null].filter(Boolean).join(' and ')
      return { score: null, incompleteReason: `no ${missing} in the last 24 h`, detail: `insufficient data — ${missing} not available`, contributors: [] }
    }
    const pf = pao2.value / (fio2.value / 100)
    const support = mode === 'worst' ? ctx.respSupport.anyYes : ctx.respSupport.latestYes === true
    let raw: number
    if (pf >= 400) raw = 0
    else if (pf >= 300) raw = 1
    else if (pf >= 200) raw = 2
    else if (pf >= 100) raw = 3
    else raw = 4
    let score = raw
    let note: string | undefined
    if (raw >= 3 && !support) {
      score = 2
      note = `P/F ${Math.round(pf)} would score ${raw}, but respiratory support is not charted "Yes" — capped at 2 (support is required for 3–4)`
    }
    const contributors = [
      { label: 'PaO₂', display: `${num(pao2.value)} mmHg`, timeLabel: pao2.timeLabel },
      { label: 'FiO₂', display: `${num(fio2.value)} %`, timeLabel: fio2.timeLabel },
    ]
    return { score, detail: `P/F = ${Math.round(pf)} (PaO₂ ${num(pao2.value)} ÷ FiO₂ ${(fio2.value / 100).toFixed(2)})${support ? ' · on respiratory support' : ''}`, contributors, note }
  },
}

/** 1.2 Coagulation — platelets ×10³/µL (spec §1.2) */
const coagulation: ScoreComponent<SofaContext> = {
  key: 'coagulation', label: 'Coagulation', max: 4,
  score(ctx, mode): ComponentResult {
    const p = pick(ctx.platelets, mode)
    if (!p) return { score: null, incompleteReason: 'no platelet count in the last 24 h', detail: 'insufficient data — platelets not available', contributors: [] }
    const v = p.value
    const score = v < 20 ? 4 : v < 50 ? 3 : v < 100 ? 2 : v < 150 ? 1 : 0
    return { score, detail: `platelets ${num(v)} ×10³/µL`, contributors: [{ label: 'Platelets', display: `${num(v)} ×10⁹/L`, timeLabel: p.timeLabel }] }
  },
}

/** 1.3 Liver — total bilirubin mg/dL (spec §1.3) */
const liver: ScoreComponent<SofaContext> = {
  key: 'liver', label: 'Liver', max: 4,
  score(ctx, mode): ComponentResult {
    const b = pick(ctx.bilirubin, mode)
    if (!b) return { score: null, incompleteReason: 'no bilirubin in the last 24 h', detail: 'insufficient data — bilirubin not available', contributors: [] }
    const v = b.value
    const score = v >= 12 ? 4 : v >= 6 ? 3 : v >= 2 ? 2 : v >= 1.2 ? 1 : 0
    return { score, detail: `bilirubin ${num(v)} mg/dL`, contributors: [{ label: 'T.Bili', display: `${num(v)} mg/dL`, timeLabel: b.timeLabel }] }
  },
}

/** 1.4 CNS — GCS Total (spec §1.4) */
const cns: ScoreComponent<SofaContext> = {
  key: 'cns', label: 'CNS', max: 4,
  score(ctx, mode): ComponentResult {
    const g = pick(ctx.gcs, mode)
    if (!g) return { score: null, incompleteReason: 'no GCS in the last 24 h', detail: 'insufficient data — GCS not available', contributors: [] }
    const v = g.value
    const score = v < 6 ? 4 : v < 10 ? 3 : v < 13 ? 2 : v < 15 ? 1 : 0
    return { score, detail: `GCS ${num(v)}`, contributors: [{ label: 'GCS Total', display: num(v), timeLabel: g.timeLabel }] }
  },
}

const creatinineScore = (v: number) => (v >= 5 ? 4 : v >= 3.5 ? 3 : v >= 2 ? 2 : v >= 1.2 ? 1 : 0)
/** urine only defines the 3/4 (oliguria) bands — normal urine cannot give
 *  0–2 (that is creatinine's job), so ≥500 mL/24h contributes null */
const urineScore = (mlPerDay: number): number | null => (mlPerDay < 200 ? 4 : mlPerDay < 500 ? 3 : null)

/** 1.5 Renal — creatinine mg/dL OR urine output; WORST-of when both;
 *  urine only as a complete rolling-24h total, never extrapolated (§1.5) */
const renal: ScoreComponent<SofaContext> = {
  key: 'renal', label: 'Renal', max: 4,
  score(ctx, mode): ComponentResult {
    const cr = pick(ctx.creatinine, mode)
    const crScore = cr ? creatinineScore(cr.value) : null // number whenever cr present
    const u = ctx.urine
    const uScore = u.complete && u.total !== null ? urineScore(u.total) : null // null if ≥500 or partial frame

    const contributors: ComponentResult['contributors'] = []
    if (cr) contributors.push({ label: 'Creatinine', display: `${num(cr.value)} mg/dL`, timeLabel: cr.timeLabel })
    if (u.complete && u.total !== null) contributors.push({ label: 'Urine (24 h)', display: `${Math.round(u.total)} mL`, timeLabel: '' })

    // INCOMPLETE only when there is no creatinine AND no usable oliguric
    // 24h urine total — never assume normal (P1). A normal urine alone
    // cannot score renal 0–2 (creatinine-defined), so it stays insufficient.
    if (crScore === null && uScore === null) {
      const why = `no creatinine in the last 24 h and ${
        u.total === null ? 'no urine charted' : u.complete ? 'urine not oliguric (creatinine needed to score 0–2)' : 'no complete 24 h urine total (' + u.coverage + ')'
      }`
      return { score: null, incompleteReason: why, detail: `insufficient data — ${why}`, contributors }
    }

    // worst-of the available scores (SOFA's worst-dysfunction philosophy)
    const candidates = [crScore, uScore].filter((x): x is number => x !== null)
    const score = Math.max(...candidates)
    let note: string | undefined
    if (crScore !== null && uScore !== null) note = `worst-of: creatinine → ${crScore}, urine → ${uScore}`
    else if (uScore === null && u.total !== null && !u.complete) note = `urine not used (${u.coverage}) — scored from creatinine only`
    else if (crScore === null) note = 'no creatinine — scored from the oliguric 24 h urine total only'
    return { score, detail: `renal ${score} (${contributors.map(c => `${c.label} ${c.display}`).join(', ')})`, contributors, note }
  },
}

const pressorBand = (drugId: string, dose: number): number | null => {
  if (drugId === 'dobutamine') return 2
  if (drugId === 'dopamine') return dose > 15 ? 4 : dose > 5 ? 3 : 2
  if (drugId === 'adrenaline' || drugId === 'noradrenaline') return dose > 0.1 ? 4 : 3
  return null
}

/** 1.6 Cardiovascular — MAP + vasopressors µg/kg/min; vasopressin and
 *  phenylephrine excluded; take the highest applicable (§1.6) */
const cardiovascular: ScoreComponent<SofaContext> = {
  key: 'cardiovascular', label: 'Cardiovascular', max: 4,
  score(ctx, mode): ComponentResult {
    const map = pick(ctx.map, mode)
    const contributors: ComponentResult['contributors'] = []
    const scores: number[] = []
    if (map) {
      contributors.push({ label: 'MAP', display: `${num(map.value)} mmHg`, timeLabel: map.timeLabel })
      scores.push(map.value >= 70 ? 0 : 1)
    }
    // an active vasopressor whose dose is NOT machine-readable must not
    // silently understate severity — flag it INCOMPLETE (P1 spirit)
    const unreadable = ctx.pressors.filter(p => p.mcgKgMin === null)
    for (const p of ctx.pressors) {
      if (p.mcgKgMin === null) continue
      const band = pressorBand(p.drugId, p.mcgKgMin)
      if (band === null) continue
      contributors.push({ label: p.drugName, display: `${p.mcgKgMin.toFixed(3).replace(/\.?0+$/, '')} µg/kg/min`, timeLabel: 'active' })
      scores.push(band)
    }
    if (unreadable.length > 0) {
      const names = unreadable.map(p => p.drugName).join(', ')
      return { score: null, incompleteReason: `active vasopressor with a non-structured dose: ${names}`, detail: `insufficient data — ${names} active but its dose is not machine-readable (chart it via structured infusion ordering)`, contributors }
    }
    if (scores.length === 0) return { score: null, incompleteReason: 'no MAP in the last 24 h and no active vasopressor', detail: 'insufficient data — MAP and vasopressors not available', contributors }
    const score = Math.max(...scores)
    return { score, detail: contributors.map(c => `${c.label} ${c.display}`).join(' · '), contributors }
  },
}

export const SOFA_V1: ScoreDefinition<SofaContext> = {
  id: 'sofa',
  version: 'v1',
  label: 'SOFA (classic)',
  maxTotal: 24,
  components: [respiratory, coagulation, liver, cns, renal, cardiovascular],
}
