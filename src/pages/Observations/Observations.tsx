import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import './Observations.css'
import { AppHeader, type KpiSpec } from '../../components/AppHeader'
import { NavSidebar } from '../../components/NavSidebar'
import { NotFoundCard } from '../../components/NotFoundCard'
import { PatientBar } from '../../components/PatientBar'
import { PatientRail } from '../../components/PatientRail'
import { Toast, useToast } from '../../components/Toast'
import { IconCheck, IconClock, IconPencil, IconPulse, IconStats } from '../../components/icons'
import {
  chartObservations, correctObservation, getObservationCatalog, getObservations,
  getPatients, getRosterRecord,
} from '../../lib/api'
import type {
  NewObservationEntry, ObsCatalogGroup, ObsEntryValue, Observation, ObservationType,
  PatientSummary, RosterRecordDto,
} from '../../lib/api/types'
import { defaultPatientId, useRememberPatient } from '../../lib/patientContext'
import { getSession, hasPermission, initialsOf, profileOf } from '../../lib/session'
import { useNow } from '../../lib/time'

/* Stage 11 §12 step 3 — the /observations entry+chart screen.
   Grouped entry (Pillar 2: the form is RENDERED FROM the Observation Type
   Catalogue — enabled groups only, no observation names in this code);
   both §10 entry modes (a timed ROUND is many staged values submitted as
   one request sharing the server-stamped clinicalTime; an AD-HOC entry is
   the same submission with one value); the chart read view with the §8
   amendment history; read-only without observations.record (§4); the
   two-tier correction UI (tier-1 self within the 5-minute window charts
   only the corrected value — no reason field, the Q1 decision; tier-2
   Consultant-tier requires the reason). The SERVER decides every rule —
   tier, window, validation, RBAC; the client hints are display only. */

const SELF_WINDOW_MS = 5 * 60_000

/* the tier-1 window anchor: enteredAt is 'yyyy-MM-dd HH:mm:ss' UTC */
const enteredAtMs = (o: Observation) => Date.parse(`${o.enteredAt.replace(' ', 'T')}Z`)

const withinSelfWindow = (o: Observation, name: string, now: Date) =>
  o.recordedBy === name && now.getTime() - enteredAtMs(o) <= SELF_WINDOW_MS

/** amend-not-erase: the effective value is the last amendment's newValue */
const effectiveValue = (o: Observation) =>
  o.amendments.length > 0 ? o.amendments[o.amendments.length - 1].newValue : o.value

/** clinicalTime 'yyyy-MM-dd HH:mm' UTC → 'HH:mm' when the date is the
 *  current UTC date, otherwise the full stamp (the calendar-date open
 *  question is inherited from the Print Center convention, not resolved
 *  here) */
function timeLabel(clinicalTime: string): string {
  const [date, hm] = clinicalTime.split(' ')
  return date === new Date().toISOString().slice(0, 10) ? hm : clinicalTime
}

const parseCompound = (raw: string): Record<string, number | string> => {
  try { return JSON.parse(raw) as Record<string, number | string> } catch { return {} }
}

/** render a stored value for display — compound values list their
 *  components in catalogue order */
function displayValue(t: ObservationType | undefined, raw: string): string {
  if (t?.valueType !== 'compound') return raw
  const obj = parseCompound(raw)
  return (t.components ?? []).map(c => `${c.label} ${obj[c.code] ?? '—'}`).join(' · ')
}

/* ---- derived values: computed at read/render, NEVER stored or charted
   (§1). The INPUTS come from the catalogue rows (derivationInputs); the
   arithmetic itself is semantic per type and lives in this small render
   map — a derived type with no renderer here shows nothing rather than a
   guessed number. Values resolve within ONE round (a shared clinicalTime):
   fluid totals are per-interval sums, driving pressure needs the same
   timepoint's pplat/peep, GCS total sums the compound's components. */
