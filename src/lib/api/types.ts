/* API contract types.
   These interfaces mirror the future ASP.NET Core REST responses one-to-one
   (field names + nesting). Swapping the mock adapters for real endpoints must
   be a data-layer change only — never touch the UI when doing so. */

export type Severity = 'crit' | 'high' | 'stable'
export type AlertSeverity = 'crit' | 'high' | 'med' | 'info'
export type SupportFlag = 'vent' | 'pressor' | 'crrt' | 'ecmo'
export type Sex = 'M' | 'F'

/* ---------- GET /api/icu/units/:unitId/beds ---------- */

export interface BedCardVitals {
  hr: number
  map: number
  spo2: number
  temp: number
  /** urine output, mL/h */
  uo: number
}

export interface BedAlert {
  severity: AlertSeverity
  message: string
}

export interface BedPatient {
  /** stable patient identifier — the canonical key for routing/lookups
      (bed number is location only and can change) */
  patientId: string
  name: string
  age: number
  sex: Sex
  diagnosis: string
  /** ICU day / length of stay in days */
  los: number
  flags: SupportFlag[]
  isolation: boolean
  codeStatus: string
  sofa: number
  ews: number
  vitals: BedCardVitals
  alert: BedAlert
  attending: string
  severity: Severity
  /** last 7 MAP samples for the footer sparkline */
  mapTrend: number[]
}

export interface Bed {
  bedId: string
  area: string
  /** null = bed available */
  patient: BedPatient | null
}

export interface BedsResponse {
  unitId: string
  capacity: number
  physicians: string[]
  areas: string[]
  beds: Bed[]
}

/* ---------- GET /api/icu/units/:unitId/summary ---------- */

export interface UnitAlert {
  severity: Extract<AlertSeverity, 'crit' | 'high'>
  message: string
  time: string
}

export interface UnitKpiStat {
  label: string
  value: string
  delta: string
  trend: 'up' | 'dn' | 'fl'
}

export interface UnitSummaryResponse {
  unitId: string
  admissionsInProgress: number
  dischargesPlanned: number
  pendingConsults: number
  highPriorityAlerts: UnitAlert[]
  stats: UnitKpiStat[]
}

/* ---------- GET /api/icu/patients ---------- */

export interface PatientSummary {
  /** stable patient identifier — the canonical key for routing/lookups */
  patientId: string
  /** current bed — location only, display data */
  bedId: string
  name: string
  mrn: string
  diagnosis: string
  flags: SupportFlag[]
  isolation: boolean
  alertCount: number
}

/* ---------- GET /api/icu/patients/:patientId ---------- */

export interface MonitorVitals {
  hr: number
  sys: number
  dia: number
  map: number
  nibpSys: number
  nibpDia: number
  spo2: number
  rr: number
  temp: number
  etco2: number
  cvp: number
}

export type OrganName = 'Brain' | 'Heart' | 'Lungs' | 'Kidneys' | 'Liver' | 'Circulation'
export type OrganStatus = 'ok' | 'watch' | 'crit'

export interface AiRisk {
  name: string
  /** 0–100 probability */
  probability: number
  rationale: string
}

export interface Patient extends PatientSummary {
  age: number
  sex: Sex
  los: number
  allergies: string
  attending: string
  codeStatus: string
  rhythm: string
  vitals: MonitorVitals
  organs: Record<OrganName, OrganStatus>
  aiRisks: AiRisk[]
}

export interface VentTile {
  label: string
  value: string
  unit: string
  warn: boolean
}

export interface Ventilator {
  mode: string
  tiles: VentTile[]
}

export interface HemoMetric {
  label: string
  value: string
  unit: string
  warn: boolean
}

export interface FluidBalance {
  /** display string e.g. "+1,850 mL" */
  value: string
  /** bar fill percent from midline */
  percent: number
}

export interface Hemodynamics {
  metrics: HemoMetric[]
  fluidBalance: FluidBalance
}

export interface Infusion {
  name: string
  dose: string
  rate: string
  status: 'hi' | 'md' | 'ok'
  /** last 7 rate samples */
  trend: number[]
}

