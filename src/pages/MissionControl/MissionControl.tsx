import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import './MissionControl.css'
import { Card } from '../../components/Card'
import { NotYetAvailable } from '../../components/NotYetAvailable'
import { Badge } from '../../components/Badge'
import { BedChip, TagList } from '../../components/Tag'
import { AlertRow } from '../../components/AlertRow'
import { BackButton } from '../../components/AppHeader'
import { NotFoundCard } from '../../components/NotFoundCard'
import { VitalTile } from '../../components/VitalTile'
import { Sparkline } from '../../components/Sparkline'
import { IconCheck, IconPulse, IconSearch, IconVent } from '../../components/icons'
import { useClock } from '../../hooks/useClock'
import { getCoverage, getCodeStatuses, getEncounters, getIsolationTypes, getPatientDetail, getPatientIdentity, getPatients, isolationTypeLabel, setEncounterCodeStatus, setEncounterIsolation } from '../../lib/api'
import { usePatientScores } from '../../hooks/usePatientScores'
import { unitSuffix, useHospitalIdentity } from '../../lib/hospitalIdentity'
import { resolveCodeStatus } from '../../lib/codeStatus'
import { Toast, useToast } from '../../components/Toast'
import { latestObservations, type LatestObservation } from '../../lib/api/bedside'
import { useRememberPatient } from '../../lib/patientContext'
import { getSession, hasPermission, signOut } from '../../lib/session'
import type { CoverageRow, CodeStatusEntry, IsolationTypeEntry, PatientAlert, PatientDetailResponse, PatientIdentity, PatientSummary } from '../../lib/api/types'
import { IdentityDialog } from './IdentityDialog'
import { AssignmentDialog } from './AssignmentDialog'
import { LatestObservationsCard } from './LatestObservationsCard'
import { DigitalTwin } from './DigitalTwin'
import { LabsCard } from './LabsCard'
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

interface LiveAlert extends PatientAlert {
  key: number
  leaving: boolean
}

const initials = (name: string) => name.split(' ').map(w => w[0]).slice(0, 2).join('')

