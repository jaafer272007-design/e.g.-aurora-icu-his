import { useCallback, useEffect, useMemo, useState } from 'react'
import '../UsersAdmin/UsersAdmin.css'
import '../Formulary/Formulary.css'
import './LabCatalog.css'
import { AppHeader, type KpiSpec } from '../../components/AppHeader'
import { NavSidebar } from '../../components/NavSidebar'
import { Card } from '../../components/Card'
import { Toast, useToast } from '../../components/Toast'
import { IconAdmit, IconCheck, IconClock, IconFlask } from '../../components/icons'
import { createLabTest, deactivateLabTest, deleteLabTest, getLabCatalog, reactivateLabTest, updateLabTest } from '../../lib/api'
import type { AdtWriteResult } from '../../lib/api'
import type { AnalyteDef, LabTest } from '../../lib/api/types'
import { getSession, initialsOf, profileOf } from '../../lib/session'

/** Layer 4 phase 2 — Lab Test Catalogue management (/lab-catalog, Aurora
 *  Core Master Data). labcatalog.manage — the Laboratory (Ancillary) plus,
 *  with Option B, SeniorDoctor (the Consultant tier); the route guard
 *  renders Access Restricted for everyone else and the server re-enforces
 *  every mutation. Deactivation is a status change, never a delete: an
 *  inactive test cannot be newly ORDERED (server 409) or newly DOCUMENTED
 *  at the bedside (Option B retire), but every existing result referencing
 *  it keeps rendering, and lab resulting against open orders stays allowed.
 *  Option B adds: critical thresholds on analytes (drive the CRITICAL
 *  flag), and Remove — a true delete ONLY for a never-used test; the server
 *  refuses (409) when any result/order references it. Writes are REAL-ONLY
 *  — reference data is a durable system of record. */

/* ---- structured analyte rows (usability fix from hands-on testing) ----
   Analytes were one pipe-delimited textarea ("analyte | unit | refRange |
   refLow | refHigh [| critLow | critHigh]", one per line) — a consultant
   had to hand-type the "|" separators. Each analyte is now a ROW of
   separate labeled inputs; a single-analyte test is one row, a
   multi-analyte panel (like the seeded CBC) is several rows via "Add
   another analyte". UI-ONLY: the same AnalyteDef data is built and stored
   — no data-model or flagging change (the server validates identically). */

interface AnalyteRow {
  analyte: string
  unit: string
  /** the DISPLAY range string (e.g. "4.0–11.0"); blank = auto-derived
   *  "low–high" on submit, so typing the bounds alone is enough */
  refRange: string
  refLow: string
  refHigh: string
  critLow: string
  critHigh: string
}

const emptyRow = (): AnalyteRow =>
  ({ analyte: '', unit: '', refRange: '', refLow: '', refHigh: '', critLow: '', critHigh: '' })

const rowsFromDefs = (a: AnalyteDef[]): AnalyteRow[] => a.map(x => ({
  analyte: x.analyte, unit: x.unit, refRange: x.refRange,
  refLow: String(x.refLow), refHigh: String(x.refHigh),
  critLow: x.critLow !== undefined ? String(x.critLow) : '',
  critHigh: x.critHigh !== undefined ? String(x.critHigh) : '',
}))

/** fully-empty trailing rows are ignored (an extra "Add another analyte"
 *  click never blocks submission) */
const rowIsBlank = (r: AnalyteRow) =>
  !r.analyte.trim() && !r.unit.trim() && !r.refRange.trim() && !r.refLow.trim()
  && !r.refHigh.trim() && !r.critLow.trim() && !r.critHigh.trim()

/** rows → AnalyteDef[], or a message naming the offending row. Client
 *  checks mirror what the old pipe parser checked (required fields +
 *  numeric bounds); the semantic rules (refLow ≤ refHigh, crit at/outside
 *  the range) stay server-answered 400s exactly as before. */
