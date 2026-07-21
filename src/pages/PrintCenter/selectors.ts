import {
  getDispositions, getEncounters, getImagingStudies, getLabDraws, getObservationCatalog, getObservations,
  getPatientIdentity, getPatientOrders, getRosterRecord, getTimeline,
} from '../../lib/api'
import { resolveCodeStatus } from '../../lib/codeStatus'
import type {
  Encounter, LabDraw, Observation, ObservationType, Order, PatientIdentity, RosterRecordDto,
} from '../../lib/api/types'
import { dayOffsetOf, localStamp } from '../../lib/time'
import { computeNews2, computeSofa, type ScoreResult } from '../../lib/scoring'
import type {
  ActiveOrdersData, AdmissionNoteData, ConsultReportData, DailyProgressData, DischargeSummaryData,
  FaceSheetData, FlowsheetColumn, FlowsheetData, FlowsheetRow, FlowsheetSection,
  ImagingReportData, LabReportData, MarCell, MarMedRow, MarSheetData, MedicationOrdersData,
  PrintContext, PrintEncounterInfo, PrintMedLine, PrintOrderLine, PrintPatientIdentity,
  PrintScores, PrintVitals, SbarData, TransferSummaryData, VentDeviceData, VentSnapshotLine,
} from './types'

/* ==================== Print Center selectors ====================
   Read-only. Every function here composes EXISTING adapters — the same
   ones the application screens call — into template-ready view models.
   No store is queried by a template directly, no business logic is
   duplicated, nothing is written.

   ABSOLUTE RULE — HISTORICAL RENDERING NEVER CONSULTS THE LIVE FORMULARY.
   This module must never import getFormulary / getLabCatalog or any
   master-data adapter. Medications render from the persisted order
   record (drug text, dose, route, frequency, audit history,
   administrations) exactly as originally recorded; deactivating or
   removing a drug from the formulary after the fact MUST NOT change any
   printed document (the ORD-168 guarantee, one level up). */

/** The exact audit reason the server's discharge cascade records
 *  (server/Core/Orders/OrderLogic.cs — DischargeCascade). An order
 *  discontinued with THIS reason was active at the moment of discharge:
 *  that is what makes "medications at discharge" derivable from history
 *  alone, with no print-specific domain model. */
export const DISCHARGE_CASCADE_REASON = 'patient discharged — auto-discontinued at discharge'

const isChartedTime = (t: string | undefined): boolean => !!t && !/^\d{4}-\d{2}-\d{2}/.test(t)

function toIdentity(r: RosterRecordDto): PrintPatientIdentity {
  /* code status prints through the ONE shared resolver (the governed-
     vocabulary SAFETY FIX): governed label · legacy text explicitly
     marked unverified · null = "Not recorded" at the render site —
     never a blank, never a default */
  const cs = resolveCodeStatus(r)
  return {
    patientId: r.patientId, name: r.name, mrn: r.mrn, age: r.age, sex: r.sex,
    allergies: r.allergies, attending: r.attending,
    codeStatus: cs.kind === 'none' ? null
      : cs.kind === 'legacy' ? `${cs.label} (legacy — unverified)` : cs.label,
    bedId: r.bedId, diagnosis: r.diagnosis,
    fullName: r.fullName ?? null, nationalId: r.nationalId ?? null,
    fileNumber: r.fileNumber ?? null, source: 'roster',
  }
}

/** THE MIDDLE RUNG (closes the recorded discharged-patient identity gap):
 *  person-level identity from the Core patient-identity read — the SAME
 *  server-side resolver the roster serves — joined with the encounter's
 *  own display fields (bed, diagnosis, attending). Code status stays
 *  bedside state (roster-only), not identity. */
function recordIdentity(p: PatientIdentity, e: Encounter, codeStatusLabel: string | null): PrintPatientIdentity {
  return {
    patientId: p.patientId, name: p.name, mrn: p.mrn, age: p.age, sex: p.sex,
    /* the ENCOUNTER's governed code status (a discharged episode that
       recorded one must print it; pre-feature episodes print "Not
       recorded") — label resolved by the caller from the vocabulary */
    allergies: p.allergies, attending: e.attending, codeStatus: codeStatusLabel,
    bedId: e.bedId, diagnosis: e.diagnosis,
    fullName: p.fullName ?? null, nationalId: p.nationalId ?? null,
    fileNumber: p.fileNumber ?? null, source: 'patient-record',
  }
}