export interface LabSeries {
  label: string
  color: string
  points: number[]
}

export interface LabResult {
  analyte: string
  value: string
  flag: '' | 'abn' | 'crit2'
}

export interface LabPanel {
  name: string
  series: LabSeries[]
  results: LabResult[]
}

export interface Labs {
  drawTimes: string[]
  panels: LabPanel[]
}

export interface PatientAlert {
  severity: AlertSeverity
  message: string
  time: string
}

export interface Goal {
  label: string
  done: boolean
}

/* ---------- GET /api/icu/patients/:patientId/timeline ----------
   Read-only AGGREGATED feed (Screen 7) — derived at read time from the
   canonical stores (order audit history, lab draws, imaging studies,
   nursing tasks, I&O, consults, clinical notes). It is never stored as
   its own list; Mission Control's timeline card reads the same feed. */

export type TimelineCategory =
  | 'order' | 'med' | 'lab' | 'imaging' | 'task' | 'io' | 'consult' | 'note'

export interface TimelineEvent {
  /** synthetic stable id: `${refId}-${suffix}` */
  id: string
  patientId: string
  /** "HH:MM" today or "D-n HH:MM" for prior days */
  time: string
  category: TimelineCategory
  categoryLabel: string
  title: string
  detail?: string
  actor?: string
  /** result severity, for lab/imaging events */
  flag?: ResultFlag
  /** route to the originating screen (view-only feed — act there, not here) */
  link?: string
  /** id of the source record (orderId / labId / studyId / taskId / …) */
  refId: string
}

export interface PatientDetailResponse {
  patient: Patient
  ventilator: Ventilator
  hemodynamics: Hemodynamics
  infusions: Infusion[]
  labs: Labs
  alerts: PatientAlert[]
  goals: Goal[]
  timeline: TimelineEvent[]
}

/* ---------- GET /api/icu/worklist (doctor workspace) ---------- */

export interface RoundingPatient {
  patientId: string
  bedId: string
  name: string
  diagnosis: string
  flags: SupportFlag[]
  sofa: number
  severity: Severity
}

export interface RoundingListResponse {
  physician: { name: string; initials: string; role: string }
  patients: RoundingPatient[]
}

export interface ActionQueueItem {
  title: string
  detail: string
  time: string
}

export type QueueKey = 'orders' | 'results' | 'notes'

/** notes only — "orders to sign" derives from the canonical Order model
    (Screen 5) and "results to acknowledge" from the canonical results
    domain (Screen 6) */
export type ActionQueuesResponse = Record<'notes', ActionQueueItem[]>

/* ---------- GET /api/icu/consults ---------- */

/** Consult request — shared store: Doctor Workspace's "Incoming Consults"
    and the Timeline both read it. Patient linkage is structured
    (patientId), never embedded in free text. */
export interface Consult {
  consultId: string
  patientId: string
  /** denormalized display fields */
  bedId: string
  patientName: string
  specialty: string
  message: string
  /** "HH:MM" today or "D-n HH:MM" */
  time: string
}

export type OrderType = 'Medication' | 'Lab' | 'Imaging' | 'Nursing'

export type OrderSetsResponse = Record<OrderType, string[]>

/* ==================== Nursing domain (Screen 4) ====================
   Independent domain models per docs/architecture.md rule 2 — each block
   below maps to its own future endpoint and is replaceable in isolation. */

/* ---------- GET /api/icu/nursing/assignment ---------- */

export interface AssignedPatient {
  patientId: string
  /** location only — display data */
  bedId: string
  name: string
  age: number
  sex: Sex
  diagnosis: string
  allergies: string
  codeStatus: string
  flags: SupportFlag[]
  isolation: boolean
  severity: Severity
  vitals: BedCardVitals
}

export interface NurseAssignmentResponse {
  nurse: { name: string; initials: string; role: string; shift: string }
  patients: AssignedPatient[]
}

export type OrderPriority = 'Routine' | 'Urgent' | 'STAT'

