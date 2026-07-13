import { useEffect, useState } from 'react'
import { Card } from '../../components/Card'
import { getPatientIdentity, updatePatientMeasurements } from '../../lib/api'
import type { PatientIdentity } from '../../lib/api/types'
import { bmi, bsaMostellerM2, ibwDevineKg } from '../../lib/anthropometrics'
import { getSession, hasPermission } from '../../lib/session'

/** Patient Weight & Height (the clinical validator's design) — PERSON-LEVEL
 *  attributes on the patient record, NOT observations: ICU patients aren't
 *  weighed daily, so this is the recorded reference weight (kg) / height
 *  (cm) used for dosing and SOFA (µg/kg/min). Captured at admission,
 *  addable here when omitted, correctable here with amend-not-erase
 *  history (who/when/prior — a value that drives dosing is never silently
 *  overwritten). BMI / IBW (Devine) / BSA (Mosteller) are DERIVED AT
 *  RENDER from weight+height and hidden while an input is missing —
 *  honest-data, no fabricated BMI.
 *
 *  Reads the REAL patient-identity endpoint (real-only, like the print
 *  selectors): in pure mock/offline mode the card renders nothing — there
 *  is no mock store behind this domain, and inventing one would fabricate
 *  clinical data. */
export function WeightHeightCard({ patientId }: { patientId: string }) {
  const session = getSession()
  const canMeasure = session != null && hasPermission(session.jobTitle, 'patients.measure')

  const [identity, setIdentity] = useState<PatientIdentity | null>(null)
  const [editing, setEditing] = useState(false)
  const [wInput, setWInput] = useState('')
  const [hInput, setHInput] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let stale = false
    setIdentity(null)
    setEditing(false)
    setShowHistory(false)
    setErr(null)
    if (!patientId) return
    getPatientIdentity(patientId).then(p => { if (!stale) setIdentity(p) })
    return () => { stale = true }
  }, [patientId])

  if (!identity) return null

  const derivedBmi = bmi(identity.weightKg, identity.heightCm)
  const derivedIbw = ibwDevineKg(identity.sex, identity.heightCm)
  const derivedBsa = bsaMostellerM2(identity.weightKg, identity.heightCm)
  const history = identity.measurements ?? []
  const hasAny = identity.weightKg != null || identity.heightCm != null

  function openEditor() {
    setWInput(identity?.weightKg != null ? String(identity.weightKg) : '')
    setHInput(identity?.heightCm != null ? String(identity.heightCm) : '')
    setErr(null)
    setEditing(true)
  }

  async function save() {
    if (!identity) return
    setErr(null)
    const draft: { weightKg?: number; heightCm?: number } = {}
    if (wInput.trim()) {
      const w = Number(wInput)
      if (!Number.isFinite(w) || w < 0.5 || w > 500) { setErr('Weight must be a number between 0.5 and 500 kg'); return }
      if (w !== identity.weightKg) draft.weightKg = w
    }
    if (hInput.trim()) {
      const h = Number(hInput)
      if (!Number.isFinite(h) || h < 30 || h > 260) { setErr('Height must be a number between 30 and 260 cm'); return }
      if (h !== identity.heightCm) draft.heightCm = h
    }
    if (draft.weightKg == null && draft.heightCm == null) {
      setErr('Nothing to save — the values match the recorded weight/height')
      return
    }
    setBusy(true)
    const res = await updatePatientMeasurements(identity.patientId, draft)
    setBusy(false)
    if (res.kind === 'ok') {
      setIdentity(res.data)
      setEditing(false)
      setShowHistory(true)
    } else if (res.kind === 'rejected') {
      setErr(res.error)
    } else {
      setErr('Weight/height writes require the live server — nothing was recorded (offline/local session)')
    }
  }

  const val = (n: number | null | undefined, unit: string) =>
    n != null ? <b className="num">{n} <i>{unit}</i></b> : <span className="whmissing">— not recorded</span>

  return (
    <Card
      id="weight-height"
      icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--violet)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3h12l3 7c0 6-6 11-9 11S3 16 3 10l3-7z" /><path d="M12 3v5m-3.5 2.5L12 8l3.5 2.5" /></svg>}
      title="Weight & Height"
      aside={canMeasure
        ? <button className="whedit" onClick={() => (editing ? setEditing(false) : openEditor())}>{editing ? 'Cancel' : hasAny ? '✎ Correct' : '+ Add'}</button>
        : 'reference values · kg / cm'}
    >
      <div className="whvals">
        <div className="whv"><span className="k">Weight</span>{val(identity.weightKg, 'kg')}</div>
        <div className="whv"><span className="k">Height</span>{val(identity.heightCm, 'cm')}</div>
        <div className="whv"><span className="k">BMI</span>{derivedBmi != null ? <b className="num">{derivedBmi} <i>kg/m²</i></b> : <span className="whmissing">—</span>}</div>
        <div className="whv"><span className="k">IBW · Devine</span>{derivedIbw != null ? <b className="num">{derivedIbw} <i>kg</i></b> : <span className="whmissing">—</span>}</div>
        <div className="whv"><span className="k">BSA · Mosteller</span>{derivedBsa != null ? <b className="num">{derivedBsa} <i>m²</i></b> : <span className="whmissing">—</span>}</div>
      </div>

      {(derivedBmi == null || derivedBsa == null) && (
        <div className="whnote">
          BMI / BSA derive from weight + height at render — they stay blank until both are
          recorded (never fabricated). {derivedIbw == null && 'IBW (Devine) needs a recorded height ≥ 152.4 cm.'}
        </div>
      )}

      {editing && (
        <div className="wheditor">
          <label>Weight (kg)
            <input value={wInput} onChange={e => setWInput(e.target.value)} inputMode="decimal" placeholder="e.g. 78" aria-label="Weight in kilograms" />
          </label>
          <label>Height (cm)
            <input value={hInput} onChange={e => setHInput(e.target.value)} inputMode="decimal" placeholder="e.g. 172" aria-label="Height in centimetres" />
          </label>
          <button className="whsave" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          <div className="whself">
            The reference weight drives dosing — a change is recorded with the prior value
            preserved (amend-not-erase), never silently overwritten.
          </div>
        </div>
      )}
      {err && <div className="wherr" role="alert">{err}</div>}

      {history.length > 0 && (
        <>
          <button className="whhistbtn" onClick={() => setShowHistory(s => !s)} aria-expanded={showHistory}>
            {showHistory ? 'Hide' : 'Show'} history ({history.length})
          </button>
          {showHistory && (
            <div className="whhist">
              {history.map((ev, i) => (
                <div className="whev" key={i}>
                  <span className="t">{ev.time}</span>
                  <span className="f">{ev.field}</span>
                  <span className="a">{ev.action}</span>
                  {ev.prior != null && <s>{ev.prior} {ev.field === 'weight' ? 'kg' : 'cm'}</s>}
                  <b className="num">{ev.value} {ev.field === 'weight' ? 'kg' : 'cm'}</b>
                  <i>· {ev.actor}</i>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  )
}