/** Last resort — identity read unreachable AND patient off the roster:
 *  the encounter's own display snapshot, and the document SAYS so instead
 *  of fabricating the missing fields. */
function snapshotIdentity(e: Encounter): PrintPatientIdentity {
  return {
    patientId: e.patientId, name: e.patientName, mrn: null, age: null, sex: null,
    allergies: null, attending: e.attending, codeStatus: null,
    bedId: e.bedId, diagnosis: e.diagnosis,
    fullName: null, nationalId: null, fileNumber: null, source: 'encounter-snapshot',
  }
}

function toEncounterInfo(target: Encounter, all: Encounter[]): PrintEncounterInfo {
  return {
    encounterId: target.encounterId,
    status: target.status,
    admittedAt: target.admittedAt,
    admittedBy: target.admittedBy,
    dischargedAt: target.dischargedAt,
    dischargedBy: target.dischargedBy,
    disposition: target.disposition,
    otherEncounterCount: all.filter(e => e.encounterId !== target.encounterId).length,
  }
}

export interface ResolvedContext {
  context: PrintContext
  roster: RosterRecordDto | null
  encounter: Encounter | null
  /** patient orders narrowed to the target encounter (falls back to ALL
   *  of the patient's orders when the data predates encounter scoping —
   *  the mock store — and the document notes the scope it used) */
  orders: Order[]
  encounterScoped: boolean
}

/** Shared context resolution for every template: identity + target
 *  encounter + that encounter's orders. `preferred` picks the target when
 *  several encounters exist; otherwise the open encounter wins, then the
 *  most recent discharged one. */
export async function resolveContext(patientId: string, preferredEncounterId?: string): Promise<ResolvedContext | null> {
  /* primes dispositionLabel (the MANAGED vocabulary) before any template
     renders — historical documents resolve retired entries too */
  await getDispositions().catch(() => {})
  const [roster, encounters, allOrders] = await Promise.all([
    getRosterRecord(patientId),
    getEncounters({ patientId }),
    getPatientOrders(patientId),
  ])
  const target =
    (preferredEncounterId && encounters.find(e => e.encounterId === preferredEncounterId)) ||
    encounters.find(e => e.status === 'open') ||
    encounters[encounters.length - 1] ||
    null
  if (!roster && !target) return null

  /* the print identity LADDER: roster record (admitted) → the Core
     patient-identity read (by id — resolves discharged patients) →
     encounter snapshot (last resort, offline). One rung per await:
     the identity read is only consulted when the roster misses. */
  const identity = roster ? null : await getPatientIdentity(patientId)
  /* off-roster (discharged) prints read the ENCOUNTER's OWN code-status
     record — the label SNAPSHOT captured when it was set (the results-
     range precedent: historical rendering never consults the live
     vocabulary, the module's absolute rule). A recorded instruction must
     print; absent = "Not recorded" at the render site. */
  const csEvents = target?.codeStatusCode
    ? (target.codeStatusEvents ?? []).filter(ev => ev.code === target.codeStatusCode)
    : []
  const encCodeStatus: string | null = target?.codeStatusCode
    ? (csEvents[csEvents.length - 1]?.label ?? target.codeStatusCode)
    : null
  const patient = roster ? toIdentity(roster)
    : identity ? recordIdentity(identity, target!, encCodeStatus)
    : snapshotIdentity(target!)
  const scoped = !!target && allOrders.some(o => o.encounterId)
  const orders = scoped ? allOrders.filter(o => o.encounterId === target!.encounterId) : allOrders
  const hasChartedTimes =
    orders.some(o => isChartedTime(o.orderedTime) || o.history.some(h => isChartedTime(h.time))) ||
    isChartedTime(target?.admittedAt)
  return {
    context: {
      patient,
      encounter: target ? toEncounterInfo(target, encounters) : null,
      hasChartedTimes,
    },
    roster, encounter: target, orders, encounterScoped: scoped,
  }
}

