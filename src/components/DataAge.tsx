import { LIVE_STALL_MS } from '../hooks/useLive'
import { displayStamp, localStamp, useNow } from '../lib/time'
import './DataAge.css'

/* DATA AGE — step 1 of the multi-user staleness work (the verify-first
   report, 2026-08-03), and the piece that STAYS after live refresh exists.

   Aurora is used by several clinicians on several devices at once, and until
   now nothing on screen said WHEN what you are looking at was read. A stale
   bed board and a fresh one were pixel-identical. That is the same failure
   shape as the no-reassuring-default rule in 01's Design System: a display
   that cannot be distinguished from a correct one is worse than one that
   admits what it does not know. This chip is the admission.

   It is deliberately not a health indicator and never claims more than it can
   prove:
     · POLLED surface, updating   -> "Live . 14:32"
     · POLLED surface, gone quiet -> "Not updating . last 14:32"   (warn tone)
     · UNPOLLED surface           -> "As of 14:32"  + a tooltip stating that
       it does not refresh by itself
   No green: on this board green is EARNED by a real clinical score, and a
   freshness widget must never borrow that meaning (01 Design System). */

export interface DataAgeProps {
  /** epoch ms of the last SUCCESSFUL load; null while the first load is in
   *  flight or after a load that failed */
  at: number | null
  /** true when this surface re-reads on a timer (usePollTick) */
  live?: boolean
  /** short prefix when a screen carries more than one age, e.g. "Beds",
   *  "Scores". Omit for the single-source case. */
  label?: string
  /** what the age describes, appended to the tooltip ("the bed census") */
  what?: string
  /** the source could not be read at all (an honest-empty domain, a failed
   *  fetch). WITHOUT this, `at === null` is indistinguishable from "still
   *  loading" and the chip sits on "loading..." forever — which is exactly
   *  the silent-failure shape this component exists to end. Caught by the
   *  rendered sweep on a chart whose observation domain was unreachable. */
  unavailable?: boolean
}

export function DataAge({ at, live = false, label, what, unavailable = false }: DataAgeProps) {
  /* re-render on a slow tick so the label ages honestly without the caller
     wiring anything; 10s keeps the stall flip visible without churn */
  const now = useNow(10_000)
  const prefix = label ? `${label} ` : ''

  if (unavailable && at === null) {
    return (
      <span className="dage dage-stall" role="status"
        title={`${what ?? 'This view'} could not be read, so there is no age to state. Nothing here is current — reload, and if it persists the server may be unreachable.`}>
        {prefix}Not read
      </span>
    )
  }
  if (at === null) {
    return (
      <span className="dage dage-wait" role="status">
        {prefix}loading&hellip;
      </span>
    )
  }

  const shown = displayStamp(localStamp(at))
  const stalled = live && now.getTime() - at > LIVE_STALL_MS
  const subject = what ?? 'this view'

  if (live && !stalled) {
    return (
      <span className="dage dage-live" role="status"
        title={`${subject} re-reads automatically. Last successful read ${shown}.`}>
        {prefix}Live &middot; {shown}
      </span>
    )
  }
  if (stalled) {
    return (
      <span className="dage dage-stall" role="status"
        title={`${subject} should re-read automatically but has not since ${shown}. The server may be unreachable — reload the page before trusting these figures.`}>
        {prefix}Not updating &middot; last {shown}
      </span>
    )
  }
  return (
    <span className="dage dage-static" role="status"
      title={`${subject} was read ${shown} and does NOT refresh by itself. Changes made on another device since then are not shown here — reopen or reload to re-read.`}>
      {prefix}As of {shown}
    </span>
  )
}
