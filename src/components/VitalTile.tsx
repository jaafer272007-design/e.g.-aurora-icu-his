import type { CSSProperties, ReactNode } from 'react'
import './VitalTile.css'

interface VitalTileProps {
  label: ReactNode
  value: ReactNode
  unit?: ReactNode
  /** rt: right-panel tile · mini: monitor substrip · tile: vent/hemo grid · vg: bed-card vital */
  variant?: 'rt' | 'mini' | 'tile' | 'vg'
  warn?: boolean
  valueClass?: string
  valueStyle?: CSSProperties
}

/** Small labelled numeric tile — the k/v stat cell reused across all screens. */
export function VitalTile({ label, value, unit, variant = 'tile', warn, valueClass, valueStyle }: VitalTileProps) {
  return (
    <div className={`vt vt-${variant}${warn ? ' warn' : ''}`}>
      <div className="k">{label}</div>
      <div className={`v${valueClass ? ' ' + valueClass : ''}`} style={valueStyle}>
        {value}
        {unit !== undefined && <small>{unit}</small>}
      </div>
    </div>
  )
}