function toVitals(r: RosterRecordDto): PrintVitals {
  return {
    bedside: r.bedsideVitals, monitor: r.monitorVitals, rhythm: r.rhythm,
    flags: r.flags,
  }
}

/** REAL computed SOFA + NEWS2 for a printed document (D5 — printing reads
 *  the SAME scoring engine as the screens). Display strings only: a
 *  computed value, "Incomplete …", or "—" when the observation source is
 *  unreachable — never the retired fabricated roster integers. */
async function buildPrintScores(patientId: string, encounter: Encounter | null): Promise<{
  scores: PrintScores
  /** the raw worst-24h SOFA behind the display string — for SCORE-BACKED
   *  derived lines (the Daily Progress problem list); null = the
   *  observation source is unavailable and nothing is derived */
  sofaWorst: ScoreResult | null
}> {
  const [obs, draws, orders] = await Promise.all([
    getObservations(patientId, encounter?.encounterId),
    getLabDraws(patientId),
    getPatientOrders(patientId),
  ])
  const now = new Date()
  if (obs === null) return { scores: { sofa: '— (observation data unavailable)', news2: '— (observation data unavailable)' }, sofaWorst: null }
  const sofa = computeSofa({ labs: draws, observations: obs, orders, weightKg: encounter?.weightKg ?? null, now })
  const news2 = computeNews2({ observations: obs, now })
  return {
    scores: {
      sofa: sofa.worst.complete
        ? `${sofa.worst.total} / 24 (worst 24 h)`
        : `Incomplete — ${sofa.worst.computedCount}/6 systems scored`,
      news2: news2.result.complete
        ? `${news2.result.total} / 20 · ${news2.band!.label}`
        : `Incomplete — ${news2.result.computedCount}/7 parameters`,
    },
    sofaWorst: sofa.worst,
  }
}

/** One printable medication line from ONE persisted order — the drug is
 *  the order's own stored text, never a formulary lookup. */
function toMedLine(o: Order): PrintMedLine {
  const m = o.medication!
  const stopped = [...o.history].reverse().find(h => h.action === 'discontinued')
  const lastAdmin = [...(o.administrations ?? [])]
    .filter(a => a.status !== 'scheduled' && a.documentedTime)
    .slice(-1)[0]
  return {
    orderId: o.orderId, drug: m.drug, dose: m.dose, route: m.route,
    frequency: m.frequency, duration: m.duration, prn: m.prn,
    status: o.status, orderedBy: o.orderedBy, orderedTime: o.orderedTime,
    stoppedReason: o.statusReason ?? stopped?.detail,
    stoppedTime: stopped?.time,
    lastAdministration: lastAdmin
      ? { time: lastAdmin.documentedTime!, status: lastAdmin.status, by: lastAdmin.documentedBy ?? '' }
      : undefined,
  }
}

const medOrders = (orders: Order[]) => orders.filter(o => o.category === 'Medication' && o.medication)

/* ---------------- Template 1 — ICU Admission Note ---------------- */

export async function buildAdmissionNote(patientId: string, encounterId?: string): Promise<AdmissionNoteData | null> {
  const rc = await resolveContext(patientId, encounterId)
  if (!rc) return null
  return {
    context: rc.context,
    vitals: rc.roster ? toVitals(rc.roster) : null,
    scores: (await buildPrintScores(patientId, rc.encounter)).scores,
    medicationOrders: medOrders(rc.orders).map(toMedLine),
    investigations: rc.orders.filter(o => o.category === 'Lab' || o.category === 'Imaging'),
  }
}

/* ---------------- Template 2 — Daily Progress Note ---------------- */

