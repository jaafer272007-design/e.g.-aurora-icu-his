import type { ReactNode } from 'react'
import './PatientRail.css'
import { BedChip } from './Tag'

export interface RailPatient {
  patientId: string
  bedId: string
  name: string
}

interface PatientRailProps<T extends RailPatient> {
  patients: T[] | null | undefined
  selectedId: string
  onSelect: (patientId: string) => void
  /** optional right-aligned badge per patient (pending count, unacked count, risk %, …) */
  badge?: (p: T) => ReactNode
  /** selection accent — AI Assistant uses violet */
  accent?: 'blue' | 'violet'
  title?: string
}

/** Patient switcher rail — shared by every patient-scoped screen
 *  (Orders, Labs & Imaging, Timeline, AI Assistant). */
export function PatientRail<T extends RailPatient>({
  patients, selectedId, onSelect, badge, accent = 'blue', title = 'Patients',
}: PatientRailProps<T>) {
  return (
    <aside className={`ptrail${accent === 'violet' ? ' accent-violet' : ''}`} aria-label={title}>
      <div className="ptrailhead">{title}</div>
      <div className="ptraillist">
        {patients?.map(p => (
          <button
            key={p.patientId}
            className={`ptrailcard${p.patientId === selectedId ? ' sel' : ''}`}
            aria-current={p.patientId === selectedId ? 'page' : undefined}
            onClick={() => onSelect(p.patientId)}
          >
            <BedChip bedId={p.bedId} />
            <span className="prname">{p.name}</span>
            {badge?.(p)}
          </button>
        ))}
      </div>
    </aside>
  )
}
