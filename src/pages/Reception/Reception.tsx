import { useCallback, useEffect, useMemo, useState } from 'react'
import './Reception.css'
import { AppHeader, type KpiSpec } from '../../components/AppHeader'
import { NavSidebar } from '../../components/NavSidebar'
import { Card } from '../../components/Card'
import { Toast, useToast } from '../../components/Toast'
import { IconAdmit, IconBed, IconClock, IconUsers } from '../../components/icons'
import {
  admitPatient, getAdmissionSources, getAdmissionTypes, getDepartments,
  getEncounters, getServices, getWardDoctors, matchPatient, searchPatients,
} from '../../lib/api'
import type {
  AdmissionSourceEntry, AdmissionTypeEntry, AdmitDraft, DepartmentEntry,
  Encounter, MatchCard, MatchPatientResponse, ServiceEntry, Sex, WardDoctorOption,
} from '../../lib/api/types'
import { getSession, hasPermission, initialsOf, profileOf } from '../../lib/session'
import { displayStamp, localStamp, localYmd, datedEpoch, wireStampOfLocal } from '../../lib/time'
import { MatchDialog } from '../Admissions/MatchDialog'

/* ==================== INPATIENT RECEPTION (/reception) ====================
   The front door of the ward journey (docs/design/inpatient-reception.md §3):
   a patient is found or registered, and an admission is created carrying
   Type, Department, Service, Admitting Doctor, Referring Doctor, admission
   time and Source. Reception stops there — no bed, no nurse, no note, no
   diagnosis, no orders (§3.5). Gated on `admissions.create`.

   🔴 THE CENTRAL CONSTRAINT — READ THIS BEFORE CHANGING ANY VALIDATION HERE.
   §3.2 marks Type of Admission, Department, Service, Admitting Doctor and
   the admission date/time REQUIRED. THE SERVER DOES NOT ENFORCE THAT, and
   that is a recorded decision, not an oversight: shipping them required
   would make admission impossible on the next update of a live install
   until somebody configured a department — while /healthz still answered
   200, so the health check passes and the updater does NOT roll back
   (option (c), recorded in the design's Amendments, in 02's Known Feature
   Gaps, and in a comment at the validation site in AdtApi.cs).

   THE CONSEQUENCE IS THAT **THIS SCREEN IS THE ONLY PLACE §3.2's
   REQUIRED-NESS IS ENFORCED.** The `formOk` gate below is not a
   convenience — it is the entire enforcement of five required fields, and
   a later refactor that "simplifies" it silently removes the requirement
   for the whole product. The dated condition for moving enforcement back
   to the server is recorded in the design: when every caller supplies the
   fields (this screen shipped, the ICU form updated, the 12 deployed
   suites migrated) AND the contracted site has configured its structure.
   Until then, deleting or loosening this gate is a functional change to
   the product's guarantees, not a cleanup.

   WHAT THE SERVER *DOES* ENFORCE, so this screen never duplicates it:
   an unknown code is 400, a retired code is 409, a service without its
   department is 400, a service under the wrong department is 400, an
   off-tier admitting doctor is 400, both referrer fields is 400, and a
   malformed or future admittedAt is 400. Those refusals are rendered as
   the server's own words — never re-worded, never pre-empted.

   FIND-OR-REGISTER IS NOT HAND-ROLLED. Browsing uses the existing partial
   search (#163) and SUBMIT uses the existing on-submit match endpoint and
   the existing MatchDialog — which already carries the tiered
   confirmed/probable card, the server-masked national ID, the
   currently-admitted guard and the deceased guard. Building a second
   find-or-register flow beside that machinery is the fork §1 forbids. */

const REQUIRED_HINT = 'required by the admission form'