export async function buildDailyProgress(patientId: string, encounterId?: string): Promise<DailyProgressData | null> {
  const rc = await resolveContext(patientId, encounterId)
  if (!rc) return null
  const [draws, timeline] = await Promise.all([getLabDraws(patientId), getTimeline(patientId)])

  const scopedDraws = rc.encounter && draws.some(d => d.encounterId)
    ? draws.filter(d => !d.encounterId || d.encounterId === rc.encounter!.encounterId)
    : draws
  const latestByPanel = new Map<string, LabDraw>()
  for (const d of scopedDraws) latestByPanel.set(d.panel, d) // draws arrive oldest→newest per panel

  const r = rc.roster
  /* the problem list is SCORE-BACKED (no-reassuring-default rule): the
     admission diagnosis plus every SOFA system the engine actually
     scored >= 1 in the last 24 h, with its evidence. The old lines came
     from the retired roster organ FIXTURES — a printed clinical document
     carried organ claims backed by nothing. A system the engine marks
     insufficient-data is NOT a problem line (not assessed != well —
     the printed scores line already states how many systems scored). */
  const { scores, sofaWorst } = await buildPrintScores(patientId, rc.encounter)
  const problems = [
    rc.context.patient.diagnosis,
    ...(sofaWorst?.components ?? [])
      .filter(c => c.score !== null && c.score >= 1)
      .map(c => `${c.label}: SOFA ${c.score}/4 (worst 24 h) — ${c.detail}`),
  ]
  return {
    context: rc.context,
    vitals: r ? toVitals(r) : null,
    scores,
    activeProblems: problems,
    ventilation: r
      ? { flagged: r.flags.includes('vent'), rhythm: r.rhythm, spo2: r.bedsideVitals.spo2, rr: r.monitorVitals.rr }
      : null,
    activeMeds: medOrders(rc.orders).filter(o => o.status === 'active').map(toMedLine),
    latestLabs: [...latestByPanel.values()],
    recentEvents: timeline.filter(e => dayOffsetOf(e.time) >= -1).slice(0, 24),
  }
}

/* ---------------- Template 3 — Discharge Summary ---------------- */

export async function buildDischargeSummary(patientId: string, encounterId?: string): Promise<DischargeSummaryData | null> {
  const rc = await resolveContext(patientId, encounterId)
  if (!rc) return null
  const [draws, imaging] = await Promise.all([getLabDraws(patientId), getImagingStudies(patientId)])
  const meds = medOrders(rc.orders)

  /* Meds ACTIVE AT DISCHARGE = discontinued by the discharge cascade
     (its persisted audit reason identifies them), plus — when printing
     BEFORE discharge — the currently active orders. Everything else that
     was discontinued stopped DURING the admission, with its own reason.
     History only; the live formulary is never consulted. */
  const dischargeMeds = meds.filter(o =>
    (o.status === 'discontinued' && o.statusReason === DISCHARGE_CASCADE_REASON) || o.status === 'active')
  const stoppedMeds = meds.filter(o =>
    o.status === 'discontinued' && o.statusReason !== DISCHARGE_CASCADE_REASON)

  const changes = meds.flatMap(o =>
    o.history.filter(h => h.action === 'modified').map(h => ({
      orderId: o.orderId, drug: o.medication!.drug, time: h.time, actor: h.actor, detail: h.detail ?? 'modified',
    })))

  const scopedDraws = rc.encounter && draws.some(d => d.encounterId)
    ? draws.filter(d => d.encounterId === rc.encounter!.encounterId)
    : draws

  return {
    context: rc.context,
    admissionDiagnosis: rc.encounter?.diagnosis ?? rc.context.patient.diagnosis,
    dischargeMeds: dischargeMeds.map(toMedLine),
    stoppedMeds: stoppedMeds.map(toMedLine),
    medicationChanges: changes,
    labCount: scopedDraws.length,
    imagingCount: imaging.length,
    medOrderCount: meds.length,
    encounterEvents: rc.encounter?.events ?? [],
  }
}

/* ==================== Contract v1.0 batch — one builder per document ====================
   Same rules as Phase 1: compose EXISTING adapters through the SAME
   resolveContext identity ladder (roster record → Core patient-identity
   read → encounter snapshot); persisted records only, never the live
   formulary; nothing here writes. */

/** One printable order line from ONE persisted order — any category;
 *  the summary is the order's own stored text. */
function toOrderLine(o: Order): PrintOrderLine {
  return {
    orderId: o.orderId, category: o.category, summary: o.summary,
    priority: o.priority, status: o.status,
    orderedBy: o.orderedBy, orderedTime: o.orderedTime,
    requiresImplementation: !!o.requiresImplementation,
  }
}

/* ---------------- Contract #1 — Patient Face Sheet ---------------- */

