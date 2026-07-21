import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import './Admissions.css'
import { AppHeader, type KpiSpec } from '../../components/AppHeader'
import { NavSidebar } from '../../components/NavSidebar'
import { Card } from '../../components/Card'
import { BedChip } from '../../components/Tag'
import { Toast, useToast } from '../../components/Toast'
import { IconAdmit, IconBed, IconUsers } from '../../components/icons'
import { admitPatient, getAdtBeds, getAttendings, getCodeStatuses, getEncounters, getPatientIdentity, matchPatient } from '../../lib/api'
import type { AdmitDraft, CodeStatusEntry, AdtBed, AttendingOption, Encounter, MatchPatientResponse, Sex } from '../../lib/api/types'
import { getSession, hasPermission, initialsOf, profileOf } from '../../lib/session'
import { MatchDialog } from './MatchDialog'

/** Layer 2 — ADT Admissions (/admissions). The first Aurora Core write
 *  screen: admit a patient (create the Patient if genuinely new, open an
 *  Encounter, assign a FREE bed). Admission is doctor-level authority
 *  (adt.admit) — other profiles see the census view-only, with no action
 *  they cannot use. Writes are REAL-ONLY: ADT is the durable system of
 *  record, never applied to local mock state.
 *  PATIENT IDENTITY MATCH (the match+overview design, superseding #116's
 *  discharged-patient picker): ON SUBMIT — never per keystroke — the
 *  form checks for an existing patient BEFORE creating anything. A match
 *  opens the dialog; nothing is created until a human decides. RE-ADMISSION
 *  keeps #116's patientId path, reached through the dialog's Readmit or
 *  the History Overview's "Admit as New Encounter" (?readmit=P-xxxx). */
