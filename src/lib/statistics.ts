import type { AdtBed, Encounter, FormularyDrug, LabDraw, Observation, Order } from './api/types'
import { isDeathDisposition } from './api'
import { datedEpoch } from './time'
import { computeNews2, computeSofa } from './scoring'
import { NEWS2_V1, NEWS2_WINDOW_MINUTES, buildNews2Context } from './scoring/news2'
import { aggregate } from './scoring/engine'

/* Statistics — ICU Analytics Dashboard (docs/design/
   statistics-dashboard-design.md). PURE computation, COMPUTED AT RENDER
   from the canonical reads (beds / encounters / observations / orders /
   labs / formulary + the scoring engine) — no stored statistics, no forks.

   THE CORE PRINCIPLE (§0): never display any value not backed by real
   data. Every metric here is either computed from real records or
   represented as an explicit absence the UI renders as "not tracked yet" /
   "insufficient data" — never a fabricated number. Consequences honoured
   throughout:
   - INCOMPLETE-aware averages: SOFA/NEWS2 averages run ONLY over patients
     whose score is computable, and carry their denominator (§0.2).
   - Going-forward data: dated timestamps (#95) and dispositions (#96)
     exist on NEW records only; every time-based metric carries its dated
     denominator so sparseness is stated, not hidden (§0.1).
   - A real 0 is a real 0 — the model distinguishes "computed 0" from
     "no computable inputs" (value: null). */

/* ---------- period helpers (UTC calendar periods — stated on the page) ---------- */

const DAY_MS = 86_400_000

/** UTC midnight of the day containing `t` */
const utcDayStart = (t: number): number => Math.floor(t / DAY_MS) * DAY_MS

/** start of the UTC calendar week (Monday) containing `now` */
export function utcWeekStart(now: Date): number {
  const day = utcDayStart(now.getTime())
  const dow = new Date(day).getUTCDay() // 0=Sun
  return day - ((dow + 6) % 7) * DAY_MS
}

/** start of the UTC calendar month containing `now` */
export function utcMonthStart(now: Date): number {
  return Date.parse(`${new Date(now).toISOString().slice(0, 7)}-01T00:00:00Z`)
}

/* ---------- model ---------- */

/** an averaged score metric — INCOMPLETE-aware with a labelled denominator */
export interface AveragedMetric {
  /** null = no computable inputs (renders "insufficient data", never 0) */
  value: number | null
  /** patients whose score was computable */
  computable: number
  /** all patients considered */
  total: number
}

/** a count over the subset of records that carry the needed (dated /
 *  dispositioned) field — the going-forward honesty carrier */
export interface QualifiedCount {
  count: number
  /** records that qualified (carried the field) */
  qualified: number
  /** all records considered */
  total: number
}

export interface TrendPoint {
  label: string
  value: number | null
  /** score-trend points carry their computable denominator */
  computable?: number
}

export interface StatisticsModel {
  now: Date
  /* 1 — Current Unit Status */
  bedsTotal: number
  bedsOccupied: number
  bedsAvailable: number
  occupancyPct: number
  ventilated: { count: number; withObs: number; total: number }
  vasopressor: { count: number; withOrders: number; total: number }
  /** OPEN encounters carrying isolation precautions (the typed IPC set) */
  isolation: { count: number }
  avgSofa: AveragedMetric
  avgNews2: AveragedMetric
  /** mean LOS days over CURRENT patients with dated admissions */
  avgLosDays: { value: number | null; dated: number; total: number }
  /* 2 — Admissions (dated records only) */
  admissionsToday: number
  admissionsWeek: number
  admissionsMonth: number
  admissionsDatedTotal: number
  admissionsUndatedTotal: number
  /* 3 — Outcomes */
  dischargesTotal: number
  dischargesToday: number
  dischargesWeek: number
  dischargesMonth: number
  dischargesDated: number
  deaths: number
  mortality: { pct: number | null; died: number; withDisposition: number; withoutDisposition: number }
  outcomeBreakdown: { code: string; count: number }[]
  outcomeNotRecorded: number
  readmittedPatients: number
  readmissionsWithin48h: { count: number; datedPairs: number }
  /* 4 — Clinical Quality */
  criticalLabs: { acknowledged: number; total: number }
  timeToAntibioticMin: { value: number | null; encounters: number; consideredEncounters: number }
  /* 5 — Trends (daily × 14 days; score trends at the scores' native 24 h windows) */
  occupancyTrend: TrendPoint[]
  admissionsTrend: TrendPoint[]
  sofaTrend: TrendPoint[]
  news2Trend: TrendPoint[]
  /** dated encounters feeding the occupancy/admissions trends (sparseness label) */
  trendDatedEncounters: number
}