export async function buildFaceSheet(patientId: string, encounterId?: string): Promise<FaceSheetData | null> {
  const rc = await resolveContext(patientId, encounterId)
  if (!rc) return null
  return { context: rc.context, adtEvents: rc.encounter?.events ?? [] }
}

/* ---------------- Contract #3 — Active Orders Sheet ---------------- */

export async function buildActiveOrders(patientId: string, encounterId?: string): Promise<ActiveOrdersData | null> {
  const rc = await resolveContext(patientId, encounterId)
  if (!rc) return null
  return {
    context: rc.context,
    activeOrders: rc.orders.filter(o => o.status === 'active').map(toOrderLine),
    pendingOrders: rc.orders.filter(o => o.status === 'pending').map(toOrderLine),
  }
}

/* ---------------- Contract #4 — Medication Orders ---------------- */

export async function buildMedicationOrders(patientId: string, encounterId?: string): Promise<MedicationOrdersData | null> {
  const rc = await resolveContext(patientId, encounterId)
  if (!rc) return null
  const meds = medOrders(rc.orders)
  return {
    context: rc.context,
    activeMeds: meds.filter(o => o.status === 'active').map(toMedLine),
    pendingMeds: meds.filter(o => o.status === 'pending').map(toMedLine),
  }
}

/* ---------------- Contract #5 — Laboratory Report ---------------- */

export async function buildLabReport(patientId: string, encounterId?: string): Promise<LabReportData | null> {
  const rc = await resolveContext(patientId, encounterId)
  if (!rc) return null
  const draws = await getLabDraws(patientId)
  const scoped = rc.encounter && draws.some(d => d.encounterId)
    ? draws.filter(d => d.encounterId === rc.encounter!.encounterId)
    : draws
  return { context: rc.context, draws: scoped }
}

/* ---------------- Contract #6 — Imaging Report ---------------- */

export async function buildImagingReport(patientId: string, encounterId?: string): Promise<ImagingReportData | null> {
  const rc = await resolveContext(patientId, encounterId)
  if (!rc) return null
  const studies = await getImagingStudies(patientId)
  const scoped = rc.encounter && studies.some(x => x.encounterId)
    ? studies.filter(x => x.encounterId === rc.encounter!.encounterId)
    : studies
  return { context: rc.context, studies: scoped }
}

/* ---------------- Contract #7 — Nursing Notes / SBAR ---------------- */

export async function buildSbar(patientId: string, encounterId?: string): Promise<SbarData | null> {
  const rc = await resolveContext(patientId, encounterId)
  if (!rc) return null
  const timeline = await getTimeline(patientId)
  return {
    context: rc.context,
    activeMeds: medOrders(rc.orders).filter(o => o.status === 'active').map(toMedLine),
    /* the canonical nursing store is future scope (contract note) — the
       feed's task/io/note categories are what the system has today */
    nursingEvents: timeline.filter(e => e.category === 'task' || e.category === 'io' || e.category === 'note').slice(0, 20),
  }
}

/* ---------------- Contract #8 — Consultation Report ---------------- */

export async function buildConsultReport(patientId: string, encounterId?: string): Promise<ConsultReportData | null> {
  const rc = await resolveContext(patientId, encounterId)
  if (!rc) return null
  const timeline = await getTimeline(patientId)
  /* chronological (oldest first) — a consultation record reads forward */
  const consults = timeline.filter(e => e.category === 'consult').reverse()
  return { context: rc.context, consultEvents: consults }
}

/* ---------------- Contract #9 — Transfer / Referral Summary ---------------- */

export async function buildTransferSummary(patientId: string, encounterId?: string): Promise<TransferSummaryData | null> {
  const rc = await resolveContext(patientId, encounterId)
  if (!rc) return null
  const draws = await getLabDraws(patientId)
  const scoped = rc.encounter && draws.some(d => d.encounterId)
    ? draws.filter(d => !d.encounterId || d.encounterId === rc.encounter!.encounterId)
    : draws
  const latestByPanel = new Map<string, LabDraw>()
  for (const d of scoped) latestByPanel.set(d.panel, d)
  return {
    context: rc.context,
    activeMeds: medOrders(rc.orders).filter(o => o.status === 'active').map(toMedLine),
    latestLabs: [...latestByPanel.values()],
    adtEvents: rc.encounter?.events ?? [],
  }
}

