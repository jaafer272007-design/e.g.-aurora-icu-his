import { useEffect, useState } from 'react'
import { clockDisplayNow } from '../lib/time'

export interface ClockState {
  time: string
  date: string
  shortTime: string
}

/* The header clock (AppHeader + Mission Control's clock / "Last Updated").
   Renders through lib/time's display clock — the server's zone once
   primed, honoring the 12h/24h Settings preference — instead of the old
   direct `Date.toLocaleTimeString('en-GB')`, which used the BROWSER's
   zone (the audited one-conversion-path leak, on the most visible clock
   in the app) and a hard-24h locale that ignored the preference. The
   1-second tick re-reads the preference, so a Settings change shows on
   the very next tick with no extra wiring. */
function read(): ClockState {
  return clockDisplayNow()
}

export function useClock(): ClockState {
  const [clock, setClock] = useState<ClockState>(read)
  useEffect(() => {
    const t = setInterval(() => setClock(read()), 1000)
    return () => clearInterval(t)
  }, [])
  return clock
}

export function useReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
