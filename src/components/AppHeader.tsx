import type { CSSProperties, ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import './AppHeader.css'
import { IconPulse } from './icons'
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
  user: { initials: string; name: string; role: string }
}

/** The in-app BACK control (Settings + Back Button design §2) — the app
 *  previously had no back navigation of its own (only the browser's),
 *  a real gap on kiosk/fullscreen clinical workstations.
 *  HONEST EDGES (the flagged choices, stated):
 *  - FIRST SCREEN: react-router stamps its history index on
 *    window.history.state.idx — at idx 0 this tab has no earlier in-app
 *    entry, so the control is HIDDEN (never a dead button). Because the
 *    index is TAB-scoped, back can also never escape into unrelated
 *    pre-app history.
 *  - SIGN-OUT: back never "undoes" a sign-out — every route re-checks the
 *    session via RequireSession on render, so a back into an
 *    authenticated view without a session lands on /login.
 *  - PATIENT CONTEXT: back replays real navigation history only — the
 *    route's patient stays the truth (it complements, never overrides,
 *    the persistent patient context). */
function BackButton() {
  const navigate = useNavigate()
  useLocation() // re-evaluate the history index on every navigation
  const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
  if (idx <= 0) return null
  return (
    <button className="hback" aria-label="Back to the previous screen" title="Back" onClick={() => navigate(-1)}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
    </button>
  )
}

/** Standard top bar: back · brand · clock · KPI pills · user · sign-out.
 *  THE BELL IS GONE (design §3, the flagged honesty debt): it showed a
 *  hardcoded count with a toast-only handler on several screens — a
 *  fabricated number. A real count would need the Alerts multi-source
 *  derivation on every screen load (disproportionate); the Alerts page
 *  shows the real attention counts. Never a fabricated number. */
export function AppHeader({ subtitle, kpis, user }: AppHeaderProps) {
  const { time, date } = useClock()
  const navigate = useNavigate()
  return (
    <header className="app-header">
      <BackButton />
      <div className="brand">
        <div className="logo"><IconPulse size={18} stroke="#06121f" strokeWidth={2.6} /></div>
        <div>AURORA ICU<small>{subtitle}</small></div>
      </div>
      <div className="datetime"><b>{time}</b><span>{date}</span></div>
      <div className="kpis">
        {kpis.map((k, i) => <KpiPill key={i} {...k} />)}
      </div>
      <div className="hspace" />
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
