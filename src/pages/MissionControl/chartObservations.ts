import type { LatestObservation } from '../../lib/api/bedside'
import type { MonitorVitals } from '../../lib/api/types'

/* LATEST CHARTED OBSERVATIONS — the ONE combined chart card (owner's plan,
   2026-10-15: "Combine the existing observation and ventilator readings …
   Remove the separate Ventilator and Hemodynamics cards. Preserve unique
   charted hemodynamic readings within the combined observations card,
   without duplicating readings").

   Pure presentation: every reading resolves from the SAME latest-per-type
   map the bedside section always used (latestObservations over the chart's
   one full-chart read), so the three groups can never disagree with each
   other. The reading lists are the retired cards' lists verbatim
   (LatestObservationsCard READINGS, bedside.ts projectVentilator /
   projectHemodynamics), minus the one duplicate: CVP was on both the
   bedside card and the Hemodynamics card — it is shown ONCE, in the
   bedside group where it already sat. Every other code appears exactly
   once (checked by the session-2 harness).

   Value resolution per reading:
     · a REAL charted observation → value + clinical time + source;
     · bedside group only: the roster-merged demo snapshot in demo-seeded
       environments (tagged DEMO, never scored) — the existing F9 rule; the
       ventilator/hemodynamic groups never had a demo fallback and get none;
     · otherwise an honest "not charted".
   Set-versus-measured stay SEPARATE readings (Set Rate / Measured Rate,
   TV Set / TV Exhaled — §1 of the bedside projection). Driving Pressure is
   DERIVED (Pplat − PEEP) only when both inputs share one charted
   timepoint — the projectVentilator condition, unchanged: a ΔP across two
   different times would be a fabricated number. */

export type ReadingKind = 'real' | 'demo' | 'derived' | 'blank'

export interface ReadingDef {
  label: string
  unit: string
  /** observation typeCodes, joined '/' when paired (BP) */
  codes: string[]
  /** bedside only: the roster-merged demo-snapshot fallback fields */
  keys?: (keyof MonitorVitals)[]
  /** the NEWS2 component this reading feeds (engine key) — absent = not a
   *  NEWS2 parameter, always neutral. NIBP (cuff sbp) is the score's
   *  systolic input; the arterial line is NOT (news2.ts reads 'sbp' only). */
  news2Key?: string
  /** a ventilator SETTING (as opposed to a measured value) */
  setting?: boolean
}

export interface ResolvedReading {
  def: ReadingDef
  kind: ReadingKind
  text: string
  /** UTC wire stamp of the newest contributing observation (real/derived) */
  clinicalTime?: string
  source?: LatestObservation['source']
  /** derived readings: how it was derived */
  derivation?: string
}

export interface ObservationGroup {
  key: 'bedside' | 'ventilator' | 'hemodynamics'
  title: string
  readings: ResolvedReading[]
}

export const BEDSIDE: ReadingDef[] = [
  { label: 'Heart Rate', unit: 'bpm', codes: ['hr'], keys: ['hr'], news2Key: 'hr' },
  { label: 'Arterial BP', unit: 'mmHg', codes: ['art_sbp', 'art_dbp'], keys: ['sys', 'dia'] },
  { label: 'MAP', unit: 'mmHg', codes: ['map'], keys: ['map'] },
  { label: 'NIBP', unit: 'mmHg', codes: ['sbp', 'dbp'], keys: ['nibpSys', 'nibpDia'], news2Key: 'sbp' },
  { label: 'SpO₂', unit: '%', codes: ['spo2'], keys: ['spo2'], news2Key: 'spo2' },
  { label: 'Resp Rate', unit: '/min', codes: ['rr'], keys: ['rr'], news2Key: 'rr' },
  { label: 'Temp', unit: '°C', codes: ['temp'], keys: ['temp'], news2Key: 'temp' },
  { label: 'EtCO₂', unit: 'mmHg', codes: ['etco2'], keys: ['etco2'] },
  { label: 'CVP', unit: 'mmHg', codes: ['cvp'], keys: ['cvp'] },
]

/** the Ventilator card's tiles, verbatim order and units (projectVentilator) */
export const VENTILATOR: ReadingDef[] = [
  { label: 'Mode', unit: '', codes: ['vent_mode'], setting: true },
  { label: 'FiO₂', unit: '%', codes: ['fio2'], setting: true },
  { label: 'PEEP', unit: 'cmH₂O', codes: ['peep'], setting: true },
  { label: 'Set Rate', unit: '/min', codes: ['rr_set'], setting: true },
  { label: 'Measured Rate', unit: '/min', codes: ['rr_measured'] },
  { label: 'TV Set', unit: 'mL', codes: ['vt_set'], setting: true },
  { label: 'TV Exhaled', unit: 'mL', codes: ['vt_exhaled'] },
  { label: 'Peak Pressure', unit: 'cmH₂O', codes: ['ppeak'] },
  { label: 'Plateau', unit: 'cmH₂O', codes: ['pplat'] },
  { label: 'Driving Pressure', unit: 'cmH₂O', codes: [] },
  { label: 'Minute Vent.', unit: 'L/min', codes: ['minute_ventilation'] },
  { label: 'I:E', unit: '', codes: ['ie_ratio'] },
]