interface RoundValues {
  /** the latest effective value per type at this timepoint (single-valued
   *  measurements: pressures, the GCS compound) */
  latest: Map<string, string>
  /** EVERY entry's effective value per type — fluid amounts are
   *  per-interval records, so a repeated type at one timepoint sums, it
   *  does not replace */
  all: Map<string, string[]>
}

function latestNum(round: RoundValues, code: string): number | null {
  const raw = round.latest.get(code)
  if (raw === undefined) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

function sumAll(round: RoundValues, code: string): number | null {
  const raws = round.all.get(code)
  if (!raws || raws.length === 0) return null
  const nums = raws.map(Number).filter(Number.isFinite)
  return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) : null
}

function derivedValue(t: ObservationType, round: RoundValues, byCode: Map<string, ObservationType>): number | null {
  const inputs = t.derivationInputs ?? []
  switch (t.typeCode) {
    case 'gcs_total': {
      const raw = round.latest.get(inputs[0] ?? 'gcs')
      if (raw === undefined) return null
      const comps = parseCompound(raw)
      const parts = Object.values(comps).map(Number)
      return parts.length > 0 && parts.every(Number.isFinite) ? parts.reduce((a, b) => a + b, 0) : null
    }
    case 'driving_pressure': {
      const vals = inputs.map(c => latestNum(round, c))
      return vals.length === 2 && vals.every(v => v !== null) ? vals[0]! - vals[1]! : null
    }
    case 'total_input':
    case 'total_output': {
      const present = inputs.map(c => sumAll(round, c)).filter((v): v is number => v !== null)
      return present.length > 0 ? present.reduce((a, b) => a + b, 0) : null
    }
    case 'net_balance': {
      const [inCode, outCode] = inputs
      const ti = byCode.get(inCode) && derivedValue(byCode.get(inCode)!, round, byCode)
      const to = byCode.get(outCode) && derivedValue(byCode.get(outCode)!, round, byCode)
      return typeof ti === 'number' && typeof to === 'number' ? ti - to : null
    }
    default:
      return null
  }
}

/* ---- entry drafts: inputs are keyed by typeCode; a compound draft keys
   its components. A compound counts as staged only when EVERY component
   is filled (the server requires exactly the defined set). */
type Draft = Record<string, string | Record<string, string>>

function stagedEntries(draft: Draft, byCode: Map<string, ObservationType>): NewObservationEntry[] {
  const entries: NewObservationEntry[] = []
  for (const [typeCode, v] of Object.entries(draft)) {
    const t = byCode.get(typeCode)
    if (!t) continue
    if (t.valueType === 'compound') {
      const comps = t.components ?? []
      const obj = v as Record<string, string>
      if (comps.some(c => !(obj[c.code] ?? '').trim())) continue
      const value: Record<string, number | string> = {}
      for (const c of comps) {
        const s = obj[c.code].trim()
        const n = Number(s)
        value[c.code] = c.kind === 'numeric' && Number.isFinite(n) && s !== '' ? n : s
      }
      entries.push({ typeCode, value })
    } else {
      const s = (v as string).trim()
      if (!s) continue
      const n = Number(s)
      /* numeric goes as a number when parseable; otherwise the raw string —
         the SERVER's catalogue validation answers with the precise 400 */
      entries.push({ typeCode, value: t.valueType === 'numeric' && Number.isFinite(n) ? n : s })
    }
  }
  return entries
}

/** a compound draft that is PARTIALLY filled blocks submission (the
 *  catalogue defines exactly which components a value carries) */
function partialCompound(draft: Draft, byCode: Map<string, ObservationType>): string | null {
  for (const [typeCode, v] of Object.entries(draft)) {
    const t = byCode.get(typeCode)
    if (t?.valueType !== 'compound') continue
    const obj = v as Record<string, string>
    const filled = (t.components ?? []).filter(c => (obj[c.code] ?? '').trim())
    if (filled.length > 0 && filled.length < (t.components ?? []).length) return t.displayName
  }
  return null
}

