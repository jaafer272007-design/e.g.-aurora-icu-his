import { Card } from '../../components/Card'
import { Badge } from '../../components/Badge'
import { useNews2 } from '../../hooks/useNews2'
import type { ScoredComponent } from '../../lib/scoring'

/* Standard NEWS2 v1 — the Clinical Scoring Engine's SECOND score, on the
   patient page. COMPUTED AT RENDER from the real observations — never
   stored; correcting an observation updates it. The honest replacement for
   the fabricated bedside/roster EWS: missing any of the 7 parameters →
   INCOMPLETE with the missing ones named + a partial breakdown, never a
   fabricated total (§4). Escalation band + standard colour are DISPLAY
   ONLY — NO automated alerts in v1 (D6). Decision-support pending clinical
   validation (P7). */

function ParamRow({ c }: { c: ScoredComponent }) {
  const incomplete = c.score === null
  return (
    <div className={`n2row${incomplete ? ' incomplete' : ''}`}>
      <div className="n2c">
        <span className="n2cl">{c.label}</span>
        {incomplete
          ? <span className="n2score ND" title={c.incompleteReason}>ND</span>
          : <span className={`n2score s${c.score}`}>{c.score}</span>}
      </div>
      <div className="n2detail">
        {incomplete ? <span className="n2insuff">insufficient data — {c.incompleteReason}</span> : c.detail}
      </div>
    </div>
  )
}

export function News2Card({ patientId }: { patientId: string }) {
  const { state, news2 } = useNews2(patientId)

  return (
    <Card
      id="news2"
      icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h3l2-6 4 12 2-6h7" /></svg>}
      title="NEWS2 · Early Warning Score"
      aside={<Badge color="blue">standard v1</Badge>}
    >
      {state === 'loading' && <div className="n2empty" aria-busy="true">Computing…</div>}
      {state === 'unavailable' && <div className="n2empty">Score unavailable — the observation data source is not reachable in this session.</div>}

      {state === 'ready' && news2 && (
        <>
          <div className="n2head">
            <div className="n2total">
              <span className="n2tn" style={{ color: news2.result.complete ? (news2.band?.color ?? 'var(--dim)') : 'var(--dim)' }}>{news2.result.total}</span>
              <span className="n2td">/ 20</span>
            </div>
            <div className="n2meta">
              {news2.result.complete
                ? (
                  <>
                    <span className="n2band" style={{ color: news2.band!.color, borderColor: news2.band!.color }}>{news2.band!.label}</span>
                    <span className="n2resp">{news2.band!.response}</span>
                    {news2.anyParamIs3 && <span className="n2trigger">③ single parameter = 3 — urgent review threshold</span>}
                  </>
                )
                : <span className="n2partial">NEWS2: Incomplete — {news2.result.incompleteComponents.join(', ')} not charted ({news2.result.computedCount}/7 parameters)</span>}
            </div>
          </div>

          <div className="n2body">
            {news2.result.components.map(c => <ParamRow key={c.key} c={c} />)}
          </div>

          {news2.ventilated && (
            <div className="n2vent">
              ⚠ Patient is on respiratory support: standard NEWS2 (v1) has known limitations under
              mechanical ventilation (respiration rate, SpO₂ and the air/O₂ element may be
              unreliable). The score is shown UNMODIFIED — ICU-specific handling is a future
              ICU-EWS v2, never a home-made adjustment here.
            </div>
          )}

          <div className="n2foot">
            <span className="n2ds">⚠ Decision-support · standard NEWS2 v1 (Scale 1) · computed from the latest charted observations · band &amp; colour are DISPLAY ONLY — <b>no automated alerts in v1</b>. <b>Requires clinical validation before use in care.</b> Missing parameters are shown as insufficient data, never scored 0.</span>
          </div>
        </>
      )}
    </Card>
  )
}
