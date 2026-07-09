import type { CSSProperties, ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import './AppHeader.css'
import { IconBell, IconPulse } from './icons'
import { useClock } from '../hooks/useClock'
import { getSession, signOut } from '../lib/session'

export interface KpiSpec {
  icon: ReactNode
  iconBg: string
  value: ReactNode
  label: string
  valueStyle?: CSSProperties
}

export function KpiPill({ icon, iconBg, value, label, valueStyle }: KpiSpec) {
  return (
    <div className="kpi">
      <span className="ic" style={{ background: iconBg }}>{icon}</span>
      <div>
        <div className="kv" style={valueStyle}>{value}</div>
        <div className="kl">{label}</div>
      </div>
    </div>
  )
}

interface AppHeaderProps {
  subtitle: string
  kpis: KpiSpec[]
  /** omit on screens with no notification context — renders a 0 badge */
  bellCount?: number
  onBellClick?: () => void
  user: { initials: string; name: string; role: string }
}

/** Standard top bar: brand · clock · KPI pills · notifications · user ·
 *  sign-out (Stage 9 local session). */
export function AppHeader({ subtitle, kpis, bellCount = 0, onBellClick, user }: AppHeaderProps) {
  const { time, date } = useClock()
  const navigate = useNavigate()
  return (
    <header className="app-header">
      <div className="brand">
        <div className="logo"><IconPulse size={18} stroke="#06121f" strokeWidth={2.6} /></div>
        <div>AURORA ICU<small>{subtitle}</small></div>
      </div>
      <div className="datetime"><b>{time}</b><span>{date}</span></div>
      <div className="kpis">
        {kpis.map((k, i) => <KpiPill key={i} {...k} />)}
      </div>
      <div className="hspace" />
      <button className="bell" aria-label={`Notifications, ${bellCount} unread`} onClick={onBellClick}>
        <IconBell size={16} />
        <span className="bdg">{bellCount}</span>
      </button>
      <button className="user" title="Local session — not real authentication" aria-label={`${user.name}, account menu`}>
        <div className="uav">{user.initials}</div>
        <div><div className="un">{user.name}</div><div className="ur">{user.role}</div></div>
      </button>
      {getSession() && (
        <button
          className="hsignout"
          aria-label="Sign out and switch role"
          title="Sign out / switch role"
          onClick={() => { signOut(); navigate('/login') }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><path d="M16 17l5-5-5-5M21 12H9" /></svg>
        </button>
      )}
    </header>
  )
}
