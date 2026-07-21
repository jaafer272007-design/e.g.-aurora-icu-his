/* API contract types.
   These interfaces mirror the future ASP.NET Core REST responses one-to-one
   (field names + nesting). Swapping the mock adapters for real endpoints must
   be a data-layer change only — never touch the UI when doing so. */

/** DERIVED patient acuity (scoring/display.ts deriveSeverity — worst of
 *  {NEWS2 band, SOFA sub-scores}). 'unscored' is the honest neutral for a
 *  patient with no computable score: green is EARNED from a real score on
 *  real data, or it does not appear (the no-reassuring-default rule). The
 *  old wire/fixture severity is retired — no display reads it. */
export type Severity = 'crit' | 'high' | 'stable' | 'unscored'
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
  /** ISOLATION PRECAUTIONS (Configuration Vocabularies): the OPEN
   *  encounter's selected type CODES (absent = none). The boolean above
   *  stays DERIVED from this set (non-empty = isolated) so every
   *  pill/filter/count renders unchanged. */
  isolationTypes?: string[]
  codeStatus: string
  /** CODE STATUS (governed vocabulary — the SAFETY FIX): codeStatus is
   *  the RESOLVED display value ('' = NOT RECORDED, an explicit state
   *  every surface renders unmistakably); codeStatusCode = the selected
   *  vocabulary code when governed; codeStatusLegacy = true when the
   *  value is preserved pre-vocabulary free text awaiting clinician
   *  re-confirmation (never dropped, never guessed). */
  codeStatusCode?: string | null
  codeStatusLegacy?: boolean
  vitals: BedCardVitals
  alert: BedAlert
  attending: string
  /* severity is NO LONGER carried here — the bed card DERIVES it from the
     real scores (useDerivedSeverities); a wire/fixture acuity claim on a
     display DTO was the reassuring-default bug */
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

/* ---------- Phase 3 PR 3 — DERIVED unit summary (production) ----------
   Not a wire contract: no unit-summary endpoint exists. These are the
   summary figures that already have canonical sources, composed client-
   side at load from the real reads — ADT encounters and the results
   inbox. Concepts with no source (pending consults, planned discharges,
   trend deltas) are ABSENT from this shape by design: dropped, never
   fabricated (owner's decision (b)). */

