import { useEffect, useState } from 'react'
import { Card } from '../../components/Card'
import { getEncounters, getPatientIdentity, updateEncounterMeasurements } from '../../lib/api'
import type { Encounter, Sex } from '../../lib/api/types'
import { bmi, bsaMostellerM2, ibwDevineKg } from '../../lib/anthropometrics'
import { getSession, hasPermission } from '../../lib/session'

/** Patient Weight & Height (the clinical validator's design) —
 *  ENCOUNTER-SCOPED attributes (the project owner's decision on the
 *  flagged modelling choice), NOT observations: ICU patients aren't
 *  weighed daily, so this is THIS ADMISSION's recorded reference weight
 *  (kg) / height (cm) for dosing and SOFA (µg/kg/min). Each admission
 *  keeps its own values — a re-admission starts fresh, never inheriting
 *  or overwriting a prior episode's. Captured at admission, addable here
 *  when omitted, correctable here with amend-not-erase history within
 *  the encounter (who/when/prior — a value that drives dosing is never
 *  silently overwritten). BMI / IBW (Devine) / BSA (Mosteller) are
 *  DERIVED AT RENDER from the encounter's weight+height and hidden while
 *  an input is missing — honest-data, no fabricated BMI.
 *
 *  Gated on the REAL patient-identity read (real-only, like the print
 *  selectors — it also supplies the sex Devine needs): in pure
 *  mock/offline mode the card renders nothing — there is no mock store
 *  behind this domain, and inventing one would fabricate clinical data.
 *  The measurements themselves come from the patient's OPEN encounter. */
export function WeightHeightCard({ patientId }: { patientId: string }) {
  const session = getSession()
  const canMeasure = session != null && hasPermission(session.jobTitle, 'patients.measure')

  const [sex, setSex] = useState<Sex | null>(null)
  const [enc, setEnc] = useState<Encounter | null>(null)
  const [editing, setEditing] = useState(false)
  const [wInput, setWInput] = useState('')
  const [hInput, setHInput] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let stale = false
    setSex(null)
    setEnc(null)
    setEditing(false)
    setShowHistory(false)
    setErr(null)
    if (!patientId) return
    /* identity is the real-server gate + the sex for Devine; the open
       encounter carries this admission's measurements */
    getPatientIdentity(patientId).then(p => {
      if (stale || !p) return
      setSex(p.sex)
      getEncounters({ patientId, status: 'open' })
        .then(list => { if (!stale) setEnc(list[0] ?? null) })
        .catch(() => {})
    })
    return () => { stale = true }
  }, [patientId])

  if (!sex || !enc) return null

  const derivedBmi = bmi(enc.weightKg, enc.heightCm)
  const derivedIbw = ibwDevineKg(sex, enc.heightCm)
  const derivedBsa = bsaMostellerM2(enc.weightKg, enc.heightCm)
  const history = enc.measurements ?? []
  const hasAny = enc.weightKg != null || enc.heightCm != null

  function openEditor() {
    setWInput(enc?.weightKg != null ? String(enc.weightKg) : '')
    setHInput(enc?.heightCm != null ? String(enc.heightCm) : '')
    setErr(null)
    setEditing(true)
  }

  async function save() {
    if (!enc) return
    setErr(null)
    const draft: { weightKg?: number; heightCm?: number } = {}
    if (wInput.trim()) {
      const w = Number(wInput)
      if (!Number.isFinite(w) || w < 0.5 || w > 500) { setErr('Weight must be a number between 0.5 and 500 kg'); return }
      if (w !== enc.weightKg) draft.weightKg = w
    }
    if (hInput.trim()) {
      const h = Number(hInput)
      if (!Number.isFinite(h) || h < 30 || h > 260) { setErr('Height must be a number between 30 and 260 cm'); return }
      if (h !== enc.heightCm) draft.heightCm = h
    }
    if (draft.weightKg == null && draft.heightCm == null) {
      setErr("Nothing to save — the values match this encounter's recorded weight/height")
      return
    }
    setBusy(true)
    const res = await updateEncounterMeasurements(enc.encounterId, draft)
    setBusy(false)
    if (res.kind === 'ok') {
      setEnc(res.data)
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
        : 'this admission · kg / cm'}
    >
      <div className="whvals">
        <div className="whv"><span className="k">Weight</span>{val(enc.weightKg, 'kg')}</div>
        <div className="whv"><span className="k">Height</span>{val(enc.heightCm, 'cm')}</div>
        <div className="whv"><span className="k">BMI</span>{derivedBmi != null ? <b className="num">{derivedBmi} <i>kg/m²</i></b> : <span className="whmissing">—</span>}</div>
        <div className="whv"><span className="k">IBW · Devine</span>{derivedIbw != null ? <b className="num">{derivedIbw} <i>kg</i></b> : <span className="whmissing">—</span>}</div>
        <div className="whv"><span className="k">BSA · Mosteller</span>{derivedBsa != null ? <b className="num">{derivedBsa} <i>m²</i></b> : <span className="whmissing">—</span>}</div>
      </div>

      <div className="whscope">
        Recorded for THIS admission ({enc.encounterId}) — each encounter keeps its own
        weight/height; a re-admission starts fresh.
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
