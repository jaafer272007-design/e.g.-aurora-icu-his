import { useNavigate } from 'react-router-dom'
import { Card } from '../../components/Card'
import { Badge } from '../../components/Badge'
import { IconPulse } from '../../components/icons'
import type { LatestObservation } from '../../lib/api/bedside'
import type { MonitorVitals } from '../../lib/api/types'

/* §12 step 4, decision F5(a): in the manual-charting era the bedside
   display is a LATEST CHARTED OBSERVATIONS card — real values with their
   clinical time and source badge. No waveforms, no jitter, no STREAMING
   badge: the animated monitor returns with the Device Adapter, when a
   genuinely streaming source exists (presentation tracks the real
   source). Value resolution per reading (F9): a real charted observation
   (time + source shown) → the demo snapshot in demo-seeded environments
   (tagged DEMO) → an honest "not charted". */

interface Reading {
  label: string
  unit: string
  color: string
  /** observation typeCodes joined with '/' (BP pairs) */
  codes: string[]
  /** the roster-merged fallback fields (real-else-demo-else-null server-side) */
  keys: (keyof MonitorVitals)[]
  big?: boolean
}

const READINGS: Reading[] = [
  { label: 'Heart Rate', unit: 'bpm', color: 'var(--green)', codes: ['hr'], keys: ['hr'], big: true },
  { label: 'Arterial BP', unit: 'mmHg', color: 'var(--red)', codes: ['art_sbp', 'art_dbp'], keys: ['sys', 'dia'] },
  { label: 'MAP', unit: 'mmHg', color: 'var(--red)', codes: ['map'], keys: ['map'], big: true },
  { label: 'NIBP', unit: 'mmHg', color: 'var(--red)', codes: ['sbp', 'dbp'], keys: ['nibpSys', 'nibpDia'] },
  { label: 'SpO₂', unit: '%', color: 'var(--cyan)', codes: ['spo2'], keys: ['spo2'], big: true },
  { label: 'Resp Rate', unit: '/min', color: 'var(--amber)', codes: ['rr'], keys: ['rr'] },
  { label: 'Temp', unit: '°C', color: 'var(--text)', codes: ['temp'], keys: ['temp'] },
  { label: 'EtCO₂', unit: 'mmHg', color: 'var(--text)', codes: ['etco2'], keys: ['etco2'] },
  { label: 'CVP', unit: 'mmHg', color: 'var(--violet)', codes: ['cvp'], keys: ['cvp'] },
]

const hm = (clinicalTime: string) => clinicalTime.split(' ')[1] ?? clinicalTime

export function LatestObservationsCard({ latest, vitals, rhythm, patientId }: {
  latest: Map<string, LatestObservation>
  vitals: MonitorVitals
  rhythm: string
  patientId: string
}) {
  const navigate = useNavigate()

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

  /* rhythm arrives roster-MERGED (real-else-demo-else '—'); the latest map
     says whether a real cardiac_rhythm exists */
  const realRhythm = latest.get('cardiac_rhythm')
  const rhythmRes = realRhythm
    ? { text: realRhythm.value, kind: 'real' as const, time: hm(realRhythm.clinicalTime), source: realRhythm.source }
    : rhythm !== '—' ? { text: rhythm, kind: 'demo' as const } : { text: '—', kind: 'blank' as const }

  const rows = [...READINGS.map(r => ({ r, res: resolve(r) })),
    { r: { label: 'Rhythm', unit: '', color: 'var(--green)', codes: [], keys: [] } as Reading, res: rhythmRes }]

  return (
    <Card id="monitor" icon={<IconPulse size={15} stroke="var(--green)" />} title="Latest Charted Observations"
      aside={<Badge color="blue">MANUAL CHARTING</Badge>}>
      <div className="obcgrid">
        {rows.map(({ r, res }) => (
          <div className={`obcell${res.kind === 'blank' ? ' blank' : ''}`} key={r.label}>
            <span className="lbl" style={{ color: r.color }}>{r.label}</span>
            <span className="obval num" style={{ color: res.kind === 'blank' ? 'var(--faint)' : r.color }}>
              {res.text}{r.unit && res.kind !== 'blank' && <i className="u">{r.unit}</i>}
            </span>
            {res.kind === 'real' && <span className="obmeta num">{res.time} · {res.source}</span>}
            {res.kind === 'demo' && <span className="obmeta demo">demo snapshot</span>}
            {res.kind === 'blank' && <span className="obmeta">not charted</span>}
          </div>
        ))}
      </div>
      <div className="obcfoot">
        <span>
          Latest charted bedside observations — a value with no real observation stays blank.
          Live waveforms return with device integration.
        </span>
        <button className="obclink" onClick={() => navigate(`/observations/${patientId}`)}>
          Chart / flowsheet →
        </button>
      </div>
    </Card>
  )
}
