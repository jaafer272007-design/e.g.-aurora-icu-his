import { useNavigate } from 'react-router-dom'
import './NavSidebar.css'
import {
  IconAdmit, IconAlertTriangle, IconBed, IconBrain, IconClock, IconDischarge, IconFlask, IconGrid, IconPencil, IconPill, IconPrinter, IconPulse, IconSettings, IconStats, IconUsers,
} from './icons'
import { getSession, hasPermission, landingRouteOf, type Permission } from '../lib/session'

export type NavKey = 'dashboard' | 'beds' | 'observations' | 'orders' | 'labs' | 'labentry' | 'timeline' | 'ai' | 'admissions' | 'discharges' | 'print' | 'users' | 'formulary' | 'labcatalog' | 'ordersets' | 'alerts' | 'statistics' | 'settings'

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
  alertCount?: number
  /** Lines shown under "AURORA HIS v4.2" in the sidebar footer. */
  footerLines: string[]
}

/** Primary navigation rail. "Dashboard" resolves to the signed-in profile's
 *  landing view, and items are filtered by the profile's permissions —
 *  both derived from the session's JobTitle at render (Stage 9 RBAC). */
export function NavSidebar({ active, alertCount = 0, footerLines }: NavSidebarProps) {
  const navigate = useNavigate()
  const session = getSession()
  const title = session?.jobTitle
  const allowed = (p?: Permission) => !p || (!!title && hasPermission(title, p))

  const all: NavItem[] = [
    { key: 'dashboard', label: 'Dashboard', icon: <IconGrid />, to: title ? landingRouteOf(title) : '/login' },
    { key: 'beds', label: 'ICU Beds', icon: <IconBed />, to: '/beds', perm: 'patients.view' },
    { key: 'observations', label: 'Observations', icon: <IconPulse />, to: '/observations', perm: 'patients.view' },
    { key: 'orders', label: 'Orders & Meds', icon: <IconPill />, to: '/orders', perm: 'orders.view' },
    { key: 'labs', label: 'Labs & Imaging', icon: <IconFlask size={16} />, to: '/labs', perm: 'results.view' },
    { key: 'labentry', label: 'Lab Entry', icon: <IconPencil size={16} />, to: '/lab-entry', perm: 'results.document' },
    { key: 'timeline', label: 'Timeline', icon: <IconClock />, to: '/timeline', perm: 'patients.view' },
    { key: 'ai', label: 'AI Assistant', icon: <IconBrain />, to: '/ai', perm: 'ai.view' },
    { key: 'admissions', label: 'Admissions', icon: <IconAdmit />, to: '/admissions', perm: 'patients.view' },
    { key: 'discharges', label: 'Discharges', icon: <IconDischarge />, to: '/discharges', perm: 'patients.view' },
    { key: 'print', label: 'Print Center', icon: <IconPrinter />, to: '/print', perm: 'patients.view' },
    { key: 'users', label: 'User Accounts', icon: <IconUsers size={16} />, to: '/admin/users', perm: 'users.manage' },
    { key: 'formulary', label: 'Formulary', icon: <IconPill />, to: '/formulary', perm: 'formulary.manage' },
    { key: 'labcatalog', label: 'Lab Catalogue', icon: <IconFlask size={16} />, to: '/lab-catalog', perm: 'labcatalog.manage' },
    { key: 'ordersets', label: 'Order Sets', icon: <IconGrid />, to: '/order-sets', perm: 'ordersets.manage' },
    { key: 'alerts', label: 'Alerts', icon: <IconAlertTriangle />, badge: alertCount },
    { key: 'statistics', label: 'Statistics', icon: <IconStats /> },
    { key: 'settings', label: 'Settings', icon: <IconSettings /> },
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
        AURORA HIS v4.2
        {footerLines.map(l => <span key={l}><br />{l}</span>)}
      </div>
    </nav>
  )
}
