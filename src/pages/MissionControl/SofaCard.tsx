import { useEffect, useState } from 'react'
import { Card } from '../../components/Card'
import { Badge } from '../../components/Badge'
import { getEncounters, getLabDraws, getObservations, getPatientOrders } from '../../lib/api'
import { computeSofa, type ScoredComponent, type SofaComputation } from '../../lib/scoring'
import { useNow } from '../../lib/time'

/* Classic SOFA v1 — the Clinical Scoring Engine's first real score, shown
   on the patient page. COMPUTED AT RENDER from the canonical reads (labs,
   observations, the structured Infusion Module, encounter weight) — never
   stored (P5); correcting an underlying value updates the score. This is
   the honest replacement for the fabricated bedside SOFA (P6): where inputs
   are insufficient it shows INCOMPLETE with the per-component breakdown and
   a partial total, never a fabricated or falsely-complete number (P1).

   DECISION-SUPPORT: surfaced as decision-support pending clinical
   validation (P7 / spec §2.8) — never as an authoritative vital. */

const scoreColor = (s: number, max: number) => {
  const frac = s / max
  if (frac >= 0.75) return 'var(--red)'
  if (frac >= 0.5) return 'var(--amber)'
  if (s > 0) return 'var(--blue)'
  return 'var(--green)'
}

function ComponentRow({ c }: { c: ScoredComponent }) {
  const incomplete = c.score === null
  return (
    <div className={`sofarow${incomplete ? ' incomplete' : ''}`}>
      <div className="sofac">
        <span className="sofacl">{c.label}</span>
        {incomplete
          ? <span className="sofascore ND" title={c.incompleteReason}>ND</span>
          : <span className="sofascore" style={{ color: scoreColor(c.score as number, c.max) }}>{c.score}</span>}
      </div>
      <div className="sofadetail">
        {incomplete ? <span className="sofainsuff">insufficient data — {c.incompleteReason}</span> : c.detail}
        {c.note && <span className="sofanote"> · {c.note}</span>}
      </div>
      {!incomplete && c.contributors.length > 0 && (
        <div className="sofacontrib">
          {c.contributors.map((k, i) => (
            <span key={i} className="sofacchip">{k.label} {k.display}{k.timeLabel ? ` @ ${k.timeLabel}` : ''}</span>
          ))}
        </div>
      )}
    </div>
  )
}

export function SofaCard({ patientId }: { patientId: string }) {
  const now = useNow(60_000)
  const [sofa, setSofa] = useState<SofaComputation | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const [view, setView] = useState<'worst' | 'latest'>('worst')

  useEffect(() => {
    let stale = false
    setState('loading'); setSofa(null)
    if (!patientId) return
    ;(async () => {
      try {
        const encs = await getEncounters({ patientId, status: 'open' })
        const enc = encs[0]
        const [labs, obs, orders] = await Promise.all([
          getLabDraws(patientId),
          getObservations(patientId, enc?.encounterId),
          getPatientOrders(patientId),
        ])
        if (stale) return
        if (obs === null) { setState('unavailable'); return } // real-only observations domain off-API
        setSofa(computeSofa({ labs, observations: obs, orders, weightKg: enc?.weightKg ?? null, now }))
        setState('ready')
      } catch {
        if (!stale) setState('unavailable')
      }
    })()
    return () => { stale = true }
    // `now` intentionally excluded: recompute on data/patient change, not every clock tick
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId])

  const result = sofa ? (view === 'worst' ? sofa.worst : sofa.latest) : null
  const delta = sofa?.deltaFromPrevious ?? null

  return (
    <Card
      id="sofa"
      icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--violet)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h4l3 8 4-16 3 8h4" /></svg>}
      title="SOFA · Organ Dysfunction"
      aside={<Badge color="blue">classic v1</Badge>}
    >
      {state === 'loading' && <div className="sofaempty" aria-busy="true">Computing…</div>}
      {state === 'unavailable' && (
        <div className="sofaempty">Score unavailable — the observation data source is not reachable in this session.</div>
      )}

      {state === 'ready' && result && (
        <>
          <div className="sofahead">
            <div className="sofatotal">
              <span className="sofatn" style={{ color: result.complete ? scoreColor(result.total, 24) : 'var(--dim)' }}>{result.total}</span>
              <span className="sofatd">/ 24</span>
            </div>
            <div className="sofameta">
              {result.complete
                ? <span className="sofacomplete">all 6 systems scored</span>
                : <span className="sofapartial">PARTIAL · {result.computedCount}/6 scored — INCOMPLETE: {result.incompleteComponents.join(', ')} not scored</span>}
              {delta !== null && (
                <span className={`sofadelta ${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}`}>
                  ΔSOFA {delta > 0 ? '+' : ''}{delta} vs prior 24 h
                </span>
              )}
            </div>
            <div className="sofaviews" role="tablist">
              <button role="tab" aria-selected={view === 'worst'} className={`sofaviewb${view === 'worst' ? ' on' : ''}`} onClick={() => setView('worst')}>Worst 24 h</button>
              <button role="tab" aria-selected={view === 'latest'} className={`sofaviewb${view === 'latest' ? ' on' : ''}`} onClick={() => setView('latest')}>Current</button>
            </div>
          </div>

          <div className="sofabody">
            {result.components.map(c => <ComponentRow key={c.key} c={c} />)}
          </div>

          <div className="sofafoot">
            <span className="sofads">⚠ Decision-support · classic SOFA v1 · computed from labs, observations &amp; infusions in the last 24 h — <b>requires clinical validation before use in care</b>. Missing inputs are shown as insufficient data, never scored 0.</span>
          </div>
        </>
      )}
    </Card>
  )
}
