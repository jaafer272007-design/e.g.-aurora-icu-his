import { useNavigate } from 'react-router-dom'
import { Card } from '../../components/Card'
import { BedChip, TagList } from '../../components/Tag'
import { SeverityDot } from '../../components/SeverityDot'
import { VitalTile } from '../../components/VitalTile'
import { IconUsers } from '../../components/icons'
import type { AssignedPatient } from '../../lib/api/types'
import { resolveCodeStatus } from '../../lib/codeStatus'
import { useDerivedSeverities } from '../../hooks/usePatientScores'

/* §12 step 4: vitals are the latest charted observations — null = not
   charted → '—', threshold classes silent on a blank (same rule as the
   bed board) */
const hrClass = (v: number | null) => (v === null ? '' : v > 111 ? 'bad' : v > 50 ? 'warn' : '')
const mapClass = (v: number | null) => (v === null ? '' : v < 65 ? 'bad' : v < 70 ? 'warn' : '')
const spo2Class = (v: number | null) => (v === null ? '' : v < 92 ? 'bad' : v < 95 ? 'warn' : '')
const tempClass = (v: number | null) => (v === null ? '' : v >= 38.3 ? 'warn' : '')
const uoClass = (v: number | null) => (v === null ? '' : v < 30 ? 'bad' : v < 50 ? 'warn' : '')

const shown = (v: number | null) => (v === null ? '—' : v)

/** My Patients — the signed-in nurse's OPT-OUT worklist (Assignment
 *  Simplification): every nurse covers every patient by default; the
 *  list is all open patients minus this nurse's carved removals. Empty
 *  only when the unit is empty or every patient was removed from her
 *  focused list — removal never limits what she can ACT on (worklist,
 *  never authority). Cards open Patient Mission Control. */
export function AssignedPatientsCard({ patients }: { patients: AssignedPatient[] }) {
  const navigate = useNavigate()
  /* severity DERIVED from the real scores (worst of {NEWS2 band, SOFA} —
     scoring/display.ts): the card accent + dot restate the computation,
     never a wire/fixture claim (no-reassuring-default rule). Missing =
     still loading -> the neutral unscored presentation. */
  const derived = useDerivedSeverities(patients.map(p => p.patientId))
  return (
    <Card
      icon={<IconUsers size={15} stroke="var(--blue)" />}
      title="My Patients"
      aside={`covering ${patients.length}`}
    >
      <div className="aplist">
        {patients.length === 0 && (
          <div className="apempty">
            Nothing on your focused list — either the unit has no open admissions,
            or every patient was removed from your list (Senior Doctor manages
            coverage from the patient chart). You can still act on any patient in
            an emergency: the list is a worklist, never an authority.
          </div>
        )}
        {patients.map(p => (
          <button
            key={p.patientId}
            className={`apcard sev-${derived[p.patientId]?.severity ?? 'unscored'}`}
            aria-label={`Open chart ${p.name}, bed ${p.bedId}`}
            onClick={() => navigate(`/patients/${p.patientId}`)}
          >
            <div className="apr1">
              <BedChip bedId={p.bedId} />
              <SeverityDot sev={derived[p.patientId]?.severity ?? 'unscored'} />
              <span className="apname">{p.name}<small>{p.age} · {p.sex}</small></span>
              {(() => { const cs = resolveCodeStatus(p); return (
                <span className={`apcode ${cs.kind === 'none' ? 'none' : cs.full ? 'full' : 'dnr'}`}>
                  {cs.label}{cs.kind === 'legacy' ? ' · UNVERIFIED' : ''}
                </span>
              ) })()}
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
