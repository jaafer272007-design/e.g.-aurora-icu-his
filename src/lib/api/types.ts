/* API contract types.
   These interfaces mirror the future ASP.NET Core REST responses one-to-one
   (field names + nesting). Swapping the mock adapters for real endpoints must
   be a data-layer change only — never touch the UI when doing so. */

export type Severity = 'crit' | 'high' | 'stable'
export type AlertSeverity = 'crit' | 'high' | 'med' | 'info'
export type SupportFlag = 'vent' | 'pressor' | 'crrt' | 'ecmo'
export type Sex = 'M' | 'F'

/* ---------- GET /api/icu/units/:unitId/beds ---------- */

/* Stage 11 §12 step 4: bedside vitals are PROJECTED from the latest
   charted Observations of the open encounter (real), with the demo
   snapshot as the per-type fallback in demo-seeded environments only.
   null = "not charted" — rendered as an honest '—', never a fabricated
   number (design §5). */
export interface BedCardVitals {
  hr: number | null
  map: number | null
  spo2: number | null
  temp: number | null
  /** latest charted urine output (per-interval amount, mL) */
  uo: number | null
}

export interface BedAlert {
  severity: AlertSeverity
  message: string
  /** "HH:MM" raised time — unit summary derives its high-priority list from these */
  time: string
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

/* ---------- GET /api/icu/patients ----------
   STAGE 10 PHASE 1: this endpoint is REAL (ASP.NET Core + SQLite, /server).
   The wire response is RosterRecordDto[] below — the canonical roster
   record. PatientSummary.alertCount is NOT on the wire: it is derived
   client-side (AI alerts + unacked results + bed alert) because those
   domains are still mock; derived state is never stored or served. */

/** Stage 10 roster service wire contract (mirrors server/Program.cs). */
export interface RosterRecordDto {
  patientId: string
  bedId: string
  name: string
  mrn: string
  age: number
  sex: Sex
  diagnosis: string
  los: number
  allergies: string
  attending: string
  codeStatus: string
  rhythm: string
  isolation: boolean
  severity: Severity
  sofa: number
  ews: number
  flags: SupportFlag[]
  bedsideVitals: BedCardVitals
  bedAlert: BedAlert
  mapTrend: number[]
  monitorVitals: MonitorVitals
  organs: Record<OrganName, OrganStatus>
}

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

/* step 4 (F7 mapping, validator-confirmed): sys/dia ← art_sbp/art_dbp
   (arterial line), nibpSys/nibpDia ← sbp/dbp (cuff), map ← charted map
   (never recomputed), etco2 ← the F6 catalogue top-up. null = not
   charted (honest blank). */
export interface MonitorVitals {
  hr: number | null
  sys: number | null
  dia: number | null
  map: number | null
  nibpSys: number | null
  nibpDia: number | null
  spo2: number | null
  rr: number | null
  temp: number | null
  etco2: number | null
  cvp: number | null
}

export type OrganName = 'Brain' | 'Heart' | 'Lungs' | 'Kidneys' | 'Liver' | 'Circulation'
export type OrganStatus = 'ok' | 'watch' | 'crit'

/** legacy one-line risk view (Mission Control's AI panel) — DERIVED from the
    canonical AI risk domain (Screen 8), never stored separately */
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
  /** absent when no fluid entry is charted in the trailing 24 h —
   *  the strip renders nothing rather than a fabricated balance */
  fluidBalance?: FluidBalance
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
  /** result severity, for lab/imaging events. '' on a custom / unstructured
   *  lab event (no flag) — treated as no severity, like absent. */
  flag?: ResultFlag | ''
  /** route to the originating screen (view-only feed — act there, not here) */
  link?: string
  /** id of the source record (orderId / labId / studyId / taskId / …) */
  refId: string
}

export interface PatientDetailResponse {
  patient: Patient
  /** derived view over the canonical AI risk domain (Screen 8) */
  aiRisks: AiRisk[]
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
  /** documented reason — required when held/refused (Stage 10 Phase 3 MAR) */
  reason?: string
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
  /** ENCOUNTER SCOPE (server-side since the ORD-113 fix): the admission
   *  this order's lifecycle is bounded by — discharge auto-discontinues
   *  the encounter's active/pending orders. Absent on the mock store
   *  (encounters are a server-side ADT concept). */
  encounterId?: string
  /** denormalized display fields (location + name snapshot) */
  bedId: string
  patientName: string
  category: OrderCategory
  /** one-line description; composed from medication fields for med orders */
  summary: string
  medication?: MedicationDetails
  /** Layer 4 (lab catalogue): the catalogue test a Lab order references —
   *  the order half of the order→result linkage. Optional; absent on the
   *  mock store and on free-text lab orders. */
  testId?: string
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
  /** Lab orders only: the catalogue test being ordered (Layer 4) */
  testId?: string
  priority: OrderPriority
  requiresImplementation?: boolean
}

