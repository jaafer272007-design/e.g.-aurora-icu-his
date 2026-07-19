import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import type { MatchPatientResponse } from '../../lib/api/types'
import { displayStamp } from '../../lib/time'

/* THE MATCH DIALOG (match+overview design §3) — shown when the on-submit
 * identity check finds an existing patient. NOTHING has been created
 * when this renders, and nothing is ever created or merged from here
 * without an explicit human action (no auto-merge, ever).
 * SAME WINDOW, CONTENT BY ROLE (locked decision 1): the card is
 * identity-only — the office Administrator sees exactly this and nothing
 * clinical; the History Overview button renders for clinicians only
 * (results.view). The national ID arrives MASKED to its last 4 digits —
 * the server never sends the full number to this dialog.
 * GUARDS: a currently ADMITTED patient gets no Readmit — the bed and
 * "Open Current Admission" instead (a duplicate-encounter safety guard,
 * mirrored by the server's open-encounter 409). A DECEASED patient
 * (latest disposition 'died', #96) gets no Readmit either — a wrong
 * death record is an audited record correction, never a readmit; the
 * server enforces the same rule with a 409.
 * Tier B additionally offers "create new patient" — the design's
 * verify-before-creating implies creating stays possible once a human
 * has verified this is a DIFFERENT person (two men named أحمد محمد علي
 * born the same day are the design's own motivating case). */
export function MatchDialog(
  { result, canAdmit, canOverview, busy, error, onReadmit, onCreateAnyway, onClose }:
  {
    result: MatchPatientResponse
    canAdmit: boolean
    canOverview: boolean
    busy: boolean
    error: string | null
    onReadmit: (patientId: string) => void
    onCreateAnyway: () => void
    onClose: () => void
  },
) {
  const navigate = useNavigate()
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])

  const confirmed = result.tier === 'confirmed'
  return (
    <div className="mtscrim" onClick={onClose}>
      <div className="mtdialog" role="dialog" aria-modal="true" aria-labelledby="mtTitle" onClick={e => e.stopPropagation()}>
        <h2 id="mtTitle">{confirmed ? 'Patient already exists.' : 'Possible existing patient.'}</h2>
        <p className="mtnote">
          {confirmed
            ? 'The submitted identifier is unique and matches this record — nothing was created.'
            : 'Please verify identity before creating a new record — a name and date of birth can belong to two different people. Nothing was created.'}
        </p>
        {result.matches.map(m => (
          <div className="mtcard" key={m.patientId}>
            <div className="mtname">{m.fullName} <span className="num mtpid">{m.patientId}</span></div>
            <div className="mtrows">
              <span>MRN <b className="num">{m.mrn}</b></span>
              <span>{m.nationalIdLast4 == null
                ? <i>no national ID recorded</i>
                : m.nationalIdLast4 === ''
                  /* recorded but too short to mask — the server never
                     sends a maskable-length value in full */
                  ? <i>national ID recorded — too short to display masked</i>
                  : <>National ID <b className="num">···· {m.nationalIdLast4}</b></>}</span>
              {m.fileNumber != null && <span>File no. <b className="num">{m.fileNumber}</b></span>}
              <span>{m.age} y{m.ageSource === 'recordedAtAdmission' && <i> (estimated)</i>} · {m.sex === 'M' ? 'Male' : 'Female'}</span>
              <span>Last admission <b className="num">{m.lastAdmission ? displayStamp(m.lastAdmission) : '—'}</b></span>
              <span>Admissions <b className="num">{m.admissionCount}</b></span>
              <span className={`mtstatus ${m.status}`}>{
                m.status === 'admitted' ? 'Admitted' : m.status === 'deceased' ? 'Deceased' : 'Discharged'}</span>
            </div>
            {m.status === 'admitted' && (
              <div className="mtguard" role="note">
                ⚠️ Patient is currently admitted to Bed {m.currentBedId} — a second open encounter
                cannot be started.
              </div>
            )}
            {m.status === 'deceased' && (
              <div className="mtguard mtdead" role="note">
                This patient is recorded as deceased. A deceased patient cannot be re-admitted —
                a wrong death record is corrected through the audited record, never through admission.
              </div>
            )}
            <div className="mtcardfoot">
              {canOverview && (
                <button className="btn ghost" onClick={() => navigate(`/patients/${m.patientId}/history`)}>
                  📄 Patient History Overview
                </button>
              )}
              {m.status === 'admitted' && (
                <button className="btn primary" onClick={() => navigate(`/patients/${m.patientId}`)}>
                  Open Current Admission
                </button>
              )}
              {m.status === 'discharged' && canAdmit && (
                <button className="btn primary" disabled={busy} onClick={() => onReadmit(m.patientId)}>
                  🏥 Start New Encounter / Readmit
                </button>
              )}
            </div>
          </div>
        ))}
        {error && <div className="mterr" role="alert">{error}</div>}
        <div className="mtfoot">
          {/* Tier B only — after HUMAN verification that this is a
              different person; a Tier A hit is definitive, so creating a
              duplicate is never offered there */}
          {!confirmed && canAdmit && (
            <button className="btn ghost" disabled={busy} onClick={onCreateAnyway}>
              Verified different person — create new patient
            </button>
          )}
          <button className="btn ghost" onClick={onClose}>❌ Cancel</button>
        </div>
      </div>
    </div>
  )
}