/** everything fetched for one CURRENT (open-encounter) patient. Null reads
 *  mean the source was unavailable — the patient is excluded from that
 *  metric's computable denominator, never counted as zero. */
export interface PatientBundle {
  patientId: string
  encounter: Encounter
  labs: LabDraw[] | null
  observations: Observation[] | null
  orders: Order[] | null
}

export interface StatisticsInputs {
  beds: AdtBed[]
  /** ALL encounters (open + discharged) */
  encounters: Encounter[]
  formulary: FormularyDrug[]
  patients: PatientBundle[]
  now: Date
}

/* ---------- drug-class helpers (formulary is the authority) ---------- */

const classOf = (formulary: FormularyDrug[], drugId: string): string =>
  formulary.find(d => d.drugId === drugId)?.drugClass ?? ''

/** the CENSUS definition of "on vasopressors": any active/pending-none —
 *  ACTIVE medication order whose formulary class is Vasopressor. Unlike
 *  SOFA's cardiovascular component this deliberately INCLUDES vasopressin
 *  and phenylephrine (they are excluded from SOFA scoring, not from being
 *  vasopressors). */
const onVasopressor = (orders: Order[], formulary: FormularyDrug[]): boolean =>
  orders.some(o => o.category === 'Medication' && o.status === 'active'
    && o.medication && classOf(formulary, o.medication.drugId).startsWith('Vasopressor'))

const isAntibiotic = (formulary: FormularyDrug[], drugId: string): boolean =>
  classOf(formulary, drugId).startsWith('Antibiotic')

/* ---------- the computation ---------- */

