import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import './LabEntry.css'
import { AppHeader, type KpiSpec } from '../../components/AppHeader'
import { NavSidebar } from '../../components/NavSidebar'
import { NotFoundCard } from '../../components/NotFoundCard'
import { PatientBar } from '../../components/PatientBar'
import { PatientRail } from '../../components/PatientRail'
import { Toast, useToast } from '../../components/Toast'
import { IconCheck, IconClock, IconFlask, IconPencil } from '../../components/icons'
import { correctLabResult, documentCustomLabResult, documentLabResult, getLabCatalog, getLabDraws, getPatients, getRosterRecord } from '../../lib/api'
import type {
  DocumentLabItem, LabDraw, LabPanelKey, LabTest, PatientSummary, RosterRecordDto,
} from '../../lib/api/types'
import { defaultPatientId, useRememberPatient } from '../../lib/patientContext'
import { getSession, hasPermission, initialsOf, profileOf } from '../../lib/session'
import { displayStamp, useNow } from '../../lib/time'

/* the pseudo-panel key for the Custom / Other tab (not a catalogue testId) */
const CUSTOM = '__custom__'

/* Lab Result Editing — the observation two-tier model applied to labs.
   Tier-1: the documenter, within the flat 5-minute window from the
   documentation anchor, no reason required (still recorded). Tier-2:
   Consultant-tier (results.correct), reason required. The SERVER decides
   the tier — everything here is a display hint. */
const SELF_WINDOW_MS = 5 * 60_000

/** the window anchor: documentedAt is 'yyyy-MM-dd HH:mm:ss' UTC */
const documentedAtMs = (d: LabDraw) =>
  d.documentedAt ? Date.parse(`${d.documentedAt.replace(' ', 'T')}Z`) : NaN

const withinSelfWindow = (d: LabDraw, now: Date) =>
  !!d.documentedAt && now.getTime() - documentedAtMs(d) <= SELF_WINDOW_MS

/** clamped to the window — never advertise more than 5 minutes (the
 *  observation screen's rule; the render clock ticks every 10 s) */
const selfWindowLeft = (d: LabDraw, now: Date) =>
  Math.min(SELF_WINDOW_MS / 60_000, Math.max(0, Math.ceil((SELF_WINDOW_MS - (now.getTime() - documentedAtMs(d))) / 60_000)))

/* Lab Result-Entry (Documentation) screen — the MANUAL human feed into the
   EXISTING lab-results store. The real paper-based workflow: the central lab
   prints results on paper → the ICU bedside team transcribes them here; a
   bedside ABG is entered straight from the blood-gas analyzer. Per-panel
   entry (the validator's Q2): select patient/encounter → catalogue panel →
   per-analyte value → submit. The FORM is rendered FROM the lab catalogue
   (units + reference ranges are catalogue-owned, no analyte names hard-coded
   here); the server derives unit/refRange/flag, links an existing order when
   one matches (or stands the result alone), and stamps the documenting
   clinician + time + source=manual. Mirrors the /observations entry pattern:
   an entry form over a complete store, not a store rebuild. REAL-ONLY write
   (a documented result is a clinical record — never written to mock). */

/** flag a value would carry, mirroring the server's derivation: CRITICAL
 *  first when the definition carries Option B critical thresholds (at or
 *  beyond one — at-threshold counts as critical), else normal in-band /
 *  abnormal out. Preview only; the SERVER is authoritative. */
function previewFlag(value: number, refLow: number, refHigh: number, critLow?: number, critHigh?: number): 'normal' | 'abnormal' | 'critical' {
  if ((critLow !== undefined && value <= critLow) || (critHigh !== undefined && value >= critHigh)) return 'critical'
  return value >= refLow && value <= refHigh ? 'normal' : 'abnormal'
}

/** the actor + time of the entry event (documented / resulted) from the
 *  result's audit history, when present */
function provenance(d: LabDraw): { actor: string; time: string } | null {
  const evt = d.history?.find(e => e.action === 'documented') ?? d.history?.find(e => e.action === 'resulted')
  return evt ? { actor: evt.actor, time: evt.time } : null
}

