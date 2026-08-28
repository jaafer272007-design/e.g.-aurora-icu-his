import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './Login.css'
import { IconPulse } from '../../components/icons'
import { unitSuffix, useHospitalIdentity } from '../../lib/hospitalIdentity'
import { AURORA_LOGIN_URL, bridgeSignIn } from '../../lib/bridge'
import { landingRouteOf, signIn, type JobTitle } from '../../lib/session'
import { JOB_TITLES } from '../../lib/session'

/* ---- ICU Integration P1 — bridge bootstrap (replaces the ICU login) ----

   THERE IS NO ICU USERNAME/PASSWORD FORM ANY MORE, and that is the
   point of the phase: one hospital login. This screen exchanges the
   Aurora/Bahmni session the browser already holds for a short-lived,
   read-only ICU token, then continues to the workspace.

   IT NEVER FALLS BACK TO A LOCAL SESSION. The old Stage-9 fallback
   (accept the typed name, no token, password unverified) is deliberately
   GONE: a fallback that admits someone the hospital system did not
   authenticate is exactly the second credential P1 exists to remove. If
   the bridge cannot produce a session, this screen says why and sends
   the clinician to Aurora — it never lets them in anyway.

   The three refusals are kept DISTINCT because they need different
   actions: signed-out → sign in to Aurora; no-access → ask an
   administrator to map your hospital role; unavailable → try again
   (nothing is wrong with your account). */

export function Login() {
  /* the CONFIGURED hospital identity (anonymous read — pre-auth) */
  const identity = useHospitalIdentity()
  const unitSuffix2 = identity ? unitSuffix(identity) : ''
  const navigate = useNavigate()
  const [state, setState] = useState<
    | { phase: 'checking' }
    | { phase: 'signed-out' }
    | { phase: 'no-access'; message: string }
    | { phase: 'unavailable'; message: string }
  >({ phase: 'checking' })
  /* StrictMode double-invokes effects in development; the bridge is a
     network call with a side effect (it mints a token), so it runs once */
  const started = useRef(false)

  const attempt = useCallback(async () => {
    setState({ phase: 'checking' })
    const r = await bridgeSignIn()
    if (r.ok) {
      /* the server is the authority on the job title; this only guards
         against a malformed payload reaching the session store — an
         unrecognised title would produce a session the RBAC layer cannot
         derive anything from, which must read as unavailable, not as a
         silent no-permission workspace */
      if (!(JOB_TITLES as readonly string[]).includes(r.session.jobTitle)) {
        setState({ phase: 'unavailable', message: 'ICU received a role it does not recognise and refused to continue.' })
        return
      }
      const jobTitle = r.session.jobTitle as JobTitle
      signIn(r.session.name, jobTitle, r.session.token)
      navigate(landingRouteOf(jobTitle), { replace: true })
      return
    }
    if (r.kind === 'signed-out') setState({ phase: 'signed-out' })
    else if (r.kind === 'no-access') setState({ phase: 'no-access', message: r.message })
    else setState({ phase: 'unavailable', message: r.message })
  }, [navigate])

  useEffect(() => {
    if (started.current) return
    started.current = true
    void attempt()
  }, [attempt])

  const toAurora = () => { window.location.assign(AURORA_LOGIN_URL) }

  return (
    <div className="lgwrap">
      <div className="lgcard">
        <div className="lghead">
          <div className="logo"><IconPulse size={20} stroke="var(--ink)" strokeWidth={2.6} /></div>
          {/* unit segment from the CONFIGURED hospital identity (one
              resolver) — omitted while unset, never a hardcoded name */}
          <div className="lgtitle">AURORA ICU<small>Hospital Information System{unitSuffix2}</small></div>
        </div>

        <div className="lgbody">
          {state.phase === 'checking' && (
            <div className="lgstate" role="status">
              <h2>Opening ICU…</h2>
              <p>Confirming your hospital sign-in. You will not be asked for a password.</p>
            </div>
          )}

          {state.phase === 'signed-out' && (
            <div className="lgstate" role="alert">
              <h2>Sign in to the hospital system</h2>
              <p>
                Your Aurora sign-in has ended, so ICU cannot open. Signing in to Aurora signs
                you in to ICU as well — ICU has no separate password.
              </p>
              <button className="lgbtn" type="button" onClick={toAurora}>Go to Aurora sign-in</button>
            </div>
          )}

          {state.phase === 'no-access' && (
            <div className="lgstate" role="alert">
              <h2>No ICU access on this account</h2>
              <p>{state.message}</p>
              <p className="lghint">
                ICU access is granted by mapping your hospital role to an ICU role. That mapping is a
                hospital decision — ask an administrator to arrange it.
              </p>
              <button className="lgbtn ghost" type="button" onClick={toAurora}>Back to Aurora</button>
            </div>
          )}

          {state.phase === 'unavailable' && (
            <div className="lgstate" role="alert">
              <h2>ICU could not start your session</h2>
              <p>{state.message}</p>
              <p className="lghint">Nothing was changed. Your hospital account is unaffected.</p>
              <div className="lgbtnrow">
                <button className="lgbtn" type="button" onClick={() => void attempt()}>Try again</button>
                <button className="lgbtn ghost" type="button" onClick={toAurora}>Back to Aurora</button>
              </div>
            </div>
          )}
        </div>

        <div className="lgfoot">
          <span className="lgro">Read-only preview · clinical changes are enabled in a later phase</span>
        </div>
      </div>
    </div>
  )
}
