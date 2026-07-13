import type { Hemodynamics, Observation, VentTile, Ventilator } from './types'

/* Stage 11 §12 step 4 — the frontend half of the bedside READ PROJECTION
   (design §5): panel shapes the Mission Control tiles already consume,
   sourced from the LATEST charted Observations instead of panels.ts.
   Real values or an honest '—' — never simulated numbers. This module is
   on the REAL path (no mock imports): when the Device Adapter later feeds
   the same Observations, these panels light up with no display change.

   warn flags are FALSE everywhere on purpose: alarm thresholds are a
   clinical rule set that does not exist yet — an invented alarm is as
   dishonest as an invented value (recorded; a later piece with the
   Derived Clinical Scores work). */

export interface LatestObservation {
  value: string
  clinicalTime: string
  source: Observation['source']
}

/** amend-not-erase: the effective value is the last amendment's newValue */
const effectiveValue = (o: Observation) =>
  o.amendments.length > 0 ? o.amendments[o.amendments.length - 1].newValue : o.value

/** latest effective observation per typeCode — the observations read is
 *  server-ordered oldest-first, so the last write per type wins */
export function latestObservations(obs: Observation[]): Map<string, LatestObservation> {
  const m = new Map<string, LatestObservation>()
  for (const o of obs) m.set(o.typeCode, { value: effectiveValue(o), clinicalTime: o.clinicalTime, source: o.source })
  return m
}

const show = (latest: Map<string, LatestObservation>, code: string): string =>
  latest.get(code)?.value ?? '—'

const tile = (latest: Map<string, LatestObservation>, code: string, label: string, unit: string): VentTile =>
  ({ label, value: show(latest, code), unit, warn: false })

/** the Ventilator panel — same tile shape as before, real-or-blank.
 *  Set-vs-measured stay separate tiles (§1); Compliance is deferred (F6);
 *  Driving Pressure is DERIVED (Pplat − PEEP) and only shown when both
 *  inputs share one charted timepoint — a ΔP across different times
 *  would be a fabricated number. */
export function projectVentilator(latest: Map<string, LatestObservation>): Ventilator {
  const pplat = latest.get('pplat')
  const peep = latest.get('peep')
  const dp = pplat && peep && pplat.clinicalTime === peep.clinicalTime
    ? Number(pplat.value) - Number(peep.value) : null
  return {
    mode: show(latest, 'vent_mode'),
    tiles: [
      tile(latest, 'fio2', 'FiO₂', '%'),
      tile(latest, 'peep', 'PEEP', 'cmH₂O'),
      tile(latest, 'rr_set', 'Set Rate', '/min'),
      tile(latest, 'rr_measured', 'Measured Rate', '/min'),
      tile(latest, 'vt_set', 'TV Set', 'mL'),
      tile(latest, 'vt_exhaled', 'TV Exhaled', 'mL'),
      tile(latest, 'ppeak', 'Peak Pressure', 'cmH₂O'),
      tile(latest, 'pplat', 'Plateau', 'cmH₂O'),
      { label: 'Driving Pressure', value: dp === null ? '—' : String(dp), unit: 'cmH₂O', warn: false },
      tile(latest, 'minute_ventilation', 'Minute Vent.', 'L/min'),
      tile(latest, 'ie_ratio', 'I:E', ''),
    ],
  }
}

const FLUID_IN = ['oral_intake', 'iv_fluids', 'blood_products']
const FLUID_OUT = ['urine_output', 'drain_output', 'ng_output', 'stool_output']

/** the Hemodynamics panel. SVV is deferred (F6). The fluid-balance strip
 *  is computed at read from the trailing 24 h of charted fluid entries
 *  (per-interval amounts summed — real data or absent, never a demo
 *  figure); the bar's percent is a bounded DISPLAY scale (4 L full
 *  scale), not a clinical claim. */
export function projectHemodynamics(latest: Map<string, LatestObservation>, obs: Observation[]): Hemodynamics {
  const cutoff = new Date(Date.now() - 24 * 3600_000)
    .toISOString().slice(0, 16).replace('T', ' ')
  const window = obs.filter(o => o.clinicalTime >= cutoff)
  const sum = (codes: string[]) => window
    .filter(o => codes.includes(o.typeCode))
    .reduce((s, o) => s + (Number(effectiveValue(o)) || 0), 0)
  const anyFluid = window.some(o => FLUID_IN.includes(o.typeCode) || FLUID_OUT.includes(o.typeCode))
  const net = sum(FLUID_IN) - sum(FLUID_OUT)
  return {
    metrics: [
      tile(latest, 'cardiac_output', 'Cardiac Output', 'L/min'),
      tile(latest, 'cardiac_index', 'Cardiac Index', 'L/min/m²'),
      tile(latest, 'svr', 'SVR', 'dyn·s/cm⁵'),
      tile(latest, 'cvp', 'CVP', 'mmHg'),
      tile(latest, 'lactate_poc', 'Lactate', 'mmol/L'),
      tile(latest, 'urine_output', 'Urine Output', 'mL'),
    ],
    ...(anyFluid
      ? {
          fluidBalance: {
            value: `${net >= 0 ? '+' : '−'}${Math.abs(net).toLocaleString('en-US')} mL`,
            percent: Math.min(100, Math.round((Math.abs(net) / 4000) * 100)),
          },
        }
      : {}),
  }
}