export function Reception() {
  const session = getSession()!
  const { toast, showToast } = useToast()
  const canCreate = hasPermission(session.jobTitle, 'admissions.create')

  /* ---- the four governed vocabularies (#199) + the ward doctor tier ---- */
  const [admTypes, setAdmTypes] = useState<AdmissionTypeEntry[] | null>(null)
  const [departments, setDepartments] = useState<DepartmentEntry[] | null>(null)
  const [services, setServices] = useState<ServiceEntry[] | null>(null)
  const [admSources, setAdmSources] = useState<AdmissionSourceEntry[] | null>(null)
  const [wardDoctors, setWardDoctors] = useState<WardDoctorOption[] | null>(null)

  /* ---- patient: browse, or register ---- */
  const [q, setQ] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<{ rows: MatchCard[]; total: number; truncated: boolean } | null>(null)
  const [picked, setPicked] = useState<MatchCard | null>(null)
  const [nameFirst, setNameFirst] = useState('')
  const [nameSecond, setNameSecond] = useState('')
  const [nameFamily, setNameFamily] = useState('')
  const [nationalId, setNationalId] = useState('')
  const [fileNumber, setFileNumber] = useState('')
  const [dob, setDob] = useState('')
  const [sex, setSex] = useState<Sex | ''>('')
  const [allergies, setAllergies] = useState('None documented')

  /* ---- §3.2 the admission fields ---- */
  const [typeCode, setTypeCode] = useState('')
  const [deptCode, setDeptCode] = useState('')
  const [svcCode, setSvcCode] = useState('')
  const [doctorId, setDoctorId] = useState('')
  const [sourceCode, setSourceCode] = useState('')
  /* REFERRING DOCTOR — internal (an account) or external (free text), never
     both: the server 400s a payload naming both, so the form models it as
     one choice rather than two fields a clerk can fill at once. */
  const [refMode, setRefMode] = useState<'none' | 'internal' | 'external'>('none')
  const [refUserId, setRefUserId] = useState('')
  const [refName, setRefName] = useState('')
  /* ADMISSION DATE/TIME — auto-filled to the SERVER-LOCAL wall clock and
     editable (§3.2). Held as a wall-clock string and converted to the UTC
     wire form on submit; never sent raw. */
  const [admittedAt, setAdmittedAt] = useState(() => localStamp(Date.now()))

  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [match, setMatch] = useState<MatchPatientResponse | null>(null)
  const [matchError, setMatchError] = useState<string | null>(null)
  const [today, setToday] = useState<Encounter[] | null>(null)

  const loadVocabularies = useCallback(() => {
    getAdmissionTypes().then(setAdmTypes).catch(() => setAdmTypes(null))
    getDepartments().then(setDepartments).catch(() => setDepartments(null))
    getServices().then(setServices).catch(() => setServices(null))
    getAdmissionSources().then(setAdmSources).catch(() => setAdmSources(null))
    getWardDoctors().then(setWardDoctors).catch(() => setWardDoctors(null))
  }, [])

  /* ---- "ADMITTED TODAY" — this desk's own list -------------------------
     Amendment 1 makes a bedless admission a valid state and requires that
     something surfaces it: "an admission with no bed and no worklist that
     surfaces it is a patient who exists only in the database". This is that
     list for reception. It is NOT the ward worklist, which stays ward scope.

     FILTERED BY DATE, NOT BY ACTOR. `AdmittedBy` stores a display NAME, so
     scoping by it would make a new dependency on a display name for
     correctness — the defect class the unvalidated `Attending` already
     represents. A reception desk is also SHARED, so "what was admitted
     today" is the truer object than "what I admitted".

     THE UTC/LOCAL SEAM, handled rather than ignored: stamps are stored UTC
     and `admittedOn` filters on the UTC date, but "today" here means the
     SERVER-LOCAL day. Those are the same date only at offset zero. So the
     fetch asks for every UTC date the local day touches (one or two), and
     the local day is then applied exactly, on the display clock. */
  const loadToday = useCallback(() => {
    const now = Date.now()
    const utcDates = Array.from(new Set([
      new Date(now - 24 * 3600_000).toISOString().slice(0, 10),
      new Date(now).toISOString().slice(0, 10),
      new Date(now + 24 * 3600_000).toISOString().slice(0, 10),
    ]))
    Promise.all(utcDates.map(d => getEncounters({ admittedOn: d })))
      .then(lists => {
        const localToday = localYmd(now)
        const seen = new Set<string>()
        const rows = lists.flat().filter(e => {
          if (seen.has(e.encounterId)) return false
          seen.add(e.encounterId)
          const ms = datedEpoch(e.admittedAt)
          return ms !== null && localYmd(ms) === localToday
        })
        rows.sort((a, b) => (a.admittedAt < b.admittedAt ? 1 : -1))
        setToday(rows)
      })
      .catch(() => setToday(null))
  }, [])

  useEffect(() => { loadVocabularies(); loadToday() }, [loadVocabularies, loadToday])

  const activeTypes = useMemo(() => (admTypes ?? []).filter(t => t.active), [admTypes])
  const activeDepts = useMemo(() => (departments ?? []).filter(d => d.active), [departments])
  const activeSources = useMemo(() => (admSources ?? []).filter(s => s.active), [admSources])
  /* SERVICE IS FILTERED BY THE CHOSEN DEPARTMENT (§2.1) — and the server
     refuses a mismatch with a 400, so this filter is the form agreeing with
     a rule it does not own rather than enforcing one of its own. */
  const activeServices = useMemo(
    () => (services ?? []).filter(s => s.active && s.departmentCode === deptCode),
    [services, deptCode],
  )
  const deptLabel = useCallback(
    (code: string) => (departments ?? []).find(d => d.code === code)?.label ?? code,
    [departments],
  )

  /* ---- the empty states (step 4's, reaching the screen that needs them) --
     Production seeds NONE of these four (#199), so on a real install they
     are all empty on day one. A form that renders empty dropdowns makes the
     clerk discover that by failing; this says it, and points at the screen
     that fixes it. Type / Department / Service are REQUIRED here, so any one
     of them missing makes the form uncompletable — that is stated as the
     consequence rather than left to be inferred. Source of Admission is
     OPTIONAL and is deliberately NOT in this list: claiming reception is
     blocked on it would be a false statement on a working screen. */
  const missing = useMemo(() => {
    const m: string[] = []
    if (admTypes !== null && activeTypes.length === 0) m.push('Admission Types')
    if (departments !== null && activeDepts.length === 0) m.push('Departments')
    if (services !== null && departments !== null && activeDepts.length > 0
        && (services ?? []).filter(s => s.active).length === 0) m.push('Services')
    return m
  }, [admTypes, departments, services, activeTypes, activeDepts])
  const blocked = missing.length > 0

  /* LOADING IS NOT THE SAME STATE AS EMPTY, and on this form the two look
     identical: an unanswered vocabulary and a vocabulary with no entries
     both render an empty dropdown. `blocked` already waits for the answer
     (each leg tests `!== null`), so this only has to say which of the two
     silences the clerk is looking at. */
  const loading = admTypes === null || departments === null || services === null
    || admSources === null || wardDoctors === null
  const isReadmission = picked !== null

  /* 🔴 THE ONLY ENFORCEMENT OF §3.2's REQUIRED-NESS IN THE PRODUCT.
     See the header comment. Type, Department, Service, Admitting Doctor and
     the admission time are required; Referring Doctor and Source are not.
     Identity is required only when REGISTERING — a re-admission's stored
     identity stands (the server's own rule). */
  const identityOk = isReadmission
    || (nameFirst.trim() && nameSecond.trim() && nameFamily.trim() && dob && sex && allergies.trim())
  const referrerOk = refMode === 'none'
    || (refMode === 'internal' ? refUserId !== '' : refName.trim() !== '')
  const formOk = !!identityOk && !!typeCode && !!deptCode && !!svcCode && !!doctorId
    && !!admittedAt.trim() && referrerOk && !blocked && canCreate

  function resetAfterAdmit() {
    setPicked(null); setQ(''); setResults(null)
    setNameFirst(''); setNameSecond(''); setNameFamily(''); setNationalId('')
    setFileNumber(''); setDob(''); setSex(''); setAllergies('None documented')
    setTypeCode(''); setDeptCode(''); setSvcCode(''); setDoctorId(''); setSourceCode('')
    setRefMode('none'); setRefUserId(''); setRefName('')
    setAdmittedAt(localStamp(Date.now()))
  }

  /* the §3.2 half of the payload — shared by the register path and the
     re-admission path so the two can never drift */
  function admissionFields() {
    /* WALL-CLOCK → UTC, once, here. The server validates the UTC form and
       refuses a future stamp; this converts and refuses locally first so a
       clerk sees the problem beside the field instead of as a server error. */
    const wire = wireStampOfLocal(admittedAt.trim())
    return {
      admissionTypeCode: typeCode,
      departmentCode: deptCode,
      serviceCode: svcCode,
      admittingDoctorUserId: doctorId,
      ...(sourceCode ? { admissionSourceCode: sourceCode } : {}),
      ...(refMode === 'internal' && refUserId ? { referrerUserId: refUserId } : {}),
      ...(refMode === 'external' && refName.trim() ? { referrerName: refName.trim() } : {}),
      ...(wire ? { admittedAt: wire } : {}),
    }
  }

  async function create(patientId?: string) {
    setBusy(true); setFormError(null); setMatchError(null)
    const draft: AdmitDraft = patientId
      ? { patientId, ...admissionFields() }
      : {
        nameFirst: nameFirst.trim(), nameSecond: nameSecond.trim(), nameFamily: nameFamily.trim(),
        ...(nationalId.trim() ? { nationalId: nationalId.trim() } : {}),
        ...(fileNumber.trim() ? { fileNumber: fileNumber.trim() } : {}),
        dateOfBirth: dob, sex: sex as Sex, allergies: allergies.trim(),
        ...admissionFields(),
      }
    const res = await admitPatient(draft)
    setBusy(false)
    if (res.kind === 'ok') {
      setMatch(null)
      showToast('Admission created',
        `${res.data.patient.name} · ${res.data.patient.mrn} — awaiting bed. The ward assigns it.`)
      resetAfterAdmit(); loadToday()
      return
    }
    /* the server's OWN words, never re-worded — an unknown or retired code,
       a service under the wrong department, an off-tier doctor and a future
       time all arrive here already explained */
    const msg = res.kind === 'rejected' ? res.error
      : 'Reception requires the live server — nothing was created'
    if (match) setMatchError(msg); else setFormError(msg)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!formOk || busy) return
    setFormError(null)
    /* the admission time never leaves this screen in the future tense */
    const wire = wireStampOfLocal(admittedAt.trim())
    if (!wire) {
      setFormError('Admission date/time must read yyyy-MM-dd HH:mm')
      return
    }
    if (Date.parse(wire.replace(' ', 'T') + ':00Z') > Date.now() + 5 * 60_000) {
      setFormError('Admission date/time is in the future — a patient cannot be admitted before they arrive')
      return
    }
    if (isReadmission) { await create(picked!.patientId); return }
    /* ON SUBMIT, NEVER PER KEYSTROKE — the existing match endpoint. Nothing
       is created while the dialog is open; the dialog decides. */
    setBusy(true)
    const check = await matchPatient({
      ...(nationalId.trim() ? { nationalId: nationalId.trim() } : {}),
      ...(fileNumber.trim() ? { fileNumber: fileNumber.trim() } : {}),
      nameFirst: nameFirst.trim(), nameSecond: nameSecond.trim(), nameFamily: nameFamily.trim(),
      ...(dob ? { dateOfBirth: dob } : {}),
    })
    setBusy(false)
    if (check.kind === 'rejected') { setFormError(check.error); return }
    if (check.kind === 'offline') {
      setFormError('Reception requires the live server — nothing was checked and nothing was created')
      return
    }
    if (check.data.matches.length > 0) { setMatchError(null); setMatch(check.data); return }
    await create()
  }

  async function runSearch(e: React.FormEvent) {
    e.preventDefault()
    if (q.trim().length < 2) { setResults(null); return }
    setSearching(true)
    const r = await searchPatients(q.trim(), 'all', 25)
    setSearching(false)
    setResults(r ? { rows: r.results, total: r.total, truncated: r.truncated } : null)
  }

  /* '—' on an unreachable server, never 0: a desk that reads "0 admitted
     today" when the truth is "we could not ask" is the fabricated-count
     defect the Alerts badge was removed for. */
  const kpis: KpiSpec[] = [
    {
      icon: <IconAdmit size={14} stroke="var(--cyan)" />, iconBg: 'rgba(var(--cyan-rgb),.13)',
      value: today === null ? '—' : today.length, label: 'Admitted Today',
    },
    {
      icon: <IconBed size={14} stroke="var(--amber)" />, iconBg: 'rgba(var(--amber-rgb),.14)',
      value: today === null ? '—' : today.filter(e => e.status === 'open' && !e.bedId).length,
      label: 'Awaiting Bed',
    },
  ]

  return (
    <div className="app-frame rcp">
      <AppHeader
        subtitle="Inpatient Reception · Ward"
        kpis={kpis}
        user={{ initials: initialsOf(session.name), name: session.name, role: `${session.jobTitle} · ${profileOf(session.jobTitle)} profile` }}
      />
      <div className="shell">
        <NavSidebar active="reception" footerLines={[`Role: ${profileOf(session.jobTitle)} profile`, 'Reception · Ward']} />

        <main>
          {!canCreate && (
            <div className="rcpnote" role="note">
              View only — creating an admission requires <b>admissions.create</b>.
            </div>
          )}

          {/* THE BLOCKED STATE — said, not discovered by failing */}
          {blocked && (
            <div className="rcpblocked" role="alert">
              <b>Reception cannot register a patient yet.</b> {
                /* "A and B", not "A, B" — this is the first sentence a
                   clerk reads on a fresh install, and it should read like
                   a sentence */
                missing.length > 1
                  ? `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}`
                  : missing[0]}
              {missing.length === 1 ? ' has' : ' have'} no active entries, and
              {missing.length === 1 ? ' it is' : ' they are'} <b>required on every admission</b>.
              Open <b>Configuration → Hospital</b> and add
              {missing.includes('Departments') ? ' the hospital’s departments first (services belong to one)' : ' them'},
              then return here. Nothing on this form is saved until they exist.
            </div>
          )}

          <div className="rcpcols">
            {/* ---------------- PATIENT ---------------- */}
            <Card icon={<IconUsers size={15} stroke="var(--blue)" />} title="Patient"
              aside={isReadmission ? 'returning patient' : 'search first, register only if new'}>
              <form className="rcpsearch" onSubmit={runSearch}>
                <input
                  value={q} onChange={e => setQ(e.target.value)}
                  placeholder="Search name, MRN, file number or national ID…"
                  aria-label="Search patients by name, MRN, file number or national ID"
                />
                <button className="rcpact" type="submit" disabled={searching || q.trim().length < 2}>
                  {searching ? 'Searching…' : 'Search'}
                </button>
              </form>
              <p className="rcphint">
                Searches <b>every</b> patient, including previously discharged — a returning
                patient is found, never re-created.
              </p>

              {results && results.rows.length === 0 && (
                <div className="rcpempty" role="note">
                  No patient matches “{q.trim()}”. Register them below — the MRN is assigned by Aurora.
                </div>
              )}
              {results && results.rows.length > 0 && (
                <div className="rcprows">
                  {results.truncated && (
                    <div className="rcphint" role="note">
                      Showing {results.rows.length} of {results.total} — refine the search to narrow it.
                    </div>
                  )}
                  {results.rows.map(m => (
                    <div className={`rcprow${picked?.patientId === m.patientId ? ' on' : ''}`} key={m.patientId}>
                      <span className="rcpwho">
                        <b>{m.fullName}</b>
                        <small className="num">{m.mrn}{m.fileNumber ? ` · file ${m.fileNumber}` : ''}
                          {m.nationalIdLast4 ? ` · ID ••••${m.nationalIdLast4}` : ''}</small>
                      </span>
                      <span className="rcpmeta">{m.age} · {m.sex}<small>{m.admissionCount} admission(s)</small></span>
                      <span className={`rcpstatus ${m.status}`}>
                        {m.status === 'admitted' ? 'Admitted' : m.status === 'deceased' ? 'Deceased' : 'Discharged'}
                      </span>
                      {/* the same two guards the dialog carries, at the point of choosing */}
                      {m.status === 'admitted' && (
                        <span className="rcpguard">already admitted{m.currentBedId ? ` · bed ${m.currentBedId}` : ''} — cannot be admitted twice</span>
                      )}
                      {m.status === 'deceased' && (
                        <span className="rcpguard">recorded as deceased — a deceased patient cannot be re-admitted</span>
                      )}
                      {m.status === 'discharged' && (
                        <button className="rcpact" disabled={!canCreate}
                          onClick={() => { setPicked(m); setResults(null) }}>
                          Admit this patient
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {isReadmission && (
                <div className="rcppicked" role="note">
                  Admitting <b>{picked!.fullName}</b> <span className="num">({picked!.mrn})</span> — their
                  stored identity stands; this creates a new admission only.
                  <button className="rcpact" onClick={() => setPicked(null)}>Choose someone else</button>
                </div>
              )}

              {!isReadmission && (
                <div className="rcpfields">
                  <label>First name <input value={nameFirst} onChange={e => setNameFirst(e.target.value)} disabled={!canCreate} /></label>
                  <label>Father’s name <input value={nameSecond} onChange={e => setNameSecond(e.target.value)} disabled={!canCreate} /></label>
                  <label>Family name <input value={nameFamily} onChange={e => setNameFamily(e.target.value)} disabled={!canCreate} /></label>
                  <label>National ID <small>optional, exactly as on the card</small>
                    <input value={nationalId} onChange={e => setNationalId(e.target.value)} disabled={!canCreate} /></label>
                  <label>File number <small>optional, the hospital’s chart number</small>
                    <input className="num" value={fileNumber} onChange={e => setFileNumber(e.target.value)} disabled={!canCreate} /></label>
                  <label>Date of birth <input type="date" value={dob} onChange={e => setDob(e.target.value)} disabled={!canCreate} /></label>
                  <label>Sex
                    <select value={sex} onChange={e => setSex(e.target.value as Sex)} disabled={!canCreate}>
                      <option value="">Select…</option><option value="M">Male</option><option value="F">Female</option>
                    </select>
                  </label>
                  <label className="rcpwide">Allergies <input value={allergies} onChange={e => setAllergies(e.target.value)} disabled={!canCreate} /></label>
                </div>
              )}
            </Card>

            {/* ---------------- THE ADMISSION ---------------- */}
            <Card icon={<IconAdmit size={15} stroke="var(--cyan)" />} title="Admission"
              aside="no bed, no diagnosis — the ward takes it from here">
              <form className="rcpform" onSubmit={submit}>
                {loading && (
                  <div className="rcpempty" role="status">
                    Loading this hospital’s admission structure…
                  </div>
                )}
                <div className="rcpfields">
                  <label>Type of admission <small>{REQUIRED_HINT}</small>
                    <select value={typeCode} onChange={e => setTypeCode(e.target.value)} disabled={!canCreate || blocked}>
                      <option value="">Select…</option>
                      {activeTypes.map(t => <option key={t.code} value={t.code}>{t.label}</option>)}
                    </select>
                  </label>

                  <label>Department <small>{REQUIRED_HINT}</small>
                    <select value={deptCode} onChange={e => { setDeptCode(e.target.value); setSvcCode('') }} disabled={!canCreate || blocked}>
                      <option value="">Select…</option>
                      {activeDepts.map(d => <option key={d.code} value={d.code}>{d.label}</option>)}
                    </select>
                  </label>

                  <label>Service <small>{deptCode ? `under ${deptLabel(deptCode)}` : 'choose a department first'}</small>
                    <select value={svcCode} onChange={e => setSvcCode(e.target.value)} disabled={!canCreate || blocked || !deptCode}>
                      <option value="">{deptCode ? 'Select…' : 'Department first'}</option>
                      {activeServices.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
                    </select>
                    {deptCode && activeServices.length === 0 && (
                      <small className="rcpwarn">
                        {deptLabel(deptCode)} has no active services — add one in Configuration, or choose another department.
                      </small>
                    )}
                  </label>

                  <label>Admitting doctor <small>{REQUIRED_HINT} · ward tier</small>
                    <select value={doctorId} onChange={e => setDoctorId(e.target.value)} disabled={!canCreate || blocked || wardDoctors === null}>
                      <option value="">{wardDoctors === null ? 'Unavailable — the server is unreachable' : 'Select…'}</option>
                      {(wardDoctors ?? []).map(d => (
                        <option key={d.username} value={d.username}>{d.name} — {d.jobTitle}</option>
                      ))}
                    </select>
                  </label>

                  <label>Admission date/time <small>auto-filled to this hospital’s clock — editable</small>
                    <input className="num" value={admittedAt} onChange={e => setAdmittedAt(e.target.value)}
                      disabled={!canCreate || blocked} placeholder="yyyy-MM-dd HH:mm"
                      aria-label="Admission date and time, hospital local clock, editable" />
                  </label>

                  <label>Source of admission <small>optional</small>
                    <select value={sourceCode} onChange={e => setSourceCode(e.target.value)} disabled={!canCreate || blocked}>
                      <option value="">Not recorded</option>
                      {activeSources.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
                    </select>
                  </label>

                  {/* REFERRING DOCTOR — one choice, because the server refuses both */}
                  <div className="rcpwide rcpreferrer">
                    <span className="rcplabel">Referring doctor <small>optional — one or the other, never both</small></span>
                    <div className="rcpseg" role="radiogroup" aria-label="Referring doctor kind">
                      {(['none', 'internal', 'external'] as const).map(k => (
                        <button key={k} type="button" role="radio" aria-checked={refMode === k}
                          className={`rcpsegbtn${refMode === k ? ' on' : ''}`} disabled={!canCreate || blocked}
                          onClick={() => { setRefMode(k); setRefUserId(''); setRefName('') }}>
                          {k === 'none' ? 'Not recorded' : k === 'internal' ? 'Our own staff' : 'External'}
                        </button>
                      ))}
                    </div>
                    {refMode === 'internal' && (
                      <select value={refUserId} onChange={e => setRefUserId(e.target.value)} disabled={!canCreate}>
                        <option value="">Select a doctor…</option>
                        {(wardDoctors ?? []).map(d => <option key={d.username} value={d.username}>{d.name} — {d.jobTitle}</option>)}
                      </select>
                    )}
                    {refMode === 'external' && (
                      <input value={refName} onChange={e => setRefName(e.target.value)} disabled={!canCreate}
                        placeholder="e.g. Dr Ahmed — City Clinic" aria-label="External referring doctor, free text" />
                    )}
                    {refMode === 'none' && (
                      <small className="rcphint">Left blank the admission records no referrer — never a placeholder.</small>
                    )}
                  </div>
                </div>

                {formError && <div className="rcperr" role="alert">{formError}</div>}

                <button className="rcpsubmit" type="submit" disabled={!formOk || busy}>
                  {busy ? 'Creating…' : 'Create admission'}
                </button>
                <p className="rcphint">
                  Creates the admission and stops. <b>No bed, no nurse, no note, no diagnosis, no orders</b> —
                  the ward assigns the bed and the resident writes the rest.
                </p>
              </form>
            </Card>
          </div>

          {/* ---------------- ADMITTED TODAY ---------------- */}
          <Card icon={<IconClock size={15} stroke="var(--green)" />} title="Admitted today"
            aside={today === null ? '—' : `${today.length} admission(s) · this desk’s own list`}>
            {today === null && <div className="rcpempty">The live server is unreachable — this list is not shown rather than shown wrong.</div>}
            {today?.length === 0 && (
              <div className="rcpempty" role="note">
                Nothing admitted today yet. Admissions created here appear immediately, with or without a bed.
              </div>
            )}
            <div className="rcprows">
              {(today ?? []).map(e => (
                <div className="rcprow" key={e.encounterId}>
                  <span className="rcpwho"><b>{e.patientName}</b><small className="num">{e.encounterId}</small></span>
                  <span className="rcpmeta">
                    {e.departmentCode ? deptLabel(e.departmentCode) : 'no department recorded'}
                    <small>{displayStamp(e.admittedAt)}</small>
                  </span>
                  <span className={`rcpstatus ${e.status === 'open' && !e.bedId ? 'awaiting' : e.status}`}>
                    {e.status === 'discharged' ? 'Discharged'
                      : e.bedId ? `Bed ${e.bedId}` : 'Awaiting bed'}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </main>
      </div>

      {match && (
        <MatchDialog
          result={match}
          /* the dialog's action gate is "may this user open an episode" —
             here that atom is admissions.create, not adt.admit */
          canAdmit={canCreate}
          /* reception never reaches a clinical pane: the History Overview
             button is results.view and stays absent for this profile */
          canOverview={hasPermission(session.jobTitle, 'results.view')}
          busy={busy}
          error={matchError}
          onReadmit={pid => { void create(pid) }}
          onCreateAnyway={() => { void create() }}
          onClose={() => { setMatch(null); setMatchError(null) }}
        />
      )}
      <Toast state={toast} accent="cyan" />
    </div>
  )
}
