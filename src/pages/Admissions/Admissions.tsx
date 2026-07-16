import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './Admissions.css'
import { AppHeader, type KpiSpec } from '../../components/AppHeader'
import { NavSidebar } from '../../components/NavSidebar'
import { Card } from '../../components/Card'
import { BedChip } from '../../components/Tag'
import { Toast, useToast } from '../../components/Toast'
import { IconAdmit, IconBed, IconUsers } from '../../components/icons'
import { admitPatient, getAdtBeds, getEncounters } from '../../lib/api'
import type { AdtBed, Encounter, Sex } from '../../lib/api/types'
import { getSession, hasPermission, initialsOf, profileOf } from '../../lib/session'

/** Layer 2 — ADT Admissions (/admissions). The first Aurora Core write
 *  screen: admit a patient (create the Patient if the MRN is new, open an
 *  Encounter, assign a FREE bed). Admission is doctor-level authority
 *  (adt.admit) — other profiles see the census view-only, with no action
 *  they cannot use. Writes are REAL-ONLY: ADT is the durable system of
 *  record, never applied to local mock state. */
export function Admissions() {
  const navigate = useNavigate()
  const { toast, showToast } = useToast()
  const session = getSession()!
  const canAdmit = hasPermission(session.jobTitle, 'adt.admit')

  const [beds, setBeds] = useState<AdtBed[] | null>(null)
  const [openEncounters, setOpenEncounters] = useState<Encounter[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [mrn, setMrn] = useState('')
  /* STRUCTURED LEGAL NAME (the validator's design): first · second
     (father) · third (grandfather) · fourth (great-grandfather) · family.
     First/Second/Family required; Third/Fourth optional — blank is
     honest. Unidentified patients use the SAME fields, named "unknown"
     by the admitting user (no special mode). */
  const [nameFirst, setNameFirst] = useState('')
  const [nameSecond, setNameSecond] = useState('')
  const [nameThird, setNameThird] = useState('')
  const [nameFourth, setNameFourth] = useState('')
  const [nameFamily, setNameFamily] = useState('')
  /* national identity number — EXACTLY as on the card, optional (the
     unidentified have none), unique when present (server-enforced) */
  const [nationalId, setNationalId] = useState('')
  /* IDENTITY REDESIGN: date of birth is the correct capture (age computes
     at read — the clock-computed-state rule); the estimated-age path
     stays for patients whose DOB is genuinely unknown at the bedside.
     Exactly one of the two is sent (server-enforced). */
  const [dob, setDob] = useState('')
  const [dobUnknown, setDobUnknown] = useState(false)
  const [age, setAge] = useState('')
  const [sex, setSex] = useState<Sex>('M')
  const [allergies, setAllergies] = useState('None documented')
  const [diagnosis, setDiagnosis] = useState('')
  const [attending, setAttending] = useState('')
  const [bedId, setBedId] = useState('')
  /* Weight & Height capture (kg/cm) — OPTIONAL at admission by design:
     if omitted, a clinician adds them later on the patient record
     (Mission Control), so a hectic admission is never blocked on a
     scale. ENCOUNTER-SCOPED (the owner's decision): the values land on
     THIS admission's encounter — a re-admission starts fresh, never
     inheriting or overwriting a prior episode's. Not observations. */
  const [weight, setWeight] = useState('')
  const [height, setHeight] = useState('')

  const reload = useCallback(() => {
    getAdtBeds().then(setBeds)
    getEncounters({ status: 'open' }).then(setOpenEncounters)
  }, [])
  useEffect(() => { reload() }, [reload])

  const freeBeds = useMemo(() => (beds ?? []).filter(b => !b.patientId), [beds])
  const occupied = useMemo(() => (beds ?? []).filter(b => b.patientId), [beds])

  const kpis: KpiSpec[] = [
    { icon: <IconBed size={14} stroke="var(--blue)" />, iconBg: 'rgba(var(--blue-rgb),.15)', value: beds ? `${occupied.length} / ${beds.length}` : '—', label: 'Census' },
    { icon: <IconBed size={14} stroke="var(--green)" />, iconBg: 'rgba(var(--green-rgb),.13)', value: beds ? freeBeds.length : '—', label: 'Beds Free' },
    { icon: <IconAdmit size={14} stroke="var(--cyan)" />, iconBg: 'rgba(var(--cyan-rgb),.13)', value: openEncounters?.filter(e => e.admittedAt !== '').length ?? '—', label: 'New Admissions' },
    { icon: <IconUsers size={14} stroke="var(--violet)" />, iconBg: 'rgba(var(--violet-rgb),.15)', value: openEncounters?.length ?? '—', label: 'Open Encounters' },
  ]

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    let identity: { age: number } | { dateOfBirth: string }
    if (dobUnknown) {
      const ageNum = Number(age)
      if (!Number.isInteger(ageNum) || ageNum < 0 || ageNum > 130) {
        setFormError('Estimated age must be a whole number between 0 and 130')
        return
      }
      identity = { age: ageNum }
    } else {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || dob > new Date().toISOString().slice(0, 10)) {
        setFormError('Date of birth must be a valid past date')
        return
      }
      identity = { dateOfBirth: dob }
    }
    const measurements: { weightKg?: number; heightCm?: number } = {}
    if (weight.trim()) {
      const w = Number(weight)
      if (!Number.isFinite(w) || w < 0.5 || w > 500) {
        setFormError('Weight must be a number between 0.5 and 500 kg (or leave it blank to add later)')
        return
      }
      measurements.weightKg = w
    }
    if (height.trim()) {
      const h = Number(height)
      if (!Number.isFinite(h) || h < 30 || h > 260) {
        setFormError('Height must be a number between 30 and 260 cm (or leave it blank to add later)')
        return
      }
      measurements.heightCm = h
    }
    setBusy(true)
    const res = await admitPatient({
      mrn: mrn.trim(),
      nameFirst: nameFirst.trim(), nameSecond: nameSecond.trim(),
      ...(nameThird.trim() ? { nameThird: nameThird.trim() } : {}),
      ...(nameFourth.trim() ? { nameFourth: nameFourth.trim() } : {}),
      nameFamily: nameFamily.trim(),
      ...(nationalId.trim() ? { nationalId: nationalId.trim() } : {}),
      ...identity, sex,
      allergies: allergies.trim(), diagnosis: diagnosis.trim(),
      attending: attending.trim(), bedId, ...measurements,
    })
    setBusy(false)
    if (res.kind === 'ok') {
      showToast('Admitted', `${res.data.patient.name} (${res.data.patient.patientId}) admitted to ${res.data.encounter.bedId} — encounter ${res.data.encounter.encounterId}`)
      setMrn(''); setNameFirst(''); setNameSecond(''); setNameThird(''); setNameFourth(''); setNameFamily(''); setNationalId('')
      setDob(''); setDobUnknown(false); setAge(''); setDiagnosis(''); setAttending(''); setBedId('')
      setWeight(''); setHeight('')
      setAllergies('None documented')
      reload()
    } else if (res.kind === 'rejected') {
      setFormError(res.error)
    } else {
      setFormError('ADT requires the live server — the admission was NOT recorded (offline/local session)')
    }
  }

  const formOk = mrn.trim() && nameFirst.trim() && nameSecond.trim() && nameFamily.trim()
    && (dobUnknown ? age.trim() : dob) && allergies.trim()
    && diagnosis.trim() && attending.trim() && bedId

  return (
    <div className="app-frame adm">
      <AppHeader
        subtitle="Admissions · ADT"
        kpis={kpis}
        user={{ initials: initialsOf(session.name), name: session.name, role: `${session.jobTitle} · ${profileOf(session.jobTitle)} profile` }}
      />
      <div className="shell">
        <NavSidebar active="admissions" footerLines={[`Role: ${profileOf(session.jobTitle)} profile`, 'ADT · Aurora Core']} />

        <main>
          {!canAdmit && (
            <div className="admnote" role="note">
              View only — admitting a patient requires doctor-level authority (adt.admit).
            </div>
          )}

          <div className="admcols">
            <Card icon={<IconAdmit size={15} stroke="var(--cyan)" />} title="New Admission" aside="creates the Patient if the MRN is new">
              <form className="admform" onSubmit={submit}>
                <div className="admgrid">
                  <label>MRN
                    <input value={mrn} onChange={e => setMrn(e.target.value)} placeholder="MRN-123456" disabled={!canAdmit} required />
                  </label>
                  <label>National identity number <i className="admopt">optional — as on the card; the unidentified have none</i>
                    <input value={nationalId} onChange={e => setNationalId(e.target.value)} placeholder="as printed on the identity card" disabled={!canAdmit} aria-label="National identity number, optional, exactly as on the identity card" />
                  </label>
                  {/* the legal name in five parts (locked decision 1) — an
                      unidentified patient is admitted through these SAME
                      fields, named "unknown" (no special mode) */}
                  <label>First name
                    <input value={nameFirst} onChange={e => setNameFirst(e.target.value)} placeholder="e.g. Ali — or Unknown" disabled={!canAdmit} required />
                  </label>
                  <label>Second name (father)
                    <input value={nameSecond} onChange={e => setNameSecond(e.target.value)} placeholder="e.g. Hassan — or Unknown" disabled={!canAdmit} required />
                  </label>
                  <label>Third name (grandfather) <i className="admopt">optional</i>
                    <input value={nameThird} onChange={e => setNameThird(e.target.value)} disabled={!canAdmit} aria-label="Third name, grandfather, optional" />
                  </label>
                  <label>Fourth name <i className="admopt">optional</i>
                    <input value={nameFourth} onChange={e => setNameFourth(e.target.value)} disabled={!canAdmit} aria-label="Fourth name, great-grandfather, optional" />
                  </label>
                  <label>Family / tribal name
                    <input value={nameFamily} onChange={e => setNameFamily(e.target.value)} placeholder="e.g. Al-Janabi — or Unknown" disabled={!canAdmit} required />
                  </label>
                  {dobUnknown ? (
                    <label>Estimated age
                      <input value={age} onChange={e => setAge(e.target.value)} inputMode="numeric" placeholder="58" disabled={!canAdmit} required />
                    </label>
                  ) : (
                    <label>Date of birth
                      <input type="date" value={dob} onChange={e => setDob(e.target.value)} disabled={!canAdmit} required />
                    </label>
                  )}
                  <label className="admwide admdob">
                    <input type="checkbox" checked={dobUnknown} onChange={e => { setDobUnknown(e.target.checked); setDob(''); setAge('') }} disabled={!canAdmit} />
                    <span>Date of birth unknown — record an estimated age (age then prints with its provenance instead of computing from DOB)</span>
                  </label>
                  <label>Sex
                    <select value={sex} onChange={e => setSex(e.target.value as Sex)} disabled={!canAdmit}>
                      <option value="M">M</option>
                      <option value="F">F</option>
                    </select>
                  </label>
                  <label>Weight (kg) <i className="admopt">optional — addable later</i>
                    <input value={weight} onChange={e => setWeight(e.target.value)} inputMode="decimal" placeholder="e.g. 78" disabled={!canAdmit} aria-label="Weight in kilograms, optional" />
                  </label>
                  <label>Height (cm) <i className="admopt">optional — addable later</i>
                    <input value={height} onChange={e => setHeight(e.target.value)} inputMode="decimal" placeholder="e.g. 172" disabled={!canAdmit} aria-label="Height in centimetres, optional" />
                  </label>
                  <label className="admwide">Allergies
                    <input value={allergies} onChange={e => setAllergies(e.target.value)} disabled={!canAdmit} required />
                  </label>
                  <label className="admwide">Admission diagnosis
                    <input value={diagnosis} onChange={e => setDiagnosis(e.target.value)} placeholder="e.g. Septic shock — pneumonia" disabled={!canAdmit} required />
                  </label>
                  <label>Attending
                    <input value={attending} onChange={e => setAttending(e.target.value)} placeholder="Dr. …" disabled={!canAdmit} required />
                  </label>
                  <label>Bed (free only)
                    <select value={bedId} onChange={e => setBedId(e.target.value)} disabled={!canAdmit} required>
                      <option value="" disabled>Select a free bed…</option>
                      {freeBeds.map(b => <option key={b.bedId} value={b.bedId}>{b.bedId} · {b.area}</option>)}
                    </select>
                  </label>
                </div>
                {formError && <div className="admerr" role="alert">{formError}</div>}
                {canAdmit && (
                  <button className="admsubmit" type="submit" disabled={!formOk || busy}>
                    {busy ? 'Admitting…' : 'Admit patient'}
                  </button>
                )}
              </form>
            </Card>

            <Card icon={<IconBed size={15} stroke="var(--blue)" />} title="Current Census" aside={beds ? `${freeBeds.length} bed(s) free` : '—'}>
              <div className="admcensus">
                {(beds ?? []).map(b => (
                  <button
                    key={b.bedId}
                    className={`admbed${b.patientId ? '' : ' free'}`}
                    onClick={() => b.patientId ? navigate(`/patients/${b.patientId}`) : undefined}
                    aria-label={b.patientId ? `Open chart: ${b.patientName}` : `${b.bedId} free`}
                  >
                    <BedChip bedId={b.bedId} />
                    <span className="admwho">{b.patientId ? b.patientName : 'Available'}</span>
                    <span className="admarea">{b.area}</span>
                  </button>
                ))}
              </div>
              <button className="admlink" onClick={() => navigate('/beds')}>Open Bed Overview →</button>
            </Card>
          </div>
        </main>
      </div>
      <Toast state={toast} accent="cyan" />
    </div>
  )
}
