import { useEffect, useState } from 'react'

/* LIVE REFRESH — step 2 of the multi-user staleness work (the verify-first
   report, 2026-08-03). Before this, EVERY screen was fetch-on-mount with no
   revalidation of any kind: no websocket, no SSE, no polling, no focus or
   visibility revalidation, no cache library. A bed board left open on a ward
   monitor showed the census as of page load, indefinitely — so a bed admitted
   to on one device stayed "empty" on every other open board until someone
   navigated or pressed F5.

   This module is deliberately SMALL and NOT a data layer. It hands a screen a
   counter that advances on a timer; the screen adds it to the dependency array
   of the load effect it already has. That keeps every existing loading
   sentinel (`undefined` = loading vs `null` = domain absent), every error
   path, and every honest-empty state exactly as they were — the refresh is
   additive, and a reviewer can see the whole of it in the diff.

   WHY ONLY THE CHEAP LIST READS (see the design note): the per-patient score
   path costs FIVE requests per patient (encounters, then labs + full-chart
   observations + encounter observations + orders), fanned out per occupied
   bed. Polling that on a 20-bed unit would be ~100 requests per cycle. The
   scores therefore stay mount-computed until they move server-side (step 3),
   and the screens say so out loud through <DataAge> rather than letting the
   list's freshness imply the scores are equally fresh. */

/** How often a polled screen re-reads its list endpoint. One named constant:
 *  the interval, the "is it still updating" threshold and the docs all derive
 *  from this value, so there is one number to change. */
export const LIVE_POLL_MS = 20_000

/** A polled surface is considered STALLED once this much time has passed with
 *  no successful load — three missed cycles, so one slow response or a single
 *  transient failure does not cry wolf, but a dead poll or an unreachable
 *  server surfaces within about a minute. */
export const LIVE_STALL_MS = LIVE_POLL_MS * 3

/* Visibility is read through a function so tests and non-browser renders
   (SSR, jsdom without the property) treat "unknown" as VISIBLE — the safe
   default is to keep refreshing, never to silently stop. */
const documentIsVisible = (): boolean =>
  typeof document === 'undefined' || document.visibilityState !== 'hidden'

/** A counter that advances every `intervalMs` while the document is VISIBLE,
 *  and once IMMEDIATELY when a hidden document becomes visible again.
 *
 *  Add it to a load effect's dependency array:
 *
 *      const tick = usePollTick()
 *      useEffect(() => { getBeds().then(...) }, [tick])
 *
 *  Pausing while hidden is not only politeness to the server: a ward monitor
 *  whose screen is off, or a background tab, has no reader, and browsers
 *  throttle background timers unpredictably anyway. Refreshing on the way
 *  BACK is the half that matters clinically — the first thing a returning
 *  clinician sees must not be the census from twenty minutes ago. */
export function usePollTick(intervalMs = LIVE_POLL_MS): number {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null

    const start = () => {
      if (timer === null) timer = setInterval(() => setTick(t => t + 1), intervalMs)
    }
    const stop = () => {
      if (timer !== null) { clearInterval(timer); timer = null }
    }
    const onVisibility = () => {
      if (documentIsVisible()) {
        setTick(t => t + 1)   // catch up FIRST, then resume the cadence
        start()
      } else {
        stop()
      }
    }

    if (documentIsVisible()) start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility) }
  }, [intervalMs])

  return tick
}