export interface DerivedUnitSummary {
  /** encounters whose server-stamped admittedAt falls on today's server-local day */
  admissionsToday: number
  /** discharged encounters whose dischargedAt falls on today's server-local day */
  dischargesToday: number
  /** unacknowledged results carrying the clinician-marked critical flag.
   *  NULL = the signed-in role holds no results.view authority (the RBAC
   *  matrix keeps clinical results off office/administrative profiles) —
   *  the UI region is ABSENT for that viewer, never a fabricated zero */
  criticalUnacked: number | null
  /** those same critical rows, as the inbox serves them — the REAL signal
   *  behind the demo "unit alert feed" region (no alert domain exists; a
   *  synthesized feed would fabricate). Same null semantics as above. */
  criticalResults: ResultInboxItem[] | null
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
  /** CODE STATUS (governed vocabulary — the SAFETY FIX): codeStatus is
   *  the RESOLVED display value ('' = NOT RECORDED, an explicit state
   *  every surface renders unmistakably); codeStatusCode = the selected
   *  vocabulary code when governed; codeStatusLegacy = true when the
   *  value is preserved pre-vocabulary free text awaiting clinician
   *  re-confirmation (never dropped, never guessed). */
  codeStatusCode?: string | null
  codeStatusLegacy?: boolean
  rhythm: string
  isolation: boolean
  /** isolation type codes of the OPEN encounter (see the bed-board note) */
  isolationTypes?: string[]
  flags: SupportFlag[]
  bedsideVitals: BedCardVitals
  bedAlert: BedAlert
  mapTrend: number[]
  monitorVitals: MonitorVitals
  /* the wire severity/organs snapshot is RETIRED from the client contract:
     severity is derived from the real scores at render; organ status is
     the digital twin's SOFA restatement. The server no longer emits
     organs at all, and its severity field is unread here by design. */
  /** structured-identity tail (absent on legacy rows): the derived FULL
   *  legal name and the national ID — both feed the one-search-box rule
   *  (any name part or number finds the patient) */
  fullName?: string
  nationalId?: string
  /** the hospital's own chart number (Locale/File-Number §2) — the
   *  third search key (staff look patients up by the number they know) */
  fileNumber?: string
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
  /** isolation type codes of the OPEN encounter (bool above derives) */
  isolationTypes?: string[]
  alertCount: number
  /** structured-identity tail (absent on legacy rows) — search fields */
  fullName?: string
  nationalId?: string
  /** the hospital's own chart number (Locale/File-Number §2) — the
   *  third search key (staff look patients up by the number they know) */
  fileNumber?: string
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

/* OrganName / OrganStatus are RETIRED: the digital twin's organ claims
   are now a pure restatement of the SOFA per-system sub-scores
   (scoring/display.ts systemStatusFromScore) — an organ status that was
   not score-backed was the fabricated-reassurance bug. */

export interface Patient extends PatientSummary {
  age: number
  sex: Sex
  los: number
  allergies: string
  attending: string
  codeStatus: string
  /** CODE STATUS (governed vocabulary — the SAFETY FIX): codeStatus is
   *  the RESOLVED display value ('' = NOT RECORDED, an explicit state
   *  every surface renders unmistakably); codeStatusCode = the selected
   *  vocabulary code when governed; codeStatusLegacy = true when the
   *  value is preserved pre-vocabulary free text awaiting clinician
   *  re-confirmation (never dropped, never guessed). */
  codeStatusCode?: string | null
  codeStatusLegacy?: boolean
  rhythm: string
  vitals: MonitorVitals
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
  /** ordered route — present on rows derived from REAL orders (PR 2) */
  route?: string
  /** PUMP-SOURCED fields — absent on rows derived from real orders: the
   *  live rate, the trend samples and the status judgement have no
   *  source without a device feed (Device Adapter scope), and facts are
   *  never invented. Present only on the demo fixture rows. */
  rate?: string
  status?: 'hi' | 'md' | 'ok'
  /** last 7 rate samples */
  trend?: number[]
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
  ventilator: Ventilator
  hemodynamics: Hemodynamics
  infusions: Infusion[]
  labs: Labs
  /** NULL = the per-patient alerts domain does not exist in this
   *  version (production, Phase 3 PR 2) — the card says so */
  alerts: PatientAlert[] | null
  /** NULL = the care-plan domain does not exist in this version */
  goals: Goal[] | null
  timeline: TimelineEvent[]
}

/* ---------- GET /api/icu/worklist (doctor workspace) ---------- */

export interface RoundingPatient {
  patientId: string
  bedId: string
  name: string
  diagnosis: string
  flags: SupportFlag[]
  /* severity retired — the rounding card derives it from the real scores */
}

/* RoundingListResponse is RETIRED (Patient Assignment & Responsibility):
   the rounding list derives from REAL doctor assignments — the fixture's
   hardcoded physician + six patient ids are gone. */

/* ---------- Assignment — the OPT-OUT coverage model (Aurora Core) ----------
   The validator's clinical correction, replacing #114's opt-in model:
   doctors have NO assignment concept (every doctor covers every patient);
   every NURSE covers every patient BY DEFAULT and exceptions are carved
   as REMOVALS (restorable, never deleted). Primary/secondary dropped.
   🔴 Worklist, never authority — with ZERO exceptions since this build
   (the SBAR handoff gate is dropped): a removal changes the focused
   view, never the ability to act. 🔴 Removing the LAST covering nurse
   is refused by the server — a patient never has zero coverage. */

/** one open encounter's derived coverage */
export interface CoverageRow {
  patientId: string
  patientName: string
  bedId: string
  encounterId: string
  /** active Nurse-profile accounts minus active removals — never empty
   *  (the server refuses the removal that would empty it) */
  nurses: CoveringNurse[]
  /** the exception rows, active AND restored (the inline audit) */
  removals: Removal[]
}

export interface CoveringNurse {
  userId: string
  name: string
  jobTitle: string
}

/** one carved exception: this nurse is NOT covering this encounter */
export interface Removal {
  removalId: string
  encounterId: string
  patientId: string
  patientName: string
  bedId: string
  userId: string
  userName: string
  userTitle: string
  removedAt: string
  removedBy: string
  removedByRole: string
  reason?: string | null
  restoredAt?: string | null
  restoredBy?: string | null
  restoredByRole?: string | null
}

/** the signed-in clinician's worklist — the wire states the model:
 *  'nurse' = all open patients minus my removals; 'doctor' = ALL open
 *  patients; null = no worklist for this profile */
export interface MineWorklist {
  kind: 'nurse' | 'doctor' | null
  patientIds: string[]
  removedPatientIds: string[]
}

/** coverage-manager picker row: the active nurses coverage derives from */
export interface CoverageStaff {
  userId: string
  name: string
  jobTitle: string
}

/* ---- the LEGACY #114 shape (history read only — /assignments/history;
   no new rows are ever created) ---- */
export type AssignmentKind = 'nurse' | 'doctor'

export interface Assignment {
  assignmentId: string
  encounterId: string
  patientId: string
  patientName: string
  bedId: string
  userId: string
  userName: string
  userTitle: string
  kind: AssignmentKind
  role: 'primary' | 'secondary'
  shift: string
  assignedAt: string
  assignedBy: string
  assignedByRole: string
  endedAt?: string | null
  endedBy?: string | null
  endedByRole?: string | null
  endReason?: string | null
}

/* UnassignedPatient / AssignableStaff / CreateAssignmentDraft are
   RETIRED (Assignment Simplification): with the opt-out default and the
   last-nurse 409, an uncovered patient CANNOT exist — the Unassigned
   panel's reason to exist is gone (the safety moved from "visible" to
   "impossible"); the opt-in create flow is replaced by remove/restore. */

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

/* OrderType / OrderSetsResponse RETIRED (Imaging Catalogue): the mock
   Order Sets lists' last consumer was imaging ordering, which now reads
   the REAL imaging catalogue (getImagingCatalog). Real order sets are
   OrderSetDef (getOrderSetDefs). */

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
  /** CODE STATUS (governed vocabulary — the SAFETY FIX): codeStatus is
   *  the RESOLVED display value ('' = NOT RECORDED, an explicit state
   *  every surface renders unmistakably); codeStatusCode = the selected
   *  vocabulary code when governed; codeStatusLegacy = true when the
   *  value is preserved pre-vocabulary free text awaiting clinician
   *  re-confirmation (never dropped, never guessed). */
  codeStatusCode?: string | null
  codeStatusLegacy?: boolean
  flags: SupportFlag[]
  isolation: boolean
  /* severity retired — the worklist card derives it from the real scores */
  vitals: BedCardVitals
}

