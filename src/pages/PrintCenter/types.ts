import type {
  BedCardVitals, Encounter, ImagingStudy, LabDraw, MonitorVitals, Order, OrganName, OrganStatus, SupportFlag, TimelineEvent,
} from '../../lib/api/types'

/* ==================== Print Center view models ====================
   Read-only, template-facing shapes PREPARED by the selectors in
   selectors.ts from the same stores/adapters the application UI uses.
   Templates receive these and render — they never query stores.

   ABSOLUTE RULE (the ORD-168 historical-rendering guarantee, applied to
   print): nothing in this module carries formulary state. Medications
   render from the persisted order record (medication text, audit
   history, administrations) exactly as originally recorded — a later
   formulary deactivation or removal must not change a printed document. */

/** Who/what the document is about — identity band under the header. */
export interface PrintPatientIdentity {
  patientId: string
  name: string
  /** null when the patient is no longer on the active roster (discharged)
   *  and the field is not part of the encounter's identity snapshot —
   *  rendered as an explicit "not in the encounter record" dash, never
   *  fabricated. */
  mrn: string | null
  age: number | null
  sex: string | null
  allergies: string | null
  attending: string
  codeStatus: string | null
  bedId: string
  diagnosis: string
  /** STRUCTURED IDENTITY (name + national ID design): the FULL LEGAL
   *  name (all present parts) and the national identity number render on
   *  official documents when recorded — null on legacy single-name rows
   *  and on the encounter snapshot (never fabricated). `name` above is
   *  the derived display name / legacy stored name. */
  fullName: string | null
  nationalId: string | null
  /** PATIENT FILE NUMBER (Locale/File-Number §2.5 — the flagged print
   *  choice, taken: YES): the hospital files its paper record by this
   *  number, so their printed documents carry it. Dash when absent. */
  fileNumber: string | null
  /** where the identity fields came from — surfaced on the document when
   *  it is the narrower encounter snapshot. 'patient-record' is the Core
   *  patient-identity read (the middle rung): full person-level identity
   *  for a patient who is no longer on the roster. */
  source: 'roster' | 'patient-record' | 'encounter-snapshot'
}

/** The encounter the document is scoped to. */
export interface PrintEncounterInfo {
  encounterId: string
  status: 'open' | 'discharged'
  admittedAt: string
  admittedBy: string
  dischargedAt?: string
  dischargedBy?: string
  /** recorded discharge disposition code (the stay's outcome); absent on
   *  pre-feature discharges — printed as "not recorded", never fabricated */
  disposition?: string
  /** discharged encounters that exist for this patient BESIDES the target
   *  — surfaced on the document (readmission presentation is a recorded
   *  open question; a printed document must say what it does NOT cover) */
  otherEncounterCount: number
}

/** Common context every template receives. */
export interface PrintContext {
  patient: PrintPatientIdentity
  encounter: PrintEncounterInfo | null
  /** true when any rendered timestamp is the charted HH:mm / "D-n HH:mm"
   *  form — triggers the date-less-timestamp footnote (recorded open
   *  question, surfaced not buried) */
  hasChartedTimes: boolean
}

/** Current bedside snapshot (roster) — labelled "as of printing". */
export interface PrintVitals {
  bedside: BedCardVitals
  monitor: MonitorVitals
  rhythm: string
  flags: SupportFlag[]
  organs: Record<OrganName, OrganStatus>
}

/** REAL computed clinical scores for a printed document — from the
 *  Clinical Scoring Engine (SOFA + NEWS2), never the retired fabricated
 *  roster integers. Each is a display string: a computed value, or
 *  "Incomplete …", or "—" when the observation source is unavailable —
 *  never a fabricated number. Decision-support (clinical validation
 *  required before care use). */
export interface PrintScores {
  sofa: string
  news2: string
}

/** One medication line, rendered ONLY from the persisted order. */
export interface PrintMedLine {
  orderId: string
  drug: string
  dose: string
  route: string
  frequency: string
  duration: string
  prn: boolean
  status: Order['status']
  orderedBy: string
  orderedTime: string
  /** discontinue reason + time from the audit history, when discontinued */
  stoppedReason?: string
  stoppedTime?: string
  /** last documented administration, from the order's own records */
  lastAdministration?: { time: string; status: string; by: string }
}