/* ---------- GET /api/icu/nursing/tasks ---------- */

export interface NursingTask {
  taskId: string
  patientId: string
  bedId: string
  label: string
  /** HH:MM — overdue/due/upcoming is computed client-side against the
      current time, never stored (see TasksCard) */
  dueTime: string
  recurrence: string
  done: boolean
  /** absolute completion timestamp/actor — set when documented, cleared on
      un-toggle (facts, not time-relative state) */
  completedAt?: string
  completedBy?: string
}

/* ---------- GET /api/icu/nursing/io ---------- */

export type IoKind = 'intake' | 'output'

export interface IoEntry {
  entryId: string
  patientId: string
  kind: IoKind
  category: string
  volumeMl: number
  time: string
}

/** POST /api/icu/nursing/io request body */
export interface NewIoEntry {
  patientId: string
  kind: IoKind
  category: string
  volumeMl: number
}

/* ---------- GET /api/icu/patients/:patientId/notes ----------
   Minimal ClinicalNote model — the ONE genuine gap the Timeline exposed:
   freeform progress/nursing/procedure/vent-adjustment notes are not tied to
   any structured action in the orders/results/nursing stores. Everything
   else on the Timeline derives from those stores; only these notes needed
   a model of their own. Vent ('vent') notes are a stand-in until device
   integration (Stage 11) emits structured ventilator events. */

export type ClinicalNoteKind = 'progress' | 'nursing' | 'procedure' | 'vent'

export interface ClinicalNote {
  noteId: string
  patientId: string
  kind: ClinicalNoteKind
  /** "HH:MM" today or "D-n HH:MM" */
  time: string
  author: string
  text: string
}

/* ==================== Orders & Medication domain (Screen 5) ====================
   THE canonical source of truth for orders and medications. Doctor Workspace's
   "Orders to Sign", Nurse Workspace's MAR and "Orders to Implement" are all
   derived views over this model — never separate lists.
   Time-relative states (overdue/due) are ALWAYS computed at render against
   the current clock (locked decision) — never stored here. */

export type OrderStatus = 'pending' | 'active' | 'completed' | 'discontinued'
export type OrderCategory = 'Medication' | 'Lab' | 'Imaging' | 'Nursing'
export type AdministrationAction = 'given' | 'held' | 'refused'

export interface MedicationDetails {
  drugId: string
  drug: string
  dose: string
  route: string
  frequency: string
  /** e.g. "7 days", "ongoing", "once" */
  duration: string
  prn: boolean
  prnIndication?: string
}

export interface MedAdministration {
  adminId: string
  /** HH:MM · empty string for PRN availability rows */
  scheduledTime: string
  status: 'scheduled' | AdministrationAction
  documentedTime?: string
  documentedBy?: string
}

export interface OrderEvent {
  /** HH:MM today, or "D-n HH:MM" for prior days */
  time: string
  actor: string
  action: 'created' | 'signed' | 'modified' | 'implemented' | 'administered' | 'held' | 'refused' | 'completed' | 'discontinued'
  detail?: string
}

export interface Order {
  orderId: string
  patientId: string
  /** denormalized display fields (location + name snapshot) */
  bedId: string
  patientName: string
  category: OrderCategory
  /** one-line description; composed from medication fields for med orders */
  summary: string
  medication?: MedicationDetails
  priority: OrderPriority
  status: OrderStatus
  orderedBy: string
  orderedTime: string
  /** non-med orders the nurse actions once from "Orders to Implement" */
  requiresImplementation?: boolean
  administrations?: MedAdministration[]
  /** full audit trail, oldest first */
  history: OrderEvent[]
  /** required reason recorded on discontinue */
  statusReason?: string
}

export interface NewOrderDraft {
  patientId: string
  category: OrderCategory
  summary?: string
  medication?: MedicationDetails
  priority: OrderPriority
  requiresImplementation?: boolean
}

/* ---------- GET /api/icu/formulary ---------- */

