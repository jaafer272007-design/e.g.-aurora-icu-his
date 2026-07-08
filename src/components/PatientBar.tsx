import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import './PatientBar.css'
import { BedChip } from './Tag'

interface PatientBarProps {
  patient: { patientId: string; bedId: string; name: string; mrn: string; age: number; sex: string }
  /** page-specific chips after the identity block — diagnosis, allergies,
      code status, view-only marker, … (shared chip classes in PatientBar.css) */
  children?: ReactNode
  /** cross-screen links, right-aligned */
  links: { label: string; to: string }[]
}

/** Patient identity bar — shared by every patient-scoped screen. */
export function PatientBar({ patient, children, links }: PatientBarProps) {
  const navigate = useNavigate()
  return (
    <div className="ptbar">
      <BedChip bedId={patient.bedId} />
      <b className="ptbarname">{patient.name}</b>
      <span className="ptbarsub num">{patient.mrn} · {patient.age} · {patient.sex}</span>
      {children}
      <div className="ptbarlinks">
        {links.map(l => (
          <button key={l.to} className="ptbarlink" onClick={() => navigate(l.to)}>{l.label}</button>
        ))}
      </div>
    </div>
  )
}
