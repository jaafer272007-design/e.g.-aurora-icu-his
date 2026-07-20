/* THE CLIENT TOOL REGISTRY — the mirror of the server's catalog
   (server/Core/Ai/AiApi.cs Tools). THE DEFINING RULE (design §2): the
   model only ever SELECTED one of these names; everything below executes
   through the SAME canonical, RBAC-enforced reads every screen uses —
   src/lib/api — on the USER's own token (the reads attach it themselves;
   no service account exists anywhere in this path, #104). The registry
   REFUSES any name not listed here, so a hallucinated tool is a visible
   refusal, never an execution.

   READ-ONLY, FOREVER (locked decision 1): every import below is a GET
   adapter or a pure computation. No write adapter is imported and no
   entry creates, signs, documents, acknowledges, corrects or assigns
   anything — assert by inspection of this file.

   "Worst" is never the model's judgment (§7): score_ranking/worst_period
   only carry WHICH instrument to sort by — Aurora computes through the
   scoring engine, ranks only COMPLETE scores, and reports the INCOMPLETE
   denominator. A patient with no charted data is never "the least sick". */

import {
  getCoverage, getEncounters, getImagingStudies, getLabDraws, getMarRows,
  getObservations, getPatientIdentity, getPatientOrders, getPatients, getTimeline,
} from '../api'
import type {
  CoverageRow, Encounter, ImagingStudy, LabDraw, MarRow, Observation, Order,
  OrderStatus, PatientIdentity, PatientSummary, TimelineEvent,
} from '../api/types'
import {
  computeNews2, computeSofa, type News2Computation, type ScoreResult, type SofaComputation,
} from '../scoring'
import { buildWorstPeriodSeries, type SeriesInstrument, type WorstPeriodSeries } from '../scoring/series'

/* the EXACT server catalog names — anything else is refused.
   condition_interpretation (owner's 2026-07-18 decision) is still a READ:
   this registry fetches the same canonical data as the score/orders/labs
   tools and renders it; the labeled commentary the screen adds afterwards
   comes from a separate endpoint over THAT rendered snapshot — no write
   exists here and no fact bypasses the record. */
export const AI_READ_TOOLS = [
  'census', 'patient_identity', 'encounters', 'assignments', 'orders', 'mar',
  'observations', 'labs', 'imaging', 'score', 'score_ranking', 'worst_period', 'timeline',
  'condition_interpretation',
] as const

const ORDER_STATUSES: OrderStatus[] = ['pending', 'active', 'completed', 'discontinued']

/* every result the registry can hand the screen — a closed union the UI
   renders with Aurora's own components; the model contributes none of it */
export type AiToolResult =
  | { kind: 'census'; rows: PatientSummary[] }
  | { kind: 'no-patient'; ref: string }
  | { kind: 'candidates'; ref: string; candidates: PatientSummary[] }
  | { kind: 'unavailable'; what: string }
  | { kind: 'identity'; patient: PatientSummary; identity: PatientIdentity }
  | { kind: 'encounters'; patient: PatientSummary; rows: Encounter[] }
  | { kind: 'assignments'; patient: PatientSummary | null; rows: CoverageRow[] }
  | { kind: 'orders'; patient: PatientSummary; rows: Order[]; status: OrderStatus | null }
  | { kind: 'mar'; patient: PatientSummary; rows: MarRow[] }
  | { kind: 'observations'; patient: PatientSummary; rows: Observation[] }
  | { kind: 'labs'; patient: PatientSummary; rows: LabDraw[] }
  | { kind: 'imaging'; patient: PatientSummary; rows: ImagingStudy[] }
  | { kind: 'score'; patient: PatientSummary; instrument: 'sofa'; sofa: SofaComputation }
  | { kind: 'score'; patient: PatientSummary; instrument: 'news2'; news2: News2Computation }
  | {
      kind: 'ranking'; instrument: SeriesInstrument
      ranked: { patient: PatientSummary; result: ScoreResult }[]
      incomplete: { patient: PatientSummary; result: ScoreResult }[]
      total: number
    }
  | { kind: 'worst-period'; patient: PatientSummary; instrument: SeriesInstrument; series: WorstPeriodSeries }
  | { kind: 'timeline'; patient: PatientSummary; rows: TimelineEvent[] }
  | {
      kind: 'condition'; patient: PatientSummary
      identity: PatientIdentity | null; encounter: Encounter | null
      news2: News2Computation; sofa: SofaComputation
      observations: Observation[]; labs: LabDraw[]; activeOrders: Order[]
    }

