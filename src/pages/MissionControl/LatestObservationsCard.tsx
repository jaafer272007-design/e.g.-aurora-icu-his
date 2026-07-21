import { useNavigate } from 'react-router-dom'
import { Card } from '../../components/Card'
import { Badge } from '../../components/Badge'
import { IconPulse } from '../../components/icons'
import type { LatestObservation } from '../../lib/api/bedside'
import type { MonitorVitals } from '../../lib/api/types'
import type { News2Computation, ScoredComponent } from '../../lib/scoring'
import { tileTierFromScore, type TileTier } from '../../lib/scoring/display'

/* §12 step 4, decision F5(a): in the manual-charting era the bedside
   display is a LATEST CHARTED OBSERVATIONS card — real values with their
   clinical time and source badge. No waveforms, no jitter, no STREAMING
   badge: the animated monitor returns with the Device Adapter, when a
   genuinely streaming source exists (presentation tracks the real
   source). Value resolution per reading (F9): a real charted observation
   (time + source shown) → the demo snapshot in demo-seeded environments
   (tagged DEMO) → an honest "not charted".

   VALUE COLOUR = the NEWS2 PARAMETER SCORE (owner's ruling): 0 neutral ·
   1–2 amber · 3 red, with the score shown as a chip (colour is never the
   sole signal). The old fixed per-metric accent colours are RETIRED —
   they painted HR 120 green on a NEWS2-HIGH patient (a decorative colour
   read as a safety verdict; the no-reassuring-default rule,
   scoring/display.ts). Readings that are not NEWS2 parameters (arterial
   BP, MAP, EtCO₂, CVP, rhythm) render plain: no score, no safety colour.
   Demo-snapshot values are never scored (NEWS2 computes from REAL
   observations only), so they stay neutral by construction. */

interface Reading {
  label: string
  unit: string
  /** observation typeCodes joined with '/' (BP pairs) */
  codes: string[]
  /** the roster-merged fallback fields (real-else-demo-else-null server-side) */
  keys: (keyof MonitorVitals)[]
  /** the NEWS2 component this tile's reading feeds (engine key) — absent
   *  = not a NEWS2 parameter, always neutral. NIBP (cuff sbp) is the
   *  score's systolic input; the arterial line is NOT (news2.ts reads
   *  'sbp' only), so only the NIBP tile carries the SBP score. */
  news2Key?: string
  big?: boolean
}

const READINGS: Reading[] = [
  { label: 'Heart Rate', unit: 'bpm', codes: ['hr'], keys: ['hr'], news2Key: 'hr', big: true },
  { label: 'Arterial BP', unit: 'mmHg', codes: ['art_sbp', 'art_dbp'], keys: ['sys', 'dia'] },
  { label: 'MAP', unit: 'mmHg', codes: ['map'], keys: ['map'], big: true },
  { label: 'NIBP', unit: 'mmHg', codes: ['sbp', 'dbp'], keys: ['nibpSys', 'nibpDia'], news2Key: 'sbp' },
  { label: 'SpO₂', unit: '%', codes: ['spo2'], keys: ['spo2'], news2Key: 'spo2', big: true },
  { label: 'Resp Rate', unit: '/min', codes: ['rr'], keys: ['rr'], news2Key: 'rr' },
  { label: 'Temp', unit: '°C', codes: ['temp'], keys: ['temp'], news2Key: 'temp' },
  { label: 'EtCO₂', unit: 'mmHg', codes: ['etco2'], keys: ['etco2'] },
  { label: 'CVP', unit: 'mmHg', codes: ['cvp'], keys: ['cvp'] },
]

const TIER_COLOR: Record<TileTier, string> = {
  neutral: 'var(--text)', amber: 'var(--amber)', red: 'var(--red)',
}

const hm = (clinicalTime: string) => clinicalTime.split(' ')[1] ?? clinicalTime

