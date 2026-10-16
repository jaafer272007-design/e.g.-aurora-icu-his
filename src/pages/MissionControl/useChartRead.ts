import { useEffect, useState } from 'react'

/** One patient-scoped chart read, keyed to the patient it was read for.
 *
 *  PATIENT ISOLATION (owner's plan §3: "Clear the displayed patient data
 *  immediately when switching patients; late responses must never
 *  populate another patient's chart"):
 *    · the result is stored WITH the patientId it was requested for, and
 *      a render for any other patient sees 'loading' — the previous
 *      patient's rows are gone in the very render that switches, not one
 *      effect later;
 *    · a response that lands after the patient changed (or the card
 *      unmounted) is discarded whole.
 *  'error' = the source could not be read — the card says so; it never
 *  turns into an empty list. */
export type ChartRead<T> =
  | { state: 'loading' }
  | { state: 'ok'; data: T; at: number }
  | { state: 'error' }

export function useChartRead<T>(patientId: string, read: (patientId: string) => Promise<T>, enabled = true): ChartRead<T> {
  const [held, setHeld] = useState<{ key: string; read: ChartRead<T> } | null>(null)

  useEffect(() => {
    if (!patientId || !enabled) return
    let stale = false
    setHeld({ key: patientId, read: { state: 'loading' } })
    read(patientId)
      .then(data => { if (!stale) setHeld({ key: patientId, read: { state: 'ok', data, at: Date.now() } }) })
      .catch(() => { if (!stale) setHeld({ key: patientId, read: { state: 'error' } }) })
    return () => { stale = true }
    // `read` is a module-level adapter function; the patient is the key
  }, [patientId, enabled])

  return held && held.key === patientId ? held.read : { state: 'loading' }
}
