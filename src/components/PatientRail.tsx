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
 *  (Orders, Labs & Imaging, Lab Entry, Timeline, AI Assistant).
 *  ALWAYS BED-SORTED: the roster read arrives in patient-record order
 *  (seeded patients first, new admissions appended), so a patient admitted
 *  into a freed low bed landed at the BOTTOM of the rail — clinicians
 *  navigate by bed, and an out-of-order rail loses patients. Sorting here,
 *  in the shared component, fixes every rail screen at once (#94). */
export function PatientRail<T extends RailPatient>({
  patients, selectedId, onSelect, badge, accent = 'blue', title = 'Patients',
}: PatientRailProps<T>) {
  const byBed = [...(patients ?? [])].sort((a, b) =>
    a.bedId.localeCompare(b.bedId, undefined, { numeric: true }))
  return (
    <aside className={`ptrail${accent === 'violet' ? ' accent-violet' : ''}`} aria-label={title}>
      <div className="ptrailhead">{title}</div>
      <div className="ptraillist">
        {byBed.map(p => (
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