export interface AdmissionNoteData {
  context: PrintContext
  vitals: PrintVitals | null
  /** real computed SOFA + NEWS2 (Clinical Scoring Engine) */
  scores: PrintScores
  medicationOrders: PrintMedLine[]
  /** Lab / Imaging ORDERS on the encounter (investigations requested) */
  investigations: Order[]
}

export interface DailyProgressData {
  context: PrintContext
  vitals: PrintVitals | null
  /** real computed SOFA + NEWS2 (Clinical Scoring Engine) */
  scores: PrintScores
  activeProblems: string[]
  /** null when the patient is not flagged ventilated; spo2/rr are the
   *  latest charted observations — null = not charted (§12 step 4) */
  ventilation: { flagged: boolean; rhythm: string; spo2: number | null; rr: number | null } | null
  activeMeds: PrintMedLine[]
  /** latest resulted draw per panel, encounter-scoped where the data
   *  carries encounterId */
  latestLabs: LabDraw[]
  /** last ~24 h of the aggregated feed, times as charted */
  recentEvents: TimelineEvent[]
}

export interface DischargeSummaryData {
  context: PrintContext
  admissionDiagnosis: string
  /** medication orders ACTIVE AT DISCHARGE — identified purely from the
   *  persisted discharge-cascade audit reason, or still-active orders
   *  when printing before discharge */
  dischargeMeds: PrintMedLine[]
  /** discontinued during the admission (any reason other than the
   *  discharge cascade), with the recorded reason */
  stoppedMeds: PrintMedLine[]
  /** dose/field changes from the orders' audit histories */
  medicationChanges: { orderId: string; drug: string; time: string; actor: string; detail: string }[]
  /** investigations performed this encounter (labs resulted / imaging) */
  labCount: number
  imagingCount: number
  medOrderCount: number
  encounterEvents: Encounter['events']
}

/* ==================== Contract v1.0 batch (docs/print-center-contract.md) ==================== */

/** One NON-medication (or any) order line — persisted order fields only. */
export interface PrintOrderLine {
  orderId: string
  category: Order['category']
  summary: string
  priority: Order['priority']
  status: Order['status']
  orderedBy: string
  orderedTime: string
  requiresImplementation: boolean
}

export interface FaceSheetData {
  context: PrintContext
  /** ADT lifecycle events of the target encounter (admitted / transferred /
   *  discharged), exactly as persisted */
  adtEvents: Encounter['events']
}

export interface ActiveOrdersData {
  context: PrintContext
  /** ALL active orders on the encounter, every category */
  activeOrders: PrintOrderLine[]
  /** pending-signature orders, marked separately — a printed order sheet
   *  must not present unsigned orders as in force */
  pendingOrders: PrintOrderLine[]
}

export interface MedicationOrdersData {
  context: PrintContext
  activeMeds: PrintMedLine[]
  /** unsigned prescriptions — printed under their own heading, never mixed
   *  into the active list */
  pendingMeds: PrintMedLine[]
}

export interface LabReportData {
  context: PrintContext
  /** encounter-scoped draws, oldest → newest, acknowledgment status per draw */
  draws: LabDraw[]
}

export interface ImagingReportData {
  context: PrintContext
  studies: ImagingStudy[]
}

export interface SbarData {
  context: PrintContext
  activeMeds: PrintMedLine[]
  /** nursing task/documentation events the aggregated feed carries — the
   *  canonical nursing-notes store is future scope (contract note); in
   *  production this is legitimately empty until it exists */
  nursingEvents: TimelineEvent[]
}

export interface ConsultReportData {
  context: PrintContext
  /** consultation events the aggregated feed carries, chronological —
   *  the canonical consultation store is future scope (contract note) */
  consultEvents: TimelineEvent[]
}

