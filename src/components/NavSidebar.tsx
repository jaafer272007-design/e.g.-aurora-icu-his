import { useNavigate } from 'react-router-dom'
import './NavSidebar.css'
import {
  IconAdmit, IconAlertTriangle, IconBed, IconBedAdmit, IconBrain, IconClock, IconDischarge, IconFlask, IconGrid, IconHome, IconPencil, IconPill, IconPrinter, IconPulse, IconSettings, IconShield, IconStats, IconUsers,
} from './icons'
import { lastPatientId } from '../lib/patientContext'
import { getSession, hasPermission, landingRouteOf, type JobTitle, type Permission } from '../lib/session'
import { APP_VERSION } from '../lib/version'

export type NavKey = 'home' | 'icuoverview' | 'adminhome' | 'beds' | 'observations' | 'orders' | 'labs' | 'labentry' | 'timeline' | 'ai' | 'reception' | 'awaiting' | 'admissions' | 'discharges' | 'discharged' | 'print' | 'users' | 'backup' | 'formulary' | 'labcatalog' | 'ordersets' | 'config' | 'alerts' | 'statistics' | 'settings'

export interface NavRow {
  key: NavKey
  label: string
  icon: JSX.Element
  to?: string
  badge?: number
  /** required permission — rows the session's profile lacks are hidden */
  perm?: Permission
  /** any-of permissions for MULTI-TENANT areas (Configuration: shown to
   *  whoever holds at least one section's authority) */
  anyPerm?: Permission[]
  /** the six patient-scoped chart rows carry the remembered patient */
  patientScoped?: boolean
  /** ICU Overview — the preserved role-personalized ICU workspace row: it
   *  resolves through the SAME landingRouteOf mechanism the retired
   *  "Dashboard" row used, restricted to the ICU workspaces (/workspace,
   *  /nurse). Profiles whose workspace is another screen (the bed board,
   *  the administrative views) see no row — a duplicate link or a non-ICU
   *  target under the ICU header would each be a lie. */
  icuWorkspace?: boolean
}

export interface NavGroup {
  /** small-caps group header; null = the ungrouped top (Home) — no header */
  label: string | null
  /** the ownership answer that placed the group (design §1.1): a MODULE's
   *  screens sit under that module; hospital-wide screens sit in
   *  hospital-wide groups. Carried on the model so surfaces (the Home
   *  launch cards) can SAY it instead of implying it. */
  ownership: 'module' | 'hospital-wide'
  rows: NavRow[]
}

/* THE OWNERSHIP MODEL — GROUP BY OWNERSHIP (hospital-shell design §1, plus
   the owner's 2026-08-23 front-door amendment, hospital-shell.md A3): a
   screen owned by one module sits under that module; a screen the whole
   hospital uses sits in a hospital-wide group. This array is the ONE
   source both the sidebar and the hospital Home render from — they cannot
   drift apart, and scripts/hospital-shell-gate.mjs pins its membership.
   Every row keeps its pre-shell permission gate except Bed Admission
   (design §3: nav gate adt.admit; the ROUTE gate stays patients.view). */
