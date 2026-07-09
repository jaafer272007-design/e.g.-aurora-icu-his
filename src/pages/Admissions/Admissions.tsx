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
  const [name, setName] = useState('')
  const [age, setAge] = useState('')
  const [sex, setSex] = useState<Sex>('M')
  const [allergies, setAllergies] = useState('None documented')
  const [diagnosis, setDiagnosis] = useState('')
  const [attending, setAttending] = useState('')
  const [bedId, setBedId] = useState('')

  const reload = useCallback(() => {
    getAdtBeds().then(setBeds)
    getEncounters({ status: 'open' }).then(setOpenEncounters)
  }, [])
  useEffect(() => { reload() }, [reload])

  const freeBeds = useMemo(() => (beds ?? []).filter(b => !b.patientId), [beds])
  const occupied = useMemo(() => (beds ?? []).filter(b => b.patientId), [beds])

  const kpis: KpiSpec[] = [
    { icon: <IconBed size={14} stroke="var(--blue)" />, iconBg: 'rgba(77,163,255,.15)', value: beds ? `${occupied.length} / ${beds.length}` : '—', label: 'Census' },
    { icon: <IconBed size={14} stroke="var(--green)" />, iconBg: 'rgba(61,232,160,.13)', value: beds ? freeBeds.length : '—', label: 'Beds Free' },
    { icon: <IconAdmit size={14} stroke="var(--cyan)" />, iconBg: 'rgba(53,224,208,.13)', value: openEncounters?.filter(e => e.admittedAt !== '').length ?? '—', label: 'New Admissions' },
    { icon: <IconUsers size={14} stroke="var(--violet)" />, iconBg: 'rgba(167,139,250,.15)', value: openEncounters?.length ?? '—', label: 'Open Encounters' },
  ]

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    const ageNum = Number(age)
    if (!Number.isInteger(ageNum) || ageNum < 0 || ageNum > 130) {
      setFormError('Age must be a whole number between 0 and 130')
      return
    }
    setBusy(true)
    const res = await admitPatient({
      mrn: mrn.trim(), name: name.trim(), age: ageNum, sex,
      allergies: allergies.trim(), diagnosis: diagnosis.trim(),
      attending: attending.trim(), bedId,
    })
    setBusy(false)
    if (res.kind === 'ok') {
      showToast('Admitted', `${res.data.patient.name} (${res.data.patient.patientId}) admitted to ${res.data.encounter.bedId} — encounter ${res.data.encounter.encounterId}`)
      setMrn(''); setName(''); setAge(''); setDiagnosis(''); setAttending(''); setBedId('')
      setAllergies('None documented')
      reload()
    } else if (res.kind === 'rejected') {
      setFormError(res.error)
    } else {
      setFormError('ADT requires the live server — the admission was NOT recorded (offline/local session)')
    }
  }

  const formOk = mrn.trim() && name.trim() && age.trim() && allergies.trim()
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
                  <label>Full name
                    <input value={name} onChange={e => setName(e.target.value)} placeholder="Patient name" disabled={!canAdmit} required />
                  </label>
                  <label>Age
                    <input value={age} onChange={e => setAge(e.target.value)} inputMode="numeric" placeholder="58" disabled={!canAdmit} required />
                  </label>
                  <label>Sex
                    <select value={sex} onChange={e => setSex(e.target.value as Sex)} disabled={!canAdmit}>
                      <option value="M">M</option>
                      <option value="F">F</option>
                    </select>
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
