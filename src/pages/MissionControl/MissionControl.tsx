import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import './MissionControl.css'
import { Card } from '../../components/Card'
import { Badge } from '../../components/Badge'
import { BedChip, TagList } from '../../components/Tag'
import { BackButton } from '../../components/AppHeader'
import { DataAge } from '../../components/DataAge'
import { NotFoundCard } from '../../components/NotFoundCard'
import { IconPulse, IconSearch } from '../../components/icons'
import { useClock } from '../../hooks/useClock'
import { getCoverage, getCodeStatuses, getEncounters, getIsolationTypes, getPatientDetail, getPatientIdentity, getPatients, isolationTypeLabel, setEncounterCodeStatus, setEncounterIsolation } from '../../lib/api'
import { usePatientObservations, usePatientScores } from '../../hooks/usePatientScores'
import { unitSuffix, useHospitalIdentity } from '../../lib/hospitalIdentity'
import { resolveCodeStatus } from '../../lib/codeStatus'
import { Toast, useToast } from '../../components/Toast'
import { latestObservations, projectHemodynamics, type LatestObservation } from '../../lib/api/bedside'
import { useRememberPatient } from '../../lib/patientContext'
import { getSession, hasPermission, profileOf, signOut } from '../../lib/session'
import type { CoverageRow, CodeStatusEntry, IsolationTypeEntry, PatientDetailResponse, PatientIdentity, PatientSummary } from '../../lib/api/types'
import { IdentityDialog } from './IdentityDialog'
import { AssignmentDialog } from './AssignmentDialog'
import { LatestObservationsCard } from './LatestObservationsCard'
import { AttachmentsCard } from './AttachmentsCard'
import { LabsCard } from './LabsCard'
import { ActiveMedicationsCard } from './ActiveMedicationsCard'
import { ImagingResultsCard } from './ImagingResultsCard'
import { PatientNurseCarePanel } from '../../features/nurse-care/PatientNurseCarePanel'
import { WeightHeightCard } from './WeightHeightCard'
import { SofaCard } from './SofaCard'
import { News2Card } from './News2Card'
import { displayStamp } from '../../lib/time'

type Filter = 'all' | 'vent' | 'pressor' | 'crrt' | 'ecmo' | 'iso' | 'alerts'
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'vent', label: 'Vent' }, { key: 'pressor', label: 'Pressors' },
  { key: 'crrt', label: 'CRRT' }, { key: 'ecmo', label: 'ECMO' }, { key: 'iso', label: 'Isolation' },
  { key: 'alerts', label: 'Alerts' },
]

/* ONE SEARCH BOX (locked decision 5) — type a name or a number. Stated
   semantics (the flagged choice): SUBSTRING across the name fields — the
   display name AND the full legal name, so a grandfather's name finds the
   patient — plus the bed; PREFIX/EXACT on the numbers (MRN, national ID,
   and the hospital's own file number — the number staff actually know).
   NO fuzzy/phonetic matching: a near-miss on patient identity is a safety
   risk, not a convenience. */
function matches(p: PatientSummary, filter: Filter, query: string): boolean {
  if (query) {
    const names = `${p.name} ${p.fullName ?? ''} ${p.bedId}`.toLowerCase()
    const hit = names.includes(query)
      || p.mrn.toLowerCase().startsWith(query)
      || (p.nationalId ?? '').startsWith(query)
      || (p.fileNumber ?? '').toLowerCase().startsWith(query)
    if (!hit) return false
  }
  if (filter === 'all') return true
  if (filter === 'iso') return p.isolation
  if (filter === 'alerts') return p.alertCount > 0
  return p.flags.includes(filter)
}

const initials = (name: string) => name.split(' ').map(w => w[0]).slice(0, 2).join('')

