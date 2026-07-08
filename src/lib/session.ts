/* Session + three-layer, permission-based RBAC (Stage 9).
   User → Role (JobTitle) → PermissionProfile → Permissions — roles are
   NEVER bound to permissions directly; both the profile and the permission
   set are COMPUTED from the JobTitle at read time via lookup (same rule as
   clock-computed states), never stored redundantly. The session persists
   ONLY { name, jobTitle } in sessionStorage.

   LOCAL SESSION ONLY — this is role simulation for design review, not
   authentication. No passwords, JWT, or user database until Stage 10.
   Service-layer adapters enforce the same permissions (defense in depth);
   Stage 10 re-enforces them server-side. */

/* ---------------- Layer 1 — JobTitle (19 real titles) ---------------- */

export const JOB_TITLES = [
  'Consultant', 'Specialist', 'Senior Resident', 'Resident', 'Intern',
  'Pharmacist', 'Clinical Pharmacist',
  'Staff Nurse', 'Charge Nurse', 'Head Nurse',
  'Laboratory Technician', 'Radiology Technician',
  'Respiratory Therapist', 'Physiotherapist', 'Dietitian',
  'Receptionist', 'Billing Officer', 'Medical Records Officer',
  'Hospital Administrator', 'IT Administrator',
] as const

export type JobTitle = (typeof JOB_TITLES)[number]

/* ---------------- Layer 2 — PermissionProfile (7, independent) ---------------- */

export type PermissionProfile =
  | 'Doctor' | 'Nurse' | 'Administrator' | 'Pharmacist'
  | 'RespiratoryTherapist' | 'Ancillary' | 'AlliedHealth'

const TITLE_PROFILE: Record<JobTitle, PermissionProfile> = {
  Consultant: 'Doctor',
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
  'IT Administrator': 'Administrator',
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
  | 'notes.document'       // nursing tasks, I&O, SBAR handoff
  | 'ai.view'
  | 'admin.view'           // administrative landing view

/* Provisional permission sets (finer-grained permissions come in a later
   stage) — all 7 profiles carry REAL sets now; the four view-only profiles
   reuse the proven view-only pattern rather than empty placeholders. */
const PROFILE_PERMISSIONS: Record<PermissionProfile, readonly Permission[]> = {
  /* full order/med authority (locked decision) */
  Doctor: [
    'patients.view', 'orders.view', 'orders.create', 'orders.sign',
    'orders.modify', 'orders.discontinue', 'results.view',
    'results.acknowledge', 'notes.document', 'ai.view',
  ],
  /* administer + document only — cannot originate orders (locked decision) */
  Nurse: [
    'patients.view', 'orders.view', 'orders.implement', 'meds.administer',
    'notes.document', 'results.view', 'ai.view',
  ],
  /* administrative landing view + census-level board */
  Administrator: ['admin.view', 'patients.view'],
  /* medication-chart review: orders + renal/liver results, view-only */
  Pharmacist: ['patients.view', 'orders.view', 'results.view'],
  /* vent-focused: orders, ABGs, and risk trajectories, view-only */
  RespiratoryTherapist: ['patients.view', 'orders.view', 'results.view', 'ai.view'],
  /* lab/radiology technicians: pending order worklist + results, view-only */
  Ancillary: ['patients.view', 'orders.view', 'results.view'],
  /* physio/dietitian: chart + results, view-only */
  AlliedHealth: ['patients.view', 'results.view'],
}

/* profile landing view — what "Dashboard" resolves to */
const PROFILE_LANDING: Record<PermissionProfile, string> = {
  Doctor: '/workspace',
  Nurse: '/nurse',
  Administrator: '/admin',
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

/* ---------------- session (sessionStorage: name + JobTitle ONLY) ---------------- */

export interface Session {
  name: string
  jobTitle: JobTitle
}

const STORAGE_KEY = 'aurora.session'

export function getSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Session>
    if (typeof parsed.name === 'string' && parsed.name.trim() &&
        (JOB_TITLES as readonly string[]).includes(parsed.jobTitle as string)) {
      return { name: parsed.name, jobTitle: parsed.jobTitle as JobTitle }
    }
  } catch { /* corrupted/absent storage → signed out */ }
  return null
}

export function signIn(name: string, jobTitle: JobTitle): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ name, jobTitle }))
}

export function signOut(): void {
  sessionStorage.removeItem(STORAGE_KEY)
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
