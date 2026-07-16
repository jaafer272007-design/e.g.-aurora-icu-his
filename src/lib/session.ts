import { clearLastPatient } from './patientContext'
import { clearPreferences } from './preferences'

/* Session + three-layer, permission-based RBAC (Stage 9, auth in Stage 10.2).
   User → Role (JobTitle) → PermissionProfile → Permissions — roles are
   NEVER bound to permissions directly; both the profile and the permission
   set are COMPUTED from the JobTitle at read time via lookup (same rule as
   clock-computed states), never stored redundantly. The session persists
   ONLY { name, jobTitle, token? } in sessionStorage.

   Stage 10 Phase 2: real authentication. The login screen calls
   POST /api/auth/login; on success the session carries the issued JWT and
   adapters attach it as a Bearer token. When the auth API is unreachable
   (or VITE_API_BASE_URL is unset) the login falls back to the Stage 9
   LOCAL SESSION (no token, password not verified) so the prototype keeps
   working — same resilience pattern as the roster adapter. Profile and
   permissions are STILL derived from the JobTitle exactly as before;
   the JWT only adds server-verified identity. */

/* ---------------- Layer 1 — JobTitle (19 real titles) ---------------- */

export const JOB_TITLES = [
  'Consultant', 'Specialist', 'Senior Resident', 'Resident', 'Intern',
  'Pharmacist', 'Clinical Pharmacist',
  'Staff Nurse', 'Charge Nurse', 'Head Nurse',
  'Laboratory Technician', 'Radiology Technician',
  'Respiratory Therapist', 'Physiotherapist', 'Dietitian',
  'Receptionist', 'Billing Officer', 'Medical Records Officer',
  'Hospital Administrator', 'IT Administrator', 'System Administrator',
] as const

export type JobTitle = (typeof JOB_TITLES)[number]

/* ---------------- Layer 2 — PermissionProfile (8, independent) ---------------- */

export type PermissionProfile =
  | 'Doctor' | 'SeniorDoctor' | 'Nurse' | 'Administrator' | 'Pharmacist'
  | 'RespiratoryTherapist' | 'Ancillary' | 'AlliedHealth' | 'SystemAdministrator'

const TITLE_PROFILE: Record<JobTitle, PermissionProfile> = {
  /* Stage 11 F4 decision: Consultant derives SeniorDoctor — Doctor's
     superset plus the Consultant-tier observation authorities */
  Consultant: 'SeniorDoctor',
  Specialist: 'Doctor',
  'Senior Resident': 'Doctor',
  Resident: 'Doctor',
  Intern: 'Doctor',
  Pharmacist: 'Pharmacist',
  'Clinical Pharmacist': 'Pharmacist',
  'Staff Nurse': 'Nurse',
  'Charge Nurse': 'Nurse',
  'Head Nurse': 'Nurse',
  'Laboratory Technician': 'Ancillary',
  'Radiology Technician': 'Ancillary',
  'Respiratory Therapist': 'RespiratoryTherapist',
  Physiotherapist: 'AlliedHealth',
  Dietitian: 'AlliedHealth',
  Receptionist: 'Administrator',
  'Billing Officer': 'Administrator',
  'Medical Records Officer': 'Administrator',
  'Hospital Administrator': 'Administrator',
  /* User Management design (§5): the System Administrator is IT/system —
     manages who exists and what access they have, and gets NO clinical
     access ever. The IT Administrator title moves to this profile (it was
     always the IT role); "System Administrator" is the design's name for
     the same authority. */
  'IT Administrator': 'SystemAdministrator',
  'System Administrator': 'SystemAdministrator',
}

/* ---------------- Layer 3 — Permissions ---------------- */

export type Permission =
  | 'patients.view'        // bed board, patient chart, timeline
  | 'orders.view'
  | 'orders.create'
  | 'orders.sign'
  | 'orders.modify'
  | 'orders.discontinue'
  | 'orders.implement'     // nursing implementation of active orders
  | 'meds.administer'      // MAR documentation (given / held / refused)
  | 'results.view'
  | 'results.acknowledge'
  | 'results.create'       // results audit PR: enter a lab/imaging result (producing service / future LIS)
  | 'results.document'     // Lab Result-Entry: manually document/transcribe a lab result (ICU bedside team)
  | 'results.correct'      // Lab Result Editing: Tier-2 correction of a documented result (Consultant-tier ONLY — never office admin)
  | 'notes.document'       // nursing tasks, I&O, SBAR handoff
  | 'identity.correct'     // Structured Patient Name + National ID: audited identity correction (office Administrator — registration work, not clinical data)
  | 'ai.view'
  | 'admin.view'           // administrative landing view
  | 'adt.admit'            // Layer 2 ADT: open an encounter (doctor authority)
  | 'adt.discharge'        // Layer 2 ADT: close an encounter (doctor authority)
  | 'adt.transfer'         // Layer 2 ADT: move within the unit (nursing action)
  | 'users.manage'         // user administration mutations (System Administrator ONLY — moved from the office profile by the User Management design)
  | 'users.view'           // read the account list (System Administrator ONLY)
  | 'formulary.manage'     // Layer 4: maintain the drug formulary (Pharmacy authority)
  | 'labcatalog.manage'    // Layer 4 phase 2: maintain the lab test catalogue (Laboratory authority)
  | 'ordersets.manage'     // Layer 4 phase 2: author order sets (stewarded with the formulary)
  | 'observations.record'  // Stage 11 §4 (F1): chart a bedside observation (any doctor or nurse)
  | 'observations.correct' // Stage 11 §8 (F2): tier-2 retrospective correction (Consultant-tier ONLY — never office admin)
  | 'observations.configure' // Stage 11 §3 (F3): group enablement (same Consultant-tier home)
  | 'patients.measure'     // Weight & Height capture: record/correct the reference weight & height (any doctor or nurse — never office admin)
  | 'assignments.manage'   // Patient Assignment: assign/end nurse & doctor assignments (SeniorDoctor — the recorded interim; a future SeniorNurse profile holds the SAME atom). A clinical care decision — never on either administrator profile. Everyone with patients.view can SEE assignments; only managing is gated.