/* ---------- patient resolution (free text → a census patient) ----------
   The model passes the user's reference through VERBATIM (name in any
   script, P-id, bed, MRN, national ID). Resolution is against the REAL
   census the user may read, with the app's established matching
   discipline: exact on identifiers, substring on names, NO fuzzy match —
   and an ambiguous reference is surfaced as candidates for the human to
   pick, never auto-picked (the Tier-B "a human verifies" rule). */
type Resolution =
  | { hit: 'one'; patient: PatientSummary }
  | { hit: 'many'; candidates: PatientSummary[] }
  | { hit: 'none' }

function resolveAgainst(census: PatientSummary[], refRaw: string): Resolution {
  const ref = refRaw.trim()
  if (ref === '') return { hit: 'none' }
  const low = ref.toLowerCase()
  const exact = census.filter(p =>
    p.patientId.toLowerCase() === low || p.bedId.toLowerCase() === low
    || p.mrn.toLowerCase() === low || (p.nationalId ?? '').toLowerCase() === low)
  if (exact.length === 1) return { hit: 'one', patient: exact[0] }
  if (exact.length > 1) return { hit: 'many', candidates: exact }
  const byName = census.filter(p =>
    p.name.toLowerCase().includes(low) || (p.fullName ?? '').toLowerCase().includes(low))
  if (byName.length === 1) return { hit: 'one', patient: byName[0] }
  if (byName.length > 1) return { hit: 'many', candidates: byName }
  return { hit: 'none' }
}