export function LabEntry() {
  const { patientId = '' } = useParams()
  const navigate = useNavigate()
  const { toast, showToast } = useToast()
  const session = getSession()!
  const now = useNow(10_000)
  const canDocument = hasPermission(session.jobTitle, 'results.document')
  const canCorrect = hasPermission(session.jobTitle, 'results.correct')

  const [patients, setPatients] = useState<PatientSummary[] | null>(null)
  const [roster, setRoster] = useState<RosterRecordDto | null>(null)
  const [missing, setMissing] = useState(false)
  const [catalog, setCatalog] = useState<LabTest[] | null>(null)
  const [catalogFailed, setCatalogFailed] = useState(false)
  const [draws, setDraws] = useState<LabDraw[] | null>(null)
  const [drawsFailed, setDrawsFailed] = useState(false)

  const [panel, setPanel] = useState<string | null>(null)
  /* per-analyte value drafts, keyed by analyte name */
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [note, setNote] = useState('')
  /* Custom / Other free-text drafts (name + value required, unit + range optional) */
  const [cName, setCName] = useState('')
  const [cValue, setCValue] = useState('')
  const [cUnit, setCUnit] = useState('')
  const [cRange, setCRange] = useState('')
  const [entryError, setEntryError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const isCustom = panel === CUSTOM
  const customReady = cName.trim() !== '' && cValue.trim() !== ''
  const resetDrafts = () => { setDraft({}); setNote(''); setCName(''); setCValue(''); setCUnit(''); setCRange(''); setEntryError(null) }

  /* the open correction editor (one at a time — the observation pattern) */
  const [editing, setEditing] = useState<string | null>(null)
  /** an analyte name (structured), 'value' (custom), or 'note' */
  const [editTarget, setEditTarget] = useState('')
  const [editValue, setEditValue] = useState('')
  const [editReason, setEditReason] = useState('')
  const [editError, setEditError] = useState<string | null>(null)

  function openEditor(d: LabDraw) {
    setEditing(d.labId)
    setEditError(null)
    setEditReason('')
    const target = d.custom ? 'value' : (d.items[0]?.analyte ?? 'note')
    setEditTarget(target)
    setEditValue(d.custom ? (d.customValue ?? '') : String(d.items[0]?.value ?? ''))
  }

  function switchTarget(d: LabDraw, target: string) {
    setEditTarget(target)
    setEditError(null)
    if (target === 'note') setEditValue(d.note ?? '')
    else if (d.custom) setEditValue(d.customValue ?? '')
    else setEditValue(String(d.items.find(i => i.analyte === target)?.value ?? ''))
  }

  async function submitCorrection(d: LabDraw) {
    if (busy) return
    const selfTier = withinSelfWindow(d, now) && provenance(d)?.actor === session.name && canDocument
    const raw = editValue.trim()
    if (raw === '') { setEditError('enter the corrected ' + (editTarget === 'note' ? 'note' : 'value')); return }
    if (!selfTier && !editReason.trim()) { setEditError('a reason is required for a Consultant-tier correction'); return }
    const draft: { analyte?: string; value?: number | string; note?: string; reason?: string } = {}
    if (editTarget === 'note') draft.note = raw
    else if (d.custom) draft.value = raw
    else {
      const n = Number(raw)
      if (!Number.isFinite(n)) { setEditError(`${editTarget}: enter a number`); return }
      draft.analyte = editTarget
      draft.value = n
    }
    /* tier-1 sends no reason; if the window expired between render and
       submit, the server answers with the tier rule — shown here */
    if (!selfTier && editReason.trim()) draft.reason = editReason.trim()
    setBusy(true)
    setEditError(null)
    const r = await correctLabResult(d.labId, draft)
    setBusy(false)
    if (r.kind === 'ok') {
      setEditing(null)
      showToast('Result corrected', 'amended, not erased — the original value stays on the record')
      loadDraws()
    } else if (r.kind === 'rejected') {
      setEditError(r.error)
    } else {
      setEditError('The AURORA API is unreachable — corrections are never applied to local mock state')
    }
  }

  useEffect(() => { getPatients().then(setPatients) }, [])
  useEffect(() => {
    getLabCatalog().then(setCatalog).catch(() => setCatalogFailed(true))
  }, [])

  useEffect(() => {
    if (!patientId && patients?.length) navigate(`/lab-entry/${defaultPatientId(patients)}`, { replace: true })
  }, [patientId, patients, navigate])
  /* record the viewed patient as the cross-section context (only once
     this screen's own list confirms the id resolves) */
  useRememberPatient(patientId, patients)

  const loadDraws = useCallback(() => {
    if (!patientId) return
    getLabDraws(patientId).then(list => { setDraws(list); setDrawsFailed(false) }).catch(() => setDrawsFailed(true))
  }, [patientId])

  useEffect(() => {
    if (!patientId) return
    let stale = false
    setMissing(false)
    setDraws(null)
    setDraft({})
    setNote('')
    setCName(''); setCValue(''); setCUnit(''); setCRange('')
    setEntryError(null)
    getRosterRecord(patientId).then(rec => {
      if (stale) return
      /* locked decision: explicit not-found — never another patient's data.
         The roster is the OPEN-encounter view; documenting into a discharged
         encounter is server-refused (409 — a result is initiated on the open
         episode), so a discharged patient legitimately has no entry form. */
      if (!rec) { setRoster(null); setMissing(true); return }
      setRoster(rec)
    })
    loadDraws()
    return () => { stale = true }
  }, [patientId, loadDraws])

  /* orderable/documentable panels: active catalogue tests (an inactive test
     still RESULTS server-side, but the entry picker offers the live menu) */
  const activeTests = useMemo(() => (catalog ?? []).filter(t => t.active), [catalog])

  useEffect(() => {
    if (panel === null && activeTests.length > 0) setPanel(activeTests[0].testId)
  }, [panel, activeTests])

  const activeTest = activeTests.find(t => t.testId === panel) ?? activeTests[0]

  const staged: DocumentLabItem[] = useMemo(() => {
    if (!activeTest) return []
    const items: DocumentLabItem[] = []
    for (const a of activeTest.analytes) {
      const raw = (draft[a.analyte] ?? '').trim()
      if (raw === '') continue
      const n = Number(raw)
      if (Number.isFinite(n)) items.push({ analyte: a.analyte, value: n })
    }
    return items
  }, [activeTest, draft])

  /* a filled-but-non-numeric field blocks submission with a precise message
     (the server would 400 — we say it earlier) */
  const badField = useMemo(() => {
    if (!activeTest) return null
    for (const a of activeTest.analytes) {
      const raw = (draft[a.analyte] ?? '').trim()
      if (raw !== '' && !Number.isFinite(Number(raw))) return a.analyte
    }
    return null
  }, [activeTest, draft])

  const manualCount = draws?.filter(d => d.source === 'manual').length ?? 0

  const kpis: KpiSpec[] = [
    { icon: <IconFlask size={14} stroke="var(--cyan)" />, iconBg: 'rgba(var(--cyan-rgb),.13)', value: catalog ? activeTests.length : '—', label: 'Panels Available' },
    { icon: <IconPencil size={14} stroke="var(--violet)" />, iconBg: 'rgba(var(--violet-rgb),.15)', value: draws ? manualCount : '—', label: 'Manually Documented' },
    { icon: <IconFlask size={14} stroke="var(--blue)" />, iconBg: 'rgba(var(--blue-rgb),.15)', value: draws ? draws.length : '—', label: 'Results on File' },
    { icon: <IconClock size={14} stroke="var(--green)" />, iconBg: 'rgba(var(--green-rgb),.13)', value: isCustom ? 'free text' : (activeTest ? activeTest.analytes.length : '—'), label: isCustom ? 'Custom Entry' : 'Analytes in Panel' },
  ]

  const setField = (analyte: string, v: string) => {
    setEntryError(null)
    setDraft(d => ({ ...d, [analyte]: v }))
  }

  async function submit() {
    if (!patientId || busy) return
    if (isCustom) return submitCustom()
    if (!activeTest) return
    if (badField) { setEntryError(`${badField}: enter a number, or clear the field`); return }
    if (staged.length === 0) { setEntryError('Enter at least one analyte value from the paper report or the analyzer'); return }
    setBusy(true)
    setEntryError(null)
    const r = await documentLabResult({
      patientId,
      panel: activeTest.testId as LabPanelKey,
      items: staged,
      ...(note.trim() ? { note: note.trim() } : {}),
    })
    setBusy(false)
    if (r.kind === 'ok') {
      setDraft({})
      setNote('')
      const linked = r.data.orderId ? `fulfilled order ${r.data.orderId}` : 'standalone (no matching order)'
      showToast('Result documented', `${r.data.label} · ${staged.length} analyte${staged.length === 1 ? '' : 's'} · ${linked} · source manual`)
      loadDraws()
    } else if (r.kind === 'rejected') {
      setEntryError(r.error)
    } else {
      setEntryError('The AURORA API is unreachable — a documented result is a clinical record and is never written to local mock state')
    }
  }

  async function submitCustom() {
    if (!patientId || busy) return
    if (!customReady) { setEntryError('Test name and result value are required'); return }
    setBusy(true)
    setEntryError(null)
    const r = await documentCustomLabResult({
      patientId,
      testName: cName.trim(),
      value: cValue.trim(),
      ...(cUnit.trim() ? { unit: cUnit.trim() } : {}),
      ...(cRange.trim() ? { refRange: cRange.trim() } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    })
    setBusy(false)
    if (r.kind === 'ok') {
      setCName(''); setCValue(''); setCUnit(''); setCRange(''); setNote('')
      showToast('Custom test documented', `${r.data.label} — unstructured · no clinical flag · source manual`)
      loadDraws()
    } else if (r.kind === 'rejected') {
      setEntryError(r.error)
    } else {
      setEntryError('The AURORA API is unreachable — a documented result is a clinical record and is never written to local mock state')
    }
  }

  /* newest documented/resulted first for the "on file" list */
  const recent = useMemo(
    () => [...(draws ?? [])].sort((a, b) => (a.labId < b.labId ? 1 : a.labId > b.labId ? -1 : 0)),
    [draws],
  )

  return (
    <div className="app-frame le">
      <AppHeader
        subtitle="Lab Result Entry"
        kpis={kpis}
        user={{ initials: initialsOf(session.name), name: session.name, role: `${session.jobTitle} · ${profileOf(session.jobTitle)} profile` }}
      />
      <div className="shell">
        <NavSidebar
          active="labentry"
          alertCount={5}
          footerLines={[`Role: ${profileOf(session.jobTitle)} profile`, canDocument ? 'Documenting enabled' : 'View only']}
        />

        <PatientRail
          patients={patients}
          selectedId={patientId}
          onSelect={id => navigate(`/lab-entry/${id}`)}
        />

        <main>
          {missing && <NotFoundCard />}

          {roster && (
            <PatientBar
              patient={roster}
              links={[
                { label: 'Results →', to: `/labs/${roster.patientId}` },
                { label: 'Orders →', to: `/orders/${roster.patientId}` },
                { label: 'Chart →', to: `/patients/${roster.patientId}` },
              ]}
            >
              <span className="ptbardx">{roster.diagnosis}</span>
              {!canDocument && <span className="ptbarviewonly">View only — no documentation authority</span>}
            </PatientBar>
          )}

          {roster && catalogFailed && (
            <section className="card leun">
              The AURORA API is unreachable — the lab catalogue cannot be loaded, so the entry
              form (which is rendered from it) is unavailable. Reprint when the API is reachable.
            </section>
          )}

          {/* ---- entry (results.document only; form rendered FROM the catalogue) ---- */}
          {roster && canDocument && catalog && activeTest && (
            <section className="card leentry">
              <div className="lehead">
                <h2><IconPencil size={15} stroke="var(--cyan)" /> Document a Lab Panel</h2>
                <span className="leaside">
                  Transcribe a paper central-lab report, or enter a bedside ABG from the analyzer.
                  Units, reference ranges and the abnormal flag come from the catalogue; the server
                  stamps you and the time, links a matching order when one exists, and marks the
                  result <b>manual</b>.
                </span>
              </div>

              <div className="lepanels" role="tablist" aria-label="Lab panels">
                {activeTests.map(t => {
                  const filled = t.analytes.filter(a => (draft[a.analyte] ?? '').trim() !== '' && !isCustom && t.testId === activeTest.testId).length
                  return (
                    <button
                      key={t.testId}
                      role="tab"
                      aria-selected={!isCustom && t.testId === activeTest.testId}
                      className={`lepchip${!isCustom && t.testId === activeTest.testId ? ' on' : ''}`}
                      onClick={() => { setPanel(t.testId); resetDrafts() }}
                    >
                      {t.testId}{filled > 0 && <span className="n num">{filled}</span>}
                    </button>
                  )
                })}
                {/* the 8th option: free-text escape hatch for a test the catalogue lacks */}
                <button
                  role="tab"
                  aria-selected={isCustom}
                  className={`lepchip lepcustom${isCustom ? ' on' : ''}`}
                  onClick={() => { setPanel(CUSTOM); resetDrafts() }}
                >
                  + Custom / Other
                </button>
              </div>

              {isCustom ? (
                <>
                  <div className="lepmeta">
                    Free-text entry for a test not in the catalogue — <b>unstructured and unflagged</b>.
                    The system records exactly what you type and does <b>not</b> compute
                    normal/abnormal/critical; the reference range is display-only context.
                  </div>
                  <div className="lefields lecustomfields">
                    <div className="lefield">
                      <label htmlFor="le-cname">Test name <i className="req">required</i></label>
                      <input id="le-cname" placeholder="e.g. Procalcitonin" value={cName}
                        onChange={e => { setCName(e.target.value); setEntryError(null) }} />
                    </div>
                    <div className="lefield">
                      <label htmlFor="le-cvalue">Result value <i className="req">required</i></label>
                      <input id="le-cvalue" placeholder='e.g. "2.5" or "positive"' value={cValue}
                        onChange={e => { setCValue(e.target.value); setEntryError(null) }} />
                    </div>
                    <div className="lefield">
                      <label htmlFor="le-cunit">Unit <i>optional</i></label>
                      <input id="le-cunit" placeholder="e.g. ng/mL" value={cUnit}
                        onChange={e => { setCUnit(e.target.value); setEntryError(null) }} />
                    </div>
                    <div className="lefield">
                      <label htmlFor="le-crange">Reference range <i>optional · display-only</i></label>
                      <input id="le-crange" placeholder="e.g. 0.5–2.0" value={cRange}
                        onChange={e => { setCRange(e.target.value); setEntryError(null) }} />
                    </div>
                  </div>
                  {cRange.trim() !== '' && (
                    <p className="lecustomnote">
                      The reference range is shown next to the result as context only — it does not
                      drive a normal/abnormal/critical flag (a hand-typed range must not produce an
                      authoritative-looking auto-flag). You interpret the value with your own judgment.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <div className="lepmeta">
                    <b>{activeTest.name}</b> · {activeTest.category} · {activeTest.specimen}
                  </div>
                  <div className="lefields">
                    {activeTest.analytes.map(a => {
                      const raw = (draft[a.analyte] ?? '').trim()
                      const n = Number(raw)
                      const show = raw !== '' && Number.isFinite(n)
                      const flag = show ? previewFlag(n, a.refLow, a.refHigh, a.critLow, a.critHigh) : null
                      return (
                        <div className="lefield" key={a.analyte}>
                          <label htmlFor={`le-${a.analyte}`}>{a.analyte}</label>
                          <span className="lenumwrap">
                            <input
                              id={`le-${a.analyte}`}
                              className="num"
                              inputMode="decimal"
                              placeholder={a.refRange}
                              value={draft[a.analyte] ?? ''}
                              onChange={e => setField(a.analyte, e.target.value)}
                            />
                            {a.unit && <span className="leunit">{a.unit}</span>}
                          </span>
                          <span className="leref num">
                            ref {a.refRange}
                            {(a.critLow !== undefined || a.critHigh !== undefined) && (
                              <> · crit {a.critLow !== undefined ? `≤${a.critLow}` : ''}{a.critLow !== undefined && a.critHigh !== undefined ? ' / ' : ''}{a.critHigh !== undefined ? `≥${a.critHigh}` : ''}</>
                            )}
                          </span>
                          {flag && <span className={`leflag ${flag}`}>{flag === 'normal' ? 'in range' : flag === 'critical' ? 'CRITICAL' : 'out of range'}</span>}
                        </div>
                      )
                    })}
                  </div>
                </>
              )}

              <div className="lenote">
                <label htmlFor="le-note">Note <i>optional</i></label>
                <input
                  id="le-note"
                  placeholder="e.g. drawn 14:00, sample slightly hemolyzed"
                  value={note}
                  onChange={e => { setNote(e.target.value); setEntryError(null) }}
                />
              </div>

              {entryError && <div className="leerr" role="alert">{entryError}</div>}

              <div className="lesubmit">
                <span className="lestaged">
                  {isCustom
                    ? (customReady
                        ? `Ready to document "${cName.trim()}" = ${cValue.trim()}${cUnit.trim() ? ` ${cUnit.trim()}` : ''} — unstructured, no clinical flag.`
                        : 'Enter a test name and a result value — a custom test is recorded exactly as typed, without a flag.')
                    : (staged.length === 0
                        ? 'Nothing entered yet — fill the analytes from the paper report or the analyzer.'
                        : `${staged.length} analyte${staged.length === 1 ? '' : 's'} staged: ${staged.map(s => s.analyte).join(', ')}`)}
                </span>
                {(isCustom ? (cName || cValue || cUnit || cRange || note) : staged.length > 0) && (
                  <button className="leclear" onClick={resetDrafts} disabled={busy}>Clear</button>
                )}
                <button className="ledoc" onClick={submit} disabled={(isCustom ? !customReady : staged.length === 0) || busy}>
                  <IconCheck /> {isCustom ? 'Document custom test' : `Document ${activeTest.testId}${staged.length > 0 ? ` (${staged.length})` : ''}`}
                </button>
              </div>
            </section>
          )}

          {/* ---- results on file (the EXISTING store — confirms the entry landed) ---- */}
          {roster && (
            <section className="card lelist">
              <div className="lehead">
                <h2><IconClock size={15} stroke="var(--blue)" /> Results on File</h2>
                <span className="leaside">
                  The canonical lab-results store · newest first · open <a onClick={() => navigate(`/labs/${roster.patientId}`)}>Labs &amp; Imaging</a> for the full trends view
                </span>
              </div>

              {drawsFailed && (
                <div className="leun">The AURORA API is unreachable — results on file cannot be loaded.</div>
              )}
              {!drawsFailed && draws && recent.length === 0 && (
                <div className="leempty">No lab results on file for this patient yet — documenting a panel above is the first entry.</div>
              )}

              {recent.map(d => {
                const prov = provenance(d)
                const selfTier = !!d.documentedAt && withinSelfWindow(d, now) && prov?.actor === session.name && canDocument
                const correctable = !!d.documentedAt && (selfTier || canCorrect)
                const edited = (d.amendments?.length ?? 0) > 0
                return (
                  <article className={`lerow${d.source === 'manual' ? ' manual' : ''}${d.custom ? ' custom' : ''}`} key={d.labId}>
                    <div className="lerowtop">
                      <span className="lerpanel">{d.custom ? 'Custom' : d.panel}</span>
                      <span className="lerlabel">{d.label}</span>
                      {/* custom results carry NO clinical flag — a "custom" tag
                          replaces the normal/abnormal/critical badge so a reader
                          never mistakes an un-interpreted result for a flagged one */}
                      {d.custom
                        ? <span className="lercustomtag" title="unstructured — no normal/abnormal/critical flag">custom · unflagged</span>
                        : <span className={`lerflag ${d.flag}`}>{d.flag}</span>}
                      {d.source === 'manual' && <span className="lersource" title="manually documented">✎ manual</span>}
                      {edited && <span className="leredited" title="corrected — the original stays on the record below">edited ×{d.amendments!.length}</span>}
                      {!d.custom && (d.orderId
                        ? <span className="lerorder" title="fulfils a lab order">↳ {d.orderId}</span>
                        : <span className="lerstandalone" title="documented without a prior order">standalone</span>)}
                      <span className="lertime num">{displayStamp(d.resultedAt)}</span>
                      {correctable && editing !== d.labId && (
                        <button className="lerfix" onClick={() => openEditor(d)}>
                          <IconPencil size={11} /> {selfTier ? `Amend (self · ${selfWindowLeft(d, now)} min left)` : 'Correct'}
                        </button>
                      )}
                    </div>
                    {d.custom ? (
                      <div className="leritems">
                        <span className="leritem lercustomval">
                          <b>{d.customValue}</b>{d.customUnit && <i className="leru"> {d.customUnit}</i>}
                          {d.customRefRange && <span className="lercustomref" title="display-only reference context — does not drive a flag">ref: {d.customRefRange}</span>}
                        </span>
                      </div>
                    ) : (
                      <div className="leritems">
                        {d.items.map(it => (
                          <span className={`leritem ${it.flag}`} key={it.analyte}>
                            {it.analyte} <b className="num">{Number.isInteger(it.value) ? it.value : it.value.toFixed(it.value < 10 ? 2 : 1)}</b>
                            {it.unit && <i className="leru"> {it.unit}</i>}
                          </span>
                        ))}
                      </div>
                    )}
                    {/* display fix (bug 2): the stored note was never shown */}
                    {d.note && <div className="lernote">note: {d.note}</div>}
                    {prov && (
                      <div className="lerprov">
                        {d.source === 'manual' ? 'documented' : 'resulted'} by {prov.actor} at {prov.time}
                        {d.acknowledged && d.acknowledgedBy && <> · acknowledged by {d.acknowledgedBy}</>}
                        {/* §2b safeguard: when a correction post-dates the
                            sign-off, say so right where the sign-off shows */}
                        {d.acknowledged && d.amendments?.some(a => a.afterAcknowledgment) && (
                          <b className="lerpostack"> — then EDITED after acknowledgment (below)</b>
                        )}
                      </div>
                    )}

                    {/* amend-not-erase history — every correction with the
                        original preserved; §2b entries carry their marker */}
                    {edited && (
                      <div className="lerhistory">
                        {d.amendments!.map((a, i) => (
                          <div className="leramend" key={i}>
                            {a.target === 'note' ? 'note' : a.target}: <s className="num">{a.previousValue || '—'}</s> → <b className="num">{a.newValue}</b>
                            {' '}by {a.amendedBy} ({a.amenderRole}) at {a.amendedAt}
                            {a.reason && <i> — “{a.reason}”</i>}
                            {a.afterAcknowledgment && <span className="lerpostacktag" title="this correction happened AFTER the result was acknowledged — the earlier sign-off covers the previous value, not this one">after acknowledgment</span>}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* the inline correction editor (one at a time) */}
                    {editing === d.labId && (
                      <div className="lereditor">
                        <select
                          aria-label="What to correct"
                          value={editTarget}
                          onChange={e => switchTarget(d, e.target.value)}
                        >
                          {d.custom
                            ? <option value="value">value ({d.customValue})</option>
                            : d.items.map(it => <option key={it.analyte} value={it.analyte}>{it.analyte} ({it.value})</option>)}
                          <option value="note">note</option>
                        </select>
                        <input
                          className={editTarget !== 'note' && !d.custom ? 'num' : undefined}
                          inputMode={editTarget !== 'note' && !d.custom ? 'decimal' : undefined}
                          aria-label={`Corrected ${editTarget}`}
                          placeholder={editTarget === 'note' ? 'corrected note' : 'corrected value'}
                          value={editValue}
                          onChange={e => { setEditValue(e.target.value); setEditError(null) }}
                        />
                        {!selfTier && (
                          <input
                            className="lerreason"
                            placeholder="Reason (required — Consultant-tier correction)"
                            aria-label="Correction reason"
                            value={editReason}
                            onChange={e => { setEditReason(e.target.value); setEditError(null) }}
                          />
                        )}
                        {selfTier && <span className="lerselfnote">Self-correction inside the 5-minute window — no reason needed; the amendment still records you, the original and the time.</span>}
                        {editError && <span className="leerr" role="alert">{editError}</span>}
                        <span className="lereditbtns">
                          <button className="leclear" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
                          <button className="ledoc" onClick={() => submitCorrection(d)} disabled={busy}><IconCheck /> Save correction</button>
                        </span>
                      </div>
                    )}
                  </article>
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