/* Provisional permission sets (finer-grained permissions come in a later
   stage) — all 7 profiles carry REAL sets now; the four view-only profiles
   reuse the proven view-only pattern rather than empty placeholders. */
const PROFILE_PERMISSIONS: Record<PermissionProfile, readonly Permission[]> = {
  /* full order/med authority (locked decision) */
  Doctor: [
    'patients.view', 'orders.view', 'orders.create', 'orders.sign',
    'orders.modify', 'orders.discontinue', 'results.view',
    'results.acknowledge', 'results.document', 'notes.document', 'ai.view',
    'adt.admit', 'adt.discharge', 'observations.record', 'patients.measure',
  ],
  /* Stage 11 F4: Doctor's SUPERSET + the Consultant-tier observation
     authorities (correct/configure). HARD CONSTRAINT: these never sit
     on the office Administrator profile. */
  /* labcatalog.manage joined SeniorDoctor with Option B (Catalogue Test
     Management) — ALONGSIDE Ancillary, a flagged additive reconciliation
     (see server Rbac.cs): Consultants define/retire structured tests; the
     laboratory keeps its recorded authority; office admin stays excluded. */
  SeniorDoctor: [
    'patients.view', 'orders.view', 'orders.create', 'orders.sign',
    'orders.modify', 'orders.discontinue', 'results.view',
    'results.acknowledge', 'results.document', 'results.correct',
    'labcatalog.manage', 'notes.document', 'ai.view',
    'adt.admit', 'adt.discharge', 'observations.record',
    'observations.correct', 'observations.configure', 'patients.measure',
    'assignments.manage',
  ],
  /* administer + document only — cannot originate orders (locked decision).
     results.document (Lab Result-Entry): the ICU bedside team transcribes
     paper central-lab reports and enters bedside ABGs — a distinct atom
     from the producing-service results.create (kept on Ancillary). */
  Nurse: [
    'patients.view', 'orders.view', 'orders.implement', 'meds.administer',
    'notes.document', 'results.view', 'results.document', 'ai.view', 'adt.transfer',
    'observations.record', 'patients.measure',
  ],
  /* administrative landing view + census-level board + user administration */
  /* users.manage MOVED to the System Administrator (User Management
     design §5) — the office profile keeps its administrative landing and
     operational patient list but no longer manages accounts */
  /* identity.correct (Structured Patient Name + National ID §3): the
     FLAGGED authority, stated — correcting a patient's legal name /
     national ID / DOB is REGISTRATION work and identity is NOT clinical
     data, so it sits on the office profile (the clinical exclusion is
     untouched). */
  Administrator: ['admin.view', 'patients.view', 'identity.correct'],
  /* the highest-privilege authority: controls who can reach patient data
     while never reaching it (no clinical atoms, not even patients.view) */
  SystemAdministrator: ['users.manage', 'users.view'],
  /* medication-chart review + Layer 4: maintaining the formulary is
     PHARMACY's authority (the same polarity flip as results.create on
     Ancillary — doctors/nurses/administrators are 403'd on mutations) */
  Pharmacist: ['patients.view', 'orders.view', 'results.view', 'formulary.manage', 'ordersets.manage'],
  /* vent-focused: orders, ABGs, and risk trajectories, view-only */
  RespiratoryTherapist: ['patients.view', 'orders.view', 'results.view', 'ai.view'],
  /* lab/radiology technicians: pending order worklist + results; entering
     a RESULT via results.create is the producing service's authority
     (results audit PR / future LIS feed) — doctors/nurses are 403'd on
     create, the usual polarity flip. The manual documentation path is a
     SEPARATE atom (results.document, on the clinical profiles) — the two
     authorities are reconciled, not merged. */
  Ancillary: ['patients.view', 'orders.view', 'results.view', 'results.create', 'labcatalog.manage'],
  /* physio/dietitian: chart + results, view-only */
  AlliedHealth: ['patients.view', 'results.view'],
}

