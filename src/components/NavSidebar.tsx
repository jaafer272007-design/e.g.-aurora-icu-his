import { useNavigate } from 'react-router-dom'
import './NavSidebar.css'
import {
  IconAdmit, IconAlertTriangle, IconBed, IconBrain, IconClock, IconDischarge, IconFlask, IconGrid, IconPencil, IconPill, IconPrinter, IconPulse, IconSettings, IconStats, IconUsers,
} from './icons'
import { lastPatientId } from '../lib/patientContext'
import { getSession, hasPermission, landingRouteOf, type Permission } from '../lib/session'
import { APP_VERSION } from '../lib/version'

export type NavKey = 'dashboard' | 'beds' | 'observations' | 'orders' | 'labs' | 'labentry' | 'timeline' | 'ai' | 'admissions' | 'discharges' | 'print' | 'users' | 'formulary' | 'labcatalog' | 'ordersets' | 'config' | 'alerts' | 'statistics' | 'settings'

interface NavItem {
  key: NavKey
  label: string
  icon: JSX.Element
  to?: string
  badge?: number
  /** required permission — items the session's profile lacks are hidden */
  perm?: Permission
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

/** Primary navigation rail. "Dashboard" resolves to the signed-in profile's
 *  landing view, and items are filtered by the profile's permissions —
 *  both derived from the session's JobTitle at render (Stage 9 RBAC). */
export function NavSidebar({ active, footerLines }: NavSidebarProps) {
  const navigate = useNavigate()
  const session = getSession()
  const title = session?.jobTitle
  const allowed = (p?: Permission) => !p || (!!title && hasPermission(title, p))

  /* Persistent patient context: the six patient-scoped sections carry the
     last-viewed patient across section switches (pick Ahmed → Lab Entry →
     Observations → Orders stays Ahmed). The route param remains the source
     of truth — this only changes where the sidebar POINTS; with no
     remembered patient the bare path behaves exactly as before. */
  const pid = lastPatientId()
  const withPatient = (base: string) => (pid ? `${base}/${pid}` : base)

  const all: NavItem[] = [
    { key: 'dashboard', label: 'Dashboard', icon: <IconGrid />, to: title ? landingRouteOf(title) : '/login' },
    { key: 'beds', label: 'ICU Beds', icon: <IconBed />, to: '/beds', perm: 'patients.view' },
    { key: 'observations', label: 'Observations', icon: <IconPulse />, to: withPatient('/observations'), perm: 'patients.view' },
    { key: 'orders', label: 'Orders & Meds', icon: <IconPill />, to: withPatient('/orders'), perm: 'orders.view' },
    { key: 'labs', label: 'Labs & Imaging', icon: <IconFlask size={16} />, to: withPatient('/labs'), perm: 'results.view' },
    { key: 'labentry', label: 'Lab Entry', icon: <IconPencil size={16} />, to: withPatient('/lab-entry'), perm: 'results.document' },
    { key: 'timeline', label: 'Timeline', icon: <IconClock />, to: withPatient('/timeline'), perm: 'patients.view' },
    { key: 'ai', label: 'AI Assistant', icon: <IconBrain />, to: withPatient('/ai'), perm: 'ai.view' },
    { key: 'admissions', label: 'Admissions', icon: <IconAdmit />, to: '/admissions', perm: 'patients.view' },
    { key: 'discharges', label: 'Discharges', icon: <IconDischarge />, to: '/discharges', perm: 'patients.view' },
    { key: 'print', label: 'Print Center', icon: <IconPrinter />, to: '/print', perm: 'patients.view' },
    { key: 'users', label: 'User Accounts', icon: <IconUsers size={16} />, to: '/admin/users', perm: 'users.manage' },
    { key: 'formulary', label: 'Formulary', icon: <IconPill />, to: '/formulary', perm: 'formulary.manage' },
    { key: 'labcatalog', label: 'Lab Catalogue', icon: <IconFlask size={16} />, to: '/lab-catalog', perm: 'labcatalog.manage' },
    { key: 'ordersets', label: 'Order Sets', icon: <IconGrid />, to: '/order-sets', perm: 'ordersets.manage' },
    /* Configuration — the per-hospital configuration area (first tenant:
       the Code Status vocabulary, a clinical-governance surface). Gated
       on codestatus.manage (SeniorDoctor) — CLINICAL configuration,
       never the office Administrator (the F2/F3 hard constraint). The
       gate widens to a shared config permission when more tenants land. */
    { key: 'config', label: 'Configuration', icon: <IconSettings size={16} />, to: '/config', perm: 'codestatus.manage' },
    /* Alerts — the Clinical Attention Center (was the second dead nav
       item; now a real screen). CLINICAL, patient-identifiable — gated on
       results.view, which every clinical profile carries and the office
       Administrator does NOT (the locked no-clinical-data rule). The old
       hardcoded "5" badge is gone — never a fabricated count. */
    { key: 'alerts', label: 'Alerts', icon: <IconAlertTriangle />, to: '/alerts', perm: 'results.view' },
    /* Statistics — the ICU Analytics Dashboard (was the first dead nav
       item; now a real screen). Gated like the other census-level reads
       on patients.view, which every profile carries — the office
       Administrator's core use is these unit-level aggregates. */
    { key: 'statistics', label: 'Statistics', icon: <IconStats />, to: '/statistics', perm: 'patients.view' },
    /* Settings — the LAST dead nav item, now a real screen. No clinical
       data on the page, so no permission gate: every profile (incl. the
       office Administrator) reaches it. */
    { key: 'settings', label: 'Settings', icon: <IconSettings />, to: '/settings' },
  ]
  const items = all.filter(it => allowed(it.perm))

  return (
    <nav className="nav-sidebar" aria-label="Primary">
      {items.map(it => (
        <button
          key={it.key}
          className={`nv${it.key === active ? ' on' : ''}`}
          aria-current={it.key === active ? 'page' : undefined}
          onClick={it.to ? () => navigate(it.to!) : undefined}
        >
          {it.icon}
          <span>{it.label}</span>
          {it.badge !== undefined && <span className="nbdg">{it.badge}</span>}
        </button>
      ))}
      <div className="navfoot">
        {APP_VERSION}
        {footerLines.map(l => <span key={l}><br />{l}</span>)}
      </div>
    </nav>
  )
}
