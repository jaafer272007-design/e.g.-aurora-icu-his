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
  /** epoch ms these scores were COMPUTED — null while loading or when the
   *  observation domain was unreachable. Surfaced by <DataAge> because the
   *  screens around it now poll their LIST reads while scores still do not
   *  (see useLive.ts): a board must never let a fresh census imply an
   *  equally fresh score. Goes away as a distinct age when scoring moves
   *  server-side and rides the polled payload (step 3). */
  fetchedAt: number | null
}

const EMPTY = (state: ScoreState): PatientScores =>
  ({ state, news2: null, sofa: null, severity: 'unscored', observations: null, fetchedAt: null })

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
export async function fetchPatientScores(patientId: string): Promise<Omit<PatientScores, 'state' | 'fetchedAt'> | null> {
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
      .then(r => { if (!stale) setScores(r ? { state: 'ready', fetchedAt: Date.now(), ...r } : EMPTY('unavailable')) })
      .catch(() => { if (!stale) setScores(EMPTY('unavailable')) })
    return () => { stale = true }
  }, [patientId])

  return scores
}

/** What a board knows about its severity map: the scores themselves, plus
 *  WHEN the set finished computing. The timestamp exists because the boards
 *  around it now poll their list reads while this does not — a fresh census
 *  must never imply an equally fresh score (see useLive.ts / <DataAge>). */
export interface DerivedSeverities {
  byId: Record<string, PatientScores>
  /** epoch ms the whole current id set finished resolving — null while any
   *  patient is still in flight, and null for an empty board */
  fetchedAt: number | null
}

/** board-level fan-out (bed board, worklists): one PatientScores per id.
 *  A missing key is still loading — render it as the neutral unscored
 *  state, never a fabricated verdict. Each patient resolves
 *  independently, so early cards colour while late ones still load. */
export function useDerivedSeverities(patientIds: string[]): DerivedSeverities {
  const [map, setMap] = useState<Record<string, PatientScores>>({})
  const [fetchedAt, setFetchedAt] = useState<number | null>(null)
  const key = patientIds.join('|')

  /* NOTE (staleness): this recomputes only when the SET of ids changes.
     The boards that call it now poll their list read, so an admission or a
     discharge DOES change the set and re-scores the board — but a new
     observation charted on another device for a patient already on the list
     does NOT, because the id set is unchanged. That gap is real, is the
     reason `fetchedAt` is reported separately, and closes when scoring moves
     server-side onto the polled payload (step 3). Until then the boards say
     "Scores as of HH:MM" out loud rather than letting the census speak for
     the scores. */
  useEffect(() => {
    let stale = false
    setMap({})
    setFetchedAt(null)
    if (!key) return
    const ids = key.split('|')
    let remaining = ids.length
    for (const id of ids) {
      fetchPatientScores(id)
        .then(r => { if (!stale) setMap(m => ({ ...m, [id]: r ? { state: 'ready', fetchedAt: Date.now(), ...r } : EMPTY('unavailable') })) })
        .catch(() => { if (!stale) setMap(m => ({ ...m, [id]: EMPTY('unavailable') })) })
        /* the set's age is the moment the LAST patient resolved — stamping
           on the first would claim a freshness the slow ones do not have.
           Runs on the failure path too: a board of unavailable scores has
           still finished, and must not read as "still loading" forever. */
        .finally(() => { if (!stale && --remaining === 0) setFetchedAt(Date.now()) })
    }
    return () => { stale = true }
  }, [key])

  return { byId: map, fetchedAt }
}
