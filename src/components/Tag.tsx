import './Tag.css'
import type { SupportFlag } from '../lib/api/types'

const FLAG_LABEL: Record<string, string> = {
  vent: 'Vent',
  pressor: 'Pressor',
  crrt: 'CRRT',
  ecmo: 'ECMO',
  iso: 'Isolation',
}

interface TagProps {
  flag: SupportFlag | 'iso'
  /** 'sm' is the compact rounding-list variant (Doctor Workspace). */
  size?: 'md' | 'sm'
}

/** Support/therapy flag pill (Vent / Pressor / CRRT / ECMO / Isolation). */
export function Tag({ flag, size = 'md' }: TagProps) {
  return <span className={`${size === 'sm' ? 'tag tag-sm' : 'tag'} ${flag}`}>{FLAG_LABEL[flag] ?? flag.toUpperCase()}</span>
}

export function TagList({ flags, iso, size }: { flags: readonly (SupportFlag | 'iso')[]; iso?: boolean; size?: 'md' | 'sm' }) {
  return (
    <>
      {flags.map(f => <Tag key={f} flag={f} size={size} />)}
      {iso && <Tag flag="iso" size={size} />}
    </>
  )
}

/** Mono bed-number chip (B-01 …). */
export function BedChip({ bedId, className }: { bedId: string; className?: string }) {
  return <span className={className ?? 'bedchip'}>{bedId}</span>
}
