import type { News2Computation } from '../lib/scoring'
import type { ScoreState } from '../hooks/usePatientScores'
import './News2Pill.css'

/* Compact real-NEWS2 pill for list/glance surfaces (bed board, rounding
   list). DISPLAY ONLY — the standard NEWS2 band colour, no
   notification/paging (D6). Honest states: a computable score shows the
   total + band; an incomplete one shows "Incomplete" (never a fabricated
   number); off-API shows "—". This REPLACES the fabricated EWS tile.

   PRESENTATIONAL since the score-derived-status build: the computation
   arrives from the shared usePatientScores / useDerivedSeverities fetch
   (one chart read feeds the pill, the severity dot and the card accent —
   they can never disagree). */
export function News2Pill({ state, news2, showLabel = true }: {
  state: ScoreState
  news2: News2Computation | null
  showLabel?: boolean
}) {
  if (state === 'loading') return <span className="news2pill loading" aria-label="NEWS2 loading">{showLabel && <b>NEWS2</b>}<span className="n2v">…</span></span>
  if (state === 'unavailable' || !news2) return <span className="news2pill na" aria-label="NEWS2 unavailable">{showLabel && <b>NEWS2</b>}<span className="n2v">—</span></span>

  if (!news2.result.complete) {
    const missing = news2.result.incompleteComponents.join(', ')
    return (
      <span className="news2pill incomplete" title={`NEWS2 incomplete — missing: ${missing}`} aria-label={`NEWS2 incomplete, missing ${missing}`}>
        {showLabel && <b>NEWS2</b>}<span className="n2v">Incomplete</span>
      </span>
    )
  }

  const band = news2.band!
  return (
    <span
      className={`news2pill band-${band.key}`}
      style={{ ['--n2c' as string]: band.color }}
      title={`NEWS2 ${news2.result.total} · ${band.label} · ${band.response}${news2.anyParamIs3 ? ' · single parameter = 3' : ''}`}
      aria-label={`NEWS2 ${news2.result.total}, ${band.label}`}
    >
      {showLabel && <b>NEWS2</b>}
      <span className="n2v" style={{ color: band.color }}>{news2.result.total}</span>
      {news2.anyParamIs3 && <span className="n2flag" title="single parameter scored 3">③</span>}
    </span>
  )
}