function rowsToDefs(rows: AnalyteRow[]): AnalyteDef[] | string {
  const filled = rows.filter(r => !rowIsBlank(r))
  if (filled.length === 0) return 'at least one analyte row is required'
  const out: AnalyteDef[] = []
  for (let i = 0; i < filled.length; i++) {
    const r = filled[i]
    const at = `Analyte ${i + 1}`
    if (!r.analyte.trim()) return `${at}: name is required`
    const refLow = Number(r.refLow), refHigh = Number(r.refHigh)
    if (!r.refLow.trim() || !Number.isFinite(refLow)) return `${at} (${r.analyte.trim()}): reference low must be a number`
    if (!r.refHigh.trim() || !Number.isFinite(refHigh)) return `${at} (${r.analyte.trim()}): reference high must be a number`
    const def: AnalyteDef = {
      analyte: r.analyte.trim(), unit: r.unit.trim(),
      /* blank display range auto-derives from the bounds (en dash, the
         seeded style) — no extra typing for the common case */
      refRange: r.refRange.trim() || `${r.refLow.trim()}–${r.refHigh.trim()}`,
      refLow, refHigh,
    }
    if (r.critLow.trim()) {
      const n = Number(r.critLow)
      if (!Number.isFinite(n)) return `${at} (${r.analyte.trim()}): critical low must be a number (or blank)`
      def.critLow = n
    }
    if (r.critHigh.trim()) {
      const n = Number(r.critHigh)
      if (!Number.isFinite(n)) return `${at} (${r.analyte.trim()}): critical high must be a number (or blank)`
      def.critHigh = n
    }
    out.push(def)
  }
  return out
}

/** the row-based analyte editor — shared by Add Test and the Edit panel */
function AnalyteRowsEditor({ rows, setRows, disabled, idPrefix }: {
  rows: AnalyteRow[]
  setRows: (rows: AnalyteRow[]) => void
  disabled: boolean
  idPrefix: string
}) {
  const set = (i: number, field: keyof AnalyteRow, value: string) =>
    setRows(rows.map((r, k) => (k === i ? { ...r, [field]: value } : r)))
  const remove = (i: number) => setRows(rows.filter((_, k) => k !== i))
  const num = (i: number, field: keyof AnalyteRow, label: string, cls: string, placeholder: string, optional = false) => (
    <span className={`anfield ${cls}`}>
      <label htmlFor={`${idPrefix}-${field}-${i}`}>{label}{optional && <i> · optional</i>}</label>
      <input id={`${idPrefix}-${field}-${i}`} className="num" inputMode="decimal" value={rows[i][field]}
        onChange={ev => set(i, field, ev.target.value)} disabled={disabled} placeholder={placeholder} autoComplete="off" />
    </span>
  )
  return (
    <div className="anrows">
      <span className="anlegend">Analytes <i>— one row per analyte; a panel is several rows. No separators — each value in its own box.</i></span>
      {rows.map((r, i) => (
        <div className="anblock" key={i} role="group" aria-label={`Analyte ${i + 1}`}>
          <span className="anhead">
            <b>Analyte {i + 1}</b>
            <button type="button" className="anremove" onClick={() => remove(i)}
              disabled={disabled || rows.length === 1} aria-label={`Remove analyte row ${i + 1}`}>
              ✕ Remove
            </button>
          </span>
          <span className="anfield an-name">
            <label htmlFor={`${idPrefix}-analyte-${i}`}>Analyte name</label>
            <input id={`${idPrefix}-analyte-${i}`} value={r.analyte} onChange={ev => set(i, 'analyte', ev.target.value)}
              disabled={disabled} placeholder="e.g. WBC" autoComplete="off" />
          </span>
          <span className="anfield an-unit">
            <label htmlFor={`${idPrefix}-unit-${i}`}>Unit <i>· blank if none</i></label>
            <input id={`${idPrefix}-unit-${i}`} value={r.unit} onChange={ev => set(i, 'unit', ev.target.value)}
              disabled={disabled} placeholder="e.g. K/µL" autoComplete="off" />
          </span>
          {num(i, 'refLow', 'Reference low', 'an-num', '4.0')}
          {num(i, 'refHigh', 'Reference high', 'an-num', '11.0')}
          <span className="anfield an-range">
            <label htmlFor={`${idPrefix}-refRange-${i}`}>Range text <i>· blank = auto low–high</i></label>
            <input id={`${idPrefix}-refRange-${i}`} className="num" value={r.refRange} onChange={ev => set(i, 'refRange', ev.target.value)}
              disabled={disabled} placeholder={r.refLow.trim() && r.refHigh.trim() ? `auto: ${r.refLow.trim()}–${r.refHigh.trim()}` : 'e.g. 4.0–11.0'} autoComplete="off" />
          </span>
          {num(i, 'critLow', 'Critical low', 'an-num an-crit', '—', true)}
          {num(i, 'critHigh', 'Critical high', 'an-num an-crit', '—', true)}
        </div>
      ))}
      <button type="button" className="anadd" disabled={disabled} onClick={() => setRows([...rows, emptyRow()])}>
        + Add another analyte
      </button>
    </div>
  )
}

