import { useCallback, useEffect, useMemo, useState } from 'react'
import '../UsersAdmin/UsersAdmin.css'
import '../Formulary/Formulary.css'
import { AppHeader, type KpiSpec } from '../../components/AppHeader'
import { NavSidebar } from '../../components/NavSidebar'
import { Card } from '../../components/Card'
import { Toast, useToast } from '../../components/Toast'
import { IconAdmit, IconCheck, IconClock, IconFlask } from '../../components/icons'
import { createLabTest, deactivateLabTest, getLabCatalog, reactivateLabTest, updateLabTest } from '../../lib/api'
import type { AdtWriteResult } from '../../lib/api'
import type { AnalyteDef, LabTest } from '../../lib/api/types'
import { getSession, initialsOf, profileOf } from '../../lib/session'

/** Layer 4 phase 2 — Lab Test Catalogue management (/lab-catalog, Aurora
 *  Core Master Data). Laboratory authority (labcatalog.manage on the
 *  Ancillary profile — the route guard renders Access Restricted for
 *  everyone else; the server re-enforces every mutation). Deactivation is
 *  a status change, never a delete: an inactive test cannot be newly
 *  ORDERED (server 409), but every existing result referencing it keeps
 *  rendering, and resulting stays allowed (completing ordered care).
 *  Writes are REAL-ONLY — reference data is a durable system of record. */

/* analytes edited one per line: "analyte | unit | refRange | refLow | refHigh"
   (unit may be blank for unitless analytes like pH) */
const analytesToText = (a: AnalyteDef[]) =>
  a.map(x => `${x.analyte} | ${x.unit} | ${x.refRange} | ${x.refLow} | ${x.refHigh}`).join('\n')

function parseAnalytes(text: string): AnalyteDef[] | string {
  const out: AnalyteDef[] = []
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length === 0) return 'at least one analyte line is required'
  for (const line of lines) {
    const parts = line.split('|').map(p => p.trim())
    if (parts.length !== 5) return `"${line}" — expected: analyte | unit | refRange | refLow | refHigh`
    const [analyte, unit, refRange, lo, hi] = parts
    const refLow = Number(lo), refHigh = Number(hi)
    if (!analyte || !refRange || !Number.isFinite(refLow) || !Number.isFinite(refHigh))
      return `"${line}" — analyte/refRange required; refLow/refHigh must be numbers`
    out.push({ analyte, unit, refRange, refLow, refHigh })
  }
  return out
}

