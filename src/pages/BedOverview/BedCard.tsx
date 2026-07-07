import type { Bed } from '../../lib/api/types'
import { BedChip, TagList } from '../../components/Tag'
import { SeverityDot } from '../../components/SeverityDot'
import { Sparkline } from '../../components/Sparkline'
import { VitalTile } from '../../components/VitalTile'
import { IconAlertTriangle } from '../../components/icons'

interface BedCardProps {
  bed: Bed
  index: number
  /** live-jittered display values (falls back to base vitals) */
  jitter?: { hr: number; map: number; spo2: number }
  onOpen: (bedId: string) => void
}

const scoreColor = (v: number, red: number, amber: number) =>
  v >= red ? 'var(--red)' : v >= amber ? 'var(--amber)' : 'var(--green)'

/* threshold classes are derived from the base (un-jittered) vitals */
const hrClass = (v: number) => (v > 111 ? 'bad' : v > 50 ? 'warn' : '')
const mapClass = (v: number) => (v < 65 ? 'bad' : v < 70 ? 'warn' : '')
const spo2Class = (v: number) => (v < 92 ? 'bad' : v < 95 ? 'warn' : '')
const tempClass = (v: number) => (v >= 38.3 ? 'warn' : '')
const uoClass = (v: number) => (v < 30 ? 'bad' : v < 50 ? 'warn' : '')

export function BedCard({ bed, index, jitter, onOpen }: BedCardProps) {
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
  const shown = jitter ?? { hr: v.hr, map: v.map, spo2: v.spo2 }
  return (
    <button
      className={`bcard sev-${p.severity}`}
      style={delay}
      aria-label={`Open chart ${p.name}`}
      onClick={() => onOpen(bed.bedId)}
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
      <div className="scores">
        <div className="score"><span className="sk">SOFA</span><span className="sv" style={{ color: scoreColor(p.sofa, 10, 6) }}>{p.sofa}</span></div>
        <div className="score"><span className="sk">EWS</span><span className="sv" style={{ color: scoreColor(p.ews, 7, 4) }}>{p.ews}</span></div>
      </div>
      <div className="vgrid">
        <VitalTile variant="vg" label="HR" value={shown.hr} valueClass={hrClass(v.hr)} />
        <VitalTile variant="vg" label="MAP" value={shown.map} valueClass={mapClass(v.map)} />
        <VitalTile variant="vg" label="SpO₂" value={shown.spo2} valueClass={spo2Class(v.spo2)} />
        <VitalTile variant="vg" label="Temp" value={v.temp.toFixed(1)} valueClass={tempClass(v.temp)} />
        <VitalTile variant="vg" label="UO" value={<>{v.uo}<span className="uo-unit">mL/h</span></>} valueClass={uoClass(v.uo)} />
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