export interface TransferSummaryData {
  context: PrintContext
  activeMeds: PrintMedLine[]
  /** latest resulted draw per panel (same derivation as the progress sheet) */
  latestLabs: LabDraw[]
  adtEvents: Encounter['events']
}

/* ==================== Stage 11 print templates (contract #12/#13/#11) ====================
   These three consume the REAL Observation/administration record (the
   Stage 11 chart-read path and the orders' persisted administrations) —
   never panels.ts, never the live formulary. All values render as
   persisted; derived values compute at render (never stored); missing →
   an honest dash. ADAPTIVE LAYOUTS (design P1): the shapes below carry
   layout-driving facts (column count, window) so the future Print Center
   Engine (P2, recorded feature) can wrap them without rework. */

/** one flowsheet grid column — an hour of the 24 h window */
export interface FlowsheetColumn {
  /** "HH:00" */
  hourLabel: string
  /** "yyyy-MM-dd" — rendered once per day boundary in the header */
  date: string
}

export interface FlowsheetRow {
  typeCode: string
  label: string
  unit: string
  /** derived rows compute per column at render (never charted) */
  derived: boolean
  /** one entry per column; null = honestly nothing charted that hour;
   *  multiple same-hour charted values join with ' / ' (each real) */
  cells: (string | null)[]
}

export interface FlowsheetSection {
  title: string
  rows: FlowsheetRow[]
}

export interface FlowsheetData {
  context: PrintContext
  /** null when the observations/catalogue reads are unreachable — the
   *  document says so; it never renders a fabricated grid */
  grid: {
    columns: FlowsheetColumn[]
    sections: FlowsheetSection[]
    /** the window is anchored to the LATEST charted observation of the
     *  encounter (works identically for discharged patients) */
    windowStart: string
    windowEnd: string
    /** any effective value on the sheet came through an amendment —
     *  rendered as a footnote (amend-not-erase upstream) */
    amendedCount: number
  } | null
  /** true = reads unreachable (vs an empty charted record) */
  unavailable: boolean
}

/** one snapshot line of the ventilator report — latest charted value of
 *  one catalogue type, with its own clinical time (values may legitimately
 *  come from different timepoints; each is attributed) */
export interface VentSnapshotLine {
  typeCode: string
  label: string
  unit: string
  /** null = not charted this encounter */
  value: string | null
  clinicalTime: string | null
  /** 'derived' = computed at render (ΔP); 'computed' = the MV fallback
   *  computed from same-timepoint inputs when the type was not charted */
  provenance: 'charted' | 'derived' | 'computed' | null
}

export interface VentDeviceData {
  context: PrintContext
  ventilator: VentSnapshotLine[] | null
  /** the one chartable devices-group type today (infusion pump rate) */
  pumpRate: VentSnapshotLine | null
  /** whether the Devices observation group is enabled in this deployment
   *  (context line — the sections render regardless, honestly empty) */
  devicesGroupEnabled: boolean | null
  unavailable: boolean
}

/** one MAR cell — one administration slot of one medication order, as
 *  persisted on the order (documentedBy/reason come from the orders read;
 *  the /mar projection omits them) */
export interface MarCell {
  adminId: string
  /** "HH:MM" scheduled slot; '' = PRN availability */
  scheduledTime: string
  status: 'scheduled' | 'given' | 'held' | 'refused'
  documentedTime?: string
  documentedBy?: string
  /** server-required for held/refused — absent on given (not a gap) */
  reason?: string
}

export interface MarMedRow {
  orderId: string
  drug: string
  dose: string
  route: string
  frequency: string
  prn: boolean
  prnIndication?: string
  status: string
  /** recorded when the order was discontinued (its documented doses stay) */
  stoppedReason?: string
  cells: MarCell[]
}

export interface MarSheetData {
  context: PrintContext
  /** medication orders of this encounter that carry a dose schedule
   *  (signed orders); pending prescriptions have no administrations and
   *  belong on the Medication Orders sheet instead */
  meds: MarMedRow[]
  /** signed med orders whose schedule list is absent (nothing to chart) */
  unscheduledCount: number
}