/* NurseAssignmentResponse is RETIRED (Patient Assignment &
   Responsibility): the workspace derives from the signed-in nurse's REAL
   assignments — the fixture's hardcoded nurse identity, two patient ids
   and '07:00–19:00' display literal (which ignored who was signed in)
   are gone. */

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
  /** STRUCTURED INFUSION ORDERING — present on continuous-infusion orders
   *  placed through the structured form: the dose as ENTERED (faithful),
   *  e.g. {value:0.3, massUnit:'mcg', timeBasis:'min'} = 0.3 µg/kg/min.
   *  The weight basis is always per kg (the design's decision). The
   *  free-text `dose` above is the DISPLAY string COMPOSED from this
   *  entry server-side — never edited independently. Normalisation to
   *  µg/kg/min is DERIVED at read (src/lib/infusion.ts), never stored.
   *  Absent on non-infusion meds and every pre-feature order. */
  infusion?: InfusionDose
}

/** the structured infusion dose (massUnit is ASCII 'mcg'|'mg' on the
 *  wire, rendered µg/mg) */
export interface InfusionDose {
  value: number
  massUnit: 'mcg' | 'mg'
  timeBasis: 'min' | 'hour'
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
  /** Imaging Catalogue: the catalogue study an Imaging order references —
   *  the ORDER half of the order→report linkage (#105 built the report
   *  half via orderId). Summary carries the study name at order time
   *  (snapshot-at-use). Optional; absent on free-text imaging orders and
   *  pre-catalogue rows. */
  studyId?: string
  /** CORRECTED IMAGING MODEL: body region + contrast are ORDER-TIME
   *  decisions on the ORDER — region free text as the doctor typed it,
   *  contrast a single tick (true = with contrast; absence IS plain).
   *  Imaging orders only; historical orders carry values backfilled from
   *  the old baked-in study definitions. */
  region?: string
  contrast?: boolean
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
  /** Imaging Catalogue: the catalogue study an Imaging order references —
   *  the ORDER half of the order→report linkage (#105 built the report
   *  half via orderId). Summary carries the study name at order time
   *  (snapshot-at-use). Optional; absent on free-text imaging orders and
   *  pre-catalogue rows. */
  studyId?: string
  /** order-time imaging specifics (the corrected model): free-text body
   *  region + the single contrast checkbox — Imaging drafts only */
  region?: string
  contrast?: boolean
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
  /** hidden internal key — omitted by the UI (the server generates it);
   *  wire-accepted for existing callers */
  drugId?: string
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
  /** Option B (Catalogue Test Management): CRITICAL thresholds — a value at
   *  or beyond one flags CRITICAL. Optional per side; absent on the 7
   *  seeded panels (backfilling them is a recorded future item). */
  critLow?: number
  critHigh?: number
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
  /** OPTIONAL since the free-text correction: the UI sends only the name
   *  and the server derives the panel key from it (what the user typed
   *  is what results render under — no format rules) */
  testId?: string
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
  /** Imaging Catalogue: the catalogue study an Imaging order references —
   *  the ORDER half of the order→report linkage (#105 built the report
   *  half via orderId). Summary carries the study name at order time
   *  (snapshot-at-use). Optional; absent on free-text imaging orders and
   *  pre-catalogue rows. */
  studyId?: string
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
  /** derived instances carry the DATED identity "yyyy-MM-ddTHH:mm" (the
   *  MAR safety fix — a missed dose can never be relabelled as another
   *  day's dose); "prn"/"ondemand" for availability rows;
   *  "missed-earlier" on the horizon summary row; documented facts keep
   *  their stored ADM-n ids */
  adminId: string
  patientId: string
  bedId: string
  medication: string
  dose: string
  route: string
  /** DATED "yyyy-MM-dd HH:mm" on derived instances · empty for
   *  PRN/on-demand · legacy facts keep whatever they recorded */
  scheduledTime: string
  prn: boolean
  status: 'scheduled' | 'missed-earlier' | AdministrationAction
  documentedTime?: string
  /** only on the per-order horizon summary row: undocumented instances
   *  older than the render window, counted out loud — never silently
   *  truncated */
  missedEarlier?: number
  /** only on the honest underivable row: why no schedule is derived */
  scheduleNote?: string
  /** documented facts only: the held/refused reason, or the DELAY
   *  reason on a dose given more than LATE_THRESHOLD_MINUTES past its
   *  scheduled instant (the overdue-delay-reason safety fix) */
  reason?: string
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
  /** Option B: the critical thresholds SNAPSHOTTED from the catalogue
   *  definition at documentation time (same snapshot rule as refLow/
   *  refHigh); absent on every pre-Option-B result */
  critLow?: number
  critHigh?: number
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
  /** Lab Result Editing: the precise UTC documentation anchor
   *  ('yyyy-MM-dd HH:mm:ss') — present ONLY on manually documented results.
   *  Anchors the 5-minute Tier-1 self-correction window and the §2a rule
   *  that a result is not acknowledgeable until the window closes. */
  documentedAt?: string
  /** Lab Result Editing: append-only correction history (amend-not-erase) —
   *  present once a result has been corrected. "Edited" is DERIVED from
   *  this being non-empty, never stored. */
  amendments?: LabAmendment[]
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

/* ---------- POST /api/icu/results/labs/:labId/correct (Lab Result Editing) ----------
   The two-tier correction of a DOCUMENTED lab result — mirrors the Stage 11
   observation amendment. Tier-1: the documenter, within 5 minutes of
   documentation, no reason required (still recorded). Tier-2: Consultant-
   tier (results.correct), reason REQUIRED, any time — incl. after
   acknowledgment (§2b: the original acknowledgment is kept and the
   amendment carries afterAcknowledgment=true so the ordering is visible).
   The SERVER decides the tier. */

/** one recorded correction — previous value preserved (amend-not-erase) */
export interface LabAmendment {
  /** what was corrected: an analyte name (structured), 'value' (custom), or 'note' */
  target: string
  previousValue: string
  newValue: string
  amendedBy: string
  amendedAt: string
  /** '' on a Tier-1 self-correction */
  reason: string
  amenderRole: string
  /** §2b: true when the correction happened AFTER the result was
   *  acknowledged — stored at correction time, so the old sign-off is
   *  never mistaken to cover the corrected value */
  afterAcknowledgment: boolean
}

export interface CorrectLabDraft {
  /** structured results only: the analyte whose value is corrected */
  analyte?: string
  /** number for a structured analyte; free-text string for a custom result */
  value?: number | string
  note?: string
  /** required on Tier-2 — the server decides the tier */
  reason?: string
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

export type ImagingModality = 'CXR' | 'X-ray' | 'CT' | 'US' | 'Echo' | 'MRI' | 'Other'

/** THE ONE MODALITY VOCABULARY (Imaging Catalogue design §3 — a small
 *  FIXED set, mirroring the server's ResultsLogic.ImagingModalities;
 *  modalities are standard — hospitals add STUDIES within them, never
 *  new modalities). Read by result-entry and the catalogue manager
 *  alike — the client's inline duplicates are retired. */
export const IMAGING_MODALITIES: readonly ImagingModality[] =
  ['CXR', 'X-ray', 'CT', 'MRI', 'US', 'Echo', 'Other']
/** status progression: ordered → in-progress → preliminary → final */
export type ImagingStatus = 'ordered' | 'in-progress' | 'preliminary' | 'final'

/* Imaging Result Entry — mirrors DocumentImagingRequest on the server */
export interface DocumentImagingDraft {
  patientId: string
  /** the pending imaging order being reported on (identity from the order) */
  orderId?: string
  modality: string
  /** required (and allowed) ONLY when unlinked — the picked study type */
  description?: string
  /** 'yyyy-MM-dd HH:mm' UTC — when the study was performed */
  performedAt: string
  findings: string
  impression: string
  /** free text from the paper report */
  reportingRadiologist: string
  /** CLINICIAN-MARKED critical finding — never system-derived */
  critical: boolean
  note?: string
}

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
  /** '' on a documented report the clinician did NOT mark critical — the
   *  system never fabricates a normal/abnormal judgment for narrative text
   *  (Imaging Result Entry design §4) */
  flag: ResultFlag | ''
  note?: string
  acknowledged: boolean
  acknowledgedBy?: string
  acknowledgedAt?: string
  /* ---- Imaging Result Entry (absent on seeded rows) ---- */
  /** the pending imaging order this report FULFILS — absent = an honest
   *  UNLINKED report (outside film / pre-order study), never a fabricated
   *  order */
  orderId?: string
  /** 'manual' on clinician-documented reports (results.document) */
  source?: string
  /** FREE TEXT from the paper report — the radiologist is not a system
   *  user; distinct from the documenting clinician (locked provenance) */
  reportingRadiologist?: string
  /** Imaging Report Correction: the precise UTC documentation anchor
   *  ('yyyy-MM-dd HH:mm:ss') — present ONLY on manually documented reports.
   *  Anchors the 5-minute Tier-1 self-correction window and the §2a rule
   *  that a report is not acknowledgeable until the window closes (the
   *  LabDraw.documentedAt pattern, verbatim). */
  documentedAt?: string
  /** Imaging Report Correction: append-only correction history
   *  (amend-not-erase) — the SAME shape as lab amendments; present once a
   *  report has been corrected. "Edited" is DERIVED from this being
   *  non-empty, never stored. Targets: 'findings' | 'impression' |
   *  'performedAt' | 'reportingRadiologist' | 'note' | 'critical'. */
  amendments?: LabAmendment[]
  /** see LabDraw.history — same never-destroy audit record */
  history?: ResultEvent[]
}

/** Imaging Report Correction — the PR #80 two-tier request applied to the
 *  imaging correctable surface. At least one field; reason required on
 *  Tier-2 (the SERVER decides the tier). */
export interface CorrectImagingDraft {
  findings?: string
  impression?: string
  /** 'yyyy-MM-dd HH:mm' UTC — same rules as documentation (never future) */
  performedAt?: string
  reportingRadiologist?: string
  note?: string
  /** the corrected CLINICIAN-MARKED critical state — marked in error or
   *  missed, both fixable; still a clinician judgment, never system-derived */
  critical?: boolean
  /** LINKAGE CORRECTION: re-point (or link an unlinked report) to this
   *  pending imaging order — identity is re-derived from it; the previous
   *  description is preserved as its own amendment. Fulfilment is derived,
   *  so the previously-linked order returns to pending automatically. */
  orderId?: string
  /** LINKAGE CORRECTION: remove the linkage (explicit boolean — never an
   *  empty-string sentinel). Mutually exclusive with orderId. */
  unlink?: boolean
  /** required on Tier-2 — the server decides the tier */
  reason?: string
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
  /** Lab Result Editing §2a: present only for manually documented lab
   *  results — a result inside its 5-minute self-correction window is not
   *  yet acknowledgeable (server-enforced; this lets the UI say so) */
  documentedAt?: string
}

/* ==================== AI Assistant — grounded query chat ====================
   The simulated risk domain that lived here (fabricated probabilities,
   ranked rail, factors, suggestions) is DELETED. The AI surface is now ONE
   translation contract: POST /api/icu/ai/query returns the tool the model
   selected — A QUERY, NEVER A VALUE. No response field can carry patient
   data; the client executes the tool through the canonical reads above,
   on the user's own token. */

export interface AiQueryResponse {
  /** the selected tool name — ABSENT/null when unanswerable/refused (the
   *  server's JSON convention drops null fields on the wire) */
  tool?: string | null
  /** the tool's arguments as parsed JSON (shape owned by the tool registry) */
  args?: Record<string, unknown> | null
  /** the model's honest refusal reason (mutually exclusive with tool) */
  unanswerable?: string | null
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
  seq: number
  /** Bed Registry (4th Configuration tenant): retired beds leave the
   *  board and the admit/transfer pickers but keep rendering on
   *  historical records carrying their bedId (FK-free snapshots). */
  active: boolean
  /** occupancy — absent = bed free (derived from open encounters) */
  patientId?: string
  patientName?: string
  encounterId?: string
  /** append-only audit (added/retired/reactivated); seeded beds carry
   *  an empty history — no invented audit */
  history: FormularyEvent[]
}

/** POST /api/icu/adt/beds — add a bed to the registry (beds.manage).
 *  Add/retire only, NEVER rename — no edit draft exists by design. */
export interface CreateBedDraft {
  bedId: string
  area: string
  seq?: number
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
  /** Weight & Height capture — ENCOUNTER-SCOPED attributes (kg / cm), NOT
   *  observations (the validator: ICU patients aren't weighed daily) and
   *  NOT person-level (the owner's decision on the flagged choice): each
   *  admission keeps ITS OWN reference weight/height — a re-admission
   *  starts fresh, never inheriting or overwriting a prior episode's.
   *  Absent until captured (the wire omits nulls). BMI/IBW/BSA are NEVER
   *  on the wire — derived at render (src/lib/anthropometrics.ts) and
   *  hidden when an input is missing. */
  weightKg?: number
  heightCm?: number
  /** amend-not-erase history WITHIN this encounter — every set/change
   *  with who/when/prior; absent until the first measurement */
  measurements?: MeasurementEvent[]
  /** discharge disposition — the OUTCOME of the ICU stay, selected by the
   *  discharging clinician as part of the discharge flow. One of the
   *  DISPOSITION codes (src/lib/api/index.ts). Absent = not recorded
   *  (every pre-feature discharge): shown as "not recorded", NEVER
   *  fabricated, and excluded from any mortality denominator. */
  disposition?: DispositionCode
  /** CODE STATUS (governed vocabulary — the SAFETY FIX): the selected
   *  vocabulary CODE, encounter-scoped like weight/height (a
   *  re-admission STARTS FRESH — a stale DNR never silently carries
   *  forward). Absent = NOT RECORDED — an explicit state, never a
   *  default. codeStatusEvents is the append-only set history (who /
   *  when / active role / prior). */
  codeStatusCode?: string
  codeStatusEvents?: CodeStatusEvent[]
  /** ISOLATION PRECAUTIONS (Configuration Vocabularies): the selected
   *  type CODES for THIS stay, encounter-scoped on the code-status rule
   *  (a re-admission starts fresh; stale precautions never silently
   *  carry). Absent = none. Set changes are audited into events. */
  isolationTypes?: string[]
}

/** one append-only code-status set event (prior null on the first set);
 *  label = the vocabulary label SNAPSHOT the clinician selected —
 *  historical rendering reads it and never consults the live vocabulary */
export interface CodeStatusEvent {
  time: string
  actor: string
  role: string
  code: string
  label: string
  prior?: string | null
}

/** discharge-disposition vocabulary (server-validated) */
/** a Dispositions vocabulary CODE (managed since the Configuration
 *  Vocabularies build — the seeded six plus whatever a hospital adds;
 *  the server validates against the active vocabulary; 'died' is
 *  reserved and death semantics ride the entry's isDeath attribute) */
export type DispositionCode = string

/* ---------- Code Status governed vocabulary (Master Data) ----------
   The per-hospital resuscitation-instruction vocabulary — the free-text
   SAFETY FIX. Managed in the Configuration area (SeniorDoctor); a
   patient's code status is SELECTED from the active entries, never
   typed. Deactivate-never-delete: a retired entry keeps rendering on
   records that carry it but cannot be newly assigned. */
export interface CodeStatusEntry {
  /** permanent natural key (lowercase snake, e.g. 'dnr_dni') */
  code: string
  label: string
  seq: number
  active: boolean
  history: FormularyEvent[]
}

/* ---------- Configuration Vocabularies (the last four of the arc) ----------
   Dispositions / isolation types / shifts on the same shape as
   CodeStatusEntry; named frequencies are value-keyed (the value IS what
   orders store, so there is no label to edit). */

export interface DispositionEntry {
  code: string
  label: string
  seq: number
  active: boolean
  /** IMMUTABLE at creation: the deceased re-admission guard, patient
   *  status, and mortality statistics key on this — never the label.
   *  The seeded 'died' row carries it and is reserved-unretireable. */
  isDeath: boolean
  history: FormularyEvent[]
}

export interface IsolationTypeEntry {
  code: string
  label: string
  seq: number
  active: boolean
  history: FormularyEvent[]
}

export interface ShiftEntry {
  code: string
  label: string
  seq: number
  active: boolean
  history: FormularyEvent[]
}

export interface FrequencyEntry {
  /** the value itself is the permanent identity AND the display (it is
   *  what orders store) — managers add/retire/reactivate, never edit */
  value: string
  seq: number
  active: boolean
  /** formulary drugs whose per-drug frequency list carries the value
   *  (the allowed-but-surfaced retirement warning) */
  referencedBy: string[]
  history: FormularyEvent[]
}

/* ---------- GET/POST /api/icu/imaging-catalog (Configuration) ----------
   The Imaging Catalogue (third Configuration tenant): coded study
   DEFINITIONS on the lab-catalogue pattern — the ordering vocabulary
   (replacing the retired production-blocked mock) and the join key for
   order→report linkage. Deactivate-never-delete: a retired study keeps
   rendering on orders that carry it but isn't newly orderable. */
export interface ImagingStudyDef {
  /** SYSTEM-GENERATED internal key — purely the order→report linkage;
   *  never typed and never displayed (the auto-generated-MRN principle).
   *  Pre-correction rows keep their old snake ids. */
  studyId: string
  /** FREE TEXT — whatever the user typed; no format rules (the corrected
   *  model: an entry is modality + name, nothing else) */
  name: string
  /** one of IMAGING_MODALITIES — the fixed reconciled vocabulary */
  modality: string
  active: boolean
  history: FormularyEvent[]
}

/** the corrected create shape: name + modality ONLY — region/contrast
 *  are order-time and portable is gone (no studyId: the server owns it) */
export interface CreateImagingStudyDraft {
  name: string
  modality: string
}

export interface EditImagingStudyDraft {
  name?: string
  modality?: string
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
  /** STRUCTURED IDENTITY tail (absent on legacy single-name rows —
   *  never fabricated): the five stored parts, the derived full legal
   *  name, the national ID as on the card, and the append-only
   *  identity-correction history. `name` above is always the DERIVED
   *  display name (First+Second+Family, or the stored legacy name). */
  nameFirst?: string
  nameSecond?: string
  nameThird?: string
  nameFourth?: string
  nameFamily?: string
  fullName?: string
  nationalId?: string
  identity?: IdentityEvent[]
  /** PATIENT FILE NUMBER — the hospital's own chart number, stored as
   *  recorded (Locale/File-Number §2): optional, typed, unique when
   *  present. NOT a linking key — the MRN/patientId stay the keys. */
  fileNumber?: string
}

/** one append-only identity-correction event — actor + ACTIVE role
 *  (#104) + dated time + reason + the previous→new diff (the previous
 *  identity is preserved and visible, never erased) */
export interface IdentityEvent {
  time: string
  actor: string
  role: string
  reason: string
  detail: string
}

/* ---------- PUT /api/icu/adt/patients/:patientId/identity ---------- */

/** the audited identity correction (office Administrator authority —
 *  identity.correct): correcting the name requires the complete
 *  structured set; nationalId / dateOfBirth correct independently;
 *  reason always required. The MRN corrects here too (the #116 flag
 *  resolved — safe now that re-admission keys on patientId, not the
 *  MRN): a typed `mrn` must be canonical MRN-###### and unique;
 *  `regenerateMrn` has Aurora assign a fresh unique number instead —
 *  exactly one of the two; the previous value stays in the history */
export interface CorrectIdentityDraft {
  nameFirst?: string
  nameSecond?: string
  nameThird?: string
  nameFourth?: string
  nameFamily?: string
  nationalId?: string
  dateOfBirth?: string
  /** the file number corrects independently like the national ID —
   *  unique against every other patient; clearing is refused */
  fileNumber?: string
  mrn?: string
  regenerateMrn?: boolean
  reason: string
}

/** one weight/height history entry (who / when / prior value preserved —
 *  a value that drives dosing is never silently overwritten) */
export interface MeasurementEvent {
  /** UTC "yyyy-MM-dd HH:mm" — a correction can land days after admission,
   *  so the audit stamp carries the date */
  time: string
  actor: string
  field: 'weight' | 'height'
  action: 'recorded at admission' | 'added' | 'corrected'
  /** the previous value whenever one existed (kg or cm per field) */
  prior?: number | null
  value: number
}

/* ---------- POST /api/icu/adt/admissions ---------- */

export interface AdmitDraft {
  /* mrn is RETIRED (auto-generated MRN — the #113 flag resolved): the
     MRN is the hospital's own record number, ASSIGNED BY AURORA at
     patient creation in the seeded MRN-###### format. The patient brings
     a national identity number, which has its own field below. A typed
     MRN is exactly how P-1191's national ID landed in his MRN slot. */
  /** RE-ADMISSION of an existing patient — their stored identity (and
   *  MRN) stands; identity fields are optional on this path. Omit to
   *  admit a NEW patient (identity fields then required). */
  patientId?: string
  /** STRUCTURED LEGAL NAME (the validator's design): five parts — first,
   *  second (father), family REQUIRED on a new patient; third
   *  (grandfather), fourth (great-grandfather) optional, blank is
   *  honest. Unidentified patients use the same fields, named "unknown"
   *  by the admitting user — no special mode. Names are NOT unique. */
  nameFirst?: string
  nameSecond?: string
  nameThird?: string
  nameFourth?: string
  nameFamily?: string
  /** national identity number — EXACTLY as on the identity card (no
   *  format invention), unique when present, OPTIONAL (the unidentified
   *  have none). Distinct from the MRN. */
  nationalId?: string
  /** PATIENT FILE NUMBER — the hospital's own chart number (typed as
   *  recorded, OPTIONAL, unique when present). A separate field from
   *  the MRN, which stays Aurora-generated (#116 never reopened). */
  fileNumber?: string
  /** EXACTLY ONE of dateOfBirth / age on a new patient. dateOfBirth
   *  ("yyyy-MM-dd") is the correct capture — age then computes at read;
   *  age remains for estimated-age admissions (DOB genuinely unknown at
   *  the bedside). Both → 400; neither → 400 on a new patient
   *  (server-validated). */
  age?: number
  dateOfBirth?: string
  sex?: Sex
  allergies?: string
  diagnosis: string
  attending: string
  bedId: string
  /** Weight & Height capture — OPTIONAL at admission (kg / cm); if
   *  omitted, a clinician adds them later on the patient record */
  weightKg?: number
  heightCm?: number
  /** Code status — OPTIONAL at admission: a code SELECTED from the
   *  ACTIVE vocabulary (never typed). Omitted = honestly NOT RECORDED
   *  until a physician sets it — never a default. */
  codeStatusCode?: string
}

export interface AdmitResponse {
  patient: PatientIdentity
  encounter: Encounter
}

/* ---------- POST /api/icu/adt/patients/match ---------- */

/** the on-submit identity match (match+overview design): runs BEFORE
 *  anything is created. Tier A = mrn/nationalId (unique → confirmed);
 *  Tier B = the three required name parts + dateOfBirth (probabilistic —
 *  a human verifies; exact parts case-insensitive, exact DOB, no fuzzy);
 *  unknown patients (no stored real DOB) never enter Tier B. */
export interface MatchPatientDraft {
  mrn?: string
  nationalId?: string
  /** the hospital's chart number — unique when present, a confirmed-tier key */
  fileNumber?: string
  nameFirst?: string
  nameSecond?: string
  nameFamily?: string
  dateOfBirth?: string
}

/** the match dialog's identity summary card — IDENTITY ONLY (this is
 *  everything the office Administrator sees; there are no clinical
 *  fields to leak). nationalIdLast4 is masked SERVER-SIDE — the full
 *  number never reaches this dialog. */
export interface MatchCard {
  patientId: string
  fullName: string
  mrn: string
  nationalIdLast4?: string | null
  age: number
  ageSource: 'dateOfBirth' | 'recordedAtAdmission'
  sex: Sex
  /** latest encounter's admission stamp — '' on dateless seeds */
  lastAdmission: string
  admissionCount: number
  status: 'admitted' | 'discharged' | 'deceased'
  currentBedId?: string | null
  currentEncounterId?: string | null
  /** UNMASKED, deliberately: the hospital's own chart label (not state
   *  PII) — verifying "same chart?" against the paper record is this
   *  card's whole job */
  fileNumber?: string | null
}

export interface MatchPatientResponse {
  /** 'confirmed' (Tier A) | 'probable' (Tier B); ABSENT when there is no
   *  match (the wire omits null fields) — the dialog only ever opens on
   *  a non-empty matches array, where the tier is always present */
  tier?: 'confirmed' | 'probable' | null
  matches: MatchCard[]
}

/* ---------- PUT /api/icu/adt/encounters/:encounterId/measurements ---------- */

/** add-if-omitted / correct-with-history WITHIN the encounter — at least
 *  one field required; RBAC patients.measure (doctor/nurse — never office
 *  admin). Each admission keeps its own values. */
export interface MeasureDraft {
  weightKg?: number
  heightCm?: number
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
  /** the ACTIVE role the actor exercised (decision 5) — absent on events
   *  written before the User Management design */
  actorRole?: string
  action: string // created | roles changed | renamed | deactivated | reactivated | password reset | password changed
  detail?: string
}

export interface UserAccount {
  username: string
  name: string
  /** the PRIMARY role (always roles[0]) — kept for legacy readers */
  jobTitle: string
  /** the SET of roles this person HOLDS (User Management design §3);
   *  they act as exactly ONE per session, chosen at login */
  roles: string[]
  active: boolean
  /** §4: a change is forced at the next sign-in (new account / admin reset) */
  mustChangePassword: boolean
  events: UserAuditEvent[]
}

/* ---------- POST /api/icu/users ---------- */

export interface CreateUserDraft {
  username: string
  name: string
  /** one or more roles the person will HOLD */
  roles: string[]
  initialPassword: string
  /** REQUIRED when any role derives a clinical profile (Doctor/Nurse/
   *  SeniorDoctor) or the System Administrator authority — recorded in
   *  the audit event */
  justification?: string
}

/* ---------- PUT /api/icu/users/:username ---------- */

export interface EditUserDraft {
  name?: string
  /** full replacement of the role SET (assign/remove roles) */
  roles?: string[]
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
  /* ---- Observations Catalogue management (the tenant) ---- */
  /** normal range — outside → abnormal flag (null = no range set; never fabricated) */
  refLow?: number
  refHigh?: number
  /** critical thresholds — at-or-beyond → critical (precedence over abnormal) */
  critLow?: number
  critHigh?: number
  /** retired types keep rendering on history but are not newly chartable */
  active: boolean
  /** 🔴 system-set: feeds NEWS2/SOFA — the whole definition is LOCKED */
  scoreInput: boolean
  /** hospital-added (vs the seeded taxonomy) */
  custom: boolean
  /** append-only management audit */
  history: FormularyEvent[]
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

/* ---- SBAR shift handoff (owner's 2026-07-18 model): append-only
   immutable entries per ENCOUNTER — four structured fields, author +
   ACTIVE role + dated server time. No edit shape exists on purpose. */
export interface HandoffEntry {
  handoffId: string
  encounterId: string
  patientId: string
  s: string
  b: string
  a: string
  r: string
  recordedByUser: string
  recordedBy: string
  recordedRole: string
  recordedAt: string
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

/* ---------- GET/PUT /api/icu/hospital-identity (Configuration) ----------
   The install's OWN identity (Config Home + Hospital Identity design):
   ONE record per install — hospital name, unit name, short name, and a
   letterhead address block. Administratively governed
   (hospital.configure — office Administrator; the identity.correct
   precedent), audited amend-never-erase. UNSET on a fresh install:
   configured=false and every surface renders a neutral placeholder,
   never a fabricated default. The public read is ANONYMOUS (the login
   screen renders identity pre-auth); the history read is gated. */
export interface HospitalIdentity {
  name: string
  unitName: string
  shortName: string
  address: string
  /** BRANDING (Print Center branding build): the hospital's own header
   *  tagline and footer line on printed documents — administrative face,
   *  never clinical data */
  headerText: string
  footerText: string
  /** letterhead logo: bytes live behind the dedicated /logo endpoint
   *  (never inlined on the boot read); logoVersion cache-busts it */
  hasLogo: boolean
  logoVersion: number
  configured: boolean
  /** the server's MACHINE CLOCK (Locale/Timezone §1.3) — only the PUBLIC
   *  read carries these; the client primes its display clock from them
   *  (storage stays UTC; display converts to the hospital's own zone) */
  serverTimeZone?: string
  serverUtcOffsetMinutes?: number
}

export interface HospitalIdentityWithHistory extends HospitalIdentity {
  history: FormularyEvent[]
}

export interface EditHospitalIdentityDraft {
  name: string
  unitName: string
  shortName: string
  address: string
  headerText: string
  footerText: string
}