export const NAV_GROUPS: NavGroup[] = [
  {
    /* the hospital front door — ungrouped at the top (design §1.1's shape
       for the landing row). The DEFAULT landing for every profile since
       the A3 amendment: Aurora HIS opens on the hospital, never on a
       module. No permission — like /settings, nothing clinical renders
       without its own gate. */
    label: null,
    ownership: 'hospital-wide',
    rows: [
      { key: 'home', label: 'Home', icon: <IconHome />, to: '/home' },
    ],
  },
  {
    /* hospital-wide — the entrance and the exit. Reception opens episodes
       for the whole hospital (no bed); Awaiting Bed is shared flow (open
       admission + no assigned bed — the office Administrator and the
       Nurse act on it); Discharges & Transfers is shared ADT for ANY
       patient (the owner's overrule: never module-owned by today's
       population). */
    label: 'Patient Flow',
    ownership: 'hospital-wide',
    rows: [
      { key: 'reception', label: 'Reception', icon: <IconAdmit />, to: '/reception', perm: 'admissions.create' },
      { key: 'awaiting', label: 'Awaiting Bed', icon: <IconBed />, to: '/awaiting-bed', perm: 'beds.assign' },
      { key: 'discharges', label: 'Discharges & Transfers', icon: <IconDischarge />, to: '/discharges', perm: 'patients.view' },
    ],
  },
  {
    /* Ward is BUILT (Ward PRs A1/A2/B) but ships no standalone ward-owned
       nav screen: the awaiting-bed worklist is shared Patient Flow (above,
       per the owner), ward admissions flow through Reception, ward moves
       through Discharges & Transfers, and the Wards vocabulary is a
       Configuration tenant under Administration. Zero rows — the group
       renders NOTHING (no header, no gap) until a genuinely ward-owned
       screen exists. OR is deliberately NOT declared at all: no OR
       implementation exists, and an empty group would be module
       advertising. */
    label: 'Ward',
    ownership: 'module',
    rows: [],
  },
  {
    /* module — genuinely ICU-owned screens, keeping their ICU names
       (clinical facts, never rebranded): the preserved ICU workspace row,
       the bed board with the ICU bedside snapshot, the admit-into-an-ICU-
       bed flow (design §3: label "Bed Admission", nav gate adt.admit,
       distinct icon — the by-BED discriminator vs Reception), and the ICU
       analytics dashboard computed over ICU encounters. */
    label: 'ICU',
    ownership: 'module',
    rows: [
      { key: 'icuoverview', label: 'ICU Overview', icon: <IconGrid />, icuWorkspace: true },
      { key: 'beds', label: 'ICU Beds', icon: <IconBed />, to: '/beds', perm: 'patients.view' },
      { key: 'admissions', label: 'Bed Admission', icon: <IconBedAdmit />, to: '/admissions', perm: 'patients.view' },
      { key: 'statistics', label: 'ICU Statistics', icon: <IconStats />, to: '/statistics', perm: 'patients.view' },
    ],
  },
  {
    /* hospital-wide — the chart follows the PATIENT, not a module: the
       day Ward ships its own screens, ward patients open in these same
       screens. */
    label: 'Patient Chart',
    ownership: 'hospital-wide',
    rows: [
      { key: 'observations', label: 'Observations', icon: <IconPulse />, to: '/observations', perm: 'patients.view', patientScoped: true },
      { key: 'orders', label: 'Orders & Meds', icon: <IconPill />, to: '/orders', perm: 'orders.view', patientScoped: true },
      { key: 'labs', label: 'Labs & Imaging', icon: <IconFlask size={16} />, to: '/labs', perm: 'results.view', patientScoped: true },
      { key: 'labentry', label: 'Lab Entry', icon: <IconPencil size={16} />, to: '/lab-entry', perm: 'results.document', patientScoped: true },
      { key: 'timeline', label: 'Timeline', icon: <IconClock />, to: '/timeline', perm: 'patients.view', patientScoped: true },
      { key: 'ai', label: 'AI Assistant', icon: <IconBrain />, to: '/ai', perm: 'ai.view', patientScoped: true },
      { key: 'alerts', label: 'Alerts', icon: <IconAlertTriangle />, to: '/alerts', perm: 'results.view' },
    ],
  },
  {
    label: 'Records',
    ownership: 'hospital-wide',
    rows: [
      { key: 'discharged', label: 'Discharged Patients', icon: <IconClock />, to: '/discharged', perm: 'results.view' },
      { key: 'print', label: 'Print Center', icon: <IconPrinter />, to: '/print', perm: 'patients.view' },
    ],
  },
  {
    /* hospital-wide — administration and configuration. Unit
       Administration is the office Administrator's operations dashboard
       (their pre-shell personalized landing, kept reachable from the
       sidebar now that Home is the universal landing). */
    label: 'Administration',
    ownership: 'hospital-wide',
    rows: [
      { key: 'adminhome', label: 'Unit Administration', icon: <IconGrid />, to: '/admin', perm: 'admin.view' },
      { key: 'users', label: 'User Accounts', icon: <IconUsers size={16} />, to: '/admin/users', perm: 'users.manage' },
      { key: 'backup', label: 'Backup & Recovery', icon: <IconShield size={16} />, to: '/backup', perm: 'backup.manage' },
      { key: 'formulary', label: 'Formulary', icon: <IconPill />, to: '/formulary', perm: 'formulary.manage' },
      { key: 'labcatalog', label: 'Lab Catalogue', icon: <IconFlask size={16} />, to: '/lab-catalog', perm: 'labcatalog.manage' },
      { key: 'ordersets', label: 'Order Sets', icon: <IconGrid />, to: '/order-sets', perm: 'ordersets.manage' },
      { key: 'config', label: 'Configuration', icon: <IconSettings size={16} />, to: '/config', anyPerm: ['hospital.configure', 'codestatus.manage', 'imagingcatalog.manage', 'beds.manage', 'dispositions.manage', 'isolation.manage', 'shifts.manage', 'frequencies.manage'] },
      { key: 'settings', label: 'Settings', icon: <IconSettings />, to: '/settings' },
    ],
  },
]