export function LabCatalog() {
  const { toast, showToast } = useToast()
  const session = getSession()!

  const [tests, setTests] = useState<LabTest[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [panel, setPanel] = useState<{ kind: 'edit' | 'deactivate' | 'history' | 'remove'; testId: string } | null>(null)
  const [rowError, setRowError] = useState<{ testId: string; error: string } | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const [cName, setCName] = useState('')
  const [cCategory, setCCategory] = useState('')
  const [cSpecimen, setCSpecimen] = useState('')
  const [cRows, setCRows] = useState<AnalyteRow[]>([emptyRow()])
  /* Option B §4: adding/editing must be a DELIBERATE act — the definition
     drives automatic flagging for every patient's results of this test */
  const [cConfirm, setCConfirm] = useState(false)
  const [eName, setEName] = useState('')
  const [eCategory, setECategory] = useState('')
  const [eSpecimen, setESpecimen] = useState('')
  const [eRows, setERows] = useState<AnalyteRow[]>([emptyRow()])
  const [eConfirm, setEConfirm] = useState(false)

  const reload = useCallback(() => { getLabCatalog().then(setTests) }, [])
  useEffect(() => { reload() }, [reload])

  const stats = useMemo(() => {
    const all = tests ?? []
    return {
      total: all.length,
      active: all.filter(t => t.active !== false).length,
      inactive: all.filter(t => t.active === false).length,
      analytes: all.reduce((n, t) => n + t.analytes.length, 0),
    }
  }, [tests])

  const kpis: KpiSpec[] = [
    { icon: <IconFlask size={14} stroke="var(--blue)" />, iconBg: 'rgba(var(--blue-rgb),.15)', value: tests ? stats.total : '—', label: 'Tests' },
    { icon: <IconCheck size={12} stroke="var(--green)" />, iconBg: 'rgba(var(--green-rgb),.13)', value: tests ? stats.active : '—', label: 'Active' },
    { icon: <IconClock size={14} stroke="var(--amber)" />, iconBg: 'rgba(var(--amber-rgb),.14)', value: tests ? stats.inactive : '—', label: 'Inactive' },
    { icon: <IconAdmit size={14} stroke="var(--violet)" />, iconBg: 'rgba(var(--violet-rgb),.14)', value: tests ? stats.analytes : '—', label: 'Analytes' },
  ]

  const offlineMsg = (what: string) => `Catalogue management requires the live server — ${what} was NOT saved`

  async function applyWrite(testId: string | null, what: string, run: () => Promise<AdtWriteResult<LabTest>>, onOk: (t: LabTest) => void) {
    setBusy(true); setRowError(null); setFormError(null)
    const res = await run()
    setBusy(false)
    if (res.kind === 'ok') { onOk(res.data); reload(); return }
    const error = res.kind === 'rejected' ? res.error : offlineMsg(what)
    if (testId) setRowError({ testId, error })
    else setFormError(error)
  }

  async function doCreate() {
    const analytes = rowsToDefs(cRows)
    if (typeof analytes === 'string') { setFormError(analytes); return }
    if (!cConfirm) { setFormError('Confirm that these ranges/thresholds will drive automatic flagging for all patients'); return }
    /* the free-text correction: ONE name field, no typed id — the server
       derives the panel key (what the user typed is what results render
       under, exactly like the seeded "CBC") */
    await applyWrite(null, 'the test', () => createLabTest({
      name: cName.trim(), category: cCategory.trim(),
      specimen: cSpecimen.trim(), analytes,
    }), t => {
      showToast('Test added', `${t.name} is active — its definition now drives flagging for all patients`)
      setCName(''); setCCategory(''); setCSpecimen(''); setCRows([emptyRow()]); setCConfirm(false)
    })
  }

  async function doEdit(t: LabTest) {
    const analytes = rowsToDefs(eRows)
    if (typeof analytes === 'string') { setRowError({ testId: t.testId, error: analytes }); return }
    if (!eConfirm) { setRowError({ testId: t.testId, error: 'Confirm that the changed ranges/thresholds will drive automatic flagging for all patients' }); return }
    await applyWrite(t.testId, 'the change', () => updateLabTest(t.testId, {
      name: eName.trim(), category: eCategory.trim(), specimen: eSpecimen.trim(), analytes,
    }), upd => { showToast('Test updated', `${upd.name} — the prior definition stays on the audit history`); setPanel(null) })
  }

  /* Option B removal: the SERVER decides — a never-used test truly deletes;
     a referenced test answers 409 telling us to retire (deactivate) instead */
  async function doRemove(t: LabTest) {
    await applyWrite(t.testId, 'the removal', () => deleteLabTest(t.testId), del => {
      showToast('Test removed', `${del.name} was never used — deleted outright (nothing clinical referenced it)`)
      setPanel(null)
    })
  }

  async function doDeactivate(t: LabTest) {
    await applyWrite(t.testId, 'the deactivation', () => deactivateLabTest(t.testId), upd => {
      showToast('Test deactivated', `${upd.name} cannot be newly ordered (existing results keep rendering)`)
      setPanel(null)
    })
  }

  async function doReactivate(t: LabTest) {
    await applyWrite(t.testId, 'the reactivation', () => reactivateLabTest(t.testId), upd => {
      showToast('Test reactivated', `${upd.name} is orderable again`)
    })
  }

  function openPanel(kind: 'edit' | 'deactivate' | 'history' | 'remove', t: LabTest) {
    setRowError(null)
    if (panel?.kind === kind && panel.testId === t.testId) { setPanel(null); return }
    if (kind === 'edit') {
      setEName(t.name); setECategory(t.category); setESpecimen(t.specimen)
      setERows(rowsFromDefs(t.analytes)); setEConfirm(false)
    }
    setPanel({ kind, testId: t.testId })
  }

  return (
    <div className="app-frame ua">
      <AppHeader
        subtitle="Lab Test Catalogue · Master Data · Aurora Core"
        kpis={kpis}
        user={{ initials: initialsOf(session.name), name: session.name, role: `${session.jobTitle} · ${profileOf(session.jobTitle)} profile` }}
      />
      <div className="shell">
        <NavSidebar active="labcatalog" alertCount={0} footerLines={[`Role: ${profileOf(session.jobTitle)} profile`, 'Master Data · Aurora Core']} />

        <main>
          <div className="uanote" role="note">
            The catalogue is the reference layer lab ordering, resulting and bedside documentation read
            from — a test&apos;s ranges and critical thresholds drive automatic flagging for <b>every
            patient&apos;s</b> results of that test, which is why management is restricted to the
            Laboratory and Consultant tiers. Removing a used test never deletes it: it retires — off the
            menu, no new orders or bedside documentation — while every existing result keeps rendering
            forever (a never-used test deletes outright). Every change is recorded on the test&apos;s
            permanent audit history, including the prior ranges.
          </div>

          <div className="uacols">
            <Card icon={<IconFlask size={15} stroke="var(--blue)" />} title="Catalogue Tests" aside={tests ? `${stats.active} active · ${stats.inactive} inactive` : '—'}>
              <div className="uarows">
                {(tests ?? []).map(t => {
                  const active = t.active !== false
                  const open = panel?.testId === t.testId ? panel.kind : null
                  const events = t.history ?? []
                  return (
                    <div className={`uarow${active ? '' : ' off'}`} key={t.testId}>
                      <div className="uamain">
                        <span className="uawho">
                          <b>{t.name}</b>
                          <small className="num">{t.testId}</small>
                        </span>
                        <span className="uarole">
                          <span>{t.category}</span>
                          <small className="uaprofile">{t.specimen}</small>
                        </span>
                        <span className={`uastatus ${active ? 'on' : 'offed'}`}>{active ? 'Active' : 'Inactive'}</span>
                        <span className="uaacts">
                          <button className="uaact" onClick={() => openPanel('history', t)} aria-expanded={open === 'history'}>
                            History ({events.length})
                          </button>
                          <button className="uaact" onClick={() => openPanel('edit', t)} aria-expanded={open === 'edit'}>Edit</button>
                          {active && (
                            <button className="uaact warn" onClick={() => openPanel('deactivate', t)} aria-expanded={open === 'deactivate'}>Retire</button>
                          )}
                          {!active && (
                            <button className="uaact" disabled={busy} onClick={() => doReactivate(t)}>Reactivate</button>
                          )}
                          <button className="uaact warn" onClick={() => openPanel('remove', t)} aria-expanded={open === 'remove'}>Remove</button>
                        </span>
                      </div>

                      <div className="fmtags" style={{ marginTop: 6 }}>
                        {t.analytes.map(a => (
                          <span className="fmtag num" key={a.analyte}>
                            {a.analyte}{a.unit ? ` ${a.unit}` : ''} · {a.refRange}
                            {(a.critLow !== undefined || a.critHigh !== undefined) && (
                              <b style={{ color: 'var(--red)' }}> · crit {a.critLow !== undefined ? `≤${a.critLow}` : ''}{a.critLow !== undefined && a.critHigh !== undefined ? ' / ' : ''}{a.critHigh !== undefined ? `≥${a.critHigh}` : ''}</b>
                            )}
                          </span>
                        ))}
                      </div>

                      {open === 'history' && (
                        <div className="uapanel" role="region" aria-label={`Audit history: ${t.testId}`}>
                          {events.length === 0 && <div className="uaempty">No management events — this test predates Layer 4 catalogue management.</div>}
                          {events.map((e, i) => (
                            <div className="uaevent" key={i}>
                              <span className="num">{e.time || '—'}</span>
                              <span><b>{e.action}</b>{e.detail ? ` — ${e.detail}` : ''}</span>
                              <small>by {e.actor}</small>
                            </div>
                          ))}
                        </div>
                      )}

                      {open === 'edit' && (
                        <div className="uapanel" role="region" aria-label={`Edit test: ${t.testId}`}>
                          <div className="uafields">
                            <label>Name
                              <input value={eName} onChange={ev => setEName(ev.target.value)} disabled={busy} />
                            </label>
                            <label>Category
                              <input value={eCategory} onChange={ev => setECategory(ev.target.value)} disabled={busy} />
                            </label>
                            <label>Specimen
                              <input value={eSpecimen} onChange={ev => setESpecimen(ev.target.value)} disabled={busy} />
                            </label>
                            <div className="uawide">
                              <AnalyteRowsEditor rows={eRows} setRows={setERows} disabled={busy} idPrefix={`edit-${t.testId}`} />
                            </div>
                            <label className="uawide" style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                              <input type="checkbox" checked={eConfirm} onChange={ev => setEConfirm(ev.target.checked)} disabled={busy} style={{ width: 'auto' }} />
                              <span>I confirm these reference ranges and critical thresholds will drive automatic
                              normal/abnormal/critical flagging for <b>all patients&apos;</b> results of this test.
                              The prior definition stays on the audit history (amend-not-erase).</span>
                            </label>
                          </div>
                          <div className="uapanelacts">
                            <button className="uaact go" disabled={busy || !eConfirm} onClick={() => doEdit(t)}>{busy ? 'Saving…' : 'Save changes'}</button>
                            <button className="uaact" onClick={() => setPanel(null)}>Cancel</button>
                          </div>
                        </div>
                      )}

                      {open === 'deactivate' && (
                        <div className="uapanel" role="alertdialog" aria-label={`Confirm retirement: ${t.testId}`}>
                          <span className="uaconfirm">
                            Retire <b>{t.name}</b>? It leaves the entry menu — no new orders and no new bedside
                            documentation — while every existing result keeps rendering and lab resulting against
                            open orders stays allowed (never deleted). Audited on the test&apos;s permanent history.
                          </span>
                          <div className="uapanelacts">
                            <button className="uaact warn" disabled={busy} onClick={() => doDeactivate(t)}>{busy ? 'Retiring…' : 'Confirm retirement'}</button>
                            <button className="uaact" onClick={() => setPanel(null)}>Cancel</button>
                          </div>
                        </div>
                      )}

                      {open === 'remove' && (
                        <div className="uapanel" role="alertdialog" aria-label={`Confirm removal: ${t.testId}`}>
                          <span className="uaconfirm">
                            Remove <b>{t.name}</b>? A test that has <b>never</b> been ordered or resulted is
                            deleted outright (nothing clinical references it). A test <b>with</b> results or
                            orders is never deleted — the server will refuse and direct you to Retire instead,
                            which preserves every historical result.
                          </span>
                          <div className="uapanelacts">
                            <button className="uaact warn" disabled={busy} onClick={() => doRemove(t)}>{busy ? 'Removing…' : 'Confirm removal'}</button>
                            <button className="uaact" onClick={() => setPanel(null)}>Cancel</button>
                          </div>
                        </div>
                      )}

                      {rowError?.testId === t.testId && <div className="uaerr" role="alert">{rowError.error}</div>}
                    </div>
                  )
                })}
                {tests?.length === 0 && <div className="uaempty">The catalogue is empty.</div>}
              </div>
            </Card>

            <Card icon={<IconAdmit size={15} stroke="var(--cyan)" />} title="Add Test" aside="new tests are active immediately">
              <form className="uaform" onSubmit={ev => { ev.preventDefault(); void doCreate() }}>
                <div className="uafields">
                  <label>Name (free text — results render under exactly this label)
                    <input value={cName} onChange={ev => setCName(ev.target.value)} disabled={busy} placeholder="CBC" autoComplete="off" />
                  </label>
                  <label>Category
                    <input value={cCategory} onChange={ev => setCCategory(ev.target.value)} disabled={busy} placeholder="Hematology" />
                  </label>
                  <label>Specimen
                    <input value={cSpecimen} onChange={ev => setCSpecimen(ev.target.value)} disabled={busy} placeholder="Whole blood (EDTA)" />
                  </label>
                  <div className="uawide">
                    <AnalyteRowsEditor rows={cRows} setRows={setCRows} disabled={busy} idPrefix="add" />
                  </div>
                  <label className="uawide" style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                    <input type="checkbox" checked={cConfirm} onChange={ev => setCConfirm(ev.target.checked)} disabled={busy} style={{ width: 'auto' }} />
                    <span>I confirm these reference ranges and critical thresholds will drive automatic
                    normal/abnormal/critical flagging for <b>all patients&apos;</b> results of this test.</span>
                  </label>
                </div>
                {formError && <div className="uaerr" role="alert">{formError}</div>}
                <button className="uasubmit" type="submit"
                  disabled={busy || !cConfirm || !cName.trim() || !cCategory.trim() || !cSpecimen.trim() || cRows.every(rowIsBlank)}>
                  {busy ? 'Adding…' : 'Add to catalogue'}
                </button>
              </form>
            </Card>
          </div>
        </main>
      </div>
      <Toast state={toast} accent="blue" />
    </div>
  )
}