export function MissionControl() {
  const { patientId = '' } = useParams()
  const navigate = useNavigate()
  const { time, date, shortTime } = useClock()
  const hospIdentity = useHospitalIdentity()
  const [patients, setPatients] = useState<PatientSummary[] | null>(null)
  const [detail, setDetail] = useState<PatientDetailResponse | null>(null)
  /* PATIENT ISOLATION (owner's plan §3): everything below that holds a
     patient's data is shown ONLY when it belongs to the routed patient.
     `current` is the patient on screen now — a refresh answering after a
     switch is dropped instead of overwriting the new patient's state. */
  const current = useRef(patientId)
  current.current = patientId
  const refreshDetail = (id: string) =>
    getPatientDetail(id).then(r => { if (r && current.current === id) setDetail(r) })
  /* CHART AGE (step 1): stamped by the chart read that backs this screen's
     body. Deliberately NOT the score fetch: in an environment where only the
     observation domain is unreachable the scores are unavailable while the
     rest of the chart loaded fine, and a single "Not read" chip would
     overstate that (caught in the rendered sweep). The SOFA/NEWS2 cards
     already state their own unavailable status — that division of labour is
     the #154 display-honesty rule, and this chip does not duplicate it. */
  const [chartAt, setChartAt] = useState<number | null>(null)
  /* the patient whose id did not resolve — tagged, so a switch never
     shows the previous id's not-found card for the new one */
  const [missingFor, setMissingFor] = useState<string | null>(null)
  const missing = missingFor !== null && missingFor === patientId
  /* ADT disposition of the routed patient, from a REAL encounter read —
     Mission Control is the OPEN-CENSUS view, so a discharged patient does
     not belong here: it redirects to their durable record at /history. This
     also closes the masking bug — in staging a discharged SEEDED patient
     would otherwise fall back to the mock store and render here as if still
     admitted; the real read redirects them instead. 'checking' suppresses
     the body until the read resolves (no mock flash); 'present' = admitted
     (real OR pure-mock demo, where a known patient still has a synthetic
     open encounter) or a truly-unknown id (→ the existing NotFound card). */
  const [adt, setAdt] = useState<'checking' | 'present' | 'redirecting'>('checking')
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')

  useEffect(() => { getPatients().then(setPatients) }, [])

  /* PERSON-LEVEL IDENTITY for the patient header — the full legal name +
     national identity number belong here and on official documents (the
     compact display name serves everywhere else). Real-only read; null
     renders nothing extra (honest absence). */
  const [pid, setPid] = useState<PatientIdentity | null>(null)
  const [correcting, setCorrecting] = useState(false)
  const session = getSession()
  const { toast, showToast } = useToast()
  const canCorrectIdentity = session ? hasPermission(session.jobTitle, 'identity.correct') : false
  /* THE NURSE'S CHART (owner's decision 2026-10-15; contract §6: the
     Nurse permission profile): SOFA / NEWS2 are hidden throughout it —
     cards, observation score chips, legends — while every observation
     stays visible. Every other profile keeps its scoring presentation. */
  const isNurseChart = session ? profileOf(session.jobTitle) === 'Nurse' : false
  const showScores = !isNurseChart
  /* the Patient History Overview (match+overview design §5.4 — reachable
     from the chart too): clinical history, so results.view — held by
     every clinical profile and by NEITHER administrator (the locked
     rule: the office Administrator never sees clinical data) */
  const canHistory = session ? hasPermission(session.jobTitle, 'results.view') : false
  /* the chart's Laboratory / Imaging Results ride the same results.view —
     the server's gate on both reads; a profile without it sees neither */
  const canResults = canHistory
  /* ORDER shortcut — jumps straight to Orders & Meds scoped to THIS
     patient (real navigation, not a fabricated drawer — the fake
     "+ Order" drawer was retired in #93). Gated on orders.view, the same
     permission the /orders/:patientId route requires. */
  const canOrder = session ? hasPermission(session.jobTitle, 'orders.view') : false

  /* NURSE COVERAGE (Assignment Simplification — the opt-out model):
     everyone with patients.view SEES who is covering; carving/restoring
     exceptions is gated on assignments.manage (SeniorDoctor — the
     recorded interim). Doctors have no assignment concept. */
  const [careTeam, setCareTeam] = useState<CoverageRow | null>(null)
  const [teamOpen, setTeamOpen] = useState(false)
  const canManageAssignments = session ? hasPermission(session.jobTitle, 'assignments.manage') : false
  const loadCareTeam = (id: string) => getCoverage(id).then(rows => setCareTeam(rows[0] ?? null)).catch(() => setCareTeam(null))

  /* CODE STATUS set control (the governed-vocabulary SAFETY FIX):
     physician-only (codestatus.set); the popover lists ONLY the ACTIVE
     vocabulary entries — selected, never typed; the write targets the
     patient's OPEN encounter and the server audits who/when/role/prior. */
  const canSetCodeStatus = session ? hasPermission(session.jobTitle, 'codestatus.set') : false
  const [csOpen, setCsOpen] = useState(false)
  const [csVocab, setCsVocab] = useState<CodeStatusEntry[] | null>(null)
  const [csBusy, setCsBusy] = useState(false)
  const [csError, setCsError] = useState<string | null>(null)
  useEffect(() => {
    if (csOpen && csVocab === null) getCodeStatuses().then(setCsVocab).catch(() => setCsVocab([]))
  }, [csOpen, csVocab])
  useEffect(() => { setCsOpen(false); setCsError(null) }, [patientId])

  /* ISOLATION PRECAUTIONS (Configuration Vocabularies — the boolean's
     upgrade): BEDSIDE CLINICIAN authority (observations.record — any
     doctor or nurse; the vocabulary itself is managed separately under
     isolation.manage). The popover offers the ACTIVE types as a
     MULTI-SELECT (contact AND droplet is clinically real); the write
     REPLACES the open encounter's set ([] clears) and the server audits
     the change with the prior set. */
  const canSetIsolation = session ? hasPermission(session.jobTitle, 'observations.record') : false
  const [isoOpen, setIsoOpen] = useState(false)
  const [isoVocab, setIsoVocab] = useState<IsolationTypeEntry[] | null>(null)
  const [isoSel, setIsoSel] = useState<string[]>([])
  const [isoBusy, setIsoBusy] = useState(false)
  const [isoError, setIsoError] = useState<string | null>(null)
  const railRec = patients?.find(x => x.patientId === patientId)
  const isoCurrent = useMemo(() => railRec?.isolationTypes ?? [], [railRec])
  useEffect(() => {
    if (isoOpen && isoVocab === null) getIsolationTypes().then(setIsoVocab).catch(() => setIsoVocab([]))
  }, [isoOpen, isoVocab])
  useEffect(() => { setIsoOpen(false); setIsoError(null) }, [patientId])
  useEffect(() => { if (isoOpen) setIsoSel(isoCurrent) }, [isoOpen, isoCurrent])
  async function doSetIsolation() {
    setIsoBusy(true); setIsoError(null)
    const open = await getEncounters({ patientId, status: 'open' }).catch(() => [])
    if (open.length === 0) {
      setIsoBusy(false)
      setIsoError('No open encounter — isolation precautions are set on an active admission')
      return
    }
    const res = await setEncounterIsolation(open[0].encounterId, isoSel)
    setIsoBusy(false)
    if (res.kind === 'ok') {
      setIsoOpen(false)
      const names = isoSel.length === 0 ? 'cleared' : isoSel.map(isolationTypeLabel).join(' + ')
      showToast('Isolation precautions', `${names} — recorded on ${open[0].encounterId} (audited)`)
      getPatients().then(setPatients)
      refreshDetail(patientId)
      return
    }
    setIsoError(res.kind === 'rejected' ? res.error
      : 'Setting isolation requires the live server — NOT recorded')
  }
  async function doSetCodeStatus(code: string, label: string) {
    setCsBusy(true); setCsError(null)
    const open = await getEncounters({ patientId, status: 'open' }).catch(() => [])
    if (open.length === 0) {
      setCsBusy(false)
      setCsError('No open encounter — a code status is set on an active admission')
      return
    }
    const res = await setEncounterCodeStatus(open[0].encounterId, code)
    setCsBusy(false)
    if (res.kind === 'ok') {
      setCsOpen(false)
      showToast('Code status set', `${label} — recorded on ${open[0].encounterId} (audited)`)
      refreshDetail(patientId)
      return
    }
    setCsError(res.kind === 'rejected' ? res.error
      : 'Setting a code status requires the live server — NOT recorded')
  }
  useEffect(() => {
    let stale = false
    setCareTeam(null)
    setTeamOpen(false)
    if (patientId) getCoverage(patientId).then(rows => { if (!stale) setCareTeam(rows[0] ?? null) }).catch(() => { if (!stale) setCareTeam(null) })
    return () => { stale = true }
  }, [patientId])
  useEffect(() => {
    let stale = false
    setPid(null)
    setCorrecting(false)
    if (patientId) getPatientIdentity(patientId).then(r => { if (!stale) setPid(r) })
    return () => { stale = true }
  }, [patientId])

  /* opening a chart records the cross-section patient context (only once
     the roster confirms the id resolves) */
  useRememberPatient(patientId, patients)

  /* ONE fetch+compute for every score-derived surface on this page:
     NEWS2 + SOFA cards and the observation tiles' score colours — and the
     latest-observations map, which projects from the SAME full-chart read
     NEWS2 consumes (no second observation fetch, no possible
     disagreement). The nurse's chart shows no score, so it reads ONLY that
     full chart (usePatientObservations) and computes nothing it would
     hide. Both hooks are patient-keyed: a switch shows the new patient's
     loading state in the same render, never the previous chart. */
  const scores = usePatientScores(showScores ? patientId : '')
  const nurseObs = usePatientObservations(showScores ? '' : patientId)
  const obsRead = showScores ? scores : nurseObs
  const chartObservations = obsRead.observations
  /* §12 step 4: the latest-per-type observation map for the combined card
     (real read; empty when nothing is charted or the read failed — the
     card then says "not charted" / "not read" honestly) */
  const latestObs = useMemo<Map<string, LatestObservation>>(
    () => (chartObservations ? latestObservations(chartObservations) : new Map()), [chartObservations])
  /* the 24 h fluid-balance strip — projectHemodynamics' own computation
     over the same read (charted INTERVAL fluids only), unchanged */
  const fluidBalance = useMemo(
    () => (chartObservations ? projectHemodynamics(latestObs, chartObservations).fluidBalance : undefined),
    [latestObs, chartObservations])

  /* REAL open-encounter check drives the discharged→history redirect. ONE
     read of the patient's encounters: an OPEN one → admitted, render Mission
     Control; NO open but the patient EXISTS (a closed encounter) → discharged
     → redirect to the durable /history record (replace, so Back skips the
     dead census view); NO encounters at all → unknown id, fall through to the
     existing NotFound path. In pure-mock/offline mode getEncounters
     synthesizes an open encounter for a KNOWN patient, so the demo still
     opens here — only a real server ever reports zero open encounters. */
  useEffect(() => {
    let stale = false
    setAdt('checking')
    if (!patientId) { setAdt('present'); return }
    getEncounters({ patientId }).then(list => {
      if (stale) return
      if (list.some(e => e.status === 'open')) { setAdt('present'); return }
      if (list.length > 0) {
        setAdt('redirecting')
        navigate(`/patients/${patientId}/history`, { replace: true })
        return
      }
      setAdt('present')
    }).catch(() => { if (!stale) setAdt('present') })
    return () => { stale = true }
  }, [patientId, navigate])

  useEffect(() => {
    let stale = false
    setMissingFor(null)
    setDetail(null)
    setChartAt(null)
    getPatientDetail(patientId).then(res => {
      if (stale) return
      if (!res) {
        /* Locked decision: an unresolved ID must render an explicit not-found
           state — never redirect to or display another patient's chart. */
        setDetail(null)
        setMissingFor(patientId)
        return
      }
      setDetail(res)
      setChartAt(Date.now())
    })
    return () => { stale = true }
  }, [patientId])

  const unit = useMemo(() => {
    if (!patients) return null
    return {
      census: `${patients.length} / 16`,
      vent: patients.filter(p => p.flags.includes('vent')).length,
      pressors: patients.filter(p => p.flags.includes('pressor')).length,
    }
  }, [patients])

  const filtered = patients?.filter(p => matches(p, filter, query)) ?? []
  /* the routed patient's chart ONLY — a detail, identity or coverage row
     still held for the previous patient renders as absent */
  const shown = detail && detail.patient.patientId === patientId ? detail : null
  const shownPid = pid && pid.patientId === patientId ? pid : null
  const shownTeam = careTeam && careTeam.patientId === patientId ? careTeam : null
  const p = shown?.patient
  /* the header's unit-stats figure, unchanged in meaning: it counts the
     critical entries of the per-patient alerts feed (absent in production
     → 0). Only the chart's Smart Alerts CARD was removed (owner's plan
     §3); this figure, the rail's alert counts and the Alerts filter stay. */
  const critAlerts = (shown?.alerts ?? []).filter(a => a.severity === 'crit').length

  return (
    <div className="app-frame mc">
      <header className="top">
        <div className="brandrow">
          {/* Mission Control has its own header (not AppHeader) — the
              app-wide back control must render here too, same edges. */}
          <BackButton />
          <div className="brand">
            <div className="logo"><IconPulse size={16} stroke="var(--ink)" strokeWidth={2.6} /></div>
            {/* unit segment from the CONFIGURED hospital identity (one
                resolver) — omitted while unset, never a hardcoded name */}
            <div>AURORA ICU<small>Mission Control{hospIdentity ? unitSuffix(hospIdentity) : ''}</small></div>
          </div>
          <div className="unitstats">
            <div className="us">Census<b>{unit?.census ?? '—'}</b></div>
            <div className="us">Ventilated<b>{unit?.vent ?? '—'}</b></div>
            <div className="us">On Pressors<b>{unit?.pressors ?? '—'}</b></div>
            <div className="us">Critical Alerts<b style={{ color: 'var(--red)' }}>{critAlerts}</b></div>
          </div>
          <div className="spacer" />
          <div className="clock"><b>{time}</b><span>{date}</span></div>
          {/* FRESHNESS (step 1): this chart is read when it OPENS and does
              not follow the ward — a Mission Control left up through a shift
              shows the chart as of the moment it was opened. Beside the wall
              clock, because a current time next to data of unknown age is
              exactly the confusion this ends. scores.fetchedAt is the widest
              read on the page (chart + labs + orders + encounter), so it is
              the honest age of what is on screen. */}
          <div className="dagerow"><DataAge at={chartAt} what="This patient's chart" /></div>
          <button className="switchrole" onClick={() => { signOut(); navigate('/login') }}>Switch role</button>
        </div>
        <div className="banner">
          <div className="pt-id">
            <div className="avatar">{p ? initials(p.name) : '—'}</div>
            <div>
              {/* the PATIENT HEADER carries the FULL LEGAL NAME (all
                  present parts) + national ID — the compact display name
                  serves everywhere else; legacy single names render as-is */}
              <h1>{shownPid?.fullName ?? p?.name ?? '—'}</h1>
              <div className="sub">
                {/* EMPTY IS ABSENT, not a value (ward.md A5): the nullish
                    guard alone rendered "Bed " for a bedless patient — ""
                    is how the model spells "no bed", so it gets the words,
                    while a still-loading p keeps the honest dash */}
                <span>{p?.mrn ?? 'MRN —'}</span> · <span>{p ? (p.bedId ? `Bed ${p.bedId}` : 'Awaiting bed') : 'Bed —'}</span>
                {shownPid?.nationalId && <> · <span className="num" title="National identity number — as on the identity card">ID {shownPid.nationalId}</span></>}
                {shownPid?.fileNumber && <> · <span className="num" title="Patient file number — the hospital's own chart number">File {shownPid.fileNumber}</span></>}
                {(shownPid?.identity?.length ?? 0) > 0 && (
                  <> · <span
                    className="idmark"
                    title={shownPid!.identity!.map(e => `${e.time} · ${e.actor} (${e.role}): ${e.detail} — ${e.reason}`).join('\n')}
                  >identity corrected ×{shownPid!.identity!.length}</span></>
                )}
                {canCorrectIdentity && shownPid && (
                  <> · <button className="idbtn" onClick={() => setCorrecting(true)} aria-label={`Correct identity of ${shownPid.fullName ?? shownPid.name}`}>✎ Correct identity</button></>
                )}
                {canHistory && (
                  <> · <button className="idbtn" onClick={() => navigate(`/patients/${patientId}/history`)} aria-label="Open the patient history overview">🕘 History</button></>
                )}
                {canOrder && patientId && (
                  <> · <button className="idbtn" onClick={() => navigate(`/orders/${patientId}`)} aria-label={`Place an order for ${shownPid?.fullName ?? shownPid?.name ?? 'this patient'}`}>💊 Order</button></>
                )}
              </div>
            </div>
          </div>
          <div className="chips">
            <div className="chip"><span className="k">Age / Sex</span><span className="v">{p ? `${p.age} · ${p.sex}` : '—'}</span></div>
            <div className="chip"><span className="k">Diagnosis</span><span className="v">{p?.diagnosis ?? '—'}</span></div>
            <div className="chip"><span className="k">ICU Day</span><span className="v num">{p ? `Day ${p.los}` : '—'}</span></div>
            <div className="chip alert"><span className="k">Allergies</span><span className="v">{p?.allergies ?? '—'}</span></div>
            <div className="chip"><span className="k">Attending</span><span className="v">{p?.attending ?? '—'}</span></div>
            {/* NURSE COVERAGE — derived (never the free-text Attending,
                a legacy display string deliberately left alone). Everyone
                covers by default; click to view (everyone) or carve
                exceptions (Senior Doctor). A discharged patient has no
                open encounter → no coverage row → the chip stays em-dash. */}
            <button
              className="chip ctchip"
              onClick={() => shownTeam && setTeamOpen(true)}
              aria-label="Nurse coverage — view and manage exceptions"
            >
              <span className="k">Coverage</span>
              <span className="v">{(() => {
                if (!shownTeam) return '—'
                const names = shownTeam.nurses.map(n => n.name)
                const rest = names.length - names.slice(0, 2).length
                return names.length === 0 ? '—'
                  : names.slice(0, 2).join(' · ') + (rest > 0 ? ` +${rest}` : '')
              })()}</span>
            </button>
            {/* CODE STATUS (governed vocabulary — the SAFETY FIX): the one
                shared resolver; NOT RECORDED is an unmistakable explicit
                state, never a blank. Physicians (codestatus.set) click to
                SELECT from the active vocabulary — never type. */}
            <span className="cswrap">
            <button
              className={`chip code${p && resolveCodeStatus(p).kind === 'none' ? ' csnone' : ''}${canSetCodeStatus ? ' cssettable' : ''}`}
              disabled={!canSetCodeStatus || !p}
              onClick={() => setCsOpen(o => !o)}
              aria-label={canSetCodeStatus ? 'Code status — set from the vocabulary' : 'Code status'}
            >
              <span className="k">Code Status</span>
              <span className="v">{p ? (() => {
                const cs = resolveCodeStatus(p)
                return cs.kind === 'legacy' ? `${cs.label} · UNVERIFIED` : cs.label
              })() : '—'}</span>
            </button>
            {csOpen && p && canSetCodeStatus && (
              <div className="cspop" role="dialog" aria-label="Set code status">
                <div className="cspophead">Set code status — selected from the governed vocabulary; audited (who / when / role)</div>
                {csVocab === null && <div className="cspophint">Loading vocabulary…</div>}
                {csVocab?.filter(c => c.active).map(c => (
                  <button key={c.code} className="csopt" disabled={csBusy}
                    onClick={() => void doSetCodeStatus(c.code, c.label)}>
                    {c.label} <small className="num">{c.code}</small>
                  </button>
                ))}
                {csError && <div className="csperr" role="alert">{csError}</div>}
                <button className="csopt cscancel" onClick={() => { setCsOpen(false); setCsError(null) }}>Cancel</button>
              </div>
            )}
            </span>
            {/* ISOLATION (typed IPC precautions — the boolean's upgrade):
                labels resolve through the vocabulary; None is an explicit
                state. Bedside clinicians click to select the ACTIVE
                types (multiple is clinically real). */}
            <span className="cswrap">
            <button
              className={`chip iso${canSetIsolation ? ' cssettable' : ''}`}
              disabled={!canSetIsolation || !p}
              onClick={() => setIsoOpen(o => !o)}
              aria-label={canSetIsolation ? 'Isolation precautions — set from the vocabulary' : 'Isolation precautions'}
            >
              <span className="k">Isolation</span>
              <span className="v">{!p ? '—'
                : isoCurrent.length === 0 ? 'None'
                : isoCurrent.map(isolationTypeLabel).join(' + ')}</span>
            </button>
            {isoOpen && p && canSetIsolation && (
              <div className="cspop" role="dialog" aria-label="Set isolation precautions">
                <div className="cspophead">Isolation precautions — the replacement set for THIS stay; multiple types are clinically real; audited with the prior set</div>
                {isoVocab === null && <div className="cspophint">Loading vocabulary…</div>}
                {isoVocab?.filter(t => t.active).map(t => (
                  <label key={t.code} className="csopt isochk">
                    <input type="checkbox" disabled={isoBusy}
                      checked={isoSel.includes(t.code)}
                      onChange={e => setIsoSel(sel =>
                        e.target.checked ? [...sel, t.code] : sel.filter(c => c !== t.code))} />
                    {' '}{t.label} <small className="num">{t.code}</small>
                  </label>
                ))}
                {isoError && <div className="csperr" role="alert">{isoError}</div>}
                <button className="csopt" disabled={isoBusy} onClick={() => void doSetIsolation()}>
                  {isoBusy ? 'Saving…' : (isoSel.length === 0 ? 'Save (no precautions)' : `Save ${isoSel.length} type${isoSel.length === 1 ? '' : 's'}`)}
                </button>
                <button className="csopt cscancel" onClick={() => { setIsoOpen(false); setIsoError(null) }}>Cancel</button>
              </div>
            )}
            </span>
            <div className="chip upd"><span className="k">Last Updated</span><span className="v">{shortTime} · auto</span></div>
          </div>
        </div>
      </header>

      {teamOpen && shownTeam && session && (
        <AssignmentDialog
          coverage={shownTeam}
          canManage={canManageAssignments}
          actor={session.name}
          jobTitle={session.jobTitle}
          onClose={() => setTeamOpen(false)}
          onChanged={() => loadCareTeam(patientId)}
        />
      )}
      {correcting && shownPid && (
        <IdentityDialog
          patient={shownPid}
          onCancel={() => setCorrecting(false)}
          onCorrected={updated => {
            setCorrecting(false)
            setPid(updated)
            /* the corrected display name flows through every derived
               surface — re-read the roster and this chart */
            getPatients().then(setPatients)
            refreshDetail(patientId)
          }}
        />
      )}
      <div className="shell">
        <aside>
          <div className="side-head">
            <div className="ttl">Patients <Badge color="blue">{filtered.length}</Badge></div>
            <div className="searchbox">
              <IconSearch size={14} />
              <input
                placeholder="Search name, bed, MRN, file no…" aria-label="Search name, bed, MRN, national ID or file number"
                value={query} onChange={e => setQuery(e.target.value.trim().toLowerCase())}
              />
            </div>
            <div className="filters">
              {FILTERS.map(f => (
                <button key={f.key} className={`fbtn${filter === f.key ? ' on' : ''}`} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <div className="ptlist">
            {filtered.map(pt => (
              <button
                key={pt.patientId}
                className={`ptcard${pt.patientId === patientId ? ' sel' : ''}`}
                onClick={() => navigate(`/patients/${pt.patientId}`)}
                aria-label={`Open ${pt.name}, ${pt.bedId ? `bed ${pt.bedId}` : 'awaiting bed'}`}
              >
                <div className="r1">
                  <BedChip bedId={pt.bedId} />
                  <span className="nm">{pt.name}</span>
                  <span className={`acount${pt.alertCount ? '' : ' zero'}`}>{pt.alertCount}</span>
                </div>
                <div className="dx">{pt.diagnosis}</div>
                <div className="tags"><TagList flags={pt.flags} iso={pt.isolation} /></div>
              </button>
            ))}
          </div>
        </aside>

        <main className={isNurseChart ? 'nursechart' : 'fullchart'}>
          {/* Suppress the body until the ADT check resolves: a discharged
              patient redirects to /history and must never flash the (possibly
              mock-backed) Mission Control body first — that flash IS the
              masking bug. 'checking'/'redirecting' → a busy placeholder. */}
          {adt !== 'present' && <div style={{ gridColumn: '1/-1' }} aria-busy="true" />}
          {adt === 'present' && <>
          {missing && <NotFoundCard />}

          {/* LATEST CHARTED OBSERVATIONS — the one combined card (bedside,
              ventilator and the unique hemodynamic readings + the 24 h
              fluid strip); score chips/legend only where scores are shown */}
          {shown && (
            <LatestObservationsCard
              key={`obs-${patientId}`}
              latest={latestObs}
              vitals={shown.patient.vitals}
              rhythm={shown.patient.rhythm}
              patientId={patientId}
              news2={showScores ? scores.news2 : null}
              showScores={showScores}
              readState={obsRead.state}
              fluidBalance={fluidBalance}
            />
          )}

          {shown && (
            <div className="colR">
              {/* Weight & Height (encounter-scoped reference values, kg/cm) —
                  reads the REAL identity endpoint; renders nothing in pure
                  mock mode (no mock store behind this domain) */}
              <WeightHeightCard key={`wh-${patientId}`} patientId={patientId} />
              {/* non-nurse charts: the medication SUMMARY (orders.view —
                  the server's gate on the read). The nurse's chart carries
                  Laboratory Results here; its medication slot is below. */}
              {!isNurseChart && canOrder && <ActiveMedicationsCard key={`meds-${patientId}`} patientId={patientId} />}
              {isNurseChart && canResults && <LabsCard key={`labs-${patientId}`} labs={shown.labs} patientId={patientId} />}
            </div>
          )}

          {/* THE NURSE'S MEDICATION + I&O SLOT — Session 3's
              PatientNurseCarePanel (contract §6): this patient's MAR cards
              (Given / Held / Refused through the ONE NurseCareProvider that
              App.tsx mounts around the routes — no provider here) and the
              I&O panel. Self-contained: it reads the session and provider
              itself and clears on a patientId change. Rendered only for the
              routed patient (`shown`), and keyed per patient like every
              other patient card here, so none of its local state renders
              under another patient; saves in flight complete into the
              provider's controller, not into this instance. */}
          {shown && isNurseChart && (
            <div className="nursecare">
              <PatientNurseCarePanel key={`care-${patientId}`} patientId={patientId} />
            </div>
          )}

          {/* Classic SOFA v1 + Standard NEWS2 v1 — computed at render from
              the canonical reads; decision-support pending clinical
              validation. Never on the nurse's chart (owner's decision
              2026-10-15); unchanged for every other profile. */}
          {shown && showScores && <SofaCard state={scores.state} sofa={scores.sofa} />}
          {shown && showScores && <News2Card state={scores.state} news2={scores.news2} />}

          {/* LABORATORY RESULTS (renamed from Laboratory Trends) and IMAGING
              RESULTS — results.view, the server's gate on both reads */}
          {shown && !isNurseChart && canResults && <LabsCard key={`labs-${patientId}`} labs={shown.labs} patientId={patientId} />}
          {shown && canResults && <ImagingResultsCard key={`img-${patientId}`} patientId={patientId} />}

          {/* File Attachments (2026-07-25): patient-scoped, DB-resident,
              clinical-tier view / documenting-roles add — the card gates
              itself on attachments.view and renders nothing without it */}
          <AttachmentsCard key={`att-${patientId}`} patientId={patientId ?? ''} />

          {shown && (
            <Card id="timeline"
              icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg>}
              title="Clinical Timeline · Last 24 h"
              aside={(
                <button className="tlmore" onClick={() => navigate(`/timeline/${patientId}`)}>
                  Full timeline →
                </button>
              )}>
              {/* derived view over the aggregated feed (Screen 7) — same data, compact strip */}
              <div className="tl">
                {shown.timeline.map(ev => (
                  <div className="tle" key={ev.id}>
                    <span className="tt">{displayStamp(ev.time)}</span>
                    <span className={`tc ${ev.category}`}>{ev.categoryLabel}</span>
                    <p>{ev.title}{ev.detail ? ` — ${ev.detail}` : ''}</p>
                  </div>
                ))}
              </div>
            </Card>
          )}
          {!shown && !missing && <div style={{ gridColumn: '1/-1' }} aria-busy="true" />}
          </>}
        </main>
      </div>
      <Toast state={toast} accent="cyan" />
    </div>
  )
}
