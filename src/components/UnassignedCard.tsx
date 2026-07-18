import { useNavigate } from 'react-router-dom'
import './UnassignedCard.css'
import { Card } from './Card'
import { BedChip } from './Tag'
import { SeverityDot } from './SeverityDot'
import { IconAlertTriangle } from './icons'
import type { UnassignedPatient } from '../lib/api/types'

/** The UNASSIGNED panel (Patient Assignment & Responsibility §7 — the
 *  P-1191 failure made structural): every open encounter with no active
 *  nurse (or doctor). Zero assignments is ALLOWED — a newly admitted
 *  patient is honestly unassigned (no auto-assignment: Attending is free
 *  text and registration may be clerical) — but it must be VISIBLE so no
 *  patient silently falls through. Rendered on the bed board and both
 *  workspaces (a unit-level safety view, not a per-user one). */
export function UnassignedCard({ kind, patients }: { kind: 'nurse' | 'doctor'; patients: UnassignedPatient[] }) {
  const navigate = useNavigate()
  return (
    <Card
      icon={<IconAlertTriangle size={15} stroke={patients.length ? 'var(--amber)' : 'var(--green)'} />}
      title={`Unassigned — no ${kind}`}
      aside={patients.length ? `${patients.length} patient${patients.length === 1 ? '' : 's'}` : 'none'}
    >
      {patients.length === 0 ? (
        <div className="unempty">Every open encounter has an active {kind} assigned.</div>
      ) : (
        <div className="unlist" role="list">
          {patients.map(p => (
            <button
              key={p.patientId}
              className="unrow"
              role="listitem"
              aria-label={`Open chart ${p.name}, bed ${p.bedId} — no ${kind} assigned`}
              onClick={() => navigate(`/patients/${p.patientId}`)}
            >
              <BedChip bedId={p.bedId} />
              <SeverityDot sev={p.severity} />
              <span className="unname">{p.name}</span>
              <span className="undx">{p.diagnosis}</span>
              <span className="ungo">Assign →</span>
            </button>
          ))}
        </div>
      )}
    </Card>
  )
}