/* ---------- GET /api/icu/formulary (Layer 4 — master data, Aurora Core) ----------
   The reference layer Pharmacy maintains: a real database table since
   Layer 4, no longer a hardcoded frontend list. Removing a drug is a
   STATUS change (active=false) — a drug that has ever been prescribed
   must stay resolvable forever or historical orders become unreadable. */

/** display-string dose bounds — reference data carried per drug; dose-range
 *  ENFORCEMENT at ordering time is recorded future scope, not Layer 4 */
export interface DoseLimits {
  min?: string
  /** per dose */
  max?: string
  maxDaily?: string
  /** weight-based bound, where applicable */
  perKg?: string
}

/** one audited change on a formulary drug (Layer 3 users convention:
 *  dated UTC times — reference data changes span months) */
export interface FormularyEvent {
  time: string
  actor: string
  action: string
  detail?: string
}

export interface FormularyDrug {
  drugId: string
  /** generic name */
  name: string
  brandNames: string[]
  drugClass: string
  /** dosage form(s) as stocked */
  form: string
  strengths: string[]
  doses: string[]
  defaultDose: string
  doseLimits?: DoseLimits
  routes: string[]
  frequencies: string[]
  prnCapable: boolean
  /** allergy tags that BLOCK ordering (matched against the patient's documented allergy field) */
  allergyBlock: string[]
  /** cross-reactivity tags that WARN */
  allergyWarn: string[]
  /** deactivation is a status change, never a delete — an inactive drug
   *  cannot be selected for a NEW order; existing orders still render */
  active: boolean
  /** per-drug audit history (absent on the mock store) */
  history?: FormularyEvent[]
}

/** POST /api/icu/formulary — create draft (Pharmacist formulary.manage) */
export interface CreateDrugDraft {
  drugId: string
  name: string
  brandNames: string[]
  drugClass: string
  form: string
  strengths: string[]
  doses: string[]
  defaultDose: string
  doseLimits?: DoseLimits
  routes: string[]
  frequencies: string[]
  prnCapable: boolean
  allergyBlock: string[]
  allergyWarn: string[]
}

/** PUT /api/icu/formulary/:drugId — all fields optional; drugId immutable */
export type EditDrugDraft = Partial<Omit<CreateDrugDraft, 'drugId'>>

/* ---------- GET /api/icu/lab-catalog (Layer 4 — master data, Aurora Core) ----------
   The tests that can be ordered — reference data the LABORATORY maintains
   (labcatalog.manage on the Ancillary profile). Deactivation is a status
   change, never a delete: an inactive test cannot be newly ORDERED (409),
   but every existing result referencing it still renders, and resulting
   against it stays allowed (completing ordered care is never blocked by a
   reference-data status change). testId == the LabPanelKey on results. */

export interface AnalyteDef {
  analyte: string
  /** may be empty — unitless analytes (pH, INR) are canonical */
  unit: string
  refRange: string
  refLow: number
  refHigh: number
}

export interface LabTest {
  testId: string
  name: string
  /** panel grouping, e.g. Hematology / Chemistry / Blood gas */
  category: string
  specimen: string
  analytes: AnalyteDef[]
  active: boolean
  /** per-test audit history (absent on the mock store) */
  history?: FormularyEvent[]
}

/** POST /api/icu/lab-catalog — create draft (labcatalog.manage) */
export interface CreateLabTestDraft {
  testId: string
  name: string
  category: string
  specimen: string
  analytes: AnalyteDef[]
}

/** PUT /api/icu/lab-catalog/:testId — all fields optional; testId immutable */
export type EditLabTestDraft = Partial<Omit<CreateLabTestDraft, 'testId'>>

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
  /** Lab items: the catalogue test the item orders (Layer 4) */
  testId?: string
  priority: OrderPriority
  requiresImplementation?: boolean
}

