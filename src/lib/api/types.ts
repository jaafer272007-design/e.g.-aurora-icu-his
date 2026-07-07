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

export interface TimelineEvent {
  time: string
  category: 'med' | 'lab' | 'vnt' | 'prc' | 'con' | 'nte' | 'txf'
  categoryLabel: string
  text: string
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

export type ActionQueuesResponse = Record<QueueKey, ActionQueueItem[]>

export interface Consult {
  specialty: string
  message: string
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

/* ---------- GET /api/icu/nursing/mar ---------- */

/** pending states are precomputed server-side against the schedule */
export type MarDueState = 'overdue' | 'due' | 'upcoming' | 'prn'
export type MarAction = 'given' | 'held' | 'refused'

export interface MarEntry {
  marId: string
  patientId: string
  bedId: string
  medication: string
  dose: string
  route: string
  /** empty for PRN entries */
  scheduledTime: string
  status: MarDueState | MarAction
  /** set once documented (given/held/refused) */
  documentedTime?: string
  orderedBy: string
}

/* ---------- GET /api/icu/nursing/orders-to-implement ---------- */

export type OrderPriority = 'Routine' | 'Urgent' | 'STAT'

export interface ImplementOrder {
  orderId: string
  patientId: string
  bedId: string
  text: string
  priority: OrderPriority
  orderedBy: string
  time: string
  done: boolean
}

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
