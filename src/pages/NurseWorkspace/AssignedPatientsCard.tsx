import { useNavigate } from 'react-router-dom'
import { Card } from '../../components/Card'
import { BedChip, TagList } from '../../components/Tag'
import { SeverityDot } from '../../components/SeverityDot'
import { VitalTile } from '../../components/VitalTile'
import { IconUsers } from '../../components/icons'
import type { AssignedPatient } from '../../lib/api/types'

/* §12 step 4: vitals are the latest charted observations — null = not
   charted → '—', threshold classes silent on a blank (same rule as the
   bed board) */
const hrClass = (v: number | null) => (v === null ? '' : v > 111 ? 'bad' : v > 50 ? 'warn' : '')
const mapClass = (v: number | null) => (v === null ? '' : v < 65 ? 'bad' : v < 70 ? 'warn' : '')
const spo2Class = (v: number | null) => (v === null ? '' : v < 92 ? 'bad' : v < 95 ? 'warn' : '')
const tempClass = (v: number | null) => (v === null ? '' : v >= 38.3 ? 'warn' : '')
const uoClass = (v: number | null) => (v === null ? '' : v < 30 ? 'bad' : v < 50 ? 'warn' : '')

const shown = (v: number | null) => (v === null ? '—' : v)

/** My Assigned Patients — 1–2 patients (real ICU nurse:patient ratio).
 *  Cards open Patient Mission Control by stable PatientID. */
export function AssignedPatientsCard({ patients }: { patients: AssignedPatient[] }) {
  const navigate = useNavigate()
  return (
    <Card
      icon={<IconUsers size={15} stroke="var(--blue)" />}
      title="My Assigned Patients"
      aside={`${patients.length} of 2 · this shift`}
    >
      <div className="aplist">
        {patients.map(p => (
          <button
            key={p.patientId}
            className={`apcard sev-${p.severity}`}
            aria-label={`Open chart ${p.name}, bed ${p.bedId}`}
            onClick={() => navigate(`/patients/${p.patientId}`)}
          >
            <div className="apr1">
              <BedChip bedId={p.bedId} />
              <SeverityDot sev={p.severity} />
              <span className="apname">{p.name}<small>{p.age} · {p.sex}</small></span>
              <span className={`apcode ${p.codeStatus.startsWith('Full') ? 'full' : 'dnr'}`}>{p.codeStatus}</span>
            </div>
            <div className="apdx">{p.diagnosis}</div>
            <div className="aprow2">
              <span className="apallergy">⚠ Allergy: {p.allergies}</span>
              <span className="aptags"><TagList flags={p.flags} iso={p.isolation} size="sm" /></span>
            </div>
            <div className="apvitals">
              <VitalTile variant="vg" label="HR" value={shown(p.vitals.hr)} valueClass={hrClass(p.vitals.hr)} />
              <VitalTile variant="vg" label="MAP" value={shown(p.vitals.map)} valueClass={mapClass(p.vitals.map)} />
              <VitalTile variant="vg" label="SpO₂" value={shown(p.vitals.spo2)} valueClass={spo2Class(p.vitals.spo2)} />
              <VitalTile variant="vg" label="Temp" value={p.vitals.temp === null ? '—' : p.vitals.temp.toFixed(1)} valueClass={tempClass(p.vitals.temp)} />
              <VitalTile variant="vg" label="UO" value={shown(p.vitals.uo)} valueClass={uoClass(p.vitals.uo)} />
            </div>
            <div className="apfoot">Open Mission Control →</div>
          </button>
        ))}
      </div>
    </Card>
  )
}
