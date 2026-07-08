import { Navigate, useNavigate } from 'react-router-dom'
import './RequireSession.css'
import { IconAlertTriangle } from './icons'
import {
  getSession, hasPermission, landingRouteOf, profileOf, signOut,
  type Permission, type Session,
} from '../lib/session'

/* Route guards (Stage 9). No session → /login. Session without the route's
   required permission → explicit Access Restricted state (mirrors the locked
   Patient Not Found pattern: never silently show another view). The same
   permissions are re-checked in the service layer — this is UX, not the
   security boundary; Stage 10 enforces server-side. */

function AccessDenied({ session, permission }: { session: Session; permission: Permission }) {
  const navigate = useNavigate()
  return (
    <div className="app-frame denied">
      <main className="deniedwrap">
        <section className="card notfound" role="alert">
          <IconAlertTriangle size={28} stroke="var(--amber)" />
          <h2>Access Restricted</h2>
          <p>
            You are signed in as <b>{session.name}</b> — {session.jobTitle} ({profileOf(session.jobTitle)} profile).
            This screen requires the <code>{permission}</code> permission, which that profile doesn't include.
          </p>
          <div className="deniedbtns">
            <button className="nf-btn" onClick={() => navigate(landingRouteOf(session.jobTitle))}>← My dashboard</button>
            <button className="nf-btn" onClick={() => { signOut(); navigate('/login') }}>Switch role</button>
          </div>
        </section>
      </main>
    </div>
  )
}

export function RequireSession({ permission, children }: { permission?: Permission; children: JSX.Element }) {
  const session = getSession()
  if (!session) return <Navigate to="/login" replace />
  if (permission && !hasPermission(session.jobTitle, permission)) {
    return <AccessDenied session={session} permission={permission} />
  }
  return children
}
