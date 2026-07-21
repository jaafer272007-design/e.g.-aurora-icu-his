import { useEffect, useState } from 'react'
import { getEncounters, getLabDraws, getObservations, getPatientOrders } from '../lib/api'
import { computeNews2, computeSofa, type News2Computation, type SofaComputation } from '../lib/scoring'
import { deriveSeverity, type DerivedSeverity } from '../lib/scoring/display'
import type { Observation } from '../lib/api/types'

export type ScoreState = 'loading' | 'ready' | 'unavailable'

export interface PatientScores {
  state: ScoreState
  news2: News2Computation | null
  sofa: SofaComputation | null
  /** worst-of {NEWS2 band, SOFA sub-scores} — see scoring/display.ts */
  severity: DerivedSeverity
  /** the raw FULL-CHART observations behind NEWS2 — reused for the
   *  latest-observations projection so one fetch feeds both */
  observations: Observation[] | null
}

const EMPTY = (state: ScoreState): PatientScores =>
  ({ state, news2: null, sofa: null, severity: 'unscored', observations: null })

/* ONE fetch+compute path for every score-derived surface (score cards,
   observation tiles, digital twin, severity dots). The inputs preserve
   the pre-existing per-score scopes EXACTLY, so the computed scores are
   unchanged by this consolidation:
     · NEWS2 reads the FULL chart (the retired useNews2 hook's input);
     · SOFA reads the OPEN encounter's chart when one exists — else the
       full chart — plus labs / orders / encounter weight (the old
       SofaCard inline fetch, verbatim).
   null = the real-only observation domain is unreachable → every
   consumer shows its honest unavailable/neutral state (nothing is
   fabricated; the no-reassuring-default rule). */
export async function fetchPatientScores(patientId: string): Promise<Omit<PatientScores, 'state'> | null> {
  const encs = await getEncounters({ patientId, status: 'open' }).catch(() => [])
  const enc = encs[0]
  const [labs, obsAll, obsEnc, orders] = await Promise.all([
    getLabDraws(patientId),
    getObservations(patientId),
    enc ? getObservations(patientId, enc.encounterId) : Promise.resolve(null),
    getPatientOrders(patientId),
  ])
  if (obsAll === null || (enc && obsEnc === null)) return null
  const now = new Date()
  const news2 = computeNews2({ observations: obsAll, now })
  const sofa = computeSofa({
    labs,
    observations: enc ? obsEnc! : obsAll,
    orders,
    weightKg: enc?.weightKg ?? null,
    now,
  })
  return { news2, sofa, severity: deriveSeverity(news2, sofa), observations: obsAll }
}

/** scores for ONE patient — recomputes on patientId change (opening the
 *  patient re-reads the chart; a live charting refresh is a later
 *  refinement, unchanged from the retired useNews2) */
export function usePatientScores(patientId: string): PatientScores {
  const [scores, setScores] = useState<PatientScores>(EMPTY('loading'))

  useEffect(() => {
    let stale = false
    setScores(EMPTY('loading'))
    if (!patientId) return
    fetchPatientScores(patientId)
      .then(r => { if (!stale) setScores(r ? { state: 'ready', ...r } : EMPTY('unavailable')) })
      .catch(() => { if (!stale) setScores(EMPTY('unavailable')) })
    return () => { stale = true }
  }, [patientId])

  return scores
}

/** board-level fan-out (bed board, worklists): one PatientScores per id.
 *  A missing key is still loading — render it as the neutral unscored
 *  state, never a fabricated verdict. Each patient resolves
 *  independently, so early cards colour while late ones still load. */
export function useDerivedSeverities(patientIds: string[]): Record<string, PatientScores> {
  const [map, setMap] = useState<Record<string, PatientScores>>({})
  const key = patientIds.join('|')

  useEffect(() => {
    let stale = false
    setMap({})
    if (!key) return
    for (const id of key.split('|')) {
      fetchPatientScores(id)
        .then(r => { if (!stale) setMap(m => ({ ...m, [id]: r ? { state: 'ready', ...r } : EMPTY('unavailable') })) })
        .catch(() => { if (!stale) setMap(m => ({ ...m, [id]: EMPTY('unavailable') })) })
    }
    return () => { stale = true }
  }, [key])

  return map
}
