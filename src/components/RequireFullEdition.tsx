import { Navigate } from 'react-router-dom'
import { useEdition } from '../lib/edition'
import { getSession, landingRouteOf } from '../lib/session'

/* Route guard for the module-2 screens (lib/edition.ts): the server this
   bundle is wired to must report the FULL edition, else the route is not a
   screen at all — it sends the session to its landing view (a bookmarked
   /reception on an ICU-edition install lands on the dashboard). Sits INSIDE
   RequireSession, so a session is guaranteed here and the route's permission
   gate has already applied. 'pending' renders nothing rather than guessing. */
export function RequireFullEdition({ children }: { children: JSX.Element }) {
  const edition = useEdition()
  if (edition === 'pending') return null
  if (edition === 'icu') {
    const session = getSession()
    return <Navigate to={session ? landingRouteOf(session.jobTitle) : '/login'} replace />
  }
  return children
}
