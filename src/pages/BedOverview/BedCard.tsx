import type { Bed } from '../../lib/api/types'
import type { PatientScores } from '../../hooks/usePatientScores'
import { resolveCodeStatus } from '../../lib/codeStatus'
import { BedChip, TagList } from '../../components/Tag'
import { SeverityDot } from '../../components/SeverityDot'
import { Sparkline } from '../../components/Sparkline'
import { VitalTile } from '../../components/VitalTile'
import { IconAlertTriangle } from '../../components/icons'
import { News2Pill } from '../../components/News2Pill'

interface BedCardProps {
  bed: Bed
  index: number
  /** the shared score computation for this bed's patient (undefined =
   *  still loading → the neutral unscored presentation, never a verdict) */
  scores: PatientScores | undefined
  onOpen: (patientId: string) => void
}

/* §12 step 4: vitals are the LATEST CHARTED observations (or the demo
   snapshot in demo-seeded environments) — displayed as charted, no live
   jitter (a static value presented as a moving one is a fabricated
   stream; the honest-data rule, decision F5). null = not charted → '—',
   and threshold classes stay silent on a blank.

   SEVERITY is DERIVED from the real scores (worst of {NEWS2 band, SOFA} —
   scoring/display.ts): the card accent, the dot and the sparkline colour
   all restate the same computation the NEWS2 pill shows. The old wire /
   fixture severity is retired (no-reassuring-default rule) — green
   appears only when a complete score earned it. The per-vital classes
   below are warning-direction accents only ('' = plain, never green). */
const hrClass = (v: number | null) => (v === null ? '' : v > 111 ? 'bad' : v > 50 ? 'warn' : '')
const mapClass = (v: number | null) => (v === null ? '' : v < 65 ? 'bad' : v < 70 ? 'warn' : '')
const spo2Class = (v: number | null) => (v === null ? '' : v < 92 ? 'bad' : v < 95 ? 'warn' : '')
const tempClass = (v: number | null) => (v === null ? '' : v >= 38.3 ? 'warn' : '')
const uoClass = (v: number | null) => (v === null ? '' : v < 30 ? 'bad' : v < 50 ? 'warn' : '')

const shown = (v: number | null) => (v === null ? '—' : v)

export function BedCard({ bed, index, scores, onOpen }: BedCardProps) {
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
  const sev = scores?.severity ?? 'unscored'
  const trendColor = sev === 'crit' ? 'var(--red)' : sev === 'high' ? 'var(--amber)'
    : sev === 'stable' ? 'var(--green)' : 'var(--dim)'
  const v = p.vitals
  return (
    <button
      className={`bcard sev-${sev}`}
      style={delay}
      aria-label={`Open chart ${p.name}`}
      onClick={() => onOpen(p.patientId)}
    >
      <div className="brow1">
        <BedChip bedId={bed.bedId} />
        <SeverityDot sev={sev} />
        <span className="los">ICU D{p.los} · {bed.area}</span>
        {(() => { const cs = resolveCodeStatus(p); return (
          <span className={`codechip ${cs.kind === 'none' ? 'none' : cs.full ? 'full' : 'dnr'}`}>
            {cs.label}{cs.kind === 'legacy' ? ' · UNVERIFIED' : ''}
          </span>
        ) })()}
      </div>
      <div className="bname">{p.name}<small>{p.age} · {p.sex}</small></div>
      <div className="bdx">{p.diagnosis}</div>
      <div className="btags"><TagList flags={p.flags} iso={p.isolation} /></div>
      {/* Real computed NEWS2 (the bedside early-warning score) — the SAME
          computation the dot/accent derive from (one fetch, one truth).
          Display-only band colour, no alerts. SOFA lives on the patient
          page and contributes to the derived severity. */}
      <div className="scores"><News2Pill state={scores?.state ?? 'loading'} news2={scores?.news2 ?? null} /></div>
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