export function Admissions() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { toast, showToast } = useToast()
  const session = getSession()!
  const canAdmit = hasPermission(session.jobTitle, 'adt.admit')
  const canOverview = hasPermission(session.jobTitle, 'results.view')

  const [beds, setBeds] = useState<AdtBed[] | null>(null)
  const [openEncounters, setOpenEncounters] = useState<Encounter[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  /* RE-ADMISSION mode — entered ONLY through the match dialog's Readmit
     or the History Overview's "Admit as New Encounter" (?readmit=P-xxxx).
     The #116 picker this replaces listed discharged patients blindly;
     matching now covers ALL patients, admitted included. */
  const readmitId = params.get('readmit') ?? ''
  const [readmitName, setReadmitName] = useState('')
  /* the on-submit match result — while this dialog is open, NOTHING has
     been created */
  const [match, setMatch] = useState<MatchPatientResponse | null>(null)
  const [matchError, setMatchError] = useState<string | null>(null)

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
  /* the hospital's own chart number (Locale/File-Number §2) — optional,
     typed as recorded; NOT the MRN (which Aurora generates) */
  const [fileNumber, setFileNumber] = useState('')
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
  /* ATTENDING CONSULTANT (the safety fix): SELECTED from the staff
     directory, never free-typed. A typo used to create a wrong/ghost
     attending on the encounter; now the value is a real senior doctor
     picked from the roster. Filtered to the SeniorDoctor profile
     (Consultant / Senior Registrar) — the clinicians who attend. */
  const [attending, setAttending] = useState('')
  const [consultants, setConsultants] = useState<AttendingOption[] | null>(null)
  const [bedId, setBedId] = useState('')
  /* Weight & Height capture (kg/cm) — OPTIONAL at admission by design:
     if omitted, a clinician adds them later on the patient record
     (Mission Control), so a hectic admission is never blocked on a
     scale. ENCOUNTER-SCOPED (the owner's decision): the values land on
     THIS admission's encounter — a re-admission starts fresh, never
     inheriting or overwriting a prior episode's. Not observations. */
  const [weight, setWeight] = useState('')
  /* CODE STATUS (governed vocabulary — the SAFETY FIX): optional at
     admission, SELECTED from the ACTIVE vocabulary, never typed;
     '' = honestly NOT RECORDED until a physician sets it */
  const [codeStatusCode, setCodeStatusCode] = useState('')
  const [codeStatuses, setCodeStatuses] = useState<CodeStatusEntry[] | null>(null)
  const [height, setHeight] = useState('')

  const reload = useCallback(() => {
    getAdtBeds().then(setBeds)
    getEncounters({ status: 'open' }).then(setOpenEncounters)
    getCodeStatuses().then(setCodeStatuses).catch(() => setCodeStatuses([]))
    getAttendings().then(setConsultants).catch(() => setConsultants([]))
  }, [])
  useEffect(() => { reload() }, [reload])

  /* resolve WHO is being re-admitted — the banner names the stored
     identity (REAL-ONLY read; an unresolvable id still posts by id and
     the server answers) */
  useEffect(() => {
    let stale = false
    setReadmitName('')
    if (readmitId) getPatientIdentity(readmitId).then(r => {
      if (!stale && r) setReadmitName(`${r.fullName ?? r.name} · ${r.mrn}`)
    })
    return () => { stale = true }
  }, [readmitId])

  /* Bed Registry: only ACTIVE beds are admittable — a retired bed leaves
     this picker (and the server refuses it with 409 regardless) */
  const freeBeds = useMemo(() => (beds ?? []).filter(b => b.active && !b.patientId), [beds])
  const occupied = useMemo(() => (beds ?? []).filter(b => b.patientId), [beds])
  const readmitting = readmitId !== ''
  const clearReadmit = () => navigate('/admissions', { replace: true })

  const kpis: KpiSpec[] = [
    { icon: <IconBed size={14} stroke="var(--blue)" />, iconBg: 'rgba(var(--blue-rgb),.15)', value: beds ? `${occupied.length} / ${beds.length}` : '—', label: 'Census' },
    { icon: <IconBed size={14} stroke="var(--green)" />, iconBg: 'rgba(var(--green-rgb),.13)', value: beds ? freeBeds.length : '—', label: 'Beds Free' },
    { icon: <IconAdmit size={14} stroke="var(--cyan)" />, iconBg: 'rgba(var(--cyan-rgb),.13)', value: openEncounters?.filter(e => e.admittedAt !== '').length ?? '—', label: 'New Admissions' },
    { icon: <IconUsers size={14} stroke="var(--violet)" />, iconBg: 'rgba(var(--violet-rgb),.15)', value: openEncounters?.length ?? '—', label: 'Open Encounters' },
  ]

  /** episode fields shared by every admission shape (validated by submit) */
  function episodeFields(): Pick<AdmitDraft, 'diagnosis' | 'attending' | 'bedId' | 'weightKg' | 'heightCm' | 'codeStatusCode'> | null {
    const measurements: { weightKg?: number; heightCm?: number } = {}
    if (weight.trim()) {
      const w = Number(weight)
      if (!Number.isFinite(w) || w < 0.5 || w > 500) {
        setFormError('Weight must be a number between 0.5 and 500 kg (or leave it blank to add later)')
        return null
      }
      measurements.weightKg = w
    }
    if (height.trim()) {
      const h = Number(height)
      if (!Number.isFinite(h) || h < 30 || h > 260) {
        setFormError('Height must be a number between 30 and 260 cm (or leave it blank to add later)')
        return null
      }
      measurements.heightCm = h
    }
    return { diagnosis: diagnosis.trim(), attending: attending.trim(), bedId, ...measurements,
      ...(codeStatusCode ? { codeStatusCode } : {}) }
  }

  function afterAdmit(kind: 'Admitted' | 'Re-admitted', data: { patient: { name: string; patientId: string; mrn: string }; encounter: { bedId: string; encounterId: string } }) {
    /* the toast carries the AURORA-ASSIGNED MRN — the user never typed
       one, so this is where they learn the record number */
    showToast(kind,
      `${data.patient.name} (${data.patient.patientId} · ${data.patient.mrn}) admitted to ${data.encounter.bedId} — encounter ${data.encounter.encounterId}`)
    setNameFirst(''); setNameSecond(''); setNameThird(''); setNameFourth(''); setNameFamily(''); setNationalId(''); setFileNumber('')
    setDob(''); setDobUnknown(false); setAge(''); setDiagnosis(''); setAttending(''); setBedId('')
    setWeight(''); setHeight(''); setCodeStatusCode('')
    setAllergies('None documented')
    setMatch(null); setMatchError(null)
    if (readmitting) clearReadmit()
    reload()
  }

  /** the CREATE post — runs only when no match stands in the way (or a
   *  human verified a Tier B suggestion is a different person) */
  async function createNewPatient() {
    const episode = episodeFields()
    if (!episode) return
    let identity: { age: number } | { dateOfBirth: string }
    if (dobUnknown) identity = { age: Number(age) }
    else identity = { dateOfBirth: dob }
    setBusy(true)
    const res = await admitPatient({
      nameFirst: nameFirst.trim(), nameSecond: nameSecond.trim(),
      ...(nameThird.trim() ? { nameThird: nameThird.trim() } : {}),
      ...(nameFourth.trim() ? { nameFourth: nameFourth.trim() } : {}),
      nameFamily: nameFamily.trim(),
      ...(nationalId.trim() ? { nationalId: nationalId.trim() } : {}),
      ...(fileNumber.trim() ? { fileNumber: fileNumber.trim() } : {}),
      sex, allergies: allergies.trim(),
      ...identity, ...episode,
    })
    setBusy(false)
    if (res.kind === 'ok') afterAdmit('Admitted', res.data)
    else if (res.kind === 'rejected') { setMatch(null); setFormError(res.error) }
    else { setMatch(null); setFormError('ADT requires the live server — the admission was NOT recorded (offline/local session)') }
  }

  /** RE-ADMISSION by patientId (#116's path) — from the dialog's Readmit
   *  or the ?readmit= banner submit. The stored identity (and MRN)
   *  stands; only this episode's fields are sent. */
  async function readmitExisting(patientId: string) {
    const episode = episodeFields()
    if (!episode) return
    setBusy(true)
    const res = await admitPatient({ patientId, ...episode })
    setBusy(false)
    if (res.kind === 'ok') afterAdmit('Re-admitted', res.data)
    else if (res.kind === 'rejected') {
      /* surface the server's precise refusal WHERE the user acted —
         inside the dialog when it is open (deceased 409, occupied bed,
         open encounter), on the form otherwise */
      if (match) setMatchError(res.error)
      else setFormError(res.error)
    }
    else {
      /* offline surfaces in the dialog too when it is open — a message
         behind the scrim is no message */
      if (match) setMatchError('ADT requires the live server — the admission was NOT recorded (offline/local session)')
      else setFormError('ADT requires the live server — the admission was NOT recorded (offline/local session)')
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    /* weight/height validate BEFORE any dialog can open — a form error
       must never end up hidden behind the match dialog's scrim (the
       scrim blocks edits, so values validated here cannot go stale) */
    if (!episodeFields()) return
    if (readmitting) { await readmitExisting(readmitId); return }
    /* new-patient validation before anything leaves the browser */
    if (dobUnknown) {
      const ageNum = Number(age)
      if (!Number.isInteger(ageNum) || ageNum < 0 || ageNum > 130) {
        setFormError('Estimated age must be a whole number between 0 and 130')
        return
      }
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || dob > new Date().toISOString().slice(0, 10)) {
      setFormError('Date of birth must be a valid past date')
      return
    }
    /* THE ON-SUBMIT MATCH CHECK (flagged choice, stated: on submit, never
       per keystroke — a national ID typed digit-by-digit must not fire
       lookups). Skipped only when nothing is matchable: an unidentified
       patient (no ID, estimated age) has no unique identifier and no
       real DOB — Tier C excludes them by construction. */
    const matchable = nationalId.trim() !== '' || fileNumber.trim() !== '' || !dobUnknown
    if (matchable) {
      setBusy(true)
      const check = await matchPatient({
        ...(nationalId.trim() ? { nationalId: nationalId.trim() } : {}),
        ...(fileNumber.trim() ? { fileNumber: fileNumber.trim() } : {}),
        nameFirst: nameFirst.trim(), nameSecond: nameSecond.trim(), nameFamily: nameFamily.trim(),
        ...(!dobUnknown && dob ? { dateOfBirth: dob } : {}),
      })
      setBusy(false)
      if (check.kind === 'rejected') { setFormError(check.error); return }
      if (check.kind === 'offline') {
        setFormError('ADT requires the live server — nothing was checked and nothing was recorded (offline/local session)')
        return
      }
      if (check.data.matches.length > 0) {
        /* MATCH → create NOTHING; the dialog decides */
        setMatchError(null)
        setMatch(check.data)
        return
      }
    }
    await createNewPatient()
  }

  const formOk = (readmitting
    || (nameFirst.trim() && nameSecond.trim() && nameFamily.trim()
      && (dobUnknown ? age.trim() : dob) && allergies.trim()))
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
            <Card icon={<IconAdmit size={15} stroke="var(--cyan)" />} title={readmitting ? 'Re-admission' : 'New Admission'} aside="the MRN is assigned by Aurora">
              <form className="admform" onSubmit={submit}>
                <div className="admgrid">
                  {/* RE-ADMISSION banner — entered via the match dialog or
                      the History Overview, never via a blind picker (the
                      #116 picker is SUPERSEDED by on-submit matching) */}
                  {readmitting && (
                    <div className="admwide admreadmit" role="note">
                      Re-admitting <b>{readmitName || readmitId}</b> ({readmitId}): identity is the
                      stored record (name, MRN, national ID, date of birth) — corrections go through
                      the audited identity path, never through admission. Only this episode&apos;s
                      fields are captured below.{' '}
                      <button type="button" className="admcancelre" onClick={clearReadmit}>✕ cancel — admit a new patient instead</button>
                    </div>
                  )}
                  {!readmitting && <>
                  <label>National identity number <i className="admopt">optional — as on the card; the unidentified have none</i>
                    <input value={nationalId} onChange={e => setNationalId(e.target.value)} placeholder="as printed on the identity card" disabled={!canAdmit} aria-label="National identity number, optional, exactly as on the identity card" />
                  </label>
                  {/* the hospital's own chart number — its own field, never
                      the MRN box (the رضا lesson, applied a third time) */}
                  <label>Patient file number <i className="admopt">optional — the hospital&apos;s own chart number, as recorded</i>
                    <input className="num" value={fileNumber} onChange={e => setFileNumber(e.target.value)} placeholder="as on the hospital chart" disabled={!canAdmit} aria-label="Patient file number, optional, the hospital's own chart number as recorded" />
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
                  </>}
                  <label>Weight (kg) <i className="admopt">optional — addable later</i>
                    <input value={weight} onChange={e => setWeight(e.target.value)} inputMode="decimal" placeholder="e.g. 78" disabled={!canAdmit} aria-label="Weight in kilograms, optional" />
                  </label>
                  <label>Height (cm) <i className="admopt">optional — addable later</i>
                    <input value={height} onChange={e => setHeight(e.target.value)} inputMode="decimal" placeholder="e.g. 172" disabled={!canAdmit} aria-label="Height in centimetres, optional" />
                  </label>
                  {/* CODE STATUS — SELECTED from the governed vocabulary,
                      never typed (the SAFETY FIX); omitted = the record
                      honestly reads NOT RECORDED until a physician sets it */}
                  <label>Code status <i className="admopt">optional — settable at the bedside</i>
                    <select value={codeStatusCode} onChange={e => setCodeStatusCode(e.target.value)} disabled={!canAdmit}
                      aria-label="Code status, selected from the governed vocabulary, optional">
                      <option value="">Not recorded</option>
                      {(codeStatuses ?? []).filter(c => c.active).map(c => (
                        <option key={c.code} value={c.code}>{c.label}</option>
                      ))}
                    </select>
                  </label>
                  {!readmitting && (
                    <label className="admwide">Allergies
                      <input value={allergies} onChange={e => setAllergies(e.target.value)} disabled={!canAdmit} required />
                    </label>
                  )}
                  <label className="admwide">Admission diagnosis
                    <input value={diagnosis} onChange={e => setDiagnosis(e.target.value)} placeholder="e.g. Septic shock — pneumonia" disabled={!canAdmit} required />
                  </label>
                  {/* ATTENDING — SELECTED from the staff directory (senior
                      doctors), never typed. A free-text attending could be
                      mistyped into a wrong/ghost name; the roster picker
                      binds the encounter to a real consultant. */}
                  <label>Attending
                    <select value={attending} onChange={e => setAttending(e.target.value)} disabled={!canAdmit || !consultants} required
                      aria-label="Attending consultant, selected from the staff directory">
                      <option value="" disabled>{consultants ? 'Select a consultant…' : 'Loading…'}</option>
                      {(consultants ?? []).map(u => (
                        <option key={u.username} value={u.name}>{u.name}</option>
                      ))}
                      {attending && !(consultants ?? []).some(u => u.name === attending) && (
                        <option value={attending}>{attending}</option>
                      )}
                    </select>
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
                    {busy ? 'Working…' : readmitting ? 'Re-admit patient' : 'Admit patient'}
                  </button>
                )}
              </form>
            </Card>

            <Card icon={<IconBed size={15} stroke="var(--blue)" />} title="Current Census" aside={beds ? `${freeBeds.length} bed(s) free` : '—'}>
              <div className="admcensus">
                {/* ACTIVE beds only — a retired bed is not unit census
                    and must never read "Available" (it cannot be
                    admitted into; the verification caught the raw list
                    rendering a retired bed as free) */}
                {(beds ?? []).filter(b => b.active).map(b => (
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
      {match && (
        <MatchDialog
          result={match}
          canAdmit={canAdmit}
          canOverview={canOverview}
          busy={busy}
          error={matchError}
          onReadmit={readmitExisting}
          onCreateAnyway={createNewPatient}
          onClose={() => { setMatch(null); setMatchError(null) }}
        />
      )}
      <Toast state={toast} accent="cyan" />
    </div>
  )
}
