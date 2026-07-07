import { useNavigate } from 'react-router-dom'
import './NavSidebar.css'
import {
  IconAdmit, IconAlertTriangle, IconBed, IconDischarge, IconGrid, IconSettings, IconStats,
} from './icons'

export type NavKey = 'dashboard' | 'beds' | 'admissions' | 'discharges' | 'alerts' | 'statistics' | 'settings'

interface NavSidebarProps {
  active: NavKey
  alertCount: number
  /** Lines shown under "AURORA HIS v4.2" in the sidebar footer. */
  footerLines: string[]
}

/** Primary navigation rail. "Dashboard" is role-personalized — it routes to the
 *  Doctor Workspace until auth exists (locked decision in CLAUDE.md). */
export function NavSidebar({ active, alertCount, footerLines }: NavSidebarProps) {
  const navigate = useNavigate()
  const items: { key: NavKey; label: string; icon: JSX.Element; to?: string; badge?: number }[] = [
    { key: 'dashboard', label: 'Dashboard', icon: <IconGrid />, to: '/workspace' },
    { key: 'beds', label: 'ICU Beds', icon: <IconBed />, to: '/beds' },
    { key: 'admissions', label: 'Admissions', icon: <IconAdmit /> },
    { key: 'discharges', label: 'Discharges', icon: <IconDischarge /> },
    { key: 'alerts', label: 'Alerts', icon: <IconAlertTriangle />, badge: alertCount },
    { key: 'statistics', label: 'Statistics', icon: <IconStats /> },
    { key: 'settings', label: 'Settings', icon: <IconSettings /> },
  ]
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
