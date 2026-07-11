import type {
  BedCardVitals, Encounter, LabDraw, MonitorVitals, Order, OrganName, OrganStatus, SupportFlag, TimelineEvent,
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
  /** where the identity fields came from — surfaced on the document when
   *  it is the narrower encounter snapshot */
  source: 'roster' | 'encounter-snapshot'
}

/** The encounter the document is scoped to. */
export interface PrintEncounterInfo {
  encounterId: string
  status: 'open' | 'discharged'
  admittedAt: string
  admittedBy: string
  dischargedAt?: string
  dischargedBy?: string
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
  sofa: number
  ews: number
  flags: SupportFlag[]
  organs: Record<OrganName, OrganStatus>
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
  medicationOrders: PrintMedLine[]
  /** Lab / Imaging ORDERS on the encounter (investigations requested) */
  investigations: Order[]
}

export interface DailyProgressData {
  context: PrintContext
  vitals: PrintVitals | null
  activeProblems: string[]
  /** null when the patient is not flagged ventilated */
  ventilation: { flagged: boolean; rhythm: string; spo2: number; rr: number } | null
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