/** ICU Overview's target for a profile — the ICU workspaces only. The
 *  other landings (/beds, /admin, /admin/users) already have their own
 *  owned rows, so the row hides rather than duplicate or mislabel. */
export function icuOverviewTargetOf(title: JobTitle): string | null {
  const t = landingRouteOf(title)
  return t === '/workspace' || t === '/nurse' ? t : null
}

function rowVisible(row: NavRow, title: JobTitle | undefined): boolean {
  if (!title) return false
  if (row.icuWorkspace) return icuOverviewTargetOf(title) !== null
  if (row.anyPerm) return row.anyPerm.some(p => hasPermission(title, p))
  return !row.perm || hasPermission(title, row.perm)
}

/** The groups a profile actually sees — rows filtered by permission, then
 *  GROUPS WITH ZERO VISIBLE ROWS DROPPED ENTIRELY (design §1.2: no header,
 *  no gap; Ward and OR are invisible, never advertised). ONE filter for
 *  the sidebar and the hospital Home. */
export function visibleGroupsFor(title: JobTitle | undefined): NavGroup[] {
  return NAV_GROUPS
    .map(g => ({ ...g, rows: g.rows.filter(r => rowVisible(r, title)) }))
    .filter(g => g.rows.length > 0)
}

interface NavSidebarProps {
  active: NavKey
  /** accepted for caller compatibility but NO LONGER RENDERED: the Alerts
   *  badge was a hardcoded fabricated count (the dead-nav "5") — removed
   *  with the Attention Center build. A real live count would need the
   *  full multi-source derivation on every screen; the Alerts page itself
   *  shows the real counts (never a fabricated number). */
  alertCount?: number
  /** Lines shown under "AURORA HIS v4.2" in the sidebar footer. */
  footerLines: string[]
}

/** Primary navigation rail, grouped BY OWNERSHIP (hospital-shell design
 *  §1): module screens under their module (ICU), hospital-wide screens in
 *  hospital-wide groups (Patient Flow · Patient Chart · Records ·
 *  Administration), Home ungrouped on top. Rows are filtered by the
 *  profile's permissions and empty groups render nothing — every profile
 *  sees only the modules it works in. */
export function NavSidebar({ active, footerLines }: NavSidebarProps) {
  const navigate = useNavigate()
  const session = getSession()
  const title = session?.jobTitle

  /* Persistent patient context: the six patient-scoped sections carry the
     last-viewed patient across section switches (pick Ahmed → Lab Entry →
     Observations → Orders stays Ahmed). The route param remains the source
     of truth — this only changes where the sidebar POINTS; with no
     remembered patient the bare path behaves exactly as before. */
  const pid = lastPatientId()
  const targetOf = (row: NavRow): string | undefined => {
    if (row.icuWorkspace) return title ? icuOverviewTargetOf(title) ?? undefined : undefined
    if (row.patientScoped && pid && row.to) return `${row.to}/${pid}`
    return row.to
  }

  const groups = visibleGroupsFor(title)

  return (
    <nav className="nav-sidebar" aria-label="Primary">
      {groups.map((g, gi) => (
        <div key={g.label ?? `top-${gi}`} className="navgroup" role="group" aria-label={g.label ?? 'Home'}>
          {/* small-caps header ≥1181px; below the icon-only collapse it
              degrades to a thin separator (the text is hidden) so the
              grouping survives without words */}
          {g.label && <div className="navgh" aria-hidden="true"><span>{g.label}</span></div>}
          {g.rows.map(it => {
            const to = targetOf(it)
            return (
              <button
                key={it.key}
                className={`nv${it.key === active ? ' on' : ''}`}
                aria-current={it.key === active ? 'page' : undefined}
                /* aria-label + title so the item stays identifiable when the
                   sidebar is icon-only (below the 13" floor, where the label
                   span is display:none): screen readers get the name, and a
                   hover tooltip names each bare icon. Harmless when the label
                   text is visible (≥1180px). */
                aria-label={it.label}
                title={it.label}
                onClick={to ? () => navigate(to) : undefined}
              >
                {it.icon}
                <span>{it.label}</span>
                {it.badge !== undefined && <span className="nbdg">{it.badge}</span>}
              </button>
            )
          })}
        </div>
      ))}
      <div className="navfoot">
        {APP_VERSION}
        {footerLines.map(l => <span key={l}><br />{l}</span>)}
      </div>
    </nav>
  )
}