export interface OrderSetDef {
  setId: string
  name: string
  description: string
  items: OrderSetItemTemplate[]
  /** Layer 4: order sets are master data — deactivation is a status
   *  change; an inactive set cannot be applied (409). Absent on mock. */
  active?: boolean
  /** per-set audit history (absent on the mock store) */
  history?: FormularyEvent[]
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

/** append-only result audit event (results audit PR) — acknowledge /
 *  un-acknowledge / resulted. Server-populated; absent on the mock store. */
export interface ResultEvent {
  time: string
  actor: string
  /** 'documented' is the manual-entry path (results.document); 'resulted'
   *  is the producing-service create path (results.create) */
  action: 'resulted' | 'documented' | 'acknowledged' | 'unacknowledged'
  detail?: string
}

export interface LabDraw {
  labId: string
  patientId: string
  /** the encounter the result was created under — SERVER-derived from the
   *  patient's open encounter (results audit PR), never client-supplied;
   *  absent on the mock store */
  encounterId?: string
  /** Layer 4 (order→result linkage): the lab order this result FULFILS —
   *  SERVER-derived at creation (oldest unfulfilled active Lab order for
   *  the same test on the open encounter), never client-supplied; absent
   *  when no order matches (walk-in/reflex results are legitimate). */
  orderId?: string
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
  /** worst flag across items (validated server-side). '' ONLY on a custom /
   *  unstructured result (see `custom`) — those carry NO clinical flag. */
  flag: ResultFlag | ''
  /** how the result ENTERED Aurora (Lab Result-Entry design §5):
   *  'manual' = the human documentation/transcription path
   *  (results.document). Absent on pre-existing rows and the
   *  producing-service create path, which predate the field — never
   *  invented. A future LIS feed becomes a second source value. */
  source?: 'manual'
  /** Custom / Other Lab Test design: an UNSTRUCTURED, UNFLAGGED result for a
   *  test the catalogue does not have. When true the result carries NO
   *  catalogue analyte (`items` is empty) and NO flag (`flag` is ''); the
   *  free-text value/unit/reference-range are below and the test name is
   *  `label`. Absent on the wire for every structured result (byte-parity). */
  custom?: true
  /** custom free-text result value (numeric like "2.5" or descriptive like
   *  "positive") — present only when `custom` */
  customValue?: string
  customUnit?: string
  /** DISPLAY-ONLY reference context — shown next to the value, never drives a flag */
  customRefRange?: string
  /** short lab/clinical note surfaced in the results inbox */
  note?: string
  acknowledged: boolean
  acknowledgedBy?: string
  acknowledgedAt?: string
  /** never-destroy audit history: a reversed acknowledgment survives here
   *  while the summary fields above clear (results audit PR) */
  history?: ResultEvent[]
}

/* ---------- POST /api/icu/results/labs/document (Lab Result-Entry) ----------
   The MANUAL documentation path — a nurse or doctor transcribing a paper
   central-lab report or entering a bedside ABG. The payload is LEAN: only
   the catalogue panel and per-analyte {analyte, value}. The server derives
   unit/refRange/bounds/flag from the lab catalogue, the label from the test
   name, the documenting clinician + time + encounter + order linkage, and
   stamps source=manual — none of it is client-claimed. */
export interface DocumentLabItem {
  analyte: string
  value: number
}

export interface DocumentLabDraft {
  patientId: string
  panel: LabPanelKey
  items: DocumentLabItem[]
  note?: string
}

/* ---------- POST /api/icu/results/labs/document-custom (Custom Lab Test) ----------
   The UNSTRUCTURED escape hatch for a test the catalogue does not have.
   Free-text testName + value (both required), optional unit / reference
   range / note. The value is free text (never parsed as a number); the
   reference range is DISPLAY-ONLY (never drives a flag). The server stamps
   provenance + time + source=manual and stores it unflagged, tagged custom. */
export interface DocumentCustomLabDraft {
  patientId: string
  testName: string
  value: string
  unit?: string
  refRange?: string
  note?: string
}

/* ---------- GET /api/icu/results/imaging?patientId ---------- */

export type ImagingModality = 'CXR' | 'CT' | 'US' | 'Echo' | 'MRI'
/** status progression: ordered → in-progress → preliminary → final */
export type ImagingStatus = 'ordered' | 'in-progress' | 'preliminary' | 'final'

export interface ImagingStudy {
  studyId: string
  patientId: string
  /** see LabDraw.encounterId — same server-derived scope */
  encounterId?: string
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
  /** see LabDraw.history — same never-destroy audit record */
  history?: ResultEvent[]
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
  /** '' ONLY for a custom / unstructured lab result — it carries no flag */
  flag: ResultFlag | ''
}

/* ==================== AI Clinical Assistant domain (Screen 8) ====================
   THE canonical source of AI risk predictions. Mission Control's AI panel is
   a derived one-line view over this model, and risks crossing threshold are
   surfaced through the EXISTING alert center (getPatientDetail alerts) —
   never a separate alert system. All predictions are SIMULATED mock data
   until the real model service arrives with device integration (Stage 11).
   The assistant is advisory only — it never places orders or acts. */

export type RiskCategory = 'Sepsis' | 'AKI' | 'ARDS' | 'Delirium' | 'Mortality'
export type RiskTrend = 'rising' | 'falling' | 'stable'

export interface RiskFactor {
  label: string
  /** relative contribution 0–100 (drives the breakdown bar) */
  weight: number
  /** true = protective/mitigating factor */
  mitigating?: boolean
}

export interface RiskPrediction {
  category: RiskCategory
  /** current probability 0–100 (== last history sample) */
  probability: number
  /** q15min model ticks, oldest → newest (~2 h window). Trend is computed
      from this at read time — never stored (same rule as due-states). */
  history: number[]
  rationale: string
  factors: RiskFactor[]
  /** advisory suggestions — present only while the risk is elevated */
  suggestions?: string[]
}

/* ---------- GET /api/icu/ai/risks?patientId ---------- */

export interface PatientRiskProfile {
  patientId: string
  /** denormalized display fields */
  bedId: string
  patientName: string
  /** last simulated model tick, "HH:MM" */
  updatedAt: string
  risks: RiskPrediction[]
}

/* ---------- GET /api/icu/ai/ranking — unit-wide, derived ---------- */

export interface RankedRisk {
  category: RiskCategory
  probability: number
  trend: RiskTrend
  /** delta vs the oldest history sample (~2 h) */
  delta: number
}

export interface RiskRankingRow {
  patientId: string
  bedId: string
  patientName: string
  diagnosis: string
  /** highest current risk across any category */
  top: RankedRisk
  topHistory: number[]
  /** every other elevated risk, highest first */
  alsoElevated: RankedRisk[]
  updatedAt: string
}

/* ================= Layer 2 — ADT (Aurora Core) =================
   Patient / Encounter are CORE entities: a Patient is a person and
   persists across visits; an Encounter is one admission (bed, attending,
   admission time, status, discharge/transfer events). Bed occupancy is
   DERIVED from open encounters — never stored. */

/* ---------- GET /api/icu/adt/beds ---------- */

export interface AdtBed {
  bedId: string
  area: string
  /** occupancy — absent = bed free (derived from open encounters) */
  patientId?: string
  patientName?: string
  encounterId?: string
}

/* ---------- GET /api/icu/adt/encounters?patientId&status ---------- */

export interface AdtEvent {
  time: string
  actor: string
  action: string // admitted | transferred | discharged
  detail?: string
}

export interface Encounter {
  encounterId: string
  patientId: string
  /** denormalized display snapshot (same precedent as orders) */
  patientName: string
  bedId: string
  diagnosis: string
  attending: string
  status: 'open' | 'discharged'
  /** "" on historical seeds (no admission time recorded) */
  admittedAt: string
  admittedBy: string
  dischargedAt?: string
  dischargedBy?: string
  events: AdtEvent[]
}

/* ---------- GET /api/icu/adt/patients/:patientId ---------- */

/** The Core PATIENT-IDENTITY read — person-level identity from the
 *  persisted AdtPatients row, resolvable whether or not the patient has
 *  an open encounter (the fix for the recorded discharged-patient
 *  identity gap). Identity is served by the SAME server-side resolver
 *  the roster and the admissions response use — one source of truth. */
export interface PatientIdentity {
  patientId: string
  mrn: string
  name: string
  /** absent/null on rows admitted before DOB capture existed (the wire
   *  omits null fields — WhenWritingNull) — an admission-era age estimate
   *  cannot be turned into a birth date without fabrication, so it
   *  never is */
  dateOfBirth?: string | null
  /** COMPUTED at read from dateOfBirth when present (clock-computed-state
   *  rule — never stored); otherwise the admission-era recorded value,
   *  served plainly with its provenance */
  age: number
  ageSource: 'dateOfBirth' | 'recordedAtAdmission'
  sex: Sex
  allergies: string
}

/* ---------- POST /api/icu/adt/admissions ---------- */

export interface AdmitDraft {
  mrn: string
  name: string
  /** EXACTLY ONE of dateOfBirth / age. dateOfBirth ("yyyy-MM-dd") is the
   *  correct capture — age then computes at read; age remains for
   *  estimated-age admissions (DOB genuinely unknown at the bedside).
   *  Both → 400, neither → 400 (server-validated). */
  age?: number
  dateOfBirth?: string
  sex: Sex
  allergies: string
  diagnosis: string
  attending: string
  bedId: string
}

export interface AdmitResponse {
  patient: PatientIdentity
  encounter: Encounter
}

/* ================= Layer 3 — User Administration (Aurora Core) =================
   JobTitle is the SINGLE stored role field — PermissionProfile and
   Permissions are ALWAYS derived from it at read time (locked RBAC rule),
   which is why UserAccount carries no profile field: the UI derives it via
   profileOf(). Deactivation is a status change, never a delete. Every
   management action lands on the account's immutable audit history. */

/* ---------- GET /api/icu/users ---------- */

export interface UserAuditEvent {
  /** UTC "yyyy-MM-dd HH:mm" — account changes span months, so unlike
   *  bedside events the audit time carries the date */
  time: string
  /** ALWAYS the acting token's name claim — never a request field */
  actor: string
  action: string // created | job title changed | renamed | deactivated | reactivated | password reset
  detail?: string
}

export interface UserAccount {
  username: string
  name: string
  jobTitle: string
  active: boolean
  events: UserAuditEvent[]
}

/* ---------- POST /api/icu/users ---------- */

export interface CreateUserDraft {
  username: string
  name: string
  jobTitle: string
  initialPassword: string
  /** REQUIRED when jobTitle derives the Doctor or Nurse profile (granting
   *  clinical authority) — recorded in the audit event */
  justification?: string
}

/* ---------- PUT /api/icu/users/:username ---------- */

export interface EditUserDraft {
  name?: string
  jobTitle?: string
  justification?: string
}

/* ---------- Stage 11 — Observations (§12 step 3 wire contracts) ----------
   Mirrors server/Core/Observations/ObservationModels.cs exactly (camelCase;
   optional fields ABSENT on the wire, not null). The Observation record is
   GENERIC (typeCode → value against the Type Catalogue — Pillar 2); values
   arrive as the server's NORMALIZED storage text: numeric → invariant
   number string, enum → the allowed value, compound → a JSON object
   string of its components. */

export interface ObsComponent {
  code: string
  label: string
  kind: 'numeric' | 'enum'
  min?: number
  max?: number
  values?: string[]
}

export interface ObservationType {
  typeCode: string
  groupCode: string
  displayName: string
  unit: string
  valueType: 'numeric' | 'enum' | 'compound'
  min?: number
  max?: number
  allowedValues?: string[]
  components?: ObsComponent[]
  isDerived: boolean
  derivationInputs?: string[]
  optional: boolean
}

/** GET /api/icu/observations/catalog — groups in clinical order, each
 *  carrying its types; DISABLED groups are included (config visibility)
 *  and the entry form filters on enabled. */
export interface ObsCatalogGroup {
  groupCode: string
  displayName: string
  seq: number
  enabled: boolean
  types: ObservationType[]
}

/** one §8 amendment layer — the actor is ALWAYS on the record; reason is
 *  '' on a tier-1 self-correction (the Q1 decision: no reason required) */
export interface ObsAmendment {
  previousValue: string
  newValue: string
  amendedBy: string
  amendedAt: string
  reason: string
  amenderRole: string
}

export interface Observation {
  observationId: string
  patientId: string
  encounterId: string
  typeCode: string
  /** ORIGINAL charted value — never rewritten; the effective value is the
   *  last amendment's newValue when amendments exist (amend-not-erase) */
  value: string
  unit: string
  /** measurement time, SERVER-stamped 'yyyy-MM-dd HH:mm' UTC (§7 — no back-dating) */
  clinicalTime: string
  source: 'manual' | 'device' | 'hybrid'
  deviceId?: string
  recordedBy: string
  /** system entry stamp 'yyyy-MM-dd HH:mm:ss' UTC — the tier-1 window anchor */
  enteredAt: string
  verifiedBy?: string
  amendments: ObsAmendment[]
}

/** a charted value on its way in: numeric types send a number, enum types
 *  the string, compound types an object of components */
export type ObsEntryValue = number | string | Record<string, number | string>

/* ---------- POST /api/icu/observations ---------- */

export interface NewObservationEntry {
  typeCode: string
  value: ObsEntryValue
}
