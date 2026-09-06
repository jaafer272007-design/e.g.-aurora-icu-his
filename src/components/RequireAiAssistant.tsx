import { Navigate } from 'react-router-dom'
import { useAiSection } from '../lib/aiAvailability'
import { getSession, landingRouteOf } from '../lib/session'

/* Route guard for the AI Assistant section (lib/aiAvailability.ts): the
   server this bundle is wired to must REPORT the AI enabled, else the route
   is not a screen at all — it sends the session to its landing view (a
   bookmarked /ai on a no-AI install lands on the dashboard, never on a
   "disabled feature" page). Sits INSIDE RequireSession, so a session is
   guaranteed here and the permission gate (ai.view) has already applied.
   'pending' (healthz not yet answered) renders nothing rather than guessing
   either way. */
export function RequireAiAssistant({ children }: { children: JSX.Element }) {
  const ai = useAiSection()
  if (ai === 'pending') return null
  if (ai === 'hidden') {
    const session = getSession()
    return <Navigate to={session ? landingRouteOf(session.jobTitle) : '/login'} replace />
  }
  return children
}