/* profile landing view — what "Dashboard" resolves to */
const PROFILE_LANDING: Record<PermissionProfile, string> = {
  Doctor: '/workspace',
  SeniorDoctor: '/workspace',
  Nurse: '/nurse',
  Administrator: '/admin',
  SystemAdministrator: '/admin/users',
  Pharmacist: '/beds',
  RespiratoryTherapist: '/beds',
  Ancillary: '/beds',
  AlliedHealth: '/beds',
}

/* ---------------- derivation (computed at read time, never stored) ---------------- */

export const profileOf = (title: JobTitle): PermissionProfile => TITLE_PROFILE[title]

export const permissionsOf = (title: JobTitle): readonly Permission[] =>
  PROFILE_PERMISSIONS[TITLE_PROFILE[title]]

export const hasPermission = (title: JobTitle, permission: Permission): boolean =>
  permissionsOf(title).includes(permission)

export const landingRouteOf = (title: JobTitle): string =>
  PROFILE_LANDING[TITLE_PROFILE[title]]

/* ------------- session (sessionStorage: name + JobTitle + optional JWT) ------------- */

export interface Session {
  name: string
  jobTitle: JobTitle
  /** JWT issued by POST /api/auth/login (Stage 10 Phase 2); absent on the
   *  Stage 9 local-session fallback. Attached as a Bearer token by the
   *  API adapters — permissions are NEVER read from it client-side. */
  token?: string
}

const STORAGE_KEY = 'aurora.session'

export function getSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Session>
    if (typeof parsed.name === 'string' && parsed.name.trim() &&
        (JOB_TITLES as readonly string[]).includes(parsed.jobTitle as string)) {
      return {
        name: parsed.name,
        jobTitle: parsed.jobTitle as JobTitle,
        ...(typeof parsed.token === 'string' && parsed.token ? { token: parsed.token } : {}),
      }
    }
  } catch { /* corrupted/absent storage → signed out */ }
  return null
}

/** the current session's Bearer token, if the sign-in was API-authenticated */
export function getToken(): string | null {
  return getSession()?.token ?? null
}

export function signIn(name: string, jobTitle: JobTitle, token?: string): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(token ? { name, jobTitle, token } : { name, jobTitle }))
}

export function signOut(): void {
  sessionStorage.removeItem(STORAGE_KEY)
  /* the cross-section patient context is USER context — a role switch in
     the same tab must never inherit the previous user's patient */
  clearLastPatient()
  /* preferences follow the same discipline (Settings design §1.1A):
     tab/session-scoped USER context, cleared with the session */
  clearPreferences()
}

/** "Dr. Sara Rahman" → "sara.rahman" — deterministic demo username.
 *  The SAME derivation generates server/Data/users-seed.json, so the
 *  fallback local login and the real user table always agree. */
export function usernameOf(name: string): string {
  return name
    .replace(/^(Dr\.|RN|RT)\s+/, '')
    .toLowerCase()
    .replace(/\s+/g, '.')
    .replace(/[^a-z.-]/g, '')
}

/** "Dr. Sara Rahman" → "SR" (title prefixes ignored) */
export function initialsOf(name: string): string {
  const words = name.replace(/^(Dr\.|RN|RT)\s+/, '').split(/\s+/).filter(Boolean)
  return words.slice(0, 2).map(w => w[0]).join('').toUpperCase() || '—'
}

/* ---------------- preset sample staff (one per JobTitle, Stage 9 demo) ---------------- */

export const SAMPLE_STAFF: readonly Session[] = [
  { name: 'Dr. Sara Rahman', jobTitle: 'Consultant' },
  { name: 'Dr. Liam Osei', jobTitle: 'Specialist' },
  { name: 'Dr. Yara Haddad', jobTitle: 'Senior Resident' },
  { name: 'Dr. Jonas Weber', jobTitle: 'Resident' },
  { name: 'Dr. Amina Diallo', jobTitle: 'Intern' },
  { name: 'Samir Qassem', jobTitle: 'Pharmacist' },
  { name: 'Anna Kovacs', jobTitle: 'Clinical Pharmacist' },
  { name: 'RN Maya Chen', jobTitle: 'Staff Nurse' },
  { name: 'RN Priya Patel', jobTitle: 'Charge Nurse' },
  { name: 'RN Daniel Okoro', jobTitle: 'Head Nurse' },
  { name: 'Noor Al-Amin', jobTitle: 'Laboratory Technician' },
  { name: 'Pablo Reyes', jobTitle: 'Radiology Technician' },
  { name: 'RT Dina Silva', jobTitle: 'Respiratory Therapist' },
  { name: 'Marco Bianchi', jobTitle: 'Physiotherapist' },
  { name: 'Sofia Lindgren', jobTitle: 'Dietitian' },
  { name: 'Huda Nasser', jobTitle: 'Receptionist' },
  { name: 'Kofi Mensah', jobTitle: 'Billing Officer' },
  { name: 'Emma Larsson', jobTitle: 'Medical Records Officer' },
  { name: 'Yusuf Karim', jobTitle: 'Hospital Administrator' },
  { name: 'Alex Novak', jobTitle: 'IT Administrator' },
]