/* ==================== Stage 11 templates — contract #12/#13/#11 ====================
   These read the REAL Stage 11 chart-read path (getObservations,
   encounter-scoped) plus the persisted administrations on the orders the
   context already resolved. The OBSERVATION TYPE CATALOGUE read supplies
   the printed VOCABULARY (row labels, units, section titles, component
   definitions): unlike the formulary it is v1 read-only reference data,
   group ENABLEMENT is deliberately ignored here (a disabled group must
   not erase a historical flowsheet — the ORD-168 principle), and values/
   units still render from each persisted observation itself. */

const eff = (o: Observation): string =>
  o.amendments.length > 0 ? o.amendments[o.amendments.length - 1].newValue : o.value

/** compact printed form of one charted value (compound values render
 *  their components; the section legend explains abbreviations) */
function printedValue(t: ObservationType | undefined, raw: string): string {
  if (t?.valueType !== 'compound') return raw
  try {
    const v = JSON.parse(raw) as Record<string, number | string>
    if (t.typeCode === 'gcs') return `E${v.eye} V${v.verbal} M${v.motor}`
    if (t.typeCode === 'pupils') {
      const r = (x: unknown) => String(x ?? '?').charAt(0)
      return `L${v.leftSize}${r(v.leftReaction)} R${v.rightSize}${r(v.rightReaction)}`
    }
    return (t.components ?? []).map(c => `${c.label} ${v[c.code] ?? '—'}`).join(' ')
  } catch { return raw }
}

/** "yyyy-MM-dd HH:mm" → epoch ms (charted clinical times are real UTC
 *  datetimes — unlike order times, they carry calendar dates) */
const obsMs = (clinicalTime: string) => Date.parse(`${clinicalTime.replace(' ', 'T')}:00Z`)
const HOUR = 3600_000

const FLOWSHEET_GROUPS = ['vitals', 'neuro', 'fluid'] as const
const FLUID_IN_TYPES = ['oral_intake', 'iv_fluids', 'blood_products']
const FLUID_OUT_TYPES = ['urine_output', 'drain_output', 'ng_output', 'stool_output']

/* ---------------- Contract #12 — Vital Signs / Observation Flowsheet ---------------- */