export function MissionControl() {
  const { patientId = '' } = useParams()
  const navigate = useNavigate()
  const { time, date, shortTime } = useClock()
  const hospIdentity = useHospitalIdentity()
  const [patients, setPatients] = useState<PatientSummary[] | null>(null)
  const [detail, setDetail] = useState<PatientDetailResponse | null>(null)
  const [missing, setMissing] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [alerts, setAlerts] = useState<LiveAlert[]>([])
  const [goals, setGoals] = useState<{ label: string; done: boolean }[]>([])
  /* false = the domain does not exist in this version (production,
     Phase 3 PR 2) — the cards render the honest not-yet state */
  const [alertsAvailable, setAlertsAvailable] = useState(true)
  const [goalsAvailable, setGoalsAvailable] = useState(true)
  /* §12 step 4: the latest-per-type observation map for the bedside card
     (real read; empty when nothing is charted or the API is unreachable —
     the card then shows demo-tagged fallbacks or honest blanks) */
  const [latestObs, setLatestObs] = useState<Map<string, LatestObservation>>(new Map())

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
  /* the Patient History Overview (match+overview design §5.4 — reachable
     from the chart too): clinical history, so results.view — held by
     every clinical profile and by NEITHER administrator (the locked
     rule: the office Administrator never sees clinical data) */
  const canHistory = session ? hasPermission(session.jobTitle, 'results.view') : false

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
      getPatientDetail(patientId).then(r => { if (r) setDetail(r) })
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
      getPatientDetail(patientId).then(r => { if (r) setDetail(r) })
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
    if (patientId) getPatientIdentity(patientId).then(r => { if (!stale) setPid(r) })
    return () => { stale = true }
  }, [patientId])

  /* opening a chart records the cross-section patient context (only once
     the roster confirms the id resolves) */
  useRememberPatient(patientId, patients)

  /* ONE fetch+compute for every score-derived surface on this page:
     NEWS2 + SOFA cards, the observation tiles' score colours, the
     SOFA-derived digital twin — and the latest-observations map, which
     projects from the SAME full-chart read NEWS2 consumes (no second
     observation fetch, no possible disagreement). */
  const scores = usePatientScores(patientId)
  useEffect(() => {
    setLatestObs(scores.observations ? latestObservations(scores.observations) : new Map())
  }, [scores.observations])

  useEffect(() => {
    let stale = false
    setMissing(false)
    getPatientDetail(patientId).then(res => {
      if (stale) return
      if (!res) {
        /* Locked decision: an unresolved ID must render an explicit not-found
           state — never redirect to or display another patient's chart. */
        setDetail(null)
        setAlerts([])
        setGoals([])
        setMissing(true)
        return
      }
      setDetail(res)
      setAlertsAvailable(res.alerts !== null)
      setGoalsAvailable(res.goals !== null)
      setAlerts((res.alerts ?? []).map((a, i) => ({ ...a, key: i, leaving: false })))
      setGoals(res.goals ?? [])
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
  const p = detail?.patient
  const critAlerts = alerts.filter(a => !a.leaving && a.severity === 'crit').length
  const activeAlerts = alerts.filter(a => !a.leaving)

  const ackAlert = (key: number) => {
    setAlerts(prev => prev.map(a => (a.key === key ? { ...a, leaving: true } : a)))
    setTimeout(() => setAlerts(prev => prev.filter(a => a.key !== key)), 320)
  }

  const toggleGoal = (i: number) =>
    setGoals(prev => prev.map((goal, k) => (k === i ? { ...goal, done: !goal.done } : goal)))
  const goalPct = goals.length ? Math.round((goals.filter(x => x.done).length / goals.length) * 100) : 0

  /* "running" is a PUMP fact — computable only on trend-carrying demo
     rows; real order-derived rows have no trend, so the aside counts
     ordered channels instead of claiming run states */
  const infusionsHaveTrends = detail ? detail.infusions.some(m => m.trend) : false
  const runningInfusions = detail ? detail.infusions.filter(m => m.trend && m.trend[m.trend.length - 1] > 0).length : 0

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
          <button className="switchrole" onClick={() => { signOut(); navigate('/login') }}>Switch role</button>
        </div>
        <div className="banner">
          <div className="pt-id">
            <div className="avatar">{p ? initials(p.name) : '—'}</div>
            <div>
              {/* the PATIENT HEADER carries the FULL LEGAL NAME (all
                  present parts) + national ID — the compact display name
                  serves everywhere else; legacy single names render as-is */}
              <h1>{pid?.fullName ?? p?.name ?? '—'}</h1>
              <div className="sub">
                <span>{p?.mrn ?? 'MRN —'}</span> · <span>Bed {p?.bedId ?? '—'}</span>
                {pid?.nationalId && <> · <span className="num" title="National identity number — as on the identity card">ID {pid.nationalId}</span></>}
                {pid?.fileNumber && <> · <span className="num" title="Patient file number — the hospital's own chart number">File {pid.fileNumber}</span></>}
                {(pid?.identity?.length ?? 0) > 0 && (
                  <> · <span
                    className="idmark"
                    title={pid!.identity!.map(e => `${e.time} · ${e.actor} (${e.role}): ${e.detail} — ${e.reason}`).join('\n')}
                  >identity corrected ×{pid!.identity!.length}</span></>
                )}
                {canCorrectIdentity && pid && (
                  <> · <button className="idbtn" onClick={() => setCorrecting(true)} aria-label={`Correct identity of ${pid.fullName ?? pid.name}`}>✎ Correct identity</button></>
                )}
                {canHistory && (
                  <> · <button className="idbtn" onClick={() => navigate(`/patients/${patientId}/history`)} aria-label="Open the patient history overview">🕘 History</button></>
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
              onClick={() => careTeam && setTeamOpen(true)}
              aria-label="Nurse coverage — view and manage exceptions"
            >
              <span className="k">Coverage</span>
              <span className="v">{(() => {
                if (!careTeam) return '—'
                const names = careTeam.nurses.map(n => n.name)
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

      {teamOpen && careTeam && session && (
        <AssignmentDialog
          coverage={careTeam}
          canManage={canManageAssignments}
          actor={session.name}
          jobTitle={session.jobTitle}
          onClose={() => setTeamOpen(false)}
          onChanged={() => loadCareTeam(patientId)}
        />
      )}
      {correcting && pid && (
        <IdentityDialog
          patient={pid}
          onCancel={() => setCorrecting(false)}
          onCorrected={updated => {
            setCorrecting(false)
            setPid(updated)
            /* the corrected display name flows through every derived
               surface — re-read the roster and this chart */
            getPatients().then(setPatients)
            getPatientDetail(patientId).then(res => { if (res) setDetail(res) })
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
                aria-label={`Open ${pt.name}, bed ${pt.bedId}`}
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

        <main>
          {missing && <NotFoundCard />}

          {detail && (
            <LatestObservationsCard
              latest={latestObs}
              vitals={detail.patient.vitals}
              rhythm={detail.patient.rhythm}
              patientId={detail.patient.patientId}
              news2={scores.news2}
            />
          )}

          {detail && (
            <div className="colR">
              {/* organ status DERIVED from the computed SOFA — the wire
                  organs snapshot (fixtures + all-"ok" fresh-admit default)
                  is retired (no-reassuring-default rule) */}
              <DigitalTwin state={scores.state} sofa={scores.sofa} />
            </div>
          )}

          {/* Weight & Height (person-level reference values, kg/cm) — reads
              the REAL identity endpoint; renders nothing in pure mock mode
              (no mock store behind this domain, nothing fabricated) */}
          {detail && <WeightHeightCard patientId={patientId} />}

          {/* Classic SOFA v1 — real computed organ-dysfunction score (the
              Clinical Scoring Engine's first score), computed at render from
              the canonical reads; the honest replacement for the fabricated
              bedside SOFA. Decision-support pending clinical validation. */}
          {detail && <SofaCard state={scores.state} sofa={scores.sofa} />}

          {/* Standard NEWS2 v1 — the engine's second real score, the honest
              replacement for the fabricated bedside/roster EWS. Display-only
              band/colour, no automated alerts. Decision-support. */}
          {detail && <News2Card state={scores.state} news2={scores.news2} />}

          {detail && (
            <Card id="vent" icon={<IconVent size={15} stroke="var(--blue)" />} title="Ventilator"
              aside={<Badge color="blue">{detail.ventilator.mode}</Badge>}>
              <div className="tgrid">
                {detail.ventilator.tiles.map(t => (
                  <VitalTile key={t.label} variant="tile" label={t.label} value={t.value} unit={t.unit} warn={t.warn} />
                ))}
              </div>
            </Card>
          )}

          {detail && (
            <Card id="hemo"
              icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21C7 17 3 13.5 3 9a5 5 0 019-3 5 5 0 019 3c0 4.5-4 8-9 12z" /></svg>}
              title="Hemodynamics" aside="Latest charted">
              <div className="tgrid">
                {detail.hemodynamics.metrics.map(t => (
                  <VitalTile key={t.label} variant="tile" label={t.label} value={t.value} unit={t.unit} warn={t.warn} />
                ))}
              </div>
              {detail.hemodynamics.fluidBalance && (
                <div className="fluid">
                  <div className="fk"><span>Fluid balance · 24 h</span><b className="num" style={{ color: 'var(--cyan)' }}>{detail.hemodynamics.fluidBalance.value}</b></div>
                  <div className="fbar"><i style={{ width: `${detail.hemodynamics.fluidBalance.percent}%` }} /></div>
                </div>
              )}
            </Card>
          )}

          {detail && (
            <Card id="meds"
              icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="7" y="2" width="10" height="20" rx="4" /><path d="M7 9h10M7 15h10" /></svg>}
              title="Active Infusions"
              aside={infusionsHaveTrends
                ? `${runningInfusions} running · ${detail.infusions.length} channels`
                : `${detail.infusions.length} active infusion order${detail.infusions.length === 1 ? '' : 's'}`}>
              <div>
                {detail.infusions.length === 0 && (
                  /* a REAL empty — the orders domain answered and holds no
                     active infusion orders; a clinical statement, not a
                     missing domain */
                  <p className="mednone">No active infusion orders for this patient.</p>
                )}
                {detail.infusions.map(m => {
                  const running = m.trend ? m.trend[m.trend.length - 1] > 0 : false
                  return (
                    <div className="medrow" key={m.name}>
                      <div><div className="mn">{m.name}</div><div className="md">{m.dose}{m.route ? ` · ${m.route}` : ''}</div></div>
                      {/* rate/trend/status are PUMP facts — rendered only
                          when a source exists (demo fixture); real
                          order-derived rows show NO sparkline, NO rate,
                          NO status dot (never fabricated) */}
                      {m.rate !== undefined && <div className="mr">{m.rate}</div>}
                      {m.trend && <Sparkline data={m.trend} color={running ? 'var(--cyan)' : 'rgba(var(--steel-rgb),.3)'} width={62} height={22} baseline="zero" />}
                      {m.status && <span className={`mwarn ${m.status}`} title={m.status === 'hi' ? 'High-dose warning' : m.status === 'md' ? 'Review due' : 'Nominal'} />}
                    </div>
                  )
                })}
              </div>
            </Card>
          )}

          {detail && <LabsCard labs={detail.labs} />}

          {detail && (
            <Card id="alerts"
              icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l10 18H2L12 3z" /><path d="M12 10v5m0 3v.01" /></svg>}
              title="Smart Alerts" aside={alertsAvailable ? `${activeAlerts.length} active` : undefined}>
              {/* the per-patient alerts DOMAIN does not exist yet (alert
                  rules are a future domain; the roster bedAlert and the
                  unacked-results inbox are the nearest real signals and
                  are NOT synthesized into a feed here) — say so, never a
                  blank that reads "no alerts" (the PR-1 rule) */}
              {!alertsAvailable && <NotYetAvailable what="Per-patient smart alerts" />}
              <div className="alist">
                {alerts.map(a => (
                  <AlertRow key={a.key} severity={a.severity} text={a.message} time={a.time} leaving={a.leaving} onAck={() => ackAlert(a.key)} />
                ))}
              </div>
            </Card>
          )}

          {detail && (
            <Card id="goals" icon={<IconCheck size={15} stroke="var(--green)" strokeWidth={2} />} title="Daily Goals · Rounding Checklist" aside={goalsAvailable ? 'Tap to complete' : undefined}>
              {!goalsAvailable && <NotYetAvailable what="The care-goals checklist" />}
              {goalsAvailable && (<>
              <div className="gprog">
                <div className="gbar"><i style={{ width: `${goalPct}%` }} /></div>
                <b>{goalPct}%</b>
              </div>
              <div className="glist">
                {goals.map((goal, i) => (
                  <button key={goal.label} className={`goal${goal.done ? ' done' : ''}`} aria-pressed={goal.done} onClick={() => toggleGoal(i)}>
                    <span className="cb"><IconCheck size={11} /></span>
                    <span>{goal.label}</span>
                  </button>
                ))}
              </div>
              </>)}
            </Card>
          )}

          {detail && (
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
                {detail.timeline.map(ev => (
                  <div className="tle" key={ev.id}>
                    <span className="tt">{displayStamp(ev.time)}</span>
                    <span className={`tc ${ev.category}`}>{ev.categoryLabel}</span>
                    <p>{ev.title}{ev.detail ? ` — ${ev.detail}` : ''}</p>
                  </div>
                ))}
              </div>
            </Card>
          )}
          {!detail && !missing && <div style={{ gridColumn: '1/-1' }} aria-busy="true" />}
        </main>
      </div>
      <Toast state={toast} accent="cyan" />
    </div>
  )
}