export interface FormularyDrug {
  drugId: string
  name: string
  drugClass: string
  doses: string[]
  routes: string[]
  frequencies: string[]
  prnCapable: boolean
  /** allergy tags that BLOCK ordering (matched against the patient's documented allergy field) */
  allergyBlock: string[]
  /** cross-reactivity tags that WARN */
  allergyWarn: string[]
}

export interface InteractionRule {
  a: string
  b: string
  severity: 'block' | 'warn'
  note: string
}

export interface SafetyIssue {
  kind: 'allergy' | 'interaction' | 'duplicate'
  severity: 'block' | 'warn'
  message: string
}

/* ---------- GET /api/icu/order-sets/definitions ---------- */

export interface OrderSetItemTemplate {
  category: OrderCategory
  summary?: string
  medication?: MedicationDetails
  priority: OrderPriority
  requiresImplementation?: boolean
}

export interface OrderSetDef {
  setId: string
  name: string
  description: string
  items: OrderSetItemTemplate[]
}

/* ---------- GET /api/icu/nursing/mar (derived view) ---------- */

export interface MarRow {
  orderId: string
  adminId: string
  patientId: string
  bedId: string
  medication: string
  dose: string
  route: string
  /** HH:MM · empty for PRN */
  scheduledTime: string
  prn: boolean
  status: 'scheduled' | AdministrationAction
  documentedTime?: string
}

/* ==================== Laboratory & Imaging domain (Screen 6) ====================
   THE canonical source of truth for lab and imaging RESULTS. Screen 5
   (Orders & Medication) places lab/imaging orders; this domain holds what
   comes back. Mission Control's lab trend card and Doctor Workspace's
   "Results to Acknowledge" are derived views over this model — never
   separate lists. Result ages shown in the UI are computed at render
   against the clock (locked decision) — never stored. */

export type ResultFlag = 'normal' | 'abnormal' | 'critical'
export type LabPanelKey = 'CBC' | 'ABG' | 'Electrolytes' | 'Renal' | 'Liver' | 'Coagulation' | 'Lactate'

/* ---------- GET /api/icu/results/labs?patientId ---------- */

export interface LabResultItem {
  analyte: string
  value: number
  unit: string
  /** display range, e.g. "4.0–11.0" */
  refRange: string
  /** numeric bounds for chart reference bands */
  refLow: number
  refHigh: number
  flag: ResultFlag
}

export interface LabDraw {
  labId: string
  patientId: string
  /** denormalized display fields */
  bedId: string
  patientName: string
  panel: LabPanelKey
  /** short x-axis label for trend charts, e.g. "D-6" … "Now" */
  label: string
  /** "HH:MM" today or "D-n HH:MM" for prior days */
  collectedAt: string
  resultedAt: string
  items: LabResultItem[]
  /** worst flag across items (validated server-side) */
  flag: ResultFlag
  /** short lab/clinical note surfaced in the results inbox */
  note?: string
  acknowledged: boolean
  acknowledgedBy?: string
  acknowledgedAt?: string
}

/* ---------- GET /api/icu/results/imaging?patientId ---------- */

export type ImagingModality = 'CXR' | 'CT' | 'US' | 'Echo' | 'MRI'
/** status progression: ordered → in-progress → preliminary → final */
export type ImagingStatus = 'ordered' | 'in-progress' | 'preliminary' | 'final'

export interface ImagingStudy {
  studyId: string
  patientId: string
  bedId: string
  patientName: string
  modality: ImagingModality
  description: string
  orderedAt: string
  performedAt?: string
  reportedAt?: string
  status: ImagingStatus
  /** findings text — present from "preliminary" onward */
  report?: string
  impression?: string
  flag: ResultFlag
  note?: string
  acknowledged: boolean
  acknowledgedBy?: string
  acknowledgedAt?: string
}

/* ---------- GET /api/icu/results/inbox — unit-wide unacknowledged ---------- */

export interface ResultInboxItem {
  kind: 'lab' | 'imaging'
  /** labId or studyId */
  id: string
  patientId: string
  bedId: string
  patientName: string
  title: string
  detail: string
  time: string
  flag: ResultFlag
}