export async function buildVitalsFlowsheet(patientId: string, encounterId?: string): Promise<FlowsheetData | null> {
  const rc = await resolveContext(patientId, encounterId)
  if (!rc) return null
  const [obs, catalog] = await Promise.all([
    getObservations(patientId, rc.encounter?.encounterId),
    getObservationCatalog(),
  ])
  if (obs === null || catalog === null) return { context: rc.context, grid: null, unavailable: true }
  if (obs.length === 0) return { context: rc.context, grid: null, unavailable: false }

  const byCode = new Map(catalog.flatMap(g => g.types).map(t => [t.typeCode, t]))

  /* ADAPTIVE window (design P1): 24 hourly columns ANCHORED to the latest
     charted observation — identical behavior for admitted and discharged
     patients; the window facts print on the document. The window/interval
     are the parameters the future Print Center Engine (P2) will expose. */
  const WINDOW_HOURS = 24
  const latestMs = Math.max(...obs.map(o => obsMs(o.clinicalTime)))
  const endMs = (Math.floor(latestMs / HOUR) + 1) * HOUR
  const startMs = endMs - WINDOW_HOURS * HOUR
  const columns: FlowsheetColumn[] = Array.from({ length: WINDOW_HOURS }, (_, i) => {
    /* column labels on the DISPLAY CLOCK (Locale/Timezone §1) — the
       bucketing below stays pure epoch math, so cells land in the hour
       the staff actually charted them on the wall clock */
    const stamp = localStamp(startMs + i * HOUR)
    return { hourLabel: stamp.slice(11), date: stamp.slice(0, 10) }
  })
  const colOf = (o: Observation) => Math.floor((obsMs(o.clinicalTime) - startMs) / HOUR)

  const windowObs = obs.filter(o => { const c = colOf(o); return c >= 0 && c < WINDOW_HOURS })

  /* per type per column: every charted value that hour (repeats join —
     each is real, none replaces another on paper) */
  const cellsFor = (typeCode: string): (string | null)[] => {
    const cells: (string | null)[] = Array.from({ length: WINDOW_HOURS }, () => null)
    for (const o of windowObs) {
      if (o.typeCode !== typeCode) continue
      const c = colOf(o)
      const v = printedValue(byCode.get(o.typeCode), eff(o))
      cells[c] = cells[c] === null ? v : `${cells[c]} / ${v}`
    }
    return cells
  }

  /* derived rows compute PER COLUMN at render (validator's decision) —
     never charted, never stored. Sums cover EVERY entry of the hour
     (per-interval amounts); GCS Total sums that hour's compound. */
  const numAt = (o: Observation) => Number(eff(o))
  const hourEntries = (col: number, codes: string[]) =>
    windowObs.filter(o => colOf(o) === col && codes.includes(o.typeCode))
  const derivedCells = (typeCode: string): (string | null)[] =>
    Array.from({ length: WINDOW_HOURS }, (_, col) => {
      if (typeCode === 'gcs_total') {
        const g = hourEntries(col, ['gcs']).pop()
        if (!g) return null
        try {
          const v = JSON.parse(eff(g)) as Record<string, number>
          return String(Number(v.eye) + Number(v.verbal) + Number(v.motor))
        } catch { return null }
      }
      const ins = hourEntries(col, FLUID_IN_TYPES).reduce((s, o) => s + (numAt(o) || 0), 0)
      const outs = hourEntries(col, FLUID_OUT_TYPES).reduce((s, o) => s + (numAt(o) || 0), 0)
      const anyIn = hourEntries(col, FLUID_IN_TYPES).length > 0
      const anyOut = hourEntries(col, FLUID_OUT_TYPES).length > 0
      if (typeCode === 'total_input') return anyIn ? String(ins) : null
      if (typeCode === 'total_output') return anyOut ? String(outs) : null
      if (typeCode === 'net_balance') return anyIn || anyOut ? String(ins - outs) : null
      return null
    })

  /* rows = the catalogue's own types for the TRADITIONAL SPLIT groups
     (vitals + neuro + fluids — the validator's decision; ventilator
     detail lives on the Ventilator & Device Report). Derived types render
     as computed rows in their catalogue position. */
  const sections: FlowsheetSection[] = catalog
    .filter(g => (FLOWSHEET_GROUPS as readonly string[]).includes(g.groupCode))
    .map(g => ({
      title: g.displayName,
      rows: g.types.map((t): FlowsheetRow => ({
        typeCode: t.typeCode, label: t.displayName, unit: t.unit,
        derived: t.isDerived,
        cells: t.isDerived ? derivedCells(t.typeCode) : cellsFor(t.typeCode),
      })),
    }))

  return {
    context: rc.context,
    grid: {
      columns,
      sections,
      windowStart: localStamp(startMs),
      windowEnd: localStamp(endMs),
      amendedCount: windowObs.filter(o => o.amendments.length > 0).length,
    },
    unavailable: false,
  }
}

/* ---------------- Contract #13 — Ventilator & Device Report ---------------- */

