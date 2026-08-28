import { useLocation } from 'react-router-dom'
import { getToken } from '../lib/session'
import { isReadOnlyToken } from '../lib/readOnly'

/* ---- ICU Integration P1 — the read-only notice ----

   Persistent and not dismissible, because it is not a warning about a
   transient state: it states what this whole phase IS. Without it a
   clinician meets a workspace whose actions are simply absent and has
   to guess whether ICU is broken, whether they lack permission, or
   whether the feature exists at all.

   IT IS A LABEL, NOT A CONTROL. The read-only rule is enforced by the
   ICU server on every request (Core/Identity/P1ReadOnly.cs) — this
   banner explains that rule, it does not implement it. Deleting this
   file would change nothing about what a P1 token can do.

   WHY IT READS useLocation(). The session lives in sessionStorage, which
   is not reactive: a component that only reads it at first render shows
   the WRONG answer whenever the session changes underneath. The browser
   proof caught exactly that, in both directions — the banner was MISSING
   on the first workspace screen after the bridge signed the clinician in,
   and PRESENT over the signed-out screen after the session ended, telling
   someone who was signed out that they were "viewing ICU". Subscribing to
   the router's location re-renders this on every navigation, which is
   precisely when the session can have changed.

   It never renders on /login: that route is the bridge bootstrap, where
   there is by definition no ICU session to describe. */
export function ReadOnlyBanner() {
  const location = useLocation()
  if (location.pathname === '/login') return null
  if (!isReadOnlyToken(getToken())) return null
  return (
    <div className="p1ro" role="note">
      <i>Read-only</i>
      Viewing ICU with your hospital sign-in.
      <span>Charting, orders and admissions are enabled in a later phase.</span>
    </div>
  )
}
