import type { CSSProperties, ReactNode } from 'react'
import './AppHeader.css'
import { IconBell, IconPulse } from './icons'
import { useClock } from '../hooks/useClock'

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
  bellCount: number
  onBellClick?: () => void
  user: { initials: string; name: string; role: string }
}

/** Standard top bar: brand · clock · KPI pills · notifications · user. */
export function AppHeader({ subtitle, kpis, bellCount, onBellClick, user }: AppHeaderProps) {
  const { time, date } = useClock()
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
      <button className="user" aria-label={`${user.name}, account menu`}>
        <div className="uav">{user.initials}</div>
        <div><div className="un">{user.name}</div><div className="ur">{user.role}</div></div>
      </button>
    </header>
  )
}
