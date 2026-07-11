import { useEffect, useState, type ReactNode } from 'react'
import './EnvironmentChrome.css'
import { APP_ENV } from '../lib/env'
import { apiHealthUrl } from '../lib/api'

/* ==================== §11 step 3 — environment chrome ====================
   The frontend-side analogues of the server's boot tripwires: a
   cross-environment mismatch fails LOUDLY AND VISIBLY, never invisibly.

   EnvironmentGate — the runtime environment cross-check. The bundle
   carries its EXPECTED environment (APP_ENV, compiled in); on load the
   app fetches /healthz from the API it is wired to and compares the
   `environment` the server reports (the step-1 identity field). A
   response that names a DIFFERENT environment — a production bundle
   somehow served against staging, a staging bundle against production —
   replaces the ENTIRE app with a full-screen refusal naming both values.
   Not a toast, not a banner: the app is unusable, by design. An
   UNREACHABLE healthz is not a verdict (a cold start or offline dev is
   not a wrong environment) — data calls fail on their own terms; and a
   pure-mock dev session (no API at all) skips the check. The gate also
   hosts the production api-unavailable overlay: when a production data
   call cannot be served (the mock layer does not exist there),
   api/index.ts dispatches 'aurora:api-unavailable' and the overlay makes
   that state unmissable.

   EnvironmentBanner — staging and development display a persistent,
   unmistakable strip naming the environment, driven by the same
   compiled-in identity. Production renders NOTHING here — and because
   the branch below is statically dead in a production build, the banner
   is absent from the production artifact, not hidden (same mechanism as
   the mock layer; verified by bundle inspection). Hidden in print CSS —
   printed documents are governed by the Print Center's own layout. */

type GateState =
  | { kind: 'ok' }
  | { kind: 'mismatch'; reported: string }
  | { kind: 'api-unavailable'; what: string }

export function EnvironmentGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>({ kind: 'ok' })

  useEffect(() => {
    const onUnavailable = (e: Event) =>
      setState(s => (s.kind === 'ok' ? { kind: 'api-unavailable', what: String((e as CustomEvent).detail ?? '') } : s))
    window.addEventListener('aurora:api-unavailable', onUnavailable)

    const url = apiHealthUrl()
    if (url !== null) {
      fetch(url)
        .then(res => (res.ok ? res.json() : null))
        .then((h: { environment?: string } | null) => {
          if (!h) return // unreachable / non-JSON — not a verdict
          const reported = typeof h.environment === 'string' ? h.environment : '<none reported>'
          if (reported !== APP_ENV) setState({ kind: 'mismatch', reported })
        })
        .catch(() => { /* unreachable is not a verdict */ })
    }
    return () => window.removeEventListener('aurora:api-unavailable', onUnavailable)
  }, [])

  if (state.kind === 'mismatch') {
    return (
      <div className="envrefusal" role="alert">
        <h1>WRONG ENVIRONMENT</h1>
        <p>
          This interface was built for the <b>{APP_ENV}</b> environment, but the server it is
          wired to reports <b>{state.reported}</b>.
        </p>
        <p>
          Refusing to operate: a cross-environment session could read or write the wrong
          system of record. This is a deployment/configuration error to fix — served from{' '}
          <span className="envmono">{window.location.origin}</span>.
        </p>
      </div>
    )
  }
  if (state.kind === 'api-unavailable') {
    return (
      <div className="envrefusal" role="alert">
        <h1>AURORA API UNAVAILABLE</h1>
        <p>
          A clinical data request (<b>{state.what || 'unknown'}</b>) could not be served, and this
          production interface carries no demo fallback — by design, it never substitutes mock
          data for the system of record.
        </p>
        <p>
          Check the AURORA service, then{' '}
          <button className="envretry" onClick={() => window.location.reload()}>reload</button>.
        </p>
      </div>
    )
  }
  return <>{children}</>
}

export function EnvironmentBanner() {
  /* statically dead in a production build — the banner is ABSENT from the
     production artifact, not hidden */
  if (import.meta.env.VITE_APP_ENV === 'production') return null
  return (
    <div className="envbanner" role="note">
      {APP_ENV.toUpperCase()} ENVIRONMENT — not the system of record; everything here is test data
    </div>
  )
}