/* ---------- argument helpers (model args are untrusted JSON) ---------- */
const argString = (args: Record<string, unknown> | null, key: string): string | null => {
  const v = args?.[key]
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

function argInstrument(args: Record<string, unknown> | null): SeriesInstrument {
  const v = argString(args, 'instrument')
  if (v === 'sofa' || v === 'news2') return v
  throw new Error(`the model passed an invalid instrument '${v ?? ''}' — expected sofa or news2; nothing was computed`)
}

/* ---------- score input assembly (the SofaCard read set, unchanged) ---------- */
async function scoreInputs(patient: PatientSummary): Promise<
  { ok: true; labs: LabDraw[]; observations: Observation[]; orders: Order[]; weightKg: number | null; encounter: Encounter | null } | { ok: false }> {
  const [enc, labs, obs, orders] = await Promise.all([
    getEncounters({ patientId: patient.patientId, status: 'open' }),
    getLabDraws(patient.patientId),
    getObservations(patient.patientId),
    getPatientOrders(patient.patientId),
  ])
  if (obs === null) return { ok: false } // the real-only observations read is unreachable — honest unavailable
  return { ok: true, labs, observations: obs, orders, weightKg: enc[0]?.weightKg ?? null, encounter: enc[0] ?? null }
}

/* ---------- the executor ---------- */
export async function executeAiTool(tool: string, args: Record<string, unknown> | null): Promise<AiToolResult> {
  if (!(AI_READ_TOOLS as readonly string[]).includes(tool))
    throw new Error(`'${tool}' is not on the read-only tool registry — nothing was executed`)

  if (tool === 'census') return { kind: 'census', rows: await getPatients() }

  if (tool === 'score_ranking') {
    const instrument = argInstrument(args)
    const census = await getPatients()
    const scored = await Promise.all(census.map(async patient => {
      if (instrument === 'news2') {
        const obs = await getObservations(patient.patientId)
        /* an unreachable chart is INCOMPLETE by construction (0/7) —
           never scored, never ranked */
        const result = computeNews2({ observations: obs ?? [], now: new Date() }).result
        return { patient, result }
      }
      const inputs = await scoreInputs(patient)
      const result = computeSofa({
        labs: inputs.ok ? inputs.labs : [], observations: inputs.ok ? inputs.observations : [],
        orders: inputs.ok ? inputs.orders : [], weightKg: inputs.ok ? inputs.weightKg : null, now: new Date(),
      }).worst
      return { patient, result }
    }))
    /* Aurora ranks — COMPLETE scores only, descending; INCOMPLETE is a
       stated denominator, never a rank (§7) */
    const ranked = scored.filter(s => s.result.complete).sort((a, b) => b.result.total - a.result.total)
    const incomplete = scored.filter(s => !s.result.complete)
    return { kind: 'ranking', instrument, ranked, incomplete, total: scored.length }
  }

  /* every remaining tool is patient-scoped except assignments (optional) */
  const ref = argString(args, 'patient')
  if (tool === 'assignments' && ref === null)
    return { kind: 'assignments', patient: null, rows: await getCoverage() }
  if (ref === null) throw new Error(`the model called ${tool} without a patient — nothing was executed`)

  const census = await getPatients()
  const res = resolveAgainst(census, ref)
  if (res.hit === 'none') return { kind: 'no-patient', ref }
  if (res.hit === 'many') return { kind: 'candidates', ref, candidates: res.candidates }
  const patient = res.patient
  const id = patient.patientId

  switch (tool) {
    case 'patient_identity': {
      const identity = await getPatientIdentity(id)
      if (!identity) return { kind: 'unavailable', what: `the identity record for ${patient.name}` }
      return { kind: 'identity', patient, identity }
    }
    case 'encounters':
      return { kind: 'encounters', patient, rows: await getEncounters({ patientId: id }) }
    case 'assignments':
      return { kind: 'assignments', patient, rows: await getCoverage(id) }
    case 'orders': {
      const statusArg = argString(args, 'status')
      const status = ORDER_STATUSES.find(s => s === statusArg) ?? null
      const rows = await getPatientOrders(id)
      return { kind: 'orders', patient, rows: status ? rows.filter(o => o.status === status) : rows, status }
    }
    case 'mar':
      return { kind: 'mar', patient, rows: await getMarRows([id]) }
    case 'observations': {
      const rows = await getObservations(id)
      if (rows === null) return { kind: 'unavailable', what: `the observations chart for ${patient.name}` }
      return { kind: 'observations', patient, rows }
    }
    case 'labs':
      return { kind: 'labs', patient, rows: await getLabDraws(id) }
    case 'imaging':
      return { kind: 'imaging', patient, rows: await getImagingStudies(id) }
    case 'timeline':
      return { kind: 'timeline', patient, rows: await getTimeline(id) }
    case 'score': {
      const instrument = argInstrument(args)
      const inputs = await scoreInputs(patient)
      if (!inputs.ok) return { kind: 'unavailable', what: `the observations chart for ${patient.name} (scores need it)` }
      if (instrument === 'news2')
        return { kind: 'score', patient, instrument, news2: computeNews2({ observations: inputs.observations, now: new Date() }) }
      return {
        kind: 'score', patient, instrument,
        sofa: computeSofa({ labs: inputs.labs, observations: inputs.observations, orders: inputs.orders, weightKg: inputs.weightKg, now: new Date() }),
      }
    }
    case 'condition_interpretation': {
      /* the FULL-RECORD condition overview (the owner's ask: the
         interpretation reads all the patient's current data) — the
         SofaCard read set plus identity, admission, both scores, the
         recent observation history, the recent draws and every
         not-yet-completed order. Everything the labeled interpretation
         may later comment on is fetched HERE, through the same
         canonical reads, and rendered before any commentary is
         requested. Bounds exist only to fit the model's context —
         stated on the card, never silently. */
      const inputs = await scoreInputs(patient)
      if (!inputs.ok) return { kind: 'unavailable', what: `the observations chart for ${patient.name} (a condition overview needs it)` }
      const identity = await getPatientIdentity(patient.patientId).catch(() => null)
      const byTime = (a: LabDraw, b: LabDraw) =>
        (b.resultedAt ?? b.collectedAt ?? '').localeCompare(a.resultedAt ?? a.collectedAt ?? '')
      return {
        kind: 'condition',
        patient,
        identity,
        encounter: inputs.encounter,
        news2: computeNews2({ observations: inputs.observations, now: new Date() }),
        sofa: computeSofa({ labs: inputs.labs, observations: inputs.observations, orders: inputs.orders, weightKg: inputs.weightKg, now: new Date() }),
        observations: inputs.observations.slice(-24), // oldest-first read → the latest 24
        labs: [...inputs.labs].sort(byTime).slice(0, 6),
        activeOrders: inputs.orders.filter(o => o.status === 'active' || o.status === 'pending'),
      }
    }
    case 'worst_period': {
      const instrument = argInstrument(args)
      const inputs = await scoreInputs(patient)
      if (!inputs.ok) return { kind: 'unavailable', what: `the observations chart for ${patient.name} (scores need it)` }
      const series = buildWorstPeriodSeries(instrument, {
        labs: inputs.labs, observations: inputs.observations, orders: inputs.orders, weightKg: inputs.weightKg, now: new Date(),
      })
      return { kind: 'worst-period', patient, instrument, series }
    }
    default:
      throw new Error(`'${tool}' is not on the read-only tool registry — nothing was executed`)
  }
}

/* ---------- the interpretation snapshot ----------
   EXACTLY the values the condition card renders — the labeled commentary
   may only ever comment on what the user can already see on screen. The
   snapshot is compact JSON the /interpret endpoint forwards verbatim to
   the model; it carries no identifiers beyond the display name (the model
   needs no MRN to describe a trend). */
const scoreJson = (r: ScoreResult) => r.complete
  ? { total: r.total, max: r.maxTotal }
  : { incomplete: true, computable: `${r.computedCount}/${r.componentCount}`, missing: r.incompleteComponents }

export function conditionSnapshot(r: Extract<AiToolResult, { kind: 'condition' }>): unknown {
  return {
    patient: {
      name: r.patient.name,
      diagnosis: r.patient.diagnosis,
      ...(r.identity ? { age: r.identity.age, sex: r.identity.sex, allergies: r.identity.allergies || 'none recorded' } : {}),
      ...(r.encounter ? { admitted: r.encounter.admittedAt ?? undefined, attending: r.encounter.attending } : {}),
    },
    scores: {
      news2: { ...scoreJson(r.news2.result), ...(r.news2.result.complete && r.news2.band ? { band: r.news2.band.label } : {}), ...(r.news2.ventilated ? { onRespiratorySupport: true } : {}) },
      sofa: { worst24h: scoreJson(r.sofa.worst), latest: scoreJson(r.sofa.latest) },
    },
    latestObservations: r.observations.map(o => ({ time: o.clinicalTime, type: o.typeCode, value: o.value, unit: o.unit })),
    latestLabDraws: r.labs.map(d => ({
      label: d.label,
      at: d.resultedAt ?? d.collectedAt,
      values: d.custom
        ? [{ analyte: d.label, value: d.customValue, unit: d.customUnit }]
        : d.items.map(it => ({ analyte: it.analyte, value: it.value, unit: it.unit, flag: it.flag })),
    })),
    activeOrders: r.activeOrders.map(o => o.summary),
  }
}