export function LatestObservationsCard({ latest, vitals, rhythm, patientId, news2 }: {
  latest: Map<string, LatestObservation>
  vitals: MonitorVitals
  rhythm: string
  patientId: string
  news2: News2Computation | null
}) {
  const navigate = useNavigate()
  const components = new Map<string, ScoredComponent>(
    (news2?.result.components ?? []).map(c => [c.key, c]))

  const resolve = (r: Reading) => {
    const real = r.codes.map(c => latest.get(c))
    if (real.some(Boolean)) {
      const parts = r.codes.map((_, i) => real[i]?.value ?? '—')
      const newest = real.filter((x): x is LatestObservation => !!x)
        .sort((a, b) => (a.clinicalTime < b.clinicalTime ? 1 : -1))[0]
      return { text: parts.join('/'), kind: 'real' as const, time: hm(newest.clinicalTime), source: newest.source }
    }
    const demo = r.keys.map(k => vitals[k])
    if (demo.some(v => v !== null)) {
      return { text: demo.map(v => v === null ? '—' : String(v)).join('/'), kind: 'demo' as const }
    }
    return { text: '—', kind: 'blank' as const }
  }

  /* the tile's NEWS2 component — scored ONLY on a real reading (a demo
     snapshot or stale/out-of-window value has no current score; the chip
     is absent and the value stays neutral) */
  const scoreOf = (r: Reading, kind: 'real' | 'demo' | 'blank'): ScoredComponent | null => {
    if (!r.news2Key || kind !== 'real') return null
    const c = components.get(r.news2Key)
    return c && c.score !== null ? c : null
  }

  /* rhythm arrives roster-MERGED (real-else-demo-else '—'); the latest map
     says whether a real cardiac_rhythm exists */
  const realRhythm = latest.get('cardiac_rhythm')
  const rhythmRes = realRhythm
    ? { text: realRhythm.value, kind: 'real' as const, time: hm(realRhythm.clinicalTime), source: realRhythm.source }
    : rhythm !== '—' ? { text: rhythm, kind: 'demo' as const } : { text: '—', kind: 'blank' as const }

  const rows = [...READINGS.map(r => ({ r, res: resolve(r) })),
    { r: { label: 'Rhythm', unit: '', codes: [], keys: [] } as Reading, res: rhythmRes }]

  return (
    <Card id="monitor" icon={<IconPulse size={15} stroke="var(--green)" />} title="Latest Charted Observations"
      aside={<Badge color="blue">MANUAL CHARTING</Badge>}>
      <div className="obcgrid">
        {rows.map(({ r, res }) => {
          const comp = scoreOf(r, res.kind)
          const tier = tileTierFromScore(comp?.score ?? null)
          return (
            <div className={`obcell${res.kind === 'blank' ? ' blank' : ''}`} key={r.label}>
              <span className="lbl">{r.label}</span>
              <span className="obval num" style={{ color: res.kind === 'blank' ? 'var(--faint)' : TIER_COLOR[tier] }}>
                {res.text}{r.unit && res.kind !== 'blank' && <i className="u">{r.unit}</i>}
                {comp && (
                  <span className={`obscore t-${tier}`} title={`NEWS2 · ${comp.label}: ${comp.detail} → scores ${comp.score}`}>
                    {comp.score}
                  </span>
                )}
              </span>
              {res.kind === 'real' && <span className="obmeta num">{res.time} · {res.source}</span>}
              {res.kind === 'demo' && <span className="obmeta demo">demo snapshot</span>}
              {res.kind === 'blank' && <span className="obmeta">not charted</span>}
            </div>
          )
        })}
      </div>
      <div className="obcfoot">
        <span>
          Latest charted bedside observations — a value with no real observation stays blank.
          Value colour = its NEWS2 parameter score (0 neutral · 1–2 amber · 3 red, shown as the chip);
          unscored readings are plain. Live waveforms return with device integration.
        </span>
        <button className="obclink" onClick={() => navigate(`/observations/${patientId}`)}>
          Chart / flowsheet →
        </button>
      </div>
    </Card>
  )
}