export function computeStatistics(inputs: StatisticsInputs): StatisticsModel {
  const { beds, encounters, formulary, patients, now } = inputs
  const nowMs = now.getTime()
  const todayStart = utcDayStart(nowMs)
  const weekStart = utcWeekStart(now)
  const monthStart = utcMonthStart(now)

  /* ----- unit status ----- */
  /* Bed Registry: census denominators count ACTIVE beds only — a retired
     bed is not unit capacity (it cannot be occupied either: retiring an
     occupied bed is refused server-side) */
  const activeBeds = beds.filter(b => b.active)
  const bedsOccupied = activeBeds.filter(b => b.patientId).length
  const bedsTotal = activeBeds.length
  const open = encounters.filter(e => e.status === 'open')

  /* ventilated — from charted resp_support/vent context (the NEWS2 context
     already derives "on respiratory support" from the real observations
     within the score window; reused so there is exactly one definition) */
  const withObs = patients.filter(p => p.observations !== null)
  const ventilated = withObs.filter(p =>
    computeNews2({ observations: p.observations!, now }).ventilated).length

  const withOrders = patients.filter(p => p.orders !== null)
  const vasopressor = withOrders.filter(p => onVasopressor(p.orders!, formulary)).length

  /* INCOMPLETE-aware unit averages (§0.2): only computable scores average;
     an INCOMPLETE patient is counted in `total` but never as a zero */
  const sofaResults = patients.map(p => (p.labs && p.observations && p.orders)
    ? computeSofa({ labs: p.labs, observations: p.observations, orders: p.orders, weightKg: p.encounter.weightKg ?? null, now })
    : null)
  const sofaComplete = sofaResults.filter(r => r?.worst.complete).map(r => r!.worst.total)
  const news2Results = patients.map(p => p.observations
    ? computeNews2({ observations: p.observations, now }) : null)
  const news2Complete = news2Results.filter(r => r?.result.complete).map(r => r!.result.total)

  const avg = (xs: number[]): number | null =>
    xs.length === 0 ? null : Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10

  /* LOS over CURRENT patients with dated admissions (going-forward) */
  const openDated = open
    .map(e => datedEpoch(e.admittedAt))
    .filter((ms): ms is number => ms !== null)
  const losDays = openDated.map(ms => (nowMs - ms) / DAY_MS)

  /* ----- admissions (dated only — undated seeds are counted as such, never placed in time) ----- */
  const admissionEpochs = encounters
    .map(e => datedEpoch(e.admittedAt))
    .filter((ms): ms is number => ms !== null)
  const admissionsUndatedTotal = encounters.length - admissionEpochs.length
  const inPeriod = (epochs: number[], start: number) => epochs.filter(ms => ms >= start && ms <= nowMs).length

  /* ----- outcomes ----- */
  const discharged = encounters.filter(e => e.status === 'discharged')
  const dischargeEpochs = discharged
    .map(e => datedEpoch(e.dischargedAt ?? ''))
    .filter((ms): ms is number => ms !== null)
  const withDispo = discharged.filter(e => e.disposition)
  /* DEATH resolves through the vocabulary's immutable isDeath attribute
     (Configuration Vocabularies) — a hospital-added death disposition
     counts; a label edit never changes a recorded outcome */
  const deaths = withDispo.filter(e => isDeathDisposition(e.disposition)).length
  /* breakdown over the codes ACTUALLY RECORDED (hospital-added
     dispositions appear; codes never recorded don't) in first-seen
     order of the seeded set then any custom ones */
  const seeded = ['home', 'ward', 'transfer_out', 'higher_care', 'died', 'other']
  const recorded = [...new Set(withDispo.map(e => e.disposition!))]
  const outcomeCodes = [...seeded.filter(c => recorded.includes(c)), ...recorded.filter(c => !seeded.includes(c))]
  const outcomeBreakdown = outcomeCodes.map(code => ({
    code, count: withDispo.filter(e => e.disposition === code).length,
  }))

  /* readmissions: patients with >1 encounter; the <48 h window only over
     DATED discharge→next-admission pairs (never inferred for undated) */
  const byPatient = new Map<string, Encounter[]>()
  for (const e of encounters) {
    byPatient.set(e.patientId, [...(byPatient.get(e.patientId) ?? []), e])
  }
  const readmittedPatients = [...byPatient.values()].filter(list => list.length > 1).length
  let datedPairs = 0, within48 = 0
  for (const list of byPatient.values()) {
    const sorted = [...list].sort((a, b) => a.encounterId.localeCompare(b.encounterId))
    for (let i = 1; i < sorted.length; i++) {
      const prevOut = datedEpoch(sorted[i - 1].dischargedAt ?? '')
      const nextIn = datedEpoch(sorted[i].admittedAt)
      if (prevOut === null || nextIn === null) continue
      datedPairs++
      if (nextIn - prevOut <= 48 * 3_600_000 && nextIn >= prevOut) within48++
    }
  }

  /* ----- clinical quality ----- */
  /* critical results across CURRENT patients' labs: acknowledged rate */
  let critTotal = 0, critAck = 0
  for (const p of patients) {
    for (const d of p.labs ?? []) {
      if (d.flag !== 'critical') continue
      critTotal++
      if (d.acknowledged) critAck++
    }
  }

  /* time to first antibiotic: per CURRENT encounter with a dated admission,
     first ACTIVE-lifecycle antibiotic order with a dated orderedTime ≥
     admission; averaged in minutes over the qualifying encounters */
  const ttaSamples: number[] = []
  let ttaConsidered = 0
  for (const p of patients) {
    const admit = datedEpoch(p.encounter.admittedAt)
    if (admit === null || p.orders === null) continue
    ttaConsidered++
    const times = p.orders
      .filter(o => o.category === 'Medication' && o.medication
        && isAntibiotic(formulary, o.medication.drugId)
        && (o.encounterId === undefined || o.encounterId === p.encounter.encounterId))
      .map(o => datedEpoch(o.orderedTime))
      .filter((ms): ms is number => ms !== null && ms >= admit)
    if (times.length === 0) continue
    ttaSamples.push((Math.min(...times) - admit) / 60_000)
  }

  /* ----- trends (granularity choice, stated: DAILY × the last 14 days for
     occupancy/admissions; SOFA/NEWS2 at their native 24 h windows —
     now / 24 h ago / 48 h ago — averaged over computable patients) ----- */
  const DAYS = 14
  const occupancyTrend: TrendPoint[] = []
  const admissionsTrend: TrendPoint[] = []
  const datedIntervals = encounters
    .map(e => ({ in: datedEpoch(e.admittedAt), out: e.dischargedAt ? datedEpoch(e.dischargedAt) : null, open: e.status === 'open' }))
    .filter(iv => iv.in !== null)
  for (let d = DAYS - 1; d >= 0; d--) {
    const dayStart = todayStart - d * DAY_MS
    const dayEnd = dayStart + DAY_MS
    const label = new Date(dayStart).toISOString().slice(5, 10)
    admissionsTrend.push({ label, value: admissionEpochs.filter(ms => ms >= dayStart && ms < dayEnd).length })
    occupancyTrend.push({
      label,
      value: datedIntervals.filter(iv =>
        iv.in! < dayEnd && (iv.open ? true : iv.out === null || iv.out >= dayStart)).length,
    })
  }

  const sofaTrendOffsets = [48, 24, 0]
  const sofaTrend: TrendPoint[] = sofaTrendOffsets.map(h => {
    const pts = sofaResults
      .map(r => r?.trend.find(t => t.endedHoursAgo === h)?.result)
      .filter(res => res?.complete)
      .map(res => res!.total)
    return { label: h === 0 ? 'now' : `${h} h ago`, value: avg(pts), computable: pts.length }
  })
  const news2Trend: TrendPoint[] = sofaTrendOffsets.map(h => {
    const pts = patients
      .filter(p => p.observations !== null)
      .map(p => aggregate(NEWS2_V1, buildNews2Context({ observations: p.observations!, now }, h * 60, NEWS2_WINDOW_MINUTES), 'latest'))
      .filter(res => res.complete)
      .map(res => res.total)
    return { label: h === 0 ? 'now' : `${h} h ago`, value: avg(pts), computable: pts.length }
  })

  return {
    now,
    bedsTotal, bedsOccupied, bedsAvailable: bedsTotal - bedsOccupied,
    occupancyPct: bedsTotal === 0 ? 0 : Math.round((bedsOccupied / bedsTotal) * 100),
    ventilated: { count: ventilated, withObs: withObs.length, total: patients.length },
    isolation: { count: encounters.filter(e => e.status === 'open' && (e.isolationTypes?.length ?? 0) > 0).length },
    vasopressor: { count: vasopressor, withOrders: withOrders.length, total: patients.length },
    avgSofa: { value: avg(sofaComplete), computable: sofaComplete.length, total: patients.length },
    avgNews2: { value: avg(news2Complete), computable: news2Complete.length, total: patients.length },
    avgLosDays: {
      value: losDays.length === 0 ? null : Math.round((losDays.reduce((a, b) => a + b, 0) / losDays.length) * 10) / 10,
      dated: losDays.length, total: open.length,
    },
    admissionsToday: inPeriod(admissionEpochs, todayStart),
    admissionsWeek: inPeriod(admissionEpochs, weekStart),
    admissionsMonth: inPeriod(admissionEpochs, monthStart),
    admissionsDatedTotal: admissionEpochs.length,
    admissionsUndatedTotal,
    dischargesTotal: discharged.length,
    dischargesToday: inPeriod(dischargeEpochs, todayStart),
    dischargesWeek: inPeriod(dischargeEpochs, weekStart),
    dischargesMonth: inPeriod(dischargeEpochs, monthStart),
    dischargesDated: dischargeEpochs.length,
    deaths,
    mortality: {
      pct: withDispo.length === 0 ? null : Math.round((deaths / withDispo.length) * 1000) / 10,
      died: deaths, withDisposition: withDispo.length,
      withoutDisposition: discharged.length - withDispo.length,
    },
    outcomeBreakdown,
    outcomeNotRecorded: discharged.length - withDispo.length,
    readmittedPatients,
    readmissionsWithin48h: { count: within48, datedPairs },
    criticalLabs: { acknowledged: critAck, total: critTotal },
    timeToAntibioticMin: {
      value: ttaSamples.length === 0 ? null : Math.round(ttaSamples.reduce((a, b) => a + b, 0) / ttaSamples.length),
      encounters: ttaSamples.length, consideredEncounters: ttaConsidered,
    },
    occupancyTrend, admissionsTrend, sofaTrend, news2Trend,
    trendDatedEncounters: datedIntervals.length,
  }
}

/* NOTE: NEWS2 escalation BANDS are deliberately not computed here — a band
   is per-patient escalation semantics; a unit AVERAGE has no band. */
