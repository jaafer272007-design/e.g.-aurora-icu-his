import { useEffect, useState } from 'react'
import { getObservations } from '../lib/api'
import { computeNews2, type News2Computation } from '../lib/scoring'

export type ScoreState = 'loading' | 'ready' | 'unavailable'

/* Real NEWS2 for a patient, computed at render from the observation reads
   (the real-only observations domain). Returns 'unavailable' when the API
   is unreachable (dev/offline) — the observation domain has no mock store,
   so nothing is fabricated. Recomputes when patientId changes (opening the
   patient re-reads the latest observations); a live charting refresh is a
   later refinement. */
export function useNews2(patientId: string): { state: ScoreState; news2: News2Computation | null } {
  const [state, setState] = useState<ScoreState>('loading')
  const [news2, setNews2] = useState<News2Computation | null>(null)

  useEffect(() => {
    let stale = false
    setState('loading'); setNews2(null)
    if (!patientId) return
    getObservations(patientId)
      .then(obs => {
        if (stale) return
        if (obs === null) { setState('unavailable'); return }
        setNews2(computeNews2({ observations: obs, now: new Date() }))
        setState('ready')
      })
      .catch(() => { if (!stale) setState('unavailable') })
    return () => { stale = true }
  }, [patientId])

  return { state, news2 }
}
