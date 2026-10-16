import { useState } from 'react'
import { IoPanel } from '../../features/nurse-care/IoPanel'
import type { AssignedPatient } from '../../lib/api/types'

interface IoCardProps {
  patients: AssignedPatient[]
}

/** Intake & Output in the Nurse Workspace: the shared I&O panel (latest
 *  manually entered values, persisted — src/features/nurse-care/IoPanel.tsx)
 *  for the patient chosen here. The patient chart shows the same panel with
 *  its patient fixed. Replaces the demo-only worksheet (shift totals of
 *  entries that were never saved). */
export function IoCard({ patients }: IoCardProps) {
  const [chosen, setChosen] = useState('')
  /* the choice survives the poll's fresh worklist while that patient is on it */
  const patientId = patients.some(p => p.patientId === chosen) ? chosen : patients[0]?.patientId ?? ''
  if (!patientId) return null
  return (
    <IoPanel
      patientId={patientId}
      idPrefix="nwio"
      toolbar={
        <div className="field iopick">
          <label htmlFor="nwioPatient">Patient</label>
          <select id="nwioPatient" value={patientId} onChange={e => setChosen(e.target.value)}>
            {patients.map(p => <option key={p.patientId} value={p.patientId}>{p.name} — {p.bedId || 'awaiting bed'}</option>)}
          </select>
        </div>
      }
    />
  )
}