export function LabCatalog() {
  const { toast, showToast } = useToast()
  const session = getSession()!

  const [tests, setTests] = useState<LabTest[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [panel, setPanel] = useState<{ kind: 'edit' | 'deactivate' | 'history'; testId: string } | null>(null)
  const [rowError, setRowError] = useState<{ testId: string; error: string } | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const [cTestId, setCTestId] = useState('')
  const [cName, setCName] = useState('')
  const [cCategory, setCCategory] = useState('')
  const [cSpecimen, setCSpecimen] = useState('')
  const [cAnalytes, setCAnalytes] = useState('')
  const [eName, setEName] = useState('')
  const [eCategory, setECategory] = useState('')
  const [eSpecimen, setESpecimen] = useState('')
  const [eAnalytes, setEAnalytes] = useState('')

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
    { icon: <IconFlask size={14} stroke="var(--blue)" />, iconBg: 'rgba(77,163,255,.15)', value: tests ? stats.total : '—', label: 'Tests' },
    { icon: <IconCheck size={12} stroke="var(--green)" />, iconBg: 'rgba(61,232,160,.13)', value: tests ? stats.active : '—', label: 'Active' },
    { icon: <IconClock size={14} stroke="var(--amber)" />, iconBg: 'rgba(255,180,84,.14)', value: tests ? stats.inactive : '—', label: 'Inactive' },
    { icon: <IconAdmit size={14} stroke="var(--violet)" />, iconBg: 'rgba(167,139,250,.14)', value: tests ? stats.analytes : '—', label: 'Analytes' },
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
    const analytes = parseAnalytes(cAnalytes)
    if (typeof analytes === 'string') { setFormError(analytes); return }
    await applyWrite(null, 'the test', () => createLabTest({
      testId: cTestId.trim(), name: cName.trim(), category: cCategory.trim(),
      specimen: cSpecimen.trim(), analytes,
    }), t => {
      showToast('Test added', `${t.name} (${t.testId}) is active in the catalogue`)
      setCTestId(''); setCName(''); setCCategory(''); setCSpecimen(''); setCAnalytes('')
    })
  }

  async function doEdit(t: LabTest) {
    const analytes = parseAnalytes(eAnalytes)
    if (typeof analytes === 'string') { setRowError({ testId: t.testId, error: analytes }); return }
    await applyWrite(t.testId, 'the change', () => updateLabTest(t.testId, {
      name: eName.trim(), category: eCategory.trim(), specimen: eSpecimen.trim(), analytes,
    }), upd => { showToast('Test updated', `${upd.name} — recorded in the audit history`); setPanel(null) })
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

  function openPanel(kind: 'edit' | 'deactivate' | 'history', t: LabTest) {
    setRowError(null)
    if (panel?.kind === kind && panel.testId === t.testId) { setPanel(null); return }
    if (kind === 'edit') {
      setEName(t.name); setECategory(t.category); setESpecimen(t.specimen)
      setEAnalytes(analytesToText(t.analytes))
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
        <NavSidebar active="labcatalog" alertCount={0} footerLines={['Role: Laboratory', 'Master Data · Aurora Core']} />

        <main>
          <div className="uanote" role="note">
            The catalogue is the reference layer lab ordering and resulting read from. Removing a test is a
            status change, never a delete — an inactive test cannot be newly ordered, but every existing
            result referencing it keeps rendering forever, and results for already-ordered tests are never
            blocked. Every change is recorded on the test&apos;s permanent audit history.
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
                            <button className="uaact warn" onClick={() => openPanel('deactivate', t)} aria-expanded={open === 'deactivate'}>Deactivate</button>
                          )}
                          {!active && (
                            <button className="uaact" disabled={busy} onClick={() => doReactivate(t)}>Reactivate</button>
                          )}
                        </span>
                      </div>

                      <div className="fmtags" style={{ marginTop: 6 }}>
                        {t.analytes.map(a => (
                          <span className="fmtag num" key={a.analyte}>{a.analyte}{a.unit ? ` ${a.unit}` : ''} · {a.refRange}</span>
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
                            <label className="uawide">Analytes — one per line: analyte | unit | refRange | refLow | refHigh
                              <textarea rows={4} value={eAnalytes} onChange={ev => setEAnalytes(ev.target.value)} disabled={busy}
                                style={{ fontFamily: 'inherit', fontSize: 11 }} />
                            </label>
                          </div>
                          <div className="uapanelacts">
                            <button className="uaact go" disabled={busy} onClick={() => doEdit(t)}>{busy ? 'Saving…' : 'Save changes'}</button>
                            <button className="uaact" onClick={() => setPanel(null)}>Cancel</button>
                          </div>
                        </div>
                      )}

                      {open === 'deactivate' && (
                        <div className="uapanel" role="alertdialog" aria-label={`Confirm deactivation: ${t.testId}`}>
                          <span className="uaconfirm">
                            Deactivate <b>{t.name}</b>? It can no longer be newly ordered; existing results
                            keep rendering and resulting against open orders stays allowed (never deleted).
                          </span>
                          <div className="uapanelacts">
                            <button className="uaact warn" disabled={busy} onClick={() => doDeactivate(t)}>{busy ? 'Deactivating…' : 'Confirm deactivation'}</button>
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
                  <label>Test id (permanent — letters, digits, hyphen)
                    <input value={cTestId} onChange={ev => setCTestId(ev.target.value)} disabled={busy} placeholder="CBC" autoComplete="off" />
                  </label>
                  <label>Name
                    <input value={cName} onChange={ev => setCName(ev.target.value)} disabled={busy} placeholder="Complete Blood Count" />
                  </label>
                  <label>Category
                    <input value={cCategory} onChange={ev => setCCategory(ev.target.value)} disabled={busy} placeholder="Hematology" />
                  </label>
                  <label>Specimen
                    <input value={cSpecimen} onChange={ev => setCSpecimen(ev.target.value)} disabled={busy} placeholder="Whole blood (EDTA)" />
                  </label>
                  <label className="uawide">Analytes — one per line: analyte | unit | refRange | refLow | refHigh
                    <textarea rows={4} value={cAnalytes} onChange={ev => setCAnalytes(ev.target.value)} disabled={busy}
                      placeholder="WBC | ×10⁹/L | 4.0–11.0 | 4 | 11" style={{ fontFamily: 'inherit', fontSize: 11 }} />
                  </label>
                </div>
                {formError && <div className="uaerr" role="alert">{formError}</div>}
                <button className="uasubmit" type="submit"
                  disabled={busy || !cTestId.trim() || !cName.trim() || !cCategory.trim() || !cSpecimen.trim() || !cAnalytes.trim()}>
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