/** the Hemodynamics card's tiles (projectHemodynamics) WITHOUT CVP, which
 *  the bedside group already carries — the one duplicate the plan removes */
export const HEMODYNAMICS: ReadingDef[] = [
  { label: 'Cardiac Output', unit: 'L/min', codes: ['cardiac_output'] },
  { label: 'Cardiac Index', unit: 'L/min/m²', codes: ['cardiac_index'] },
  { label: 'SVR', unit: 'dyn·s/cm⁵', codes: ['svr'] },
  { label: 'Lactate', unit: 'mmol/L', codes: ['lactate_poc'] },
  { label: 'Urine Output', unit: 'mL', codes: ['urine_output'] },
]

/** every typeCode the combined card reads — each exactly once. The lists
 *  are explicit, never a generic sweep of the chart, so the I&O manual
 *  snapshots (io_current_intake_ml / io_current_output_ml — the nurse's
 *  I&O panel's, contract §5.3) can never surface here. */
export const COMBINED_CODES: string[] =
  [...BEDSIDE, ...VENTILATOR, ...HEMODYNAMICS].flatMap(r => r.codes)

/** clinicalTime is the UTC wire 'yyyy-MM-dd HH:mm' — lexical order is time order */
const newestOf = (xs: LatestObservation[]): LatestObservation =>
  [...xs].sort((a, b) => (a.clinicalTime < b.clinicalTime ? 1 : a.clinicalTime > b.clinicalTime ? -1 : 0))[0]

function resolveCoded(def: ReadingDef, latest: Map<string, LatestObservation>, vitals: MonitorVitals | null): ResolvedReading {
  const codes = def.codes
  const real = codes.map(c => latest.get(c))
  if (real.some(Boolean)) {
    const present = real.filter((x): x is LatestObservation => !!x)
    const newest = newestOf(present)
    return {
      def, kind: 'real',
      text: codes.map((_, i) => real[i]?.value ?? '—').join('/'),
      clinicalTime: newest.clinicalTime, source: newest.source,
    }
  }
  if (vitals && def.keys) {
    const demo = def.keys.map(k => vitals[k])
    if (demo.some(v => v !== null)) {
      return { def, kind: 'demo', text: demo.map(v => (v === null ? '—' : String(v))).join('/') }
    }
  }
  return { def, kind: 'blank', text: '—' }
}

/** Driving Pressure = Pplat − PEEP, ONLY when both share one charted
 *  timepoint (projectVentilator's condition, verbatim) */
export function drivingPressure(def: ReadingDef, latest: Map<string, LatestObservation>): ResolvedReading {
  const pplat = latest.get('pplat')
  const peep = latest.get('peep')
  if (pplat && peep && pplat.clinicalTime === peep.clinicalTime) {
    return {
      def, kind: 'derived',
      text: String(Number(pplat.value) - Number(peep.value)),
      clinicalTime: pplat.clinicalTime,
      derivation: 'Plateau − PEEP, both charted at this time',
    }
  }
  return {
    def, kind: 'blank', text: '—',
    derivation: pplat && peep
      ? 'Plateau and PEEP were charted at different times — not derived'
      : 'needs Plateau and PEEP charted at one time',
  }
}

/** the three groups of the combined card; `vitals` = the roster-merged
 *  bedside fallback (null = none) */
export function combinedObservationGroups(
  latest: Map<string, LatestObservation>,
  vitals: MonitorVitals | null,
  rhythm: string,
): ObservationGroup[] {
  const bedside = BEDSIDE.map(d => resolveCoded(d, latest, vitals))
  /* rhythm arrives roster-MERGED (real-else-demo-else '—'); the latest map
     says whether a real cardiac_rhythm exists */
  const rhythmDef: ReadingDef = { label: 'Rhythm', unit: '', codes: ['cardiac_rhythm'] }
  const realRhythm = latest.get('cardiac_rhythm')
  bedside.push(realRhythm
    ? { def: rhythmDef, kind: 'real', text: realRhythm.value, clinicalTime: realRhythm.clinicalTime, source: realRhythm.source }
    : rhythm && rhythm !== '—'
      ? { def: rhythmDef, kind: 'demo', text: rhythm }
      : { def: rhythmDef, kind: 'blank', text: '—' })
  return [
    { key: 'bedside', title: 'Bedside', readings: bedside },
    {
      key: 'ventilator', title: 'Ventilator',
      readings: VENTILATOR.map(d => (d.label === 'Driving Pressure' ? drivingPressure(d, latest) : resolveCoded(d, latest, null))),
    },
    { key: 'hemodynamics', title: 'Hemodynamics', readings: HEMODYNAMICS.map(d => resolveCoded(d, latest, null)) },
  ]
}