export function Observations() {
  const { patientId = '' } = useParams()
  const navigate = useNavigate()
  const { toast, showToast } = useToast()
  const session = getSession()!
  const now = useNow(10_000)

  const canRecord = hasPermission(session.jobTitle, 'observations.record')
  const canCorrect = hasPermission(session.jobTitle, 'observations.correct')

  const [patients, setPatients] = useState<PatientSummary[] | null>(null)
  const [roster, setRoster] = useState<RosterRecordDto | null>(null)
  const [missing, setMissing] = useState(false)
  const [catalog, setCatalog] = useState<ObsCatalogGroup[] | null>(null)
  const [catalogFailed, setCatalogFailed] = useState(false)
  const [obs, setObs] = useState<Observation[] | null>(null)
  const [obsFailed, setObsFailed] = useState(false)

  const [activeGroup, setActiveGroup] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>({})
  const [entryError, setEntryError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /* the open correction editor (one at a time) */
  const [editing, setEditing] = useState<string | null>(null)
  const [editValue, setEditValue] = useState<string | Record<string, string>>('')
  const [editReason, setEditReason] = useState('')
  const [editError, setEditError] = useState<string | null>(null)

  useEffect(() => { getPatients().then(setPatients) }, [])
  useEffect(() => {
    getObservationCatalog().then(c => {
      if (c) setCatalog(c)
      else setCatalogFailed(true)
    })
  }, [])

  useEffect(() => {
    if (!patientId && patients?.length) navigate(`/observations/${defaultPatientId(patients)}`, { replace: true })
  }, [patientId, patients, navigate])
  /* record the viewed patient as the cross-section context (only once
     this screen's own list confirms the id resolves) */
  useRememberPatient(patientId, patients)

  const loadObservations = useCallback(() => {
    if (!patientId) return
    getObservations(patientId).then(list => {
      if (list) { setObs(list); setObsFailed(false) }
      else setObsFailed(true)
    })
  }, [patientId])

  useEffect(() => {
    if (!patientId) return
    let stale = false
    setMissing(false)
    setObs(null)
    setDraft({})
    setEntryError(null)
    setEditing(null)
    getRosterRecord(patientId).then(rec => {
      if (stale) return
      /* locked decision: explicit not-found — never another patient's data.
         The roster is the OPEN-encounter view; correcting a discharged
         patient's chart (legitimate per §6) is server-supported but has no
         picker here yet — recorded as a display gap, like the Print hub's. */
      if (!rec) { setRoster(null); setMissing(true); return }
      setRoster(rec)
    })
    loadObservations()
    return () => { stale = true }
  }, [patientId, loadObservations])

  const enabledGroups = useMemo(() => (catalog ?? []).filter(g => g.enabled), [catalog])
  const disabledGroups = useMemo(() => (catalog ?? []).filter(g => !g.enabled), [catalog])

  useEffect(() => {
    if (activeGroup === null && enabledGroups.length > 0) setActiveGroup(enabledGroups[0].groupCode)
  }, [activeGroup, enabledGroups])

  const byCode = useMemo(() => {
    const m = new Map<string, ObservationType>()
    for (const g of catalog ?? []) for (const t of g.types) m.set(t.typeCode, t)
    return m
  }, [catalog])

  /* catalogue display order — group seq then type position */
  const typeOrder = useMemo(() => {
    const m = new Map<string, number>()
    let i = 0
    for (const g of catalog ?? []) for (const t of g.types) m.set(t.typeCode, i++)
    return m
  }, [catalog])

  const staged = useMemo(() => stagedEntries(draft, byCode), [draft, byCode])

  /* ---- the chart, newest round first. A round = the observations sharing
     one server-stamped clinicalTime from one recorder (§10). */
  const rounds = useMemo(() => {
    const m = new Map<string, Observation[]>()
    for (const o of obs ?? []) {
      const key = `${o.clinicalTime}|${o.recordedBy}`
      if (!m.has(key)) m.set(key, [])
      m.get(key)!.push(o)
    }
    return [...m.entries()]
      .map(([key, list]) => ({
        key,
        clinicalTime: list[0].clinicalTime,
        recordedBy: list[0].recordedBy,
        source: list[0].source,
        list: [...list].sort((a, b) => (typeOrder.get(a.typeCode) ?? 999) - (typeOrder.get(b.typeCode) ?? 999)),
      }))
      .sort((a, b) => (a.clinicalTime < b.clinicalTime ? 1 : a.clinicalTime > b.clinicalTime ? -1 : 0))
  }, [obs, typeOrder])

  const todayUtc = new Date().toISOString().slice(0, 10)
  const todayObs = (obs ?? []).filter(o => o.clinicalTime.startsWith(todayUtc))
  const amendedCount = (obs ?? []).filter(o => o.amendments.length > 0).length

  const kpis: KpiSpec[] = [
    { icon: <IconPulse size={14} stroke="var(--cyan)" />, iconBg: 'rgba(53,224,208,.13)', value: obs ? todayObs.length : '—', label: 'Charted Today' },
    { icon: <IconClock size={14} stroke="var(--blue)" />, iconBg: 'rgba(77,163,255,.15)', value: obs ? new Set(todayObs.map(o => `${o.clinicalTime}|${o.recordedBy}`)).size : '—', label: 'Rounds Today' },
    { icon: <IconPencil size={14} stroke="var(--amber)" />, iconBg: 'rgba(255,180,84,.14)', value: obs ? amendedCount : '—', label: 'Amended Entries' },
    { icon: <IconStats size={14} stroke="var(--green)" />, iconBg: 'rgba(61,232,160,.13)', value: catalog ? `${enabledGroups.length}/${catalog.length}` : '—', label: 'Groups Enabled' },
  ]

  const setField = (typeCode: string, v: string) => {
    setEntryError(null)
    setDraft(d => ({ ...d, [typeCode]: v }))
  }
  const setCompField = (typeCode: string, comp: string, v: string) => {
    setEntryError(null)
    setDraft(d => ({ ...d, [typeCode]: { ...(d[typeCode] as Record<string, string> | undefined ?? {}), [comp]: v } }))
  }

  async function submitRound() {
    const partial = partialCompound(draft, byCode)
    if (partial) { setEntryError(`${partial}: fill every component, or clear it — a compound observation carries exactly its defined components`); return }
    if (staged.length === 0 || !patientId || busy) return
    setBusy(true)
    setEntryError(null)
    const r = await chartObservations(patientId, staged)
    setBusy(false)
    if (r.kind === 'ok') {
      setDraft({})
      showToast('Round charted', `${r.data.length} observation${r.data.length === 1 ? '' : 's'} at ${timeLabel(r.data[0].clinicalTime)} — server-stamped`)
      loadObservations()
    } else if (r.kind === 'rejected') {
      setEntryError(r.error)
    } else {
      setEntryError('The AURORA API is unreachable — observations are never written to local mock state')
    }
  }

  function openEditor(o: Observation) {
    const t = byCode.get(o.typeCode)
    setEditing(o.observationId)
    setEditError(null)
    setEditReason('')
    if (t?.valueType === 'compound') {
      const cur = parseCompound(effectiveValue(o))
      const pre: Record<string, string> = {}
      for (const c of t.components ?? []) pre[c.code] = String(cur[c.code] ?? '')
      setEditValue(pre)
    } else {
      setEditValue(effectiveValue(o))
    }
  }

  async function submitCorrection(o: Observation) {
    const t = byCode.get(o.typeCode)
    if (!t || busy) return
    const selfTier = withinSelfWindow(o, session.name, now)
    let value: ObsEntryValue
    if (t.valueType === 'compound') {
      const obj = editValue as Record<string, string>
      const comps = t.components ?? []
      if (comps.some(c => !(obj[c.code] ?? '').trim())) { setEditError('fill every component of the compound value'); return }
      const v: Record<string, number | string> = {}
      for (const c of comps) {
        const s = obj[c.code].trim()
        const n = Number(s)
        v[c.code] = c.kind === 'numeric' && Number.isFinite(n) && s !== '' ? n : s
      }
      value = v
    } else {
      const s = (editValue as string).trim()
      if (!s) { setEditError('enter the corrected value') ; return }
      const n = Number(s)
      value = t.valueType === 'numeric' && Number.isFinite(n) ? n : s
    }
    if (!selfTier && !editReason.trim()) { setEditError('a reason is required for a Consultant-tier correction'); return }
    setBusy(true)
    setEditError(null)
    /* tier-1 sends no reason (Q1); if the window expired between render
       and submit the server answers with the tier rule — shown here */
    const r = await correctObservation(o.observationId, value, selfTier ? undefined : editReason)
    setBusy(false)
    if (r.kind === 'ok') {
      setEditing(null)
      showToast('Observation corrected', 'amended, not erased — the original value stays on the record')
      loadObservations()
    } else if (r.kind === 'rejected') {
      setEditError(r.error)
    } else {
      setEditError('The AURORA API is unreachable — corrections are never applied to local mock state')
    }
  }

  /* clamped to the window: the render clock ticks every 10 s and can lag
     the server stamp by a moment — never advertise more than 5 minutes */
  const selfWindowLeft = (o: Observation) =>
    Math.min(SELF_WINDOW_MS / 60_000, Math.max(0, Math.ceil((SELF_WINDOW_MS - (now.getTime() - enteredAtMs(o))) / 60_000)))

  const activeGroupDef = enabledGroups.find(g => g.groupCode === activeGroup) ?? enabledGroups[0]

  return (
    <div className="app-frame obs">
      <AppHeader
        subtitle="Bedside Observations"
        kpis={kpis}
        bellCount={5}
        onBellClick={() => showToast('Alerts', '5 active notifications across the unit')}
        user={{ initials: initialsOf(session.name), name: session.name, role: `${session.jobTitle} · ${profileOf(session.jobTitle)} profile` }}
      />
      <div className="shell">
        <NavSidebar
          active="observations"
          alertCount={5}
          footerLines={[`Role: ${profileOf(session.jobTitle)} profile`, canRecord ? 'Charting enabled' : 'Chart is read-only']}
        />

        <PatientRail
          patients={patients}
          selectedId={patientId}
          onSelect={id => navigate(`/observations/${id}`)}
        />

        <main>
          {missing && <NotFoundCard />}

          {roster && (
            <PatientBar
              patient={roster}
              links={[
                { label: 'Chart →', to: `/patients/${roster.patientId}` },
                { label: 'Orders →', to: `/orders/${roster.patientId}` },
                { label: 'Timeline →', to: `/timeline/${roster.patientId}` },
              ]}
            >
              <span className="ptbardx">{roster.diagnosis}</span>
              {!canRecord && <span className="ptbarviewonly">Read-only chart</span>}
            </PatientBar>
          )}

          {roster && catalogFailed && (
            <section className="card obsun">
              The AURORA API is unreachable — the Observation Type Catalogue cannot be loaded.
              Observations have no offline mock: real values or none (honest data).
            </section>
          )}

          {/* ---- entry (observations.record only; rendered FROM the catalogue) ---- */}
          {roster && canRecord && catalog && enabledGroups.length > 0 && activeGroupDef && (
            <section className="card obsentry">
              <div className="obshead">
                <h2><IconPulse size={15} stroke="var(--cyan)" /> New Round</h2>
                <span className="obsaside">
                  Values you stage are charted together as ONE round sharing the server-stamped time —
                  a single value is an ad-hoc entry. No back-dating: the server stamps the clinical time.
                </span>
              </div>

              <div className="obsgroups" role="tablist" aria-label="Observation groups">
                {enabledGroups.map(g => {
                  const filled = g.types.filter(t => {
                    const v = draft[t.typeCode]
                    if (v === undefined) return false
                    return typeof v === 'string' ? v.trim() !== '' : Object.values(v).some(x => x.trim() !== '')
                  }).length
                  return (
                    <button
                      key={g.groupCode}
                      role="tab"
                      aria-selected={g.groupCode === activeGroupDef.groupCode}
                      className={`obsgchip${g.groupCode === activeGroupDef.groupCode ? ' on' : ''}`}
                      onClick={() => setActiveGroup(g.groupCode)}
                    >
                      {g.displayName}{filled > 0 && <span className="n num">{filled}</span>}
                    </button>
                  )
                })}
                {disabledGroups.length > 0 && (
                  <span className="obsdisabled">
                    Disabled in this deployment: {disabledGroups.map(g => g.displayName).join(', ')}
                  </span>
                )}
              </div>

              <div className="obsfields">
                {activeGroupDef.types.map(t => (
                  t.isDerived ? (
                    <div className="obsfield derived" key={t.typeCode}>
                      <label>{t.displayName}</label>
                      <span className="obsderivednote">
                        derived — computed at read time from {(t.derivationInputs ?? []).map(c => byCode.get(c)?.displayName ?? c).join(' + ')}, never charted
                      </span>
                    </div>
                  ) : (
                    <div className="obsfield" key={t.typeCode}>
                      <label htmlFor={`obs-${t.typeCode}`}>
                        {t.displayName}{t.optional && <i className="opt"> optional</i>}
                      </label>
                      {t.valueType === 'numeric' && (
                        <span className="obsnumwrap">
                          <input
                            id={`obs-${t.typeCode}`}
                            className="num"
                            inputMode="decimal"
                            placeholder={`${t.min ?? ''}–${t.max ?? ''}`}
                            value={(draft[t.typeCode] as string | undefined) ?? ''}
                            onChange={e => setField(t.typeCode, e.target.value)}
                          />
                          {t.unit && <span className="obsunit">{t.unit}</span>}
                        </span>
                      )}
                      {t.valueType === 'enum' && (
                        <select
                          id={`obs-${t.typeCode}`}
                          value={(draft[t.typeCode] as string | undefined) ?? ''}
                          onChange={e => setField(t.typeCode, e.target.value)}
                        >
                          <option value="">—</option>
                          {(t.allowedValues ?? []).map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                      )}
                      {t.valueType === 'compound' && (
                        <span className="obscomps">
                          {(t.components ?? []).map(c => (
                            <span className="obscomp" key={c.code}>
                              <small>{c.label}</small>
                              {c.kind === 'numeric' ? (
                                <input
                                  className="num"
                                  inputMode="decimal"
                                  aria-label={`${t.displayName} — ${c.label}`}
                                  placeholder={`${c.min ?? ''}–${c.max ?? ''}`}
                                  value={((draft[t.typeCode] as Record<string, string> | undefined)?.[c.code]) ?? ''}
                                  onChange={e => setCompField(t.typeCode, c.code, e.target.value)}
                                />
                              ) : (
                                <select
                                  aria-label={`${t.displayName} — ${c.label}`}
                                  value={((draft[t.typeCode] as Record<string, string> | undefined)?.[c.code]) ?? ''}
                                  onChange={e => setCompField(t.typeCode, c.code, e.target.value)}
                                >
                                  <option value="">—</option>
                                  {(c.values ?? []).map(v => <option key={v} value={v}>{v}</option>)}
                                </select>
                              )}
                            </span>
                          ))}
                        </span>
                      )}
                    </div>
                  )
                ))}
              </div>

              {entryError && <div className="obserr" role="alert">{entryError}</div>}

              <div className="obssubmit">
                <span className="obsstaged">
                  {staged.length === 0
                    ? 'Nothing staged yet — filled values across every group chart together.'
                    : `${staged.length} value${staged.length === 1 ? '' : 's'} staged: ${staged.map(e => byCode.get(e.typeCode)?.displayName ?? e.typeCode).join(', ')}`}
                </span>
                {staged.length > 0 && (
                  <button className="obsclear" onClick={() => { setDraft({}); setEntryError(null) }} disabled={busy}>Clear</button>
                )}
                <button className="obschart" onClick={submitRound} disabled={staged.length === 0 || busy}>
                  <IconCheck /> Chart {staged.length === 1 ? 'ad-hoc entry' : `round (${staged.length})`}
                </button>
              </div>
            </section>
          )}

          {/* ---- the chart read view (every clinical viewer) ---- */}
          {roster && (
            <section className="card obschartcard">
              <div className="obshead">
                <h2><IconClock size={15} stroke="var(--blue)" /> Observation Chart</h2>
                <span className="obsaside">
                  Newest round first · amendments layer on the original (never erased) · derived values computed at read
                </span>
              </div>

              {obsFailed && (
                <div className="obsun">
                  The AURORA API is unreachable — the chart cannot be loaded. Observations have no offline mock (honest data).
                </div>
              )}
              {!obsFailed && obs && rounds.length === 0 && (
                <div className="obsempty">No observations charted for this patient yet — the chart starts honestly blank.</div>
              )}

              {rounds.map(round => {
                const values: RoundValues = { latest: new Map(), all: new Map() }
                for (const o of round.list) {
                  const v = effectiveValue(o)
                  values.latest.set(o.typeCode, v)
                  if (!values.all.has(o.typeCode)) values.all.set(o.typeCode, [])
                  values.all.get(o.typeCode)!.push(v)
                }
                const groupCodes = new Set(round.list.map(o => byCode.get(o.typeCode)?.groupCode))
                const derivedRows = (catalog ?? [])
                  .flatMap(g => g.types)
                  .filter(t => t.isDerived && groupCodes.has(t.groupCode))
                  .map(t => ({ t, v: derivedValue(t, values, byCode) }))
                  .filter(({ v }) => v !== null)
                return (
                  <section className="obsround" key={round.key}>
                    <h3 className="obsroundhead">
                      <span className="num">{timeLabel(round.clinicalTime)}</span>
                      <span className="obsby">{round.recordedBy}</span>
                      <span className={`obssource ${round.source}`}>{round.source}</span>
                      <small className="num">{round.list.length} obs</small>
                    </h3>
                    <div className="obsrows">
                      {round.list.map(o => {
                        const t = byCode.get(o.typeCode)
                        const amended = o.amendments.length > 0
                        const selfTier = canRecord && withinSelfWindow(o, session.name, now)
                        const correctable = selfTier || canCorrect
                        return (
                          <article className={`obsrow${amended ? ' amended' : ''}`} key={o.observationId}>
                            <span className="obsname">{t?.displayName ?? o.typeCode}</span>
                            <span className="obsval num">
                              {displayValue(t, effectiveValue(o))}{o.unit && <i className="obsu"> {o.unit}</i>}
                            </span>
                            {amended && (
                              <span className="obsamendtag" title="amended — original preserved below">
                                amended ×{o.amendments.length}
                              </span>
                            )}
                            {correctable && editing !== o.observationId && (
                              <button className="obsfix" onClick={() => openEditor(o)}>
                                <IconPencil size={12} /> {selfTier ? `Amend (self · ${selfWindowLeft(o)} min left)` : 'Correct'}
                              </button>
                            )}

                            {amended && (
                              <div className="obshistory">
                                <span className="obsorig">originally <b className="num">{displayValue(t, o.value)}</b></span>
                                {o.amendments.map((a, i) => (
                                  <span className="obsamend" key={i}>
                                    → <b className="num">{displayValue(t, a.newValue)}</b> by {a.amendedBy} ({a.amenderRole}) at {timeLabel(a.amendedAt)}
                                    {a.reason && <i> — “{a.reason}”</i>}
                                  </span>
                                ))}
                              </div>
                            )}

                            {editing === o.observationId && t && (
                              <div className="obseditor">
                                {t.valueType === 'numeric' && (
                                  <span className="obsnumwrap">
                                    <input
                                      className="num"
                                      inputMode="decimal"
                                      aria-label={`Corrected ${t.displayName}`}
                                      placeholder={`${t.min ?? ''}–${t.max ?? ''}`}
                                      value={editValue as string}
                                      onChange={e => { setEditValue(e.target.value); setEditError(null) }}
                                    />
                                    {t.unit && <span className="obsunit">{t.unit}</span>}
                                  </span>
                                )}
                                {t.valueType === 'enum' && (
                                  <select
                                    aria-label={`Corrected ${t.displayName}`}
                                    value={editValue as string}
                                    onChange={e => { setEditValue(e.target.value); setEditError(null) }}
                                  >
                                    <option value="">—</option>
                                    {(t.allowedValues ?? []).map(v => <option key={v} value={v}>{v}</option>)}
                                  </select>
                                )}
                                {t.valueType === 'compound' && (
                                  <span className="obscomps">
                                    {(t.components ?? []).map(c => (
                                      <span className="obscomp" key={c.code}>
                                        <small>{c.label}</small>
                                        {c.kind === 'numeric' ? (
                                          <input
                                            className="num"
                                            inputMode="decimal"
                                            aria-label={`Corrected ${t.displayName} — ${c.label}`}
                                            value={(editValue as Record<string, string>)[c.code] ?? ''}
                                            onChange={e => { setEditValue(v => ({ ...(v as Record<string, string>), [c.code]: e.target.value })); setEditError(null) }}
                                          />
                                        ) : (
                                          <select
                                            aria-label={`Corrected ${t.displayName} — ${c.label}`}
                                            value={(editValue as Record<string, string>)[c.code] ?? ''}
                                            onChange={e => { setEditValue(v => ({ ...(v as Record<string, string>), [c.code]: e.target.value })); setEditError(null) }}
                                          >
                                            <option value="">—</option>
                                            {(c.values ?? []).map(v => <option key={v} value={v}>{v}</option>)}
                                          </select>
                                        )}
                                      </span>
                                    ))}
                                  </span>
                                )}
                                {!selfTier && (
                                  <input
                                    className="obsreason"
                                    placeholder="Reason (required — Consultant-tier correction)"
                                    aria-label="Correction reason"
                                    value={editReason}
                                    onChange={e => { setEditReason(e.target.value); setEditError(null) }}
                                  />
                                )}
                                {selfTier && <span className="obsselfnote">Self-correction inside the 5-minute window — no reason needed; the amendment still records you, the original and the time.</span>}
                                {editError && <span className="obserr" role="alert">{editError}</span>}
                                <span className="obseditbtns">
                                  <button className="obscancel" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
                                  <button className="obschart" onClick={() => submitCorrection(o)} disabled={busy}><IconCheck /> Save correction</button>
                                </span>
                              </div>
                            )}
                          </article>
                        )
                      })}
                      {derivedRows.map(({ t, v }) => (
                        <article className="obsrow derived" key={t.typeCode}>
                          <span className="obsname">{t.displayName}</span>
                          <span className="obsval num">{v}{t.unit && <i className="obsu"> {t.unit}</i>}</span>
                          <span className="obsderivedtag">computed</span>
                        </article>
                      ))}
                    </div>
                  </section>
                )
              })}
            </section>
          )}
        </main>
      </div>
      <Toast state={toast} accent="green" />
    </div>
  )
}
