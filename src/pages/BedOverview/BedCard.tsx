import type { Bed } from '../../lib/api/types'
import { BedChip, TagList } from '../../components/Tag'
import { SeverityDot } from '../../components/SeverityDot'
import { Sparkline } from '../../components/Sparkline'
import { VitalTile } from '../../components/VitalTile'
import { IconAlertTriangle } from '../../components/icons'
import { News2Pill } from '../../components/News2Pill'

interface BedCardProps {
  bed: Bed
  index: number
  onOpen: (patientId: string) => void
}

/* §12 step 4: vitals are the LATEST CHARTED observations (or the demo
   snapshot in demo-seeded environments) — displayed as charted, no live
   jitter (a static value presented as a moving one is a fabricated
   stream; the honest-data rule, decision F5). null = not charted → '—',
   and threshold classes stay silent on a blank. */
const hrClass = (v: number | null) => (v === null ? '' : v > 111 ? 'bad' : v > 50 ? 'warn' : '')
const mapClass = (v: number | null) => (v === null ? '' : v < 65 ? 'bad' : v < 70 ? 'warn' : '')
const spo2Class = (v: number | null) => (v === null ? '' : v < 92 ? 'bad' : v < 95 ? 'warn' : '')
const tempClass = (v: number | null) => (v === null ? '' : v >= 38.3 ? 'warn' : '')
const uoClass = (v: number | null) => (v === null ? '' : v < 30 ? 'bad' : v < 50 ? 'warn' : '')

const shown = (v: number | null) => (v === null ? '—' : v)

export function BedCard({ bed, index, onOpen }: BedCardProps) {
  const delay = { animationDelay: `${index * 40}ms` }
  if (!bed.patient) {
    return (
      <div className="bcard empty" style={delay}>
        <BedChip bedId={bed.bedId} />
        <span className="eb">Bed Available</span>
        <span className="ready">✓ Cleaned · Ready</span>
      </div>
    )
  }
  const p = bed.patient
  const trendColor = p.severity === 'crit' ? 'var(--red)' : p.severity === 'high' ? 'var(--amber)' : 'var(--green)'
  const v = p.vitals
  return (
    <button
      className={`bcard sev-${p.severity}`}
      style={delay}
      aria-label={`Open chart ${p.name}`}
      onClick={() => onOpen(p.patientId)}
    >
      <div className="brow1">
        <BedChip bedId={bed.bedId} />
        <SeverityDot sev={p.severity} />
        <span className="los">ICU D{p.los} · {bed.area}</span>
        <span className={`codechip ${p.codeStatus.startsWith('Full') ? 'full' : 'dnr'}`}>{p.codeStatus}</span>
      </div>
      <div className="bname">{p.name}<small>{p.age} · {p.sex}</small></div>
      <div className="bdx">{p.diagnosis}</div>
      <div className="btags"><TagList flags={p.flags} iso={p.isolation} /></div>
      {/* Real computed NEWS2 (the bedside early-warning score) — replaces
          the fabricated SOFA/EWS chips. Display-only band colour, no alerts.
          SOFA (organ dysfunction) lives on the patient page. */}
      <div className="scores"><News2Pill patientId={p.patientId} /></div>
      <div className="vgrid">
        <VitalTile variant="vg" label="HR" value={shown(v.hr)} valueClass={hrClass(v.hr)} />
        <VitalTile variant="vg" label="MAP" value={shown(v.map)} valueClass={mapClass(v.map)} />
        <VitalTile variant="vg" label="SpO₂" value={shown(v.spo2)} valueClass={spo2Class(v.spo2)} />
        <VitalTile variant="vg" label="Temp" value={v.temp === null ? '—' : v.temp.toFixed(1)} valueClass={tempClass(v.temp)} />
        <VitalTile variant="vg" label="UO" value={v.uo === null ? '—' : <>{v.uo}<span className="uo-unit">mL</span></>} valueClass={uoClass(v.uo)} />
      </div>
      <div className={`balert ${p.alert.severity === 'crit' ? 'crit' : p.alert.severity === 'high' ? 'high' : ''}`}>
        <IconAlertTriangle size={12} strokeWidth={2.2} />
        <span>{p.alert.message}</span>
      </div>
      <div className="bfoot">
        <span>{p.attending}</span>
        <Sparkline data={p.mapTrend} color={trendColor} />
      </div>
    </button>
  )
}
