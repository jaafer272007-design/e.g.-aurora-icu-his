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

/** Mono bed-number chip (B-01 …) — with an EXPLICIT empty rendering.
 *  Reception opens episodes with NO bed (ward design; "" is how the model
 *  spells it), and this is the shared renderer for roughly ten call sites —
 *  an empty chip at any of them read as a blank, not as a fact. A bedless
 *  patient shows "Awaiting bed" IN WORDS (ward.md A5's wording rule),
 *  visually distinct from a bed id so it can never be mistaken for one.
 *  Never a fabricated placeholder bed — the words state the truth. */
export function BedChip({ bedId, className }: { bedId: string; className?: string }) {
  if (bedId === '') return <span className={`${className ?? 'bedchip'} bedchip-awaiting`}>Awaiting bed</span>
  return <span className={className ?? 'bedchip'}>{bedId}</span>
}
