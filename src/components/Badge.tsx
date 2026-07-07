import type { ReactNode } from 'react'
import './Badge.css'

export type BadgeColor = 'blue' | 'green' | 'amber' | 'red'

export function Badge({ color, id, children }: { color: BadgeColor; id?: string; children: ReactNode }) {
  return <span id={id} className={`badge ${color}`}>{children}</span>
}
