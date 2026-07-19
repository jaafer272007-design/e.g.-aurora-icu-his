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

function AccessDenied({ session, permission }: { session: Session; permission: string }) {
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

export function RequireSession({ permission, anyPermission, children }: {
  permission?: Permission
  /** any-of gate for MULTI-TENANT areas (the Configuration area: each
   *  section is gated to its own authority — office Administrator holds
   *  hospital.configure, SeniorDoctor holds codestatus.manage — and the
   *  route admits whoever holds at least one; the page then shows only
   *  that session's sections) */
  anyPermission?: Permission[]
  children: JSX.Element
}) {
  const session = getSession()
  if (!session) return <Navigate to="/login" replace />
  if (permission && !hasPermission(session.jobTitle, permission)) {
    return <AccessDenied session={session} permission={permission} />
  }
  if (anyPermission && !anyPermission.some(p => hasPermission(session.jobTitle, p))) {
    return <AccessDenied session={session} permission={anyPermission.join(' or ')} />
  }
  return children
}
