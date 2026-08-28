import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import './BridgeSessionGuard.css'
import { bridgeSignIn } from '../lib/bridge'
import { getSession, getToken, signIn, signOut, type JobTitle } from '../lib/session'
import { JOB_TITLES } from '../lib/session'

/* ---- ICU Integration P1 — the shared-session guard ----

   THE PROBLEM IT SOLVES. An ICU bearer token lives in sessionStorage
   and survives things the hospital session does not: the clinician
   signs out of Aurora in another tab, the OpenMRS session times out, or
   the browser restores this page from the back/forward cache with the
   old token still sitting in storage. In every one of those cases the
   ICU tab would happily keep rendering patient data against a hospital
   session that no longer exists.

   THE RULE, therefore: before protected ICU information is shown, the
   Aurora session is REVALIDATED THROUGH THE BRIDGE. Not the ICU token —
   the ICU token is exactly the thing that might be stale. Revalidation
   happens on:
     - first load / full page navigation (mount),
     - restoration from history (`pageshow` with persisted=true — the
       bfcache case, which fires NO mount and no effect on its own),
     - the tab becoming visible again after being hidden.

   If the hospital session is gone, ICU state is CLEARED and the
   clinician is returned to the ICU entry point, which itself sends them
   to Aurora sign-in. It never renders the protected page first and
   corrects itself afterwards.

   IT DOES NOT GATE /login. That route IS the bridge bootstrap; gating
   it would loop. */
export function BridgeSessionGuard({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const onLogin = location.pathname === '/login'
  const hasSession = getSession() !== null

  /* 'trusted' only after a successful revalidation in THIS page life */
  const [checked, setChecked] = useState(false)
  const running = useRef(false)

  useEffect(() => {
    if (onLogin || !hasSession) return

    let cancelled = false
    const revalidate = async () => {
      if (running.current) return
      running.current = true
      try {
        const r = await bridgeSignIn()
        if (cancelled) return
        if (r.ok && (JOB_TITLES as readonly string[]).includes(r.session.jobTitle)) {
          /* refresh the stored token too: P1 tokens are short-lived and
             this is the one moment we know a fresh one is available */
          signIn(r.session.name, r.session.jobTitle as JobTitle, r.session.token)
          setChecked(true)
          return
        }
        if (r.ok) return // unrecognised title — leave the session alone, /login reports it
        if (r.kind === 'unavailable') {
          /* NOT a signed-out verdict. An unreachable hospital system must
             not log a clinician out mid-shift; the data calls fail on
             their own terms and say so. */
          setChecked(true)
          return
        }
        /* signed-out or no-access: the hospital session is gone or no
           longer grants ICU. Clear ICU state and leave. */
        signOut()
        navigate('/login', { replace: true })
      } finally {
        running.current = false
      }
    }

    void revalidate()

    /* history restoration (bfcache) fires no mount — this is the only
       hook that catches "the clinician pressed Back into a protected
       ICU page after signing out" */
    const onPageShow = (e: PageTransitionEvent) => { if (e.persisted) void revalidate() }
    const onVisible = () => { if (document.visibilityState === 'visible') void revalidate() }
    window.addEventListener('pageshow', onPageShow)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      window.removeEventListener('pageshow', onPageShow)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [onLogin, hasSession, navigate])

  if (onLogin) return <>{children}</>

  /* No session at all, or a session not yet revalidated in this page
     life: show NOTHING protected. A token in storage is not evidence
     that the hospital session is still alive. */
  if (!hasSession || !getToken()) return <>{children}</>
  if (!checked) {
    return (
      <div className="bsg-hold" role="status">
        <div className="bsg-card">
          <b>Confirming your hospital sign-in…</b>
          <span>ICU opens once Aurora confirms your session.</span>
        </div>
      </div>
    )
  }
  return <>{children}</>
}
