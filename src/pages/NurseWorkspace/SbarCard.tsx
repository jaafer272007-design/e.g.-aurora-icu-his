import { useState } from 'react'
import { Card } from '../../components/Card'
import { IconNote } from '../../components/icons'
import type { AssignedPatient } from '../../lib/api/types'

export interface SbarNote {
  s: string
  b: string
  a: string
  r: string
}

const EMPTY: SbarNote = { s: '', b: '', a: '', r: '' }

const FIELDS: { key: keyof SbarNote; label: string; placeholder: string }[] = [
  { key: 's', label: 'S — Situation', placeholder: 'Current status, active problems right now…' },
  { key: 'b', label: 'B — Background', placeholder: 'Admission reason, relevant history, devices/lines…' },
  { key: 'a', label: 'A — Assessment', placeholder: 'Your read: trends, response to therapy, concerns…' },
  { key: 'r', label: 'R — Recommendation', placeholder: 'What the next shift must watch / do / chase…' },
]

interface SbarCardProps {
  patients: AssignedPatient[]
  notes: Record<string, SbarNote>
  onSave: (patientId: string, note: SbarNote) => void
}

/** Shift handoff — structured SBAR note per assigned patient. */
export function SbarCard({ patients, notes, onSave }: SbarCardProps) {
  const [patientId, setPatientId] = useState(patients[0]?.patientId ?? '')
  const pid = patientId || patients[0]?.patientId
  const [draft, setDraft] = useState<SbarNote>(notes[pid] ?? EMPTY)

  const switchPatient = (id: string) => {
    setPatientId(id)
    setDraft(notes[id] ?? EMPTY)
  }

  return (
    <Card
      icon={<IconNote size={15} stroke="var(--violet)" />}
      title="Shift Handoff · SBAR"
      aside="due before 19:00"
    >
      <div className="field">
        <label htmlFor="sbarPatient">Patient</label>
        <select id="sbarPatient" value={pid} onChange={e => switchPatient(e.target.value)}>
          {patients.map(p => <option key={p.patientId} value={p.patientId}>{p.name} — {p.bedId}</option>)}
        </select>
      </div>
      {FIELDS.map(f => (
        <div className="field" key={f.key}>
          <label htmlFor={`sbar-${f.key}`}>{f.label}</label>
          <textarea
            id={`sbar-${f.key}`}
            className="sbarta"
            placeholder={f.placeholder}
            value={draft[f.key]}
            onChange={e => setDraft(d => ({ ...d, [f.key]: e.target.value }))}
          />
        </div>
      ))}
      <button className="btn primary sbarsave" onClick={() => onSave(pid, draft)}>Save Handoff Note</button>
    </Card>
  )
}
