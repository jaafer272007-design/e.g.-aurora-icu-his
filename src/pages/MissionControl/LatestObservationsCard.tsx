import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card } from '../../components/Card'
import { Badge } from '../../components/Badge'
import { IconPulse } from '../../components/icons'
import type { LatestObservation } from '../../lib/api/bedside'
import type { FluidBalance, MonitorVitals } from '../../lib/api/types'
import type { News2Computation, ScoredComponent } from '../../lib/scoring'
import { tileTierFromScore, type TileTier } from '../../lib/scoring/display'
import { displayStamp } from '../../lib/time'
import { combinedObservationGroups, type ObservationGroup, type ResolvedReading } from './chartObservations'

/* §12 step 4, decision F5(a): in the manual-charting era the bedside
   display is a LATEST CHARTED OBSERVATIONS card — real values with their
   clinical time and source badge. No waveforms, no jitter, no STREAMING
   badge: the animated monitor returns with the Device Adapter, when a
   genuinely streaming source exists (presentation tracks the real
   source).

   ICU update 2026-10-15 (owner's plan §3): this card now also carries the
   readings of the retired Ventilator and Hemodynamics cards, grouped, each
   with its time and source — see chartObservations.ts for the lists, the
   one removed duplicate (CVP) and the unchanged driving-pressure rule. The
   24 h fluid-balance strip of the Hemodynamics card moves here unchanged
   (projectHemodynamics' own computation over charted INTERVAL fluids — not
   the nurse's manual I&O snapshots, which never feed it).

   VALUE COLOUR = the NEWS2 PARAMETER SCORE (owner's ruling): 0 neutral ·
   1–2 amber · 3 red, with the score shown as a chip (colour is never the
   sole signal). Readings that are not NEWS2 parameters render plain.
   Demo-snapshot values are never scored. On the NURSE's chart
   (`showScores` false — owner's decision 2026-10-15) there is no chip, no
   score colour and no score legend: the same observations, plain. */

const TIER_COLOR: Record<TileTier, string> = {
  neutral: 'var(--text)', amber: 'var(--amber)', red: 'var(--red)',
}

export type ObservationReadState = 'loading' | 'ready' | 'unavailable'

export function LatestObservationsCard({ latest, vitals, rhythm, patientId, news2, showScores, readState, fluidBalance }: {
  latest: Map<string, LatestObservation>
  vitals: MonitorVitals
  rhythm: string
  patientId: string
  /** null whenever scores are hidden or not computed */
  news2: News2Computation | null
  showScores: boolean
  /** the observation read behind `latest` — 'unavailable' = it could not
   *  be read, so a blank is "not read", never "not charted" */
  readState: ObservationReadState
  fluidBalance?: FluidBalance
}) {
  const navigate = useNavigate()
  const components = new Map<string, ScoredComponent>(
    (showScores ? news2?.result.components ?? [] : []).map(c => [c.key, c]))
  const groups = combinedObservationGroups(latest, vitals, rhythm)

  /* the reading's NEWS2 component — scored ONLY on a real reading (a demo
     snapshot or stale/out-of-window value has no current score; the chip
     is absent and the value stays neutral) */
  const scoreOf = (r: ResolvedReading): ScoredComponent | null => {
    if (!showScores || !r.def.news2Key || r.kind !== 'real') return null
    const c = components.get(r.def.news2Key)
    return c && c.score !== null ? c : null
  }

  const blankMeta = readState === 'loading' ? 'reading…' : readState === 'unavailable' ? 'not read' : 'not charted'

  return (
    <Card id="monitor" icon={<IconPulse size={15} stroke="var(--green)" />} title="Latest Charted Observations"
      aside={<Badge color="blue">MANUAL CHARTING</Badge>}>
      {readState === 'unavailable' && (
        <div className="obcerr" role="status">
          The observation record could not be read — nothing below is a current charted value.
        </div>
      )}
      {groups.map(g => (
        <ObservationGroupView key={g.key} group={g} blankMeta={blankMeta} scoreOf={scoreOf}
          footer={g.key === 'hemodynamics' && fluidBalance ? (
            <div className="fluid">
              <div className="fk">
                <span>Fluid balance · 24 h <i>(charted interval fluids)</i></span>
                <b className="num" style={{ color: 'var(--cyan)' }}>{fluidBalance.value}</b>
              </div>
              <div className="fbar"><i style={{ width: `${fluidBalance.percent}%` }} /></div>
            </div>
          ) : null}
        />
      ))}
      <div className="obcfoot">
        <span>
          Latest charted observations — a value with no real observation stays blank; set and
          measured ventilator values are separate readings.
          {showScores && <> Value colour = its NEWS2 parameter score (0 neutral · 1–2 amber · 3 red, shown as the chip);
            unscored readings are plain.</>}
          {' '}Live waveforms return with device integration.
        </span>
        <button className="obclink" onClick={() => navigate(`/observations/${patientId}`)}>
          Chart / flowsheet →
        </button>
      </div>
    </Card>
  )
}

function ObservationGroupView({ group, blankMeta, scoreOf, footer }: {
  group: ObservationGroup
  blankMeta: string
  scoreOf: (r: ResolvedReading) => ScoredComponent | null
  footer: ReactNode
}) {
  /* "charted" counts REAL observations (and the one derived value) — a
     demo snapshot is shown, tagged, but never counted as charted */
  const charted = group.readings.filter(r => r.kind === 'real' || r.kind === 'derived').length
  const withValue = group.readings.filter(r => r.kind !== 'blank').length
  /* a group with no value at all folds to one line (a non-ventilated
     patient is not shown twelve empty ventilator tiles) — the readings stay
     one keyboard-reachable toggle away */
  const [open, setOpen] = useState(false)
  const shown = open || withValue > 0
  const headId = `obg-${group.key}`

  return (
    <section className="obgroup" aria-labelledby={headId}>
      <div className="obghead">
        <h3 id={headId}>{group.title}</h3>
        <span className="obgcount num">{charted} of {group.readings.length} charted</span>
        {withValue === 0 && (
          <button className="obgtoggle" aria-expanded={open} onClick={() => setOpen(o => !o)}>
            {open ? 'Hide readings' : 'Show readings'}
          </button>
        )}
      </div>
      {shown && (
        <div className="obcgrid">
          {group.readings.map(r => {
            const comp = scoreOf(r)
            const tier = tileTierFromScore(comp?.score ?? null)
            return (
              <div className={`obcell${r.kind === 'blank' ? ' blank' : ''}`} key={r.def.label}>
                <span className="lbl">{r.def.label}</span>
                <span className="obval num" style={{ color: r.kind === 'blank' ? 'var(--faint)' : TIER_COLOR[tier] }}>
                  {r.text}{r.def.unit && r.kind !== 'blank' && <i className="u">{r.def.unit}</i>}
                  {comp && (
                    <span className={`obscore t-${tier}`} title={`NEWS2 · ${comp.label}: ${comp.detail} → scores ${comp.score}`}>
                      {comp.score}
                    </span>
                  )}
                </span>
                {r.kind === 'real' && <span className="obmeta num">{displayStamp(r.clinicalTime)} · {r.source}</span>}
                {r.kind === 'derived' && <span className="obmeta num" title={r.derivation}>{displayStamp(r.clinicalTime)} · derived</span>}
                {r.kind === 'demo' && <span className="obmeta demo">demo snapshot</span>}
                {r.kind === 'blank' && <span className="obmeta" title={r.derivation}>{r.derivation && blankMeta === 'not charted' ? 'not derived' : blankMeta}</span>}
              </div>
            )
          })}
        </div>
      )}
      {footer}
    </section>
  )
}
