import { useEffect, useRef, useState } from 'react'
import { correctPatientIdentity } from '../../lib/api'
import type { PatientIdentity } from '../../lib/api/types'
import { displayStamp } from '../../lib/time'

/* IDENTITY CORRECTION (Structured Patient Name + National ID §3) — the
 * audited, amend-never-erase identity event, REQUIRED by the
 * unknown-patient decision: the family arrives and the patient gets a
 * name; typos must be fixable. Office-Administrator authority
 * (identity.correct — registration work, not clinical data). The form
 * pre-fills the current identity; correcting the name requires the
 * complete structured set (first/second/family); the reason is always
 * required; the PREVIOUS identity is preserved and visible in the
 * append-only history below the form. */
export function IdentityDialog(
  { patient, onCancel, onCorrected }:
  { patient: PatientIdentity; onCancel: () => void; onCorrected: (updated: PatientIdentity) => void },
) {
  const [first, setFirst] = useState(patient.nameFirst ?? '')
  const [second, setSecond] = useState(patient.nameSecond ?? '')
  const [third, setThird] = useState(patient.nameThird ?? '')
  const [fourth, setFourth] = useState(patient.nameFourth ?? '')
  const [family, setFamily] = useState(patient.nameFamily ?? '')
  const [nationalId, setNationalId] = useState(patient.nationalId ?? '')
  const [dob, setDob] = useState(patient.dateOfBirth ?? '')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const firstRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    firstRef.current?.focus()
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onCancel])

  const nameTouched = !!(first.trim() || second.trim() || third.trim() || fourth.trim() || family.trim())
  const nameComplete = !!(first.trim() && second.trim() && family.trim())

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (nameTouched && !nameComplete) {
      setError('Correcting the name requires First, Second and Family (Third/Fourth optional)')
      return
    }
    setBusy(true)
    const res = await correctPatientIdentity(patient.patientId, {
      ...(nameTouched ? {
        nameFirst: first.trim(), nameSecond: second.trim(),
        ...(third.trim() ? { nameThird: third.trim() } : {}),
        ...(fourth.trim() ? { nameFourth: fourth.trim() } : {}),
        nameFamily: family.trim(),
      } : {}),
      ...(nationalId.trim() && nationalId.trim() !== patient.nationalId ? { nationalId: nationalId.trim() } : {}),
      ...(dob && dob !== patient.dateOfBirth ? { dateOfBirth: dob } : {}),
      reason: reason.trim(),
    })
    setBusy(false)
    if (res.kind === 'ok') onCorrected(res.data)
    else if (res.kind === 'rejected') setError(res.error)
    else setError('Identity correction requires the live server — nothing was recorded')
  }

  return (
    <div className="idscrim" onClick={onCancel}>
      <div className="iddialog" role="dialog" aria-modal="true" aria-labelledby="idTitle" onClick={e => e.stopPropagation()}>
        <h2 id="idTitle">Correct patient identity · <span className="num">{patient.patientId}</span></h2>
        <p className="idnote">
          A serious, audited identity event — the previous identity is preserved and stays visible
          in the history below (amend, never erase). Current record: <b>{patient.fullName ?? patient.name}</b>
          {patient.nationalId ? <> · ID <span className="num">{patient.nationalId}</span></> : ' · no national ID recorded'}
        </p>
        <form onSubmit={submit}>
          <div className="idgrid">
            <label>First name
              <input ref={firstRef} value={first} onChange={e => setFirst(e.target.value)} placeholder={patient.nameFirst ?? 'e.g. Ali'} />
            </label>
            <label>Second name (father)
              <input value={second} onChange={e => setSecond(e.target.value)} placeholder={patient.nameSecond ?? 'e.g. Hassan'} />
            </label>
            <label>Third name (grandfather) <i>optional</i>
              <input value={third} onChange={e => setThird(e.target.value)} />
            </label>
            <label>Fourth name <i>optional</i>
              <input value={fourth} onChange={e => setFourth(e.target.value)} />
            </label>
            <label>Family / tribal name
              <input value={family} onChange={e => setFamily(e.target.value)} placeholder={patient.nameFamily ?? 'e.g. Al-Janabi'} />
            </label>
            <label>National identity number <i>as on the card</i>
              <input value={nationalId} onChange={e => setNationalId(e.target.value)} />
            </label>
            <label>Date of birth <i>correctable once known — audited</i>
              <input type="date" value={dob} onChange={e => setDob(e.target.value)} />
            </label>
            <label className="idwide">Reason (required)
              <textarea value={reason} onChange={e => setReason(e.target.value)}
                placeholder="e.g. family arrived and identified the patient — identity card presented" />
            </label>
          </div>
          {error && <div className="iderr" role="alert">{error}</div>}
          <div className="idfoot">
            <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
            <button type="submit" className="btn primary" disabled={busy || !reason.trim()}>
              {busy ? 'Recording…' : '✎ Record identity correction'}
            </button>
          </div>
        </form>
        {(patient.identity?.length ?? 0) > 0 && (
          <div className="idhist">
            <div className="idhttl">Identity history — previous identities preserved</div>
            {patient.identity!.map((e, i) => (
              <div className="idhrow" key={i}>
                <span className="num">{displayStamp(e.time)}</span>
                <span className="idha">{e.actor} · {e.role}</span>
                <span className="idhd">{e.detail} — {e.reason}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
