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
import { documentLabResult, getLabCatalog, getLabDraws, getPatients, getRosterRecord } from '../../lib/api'
import type {
  DocumentLabItem, LabDraw, LabPanelKey, LabTest, PatientSummary, RosterRecordDto,
} from '../../lib/api/types'
import { getSession, hasPermission, initialsOf, profileOf } from '../../lib/session'

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

/** flag a value would carry, mirroring the server's catalogue derivation
 *  (single reference range → normal in-band, abnormal out; no client-side
 *  critical — the catalogue models one range). Preview only; the SERVER is
 *  authoritative. */
function previewFlag(value: number, refLow: number, refHigh: number): 'normal' | 'abnormal' {
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
  const canDocument = hasPermission(session.jobTitle, 'results.document')

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
  const [entryError, setEntryError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => { getPatients().then(setPatients) }, [])
  useEffect(() => {
    getLabCatalog().then(setCatalog).catch(() => setCatalogFailed(true))
  }, [])

  useEffect(() => {
    if (!patientId && patients?.length) navigate(`/lab-entry/${patients[0].patientId}`, { replace: true })
  }, [patientId, patients, navigate])

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
    { icon: <IconFlask size={14} stroke="var(--cyan)" />, iconBg: 'rgba(53,224,208,.13)', value: catalog ? activeTests.length : '—', label: 'Panels Available' },
    { icon: <IconPencil size={14} stroke="var(--violet)" />, iconBg: 'rgba(167,139,250,.15)', value: draws ? manualCount : '—', label: 'Manually Documented' },
    { icon: <IconFlask size={14} stroke="var(--blue)" />, iconBg: 'rgba(77,163,255,.15)', value: draws ? draws.length : '—', label: 'Results on File' },
    { icon: <IconClock size={14} stroke="var(--green)" />, iconBg: 'rgba(61,232,160,.13)', value: activeTest ? activeTest.analytes.length : '—', label: 'Analytes in Panel' },
  ]

  const setField = (analyte: string, v: string) => {
    setEntryError(null)
    setDraft(d => ({ ...d, [analyte]: v }))
  }

  async function submit() {
    if (!patientId || !activeTest || busy) return
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
        bellCount={0}
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
                  const filled = t.analytes.filter(a => (draft[a.analyte] ?? '').trim() !== '' && t.testId === activeTest.testId).length
                  return (
                    <button
                      key={t.testId}
                      role="tab"
                      aria-selected={t.testId === activeTest.testId}
                      className={`lepchip${t.testId === activeTest.testId ? ' on' : ''}`}
                      onClick={() => { setPanel(t.testId); setDraft({}); setNote(''); setEntryError(null) }}
                    >
                      {t.testId}{filled > 0 && <span className="n num">{filled}</span>}
                    </button>
                  )
                })}
              </div>

              <div className="lepmeta">
                <b>{activeTest.name}</b> · {activeTest.category} · {activeTest.specimen}
              </div>

              <div className="lefields">
                {activeTest.analytes.map(a => {
                  const raw = (draft[a.analyte] ?? '').trim()
                  const n = Number(raw)
                  const show = raw !== '' && Number.isFinite(n)
                  const flag = show ? previewFlag(n, a.refLow, a.refHigh) : null
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
                      <span className="leref num">ref {a.refRange}</span>
                      {flag && <span className={`leflag ${flag}`}>{flag === 'normal' ? 'in range' : 'out of range'}</span>}
                    </div>
                  )
                })}
              </div>

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
                  {staged.length === 0
                    ? 'Nothing entered yet — fill the analytes from the paper report or the analyzer.'
                    : `${staged.length} analyte${staged.length === 1 ? '' : 's'} staged: ${staged.map(s => s.analyte).join(', ')}`}
                </span>
                {staged.length > 0 && (
                  <button className="leclear" onClick={() => { setDraft({}); setNote(''); setEntryError(null) }} disabled={busy}>Clear</button>
                )}
                <button className="ledoc" onClick={submit} disabled={staged.length === 0 || busy}>
                  <IconCheck /> Document {activeTest.testId}{staged.length > 0 ? ` (${staged.length})` : ''}
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
                return (
                  <article className={`lerow${d.source === 'manual' ? ' manual' : ''}`} key={d.labId}>
                    <div className="lerowtop">
                      <span className="lerpanel">{d.panel}</span>
                      <span className="lerlabel">{d.label}</span>
                      <span className={`lerflag ${d.flag}`}>{d.flag}</span>
                      {d.source === 'manual' && <span className="lersource" title="manually documented">✎ manual</span>}
                      {d.orderId
                        ? <span className="lerorder" title="fulfils a lab order">↳ {d.orderId}</span>
                        : <span className="lerstandalone" title="documented without a prior order">standalone</span>}
                      <span className="lertime num">{d.resultedAt}</span>
                    </div>
                    <div className="leritems">
                      {d.items.map(it => (
                        <span className={`leritem ${it.flag}`} key={it.analyte}>
                          {it.analyte} <b className="num">{Number.isInteger(it.value) ? it.value : it.value.toFixed(it.value < 10 ? 2 : 1)}</b>
                          {it.unit && <i className="leru"> {it.unit}</i>}
                        </span>
                      ))}
                    </div>
                    {prov && (
                      <div className="lerprov">
                        {d.source === 'manual' ? 'documented' : 'resulted'} by {prov.actor} at {prov.time}
                        {d.acknowledged && d.acknowledgedBy && <> · acknowledged by {d.acknowledgedBy}</>}
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