export async function buildVentDeviceReport(patientId: string, encounterId?: string): Promise<VentDeviceData | null> {
  const rc = await resolveContext(patientId, encounterId)
  if (!rc) return null
  const [obs, catalog] = await Promise.all([
    getObservations(patientId, rc.encounter?.encounterId),
    getObservationCatalog(),
  ])
  if (obs === null || catalog === null)
    return { context: rc.context, ventilator: null, pumpRate: null, devicesGroupEnabled: null, unavailable: true }

  /* SNAPSHOT (validator's decision): the latest charted value per type —
     point-in-time, not a trend; each value carries its own clinical time
     (settings may legitimately have been charted at different rounds). */
  const latest = new Map<string, Observation>()
  for (const o of obs) latest.set(o.typeCode, o)   // oldest→newest: last wins

  const line = (t: { typeCode: string; displayName: string; unit: string }, o: Observation | undefined): VentSnapshotLine => ({
    typeCode: t.typeCode, label: t.displayName, unit: t.unit,
    value: o ? eff(o) : null,
    clinicalTime: o?.clinicalTime ?? null,
    provenance: o ? 'charted' : null,
  })

  const ventGroup = catalog.find(g => g.groupCode === 'ventilator')
  const ventLines: VentSnapshotLine[] = []
  for (const t of ventGroup?.types ?? []) {
    if (t.typeCode === 'driving_pressure') {
      /* DERIVED at render (never charted): Pplat − PEEP, only when both
         come from ONE charted timepoint — a ΔP across different rounds
         would be a fabricated number. */
      const pplat = latest.get('pplat'); const peep = latest.get('peep')
      const same = pplat && peep && pplat.clinicalTime === peep.clinicalTime
      ventLines.push({
        typeCode: t.typeCode, label: t.displayName, unit: t.unit,
        value: same ? String(Number(eff(pplat)) - Number(eff(peep))) : null,
        clinicalTime: same ? pplat.clinicalTime : null,
        provenance: same ? 'derived' : null,
      })
      continue
    }
    if (t.typeCode === 'minute_ventilation') {
      /* MV is CHARTABLE in the catalogue; the design also lists it as a
         computed value. Charted wins; when absent, compute VT(exhaled) ×
         RR(measured) from ONE shared timepoint, labelled computed —
         flagged in the PR rather than silently chosen. */
      const charted = latest.get('minute_ventilation')
      if (charted) { ventLines.push(line(t, charted)); continue }
      const vt = latest.get('vt_exhaled'); const rr = latest.get('rr_measured')
      const same = vt && rr && vt.clinicalTime === rr.clinicalTime
      ventLines.push({
        typeCode: t.typeCode, label: t.displayName, unit: t.unit,
        value: same ? ((Number(eff(vt)) * Number(eff(rr))) / 1000).toFixed(1) : null,
        clinicalTime: same ? vt.clinicalTime : null,
        provenance: same ? 'computed' : null,
      })
      continue
    }
    ventLines.push(line(t, latest.get(t.typeCode)))
  }

  const devicesGroup = catalog.find(g => g.groupCode === 'devices')
  const pumpType = devicesGroup?.types.find(t => t.typeCode === 'pump_rate')
  return {
    context: rc.context,
    ventilator: ventLines,
    pumpRate: pumpType ? line(pumpType, latest.get('pump_rate')) : null,
    devicesGroupEnabled: devicesGroup?.enabled ?? null,
    unavailable: false,
  }
}

/* ---------------- Contract #11 — Medication Administration Record ---------------- */

export async function buildMar(patientId: string, encounterId?: string): Promise<MarSheetData | null> {
  const rc = await resolveContext(patientId, encounterId)
  if (!rc) return null
  /* administrations live ON the persisted orders the context already
     resolved (encounter-scoped) — the Q4 verification: AdminDto carries
     status (given/held/refused), documentedTime, documentedBy (the
     token's nurse), and the server-REQUIRED reason for held/refused.
     Pending prescriptions have no dose schedule (they are not in force)
     and print on the Medication Orders sheet, not the MAR. */
  const meds = medOrders(rc.orders)
  const scheduled = meds.filter(o => (o.administrations ?? []).length > 0)
  return {
    context: rc.context,
    meds: scheduled.map((o): MarMedRow => ({
      orderId: o.orderId,
      drug: o.medication!.drug, dose: o.medication!.dose, route: o.medication!.route,
      frequency: o.medication!.frequency, prn: o.medication!.prn,
      prnIndication: o.medication!.prnIndication,
      status: o.status,
      stoppedReason: o.status === 'discontinued' ? o.statusReason : undefined,
      /* the SCHEDULED slots per drug ARE the columns (a q8h drug → 3, a
         q4h → 6 — the validator's decision, no uniform grid). Documented
         doses always print; still-scheduled slots print as awaiting
         documentation only while the order is ACTIVE (mirrors the MAR
         screen derivation). */
      cells: (o.administrations ?? [])
        .filter(a => a.status !== 'scheduled' || o.status === 'active')
        .map((a): MarCell => ({
          adminId: a.adminId, scheduledTime: a.scheduledTime,
          status: a.status, documentedTime: a.documentedTime,
          documentedBy: a.documentedBy, reason: a.reason,
        })),
    })),
    unscheduledCount: meds.length - scheduled.length,
  }
}
