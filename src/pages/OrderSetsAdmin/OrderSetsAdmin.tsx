import { useCallback, useEffect, useMemo, useState } from 'react'
import '../UsersAdmin/UsersAdmin.css'
import '../Formulary/Formulary.css'
import { AppHeader, type KpiSpec } from '../../components/AppHeader'
import { NavSidebar } from '../../components/NavSidebar'
import { Card } from '../../components/Card'
import { Toast, useToast } from '../../components/Toast'
import { IconAdmit, IconCheck, IconClock, IconPill } from '../../components/icons'
import { createOrderSet, deactivateOrderSet, getOrderSetDefs, reactivateOrderSet, updateOrderSet } from '../../lib/api'
import type { AdtWriteResult } from '../../lib/api'
import type { OrderSetDef, OrderSetItemTemplate } from '../../lib/api/types'
import { getSession, initialsOf, profileOf } from '../../lib/session'

/** Layer 4 phase 2 — Order Sets management (/order-sets, Aurora Core
 *  Master Data). Protocol authorship, stewarded with the formulary
 *  (ordersets.manage on the Pharmacist profile). APPLYING a set is
 *  clinician authority and happens on the Orders screen — this screen
 *  only authors the definitions. Items are edited as JSON for now — a
 *  structured set-item editor is a recorded display debt; the server
 *  fully validates every item (shape, frequency vocabulary, known
 *  drug/test references) regardless. Writes are REAL-ONLY. */

const itemsToText = (items: OrderSetItemTemplate[]) => JSON.stringify(items, null, 2)

function parseItems(text: string): OrderSetItemTemplate[] | string {
  try {
    const v = JSON.parse(text) as unknown
    if (!Array.isArray(v) || v.length === 0) return 'items must be a non-empty JSON array'
    return v as OrderSetItemTemplate[]
  } catch (e) {
    return `items is not valid JSON — ${(e as Error).message}`
  }
}

export function OrderSetsAdmin() {
  const { toast, showToast } = useToast()
  const session = getSession()!

  const [sets, setSets] = useState<OrderSetDef[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [panel, setPanel] = useState<{ kind: 'edit' | 'deactivate' | 'history'; setId: string } | null>(null)
  const [rowError, setRowError] = useState<{ setId: string; error: string } | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const [cSetId, setCSetId] = useState('')
  const [cName, setCName] = useState('')
  const [cDescription, setCDescription] = useState('')
  const [cItems, setCItems] = useState('')
  const [eName, setEName] = useState('')
  const [eDescription, setEDescription] = useState('')
  const [eItems, setEItems] = useState('')

  const reload = useCallback(() => { getOrderSetDefs().then(setSets) }, [])
  useEffect(() => { reload() }, [reload])

  const stats = useMemo(() => {
    const all = sets ?? []
    return {
      total: all.length,
      active: all.filter(s => s.active !== false).length,
      inactive: all.filter(s => s.active === false).length,
      items: all.reduce((n, s) => n + s.items.length, 0),
    }
  }, [sets])

  const kpis: KpiSpec[] = [
    { icon: <IconPill size={14} stroke="var(--blue)" />, iconBg: 'rgba(var(--blue-rgb),.15)', value: sets ? stats.total : '—', label: 'Order Sets' },
    { icon: <IconCheck size={12} stroke="var(--green)" />, iconBg: 'rgba(var(--green-rgb),.13)', value: sets ? stats.active : '—', label: 'Active' },
    { icon: <IconClock size={14} stroke="var(--amber)" />, iconBg: 'rgba(var(--amber-rgb),.14)', value: sets ? stats.inactive : '—', label: 'Inactive' },
    { icon: <IconAdmit size={14} stroke="var(--violet)" />, iconBg: 'rgba(var(--violet-rgb),.14)', value: sets ? stats.items : '—', label: 'Order Templates' },
  ]

  const offlineMsg = (what: string) => `Order-set management requires the live server — ${what} was NOT saved`

  async function applyWrite(setId: string | null, what: string, run: () => Promise<AdtWriteResult<OrderSetDef>>, onOk: (s: OrderSetDef) => void) {
    setBusy(true); setRowError(null); setFormError(null)
    const res = await run()
    setBusy(false)
    if (res.kind === 'ok') { onOk(res.data); reload(); return }
    const error = res.kind === 'rejected' ? res.error : offlineMsg(what)
    if (setId) setRowError({ setId, error })
    else setFormError(error)
  }

  async function doCreate() {
    const items = parseItems(cItems)
    if (typeof items === 'string') { setFormError(items); return }
    await applyWrite(null, 'the set', () => createOrderSet({
      setId: cSetId.trim(), name: cName.trim(), description: cDescription.trim(), items,
    }), s => {
      showToast('Order set created', `${s.name} (${s.setId}) — ${s.items.length} order template(s)`)
      setCSetId(''); setCName(''); setCDescription(''); setCItems('')
    })
  }

  async function doEdit(s: OrderSetDef) {
    const items = parseItems(eItems)
    if (typeof items === 'string') { setRowError({ setId: s.setId, error: items }); return }
    await applyWrite(s.setId, 'the change', () => updateOrderSet(s.setId, {
      name: eName.trim(), description: eDescription.trim(), items,
    }), upd => { showToast('Order set updated', `${upd.name} — recorded in the audit history`); setPanel(null) })
  }

  async function doDeactivate(s: OrderSetDef) {
    await applyWrite(s.setId, 'the deactivation', () => deactivateOrderSet(s.setId), upd => {
      showToast('Order set deactivated', `${upd.name} can no longer be applied`)
      setPanel(null)
    })
  }

  async function doReactivate(s: OrderSetDef) {
    await applyWrite(s.setId, 'the reactivation', () => reactivateOrderSet(s.setId), upd => {
      showToast('Order set reactivated', `${upd.name} can be applied again`)
    })
  }

  function openPanel(kind: 'edit' | 'deactivate' | 'history', s: OrderSetDef) {
    setRowError(null)
    if (panel?.kind === kind && panel.setId === s.setId) { setPanel(null); return }
    if (kind === 'edit') { setEName(s.name); setEDescription(s.description); setEItems(itemsToText(s.items)) }
    setPanel({ kind, setId: s.setId })
  }

  return (
    <div className="app-frame ua">
      <AppHeader
        subtitle="Order Sets · Master Data · Aurora Core"
        kpis={kpis}
        user={{ initials: initialsOf(session.name), name: session.name, role: `${session.jobTitle} · ${profileOf(session.jobTitle)} profile` }}
      />
      <div className="shell">
        <NavSidebar active="ordersets" alertCount={0} footerLines={['Role: Pharmacy', 'Master Data · Aurora Core']} />

        <main>
          <div className="uanote" role="note">
            Order sets are clinical bundles referencing the formulary and the lab catalogue. Applying one
            runs every item through the normal order-creation path — the same encounter, RBAC and
            reference-state rules as a single order; a set is a convenience, never a bypass. An inactive
            set cannot be applied; a set referencing a deactivated drug/test is rejected at apply time.
          </div>

          <div className="uacols">
            <Card icon={<IconPill size={15} stroke="var(--blue)" />} title="Order Sets" aside={sets ? `${stats.active} active · ${stats.inactive} inactive` : '—'}>
              <div className="uarows">
                {(sets ?? []).map(s => {
                  const active = s.active !== false
                  const open = panel?.setId === s.setId ? panel.kind : null
                  const events = s.history ?? []
                  return (
                    <div className={`uarow${active ? '' : ' off'}`} key={s.setId}>
                      <div className="uamain">
                        <span className="uawho">
                          <b>{s.name}</b>
                          <small className="num">{s.setId}</small>
                        </span>
                        <span className="uarole">
                          <span>{s.description}</span>
                          <small className="uaprofile">{s.items.length} order template(s)</small>
                        </span>
                        <span className={`uastatus ${active ? 'on' : 'offed'}`}>{active ? 'Active' : 'Inactive'}</span>
                        <span className="uaacts">
                          <button className="uaact" onClick={() => openPanel('history', s)} aria-expanded={open === 'history'}>
                            History ({events.length})
                          </button>
                          <button className="uaact" onClick={() => openPanel('edit', s)} aria-expanded={open === 'edit'}>Edit</button>
                          {active && (
                            <button className="uaact warn" onClick={() => openPanel('deactivate', s)} aria-expanded={open === 'deactivate'}>Deactivate</button>
                          )}
                          {!active && (
                            <button className="uaact" disabled={busy} onClick={() => doReactivate(s)}>Reactivate</button>
                          )}
                        </span>
                      </div>

                      <div className="fmtags" style={{ marginTop: 6 }}>
                        {s.items.map((it, i) => (
                          <span className="fmtag" key={i}>
                            {it.category}{it.medication ? ` · ${it.medication.drug}` : it.testId ? ` · ${it.testId}` : ''} · {it.priority}
                          </span>
                        ))}
                      </div>

                      {open === 'history' && (
                        <div className="uapanel" role="region" aria-label={`Audit history: ${s.setId}`}>
                          {events.length === 0 && <div className="uaempty">No management events — this set predates Layer 4 order-set management.</div>}
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
                        <div className="uapanel" role="region" aria-label={`Edit set: ${s.setId}`}>
                          <div className="uafields">
                            <label>Name
                              <input value={eName} onChange={ev => setEName(ev.target.value)} disabled={busy} />
                            </label>
                            <label>Description
                              <input value={eDescription} onChange={ev => setEDescription(ev.target.value)} disabled={busy} />
                            </label>
                            <label className="uawide">Items (JSON — the server validates every template)
                              <textarea rows={8} value={eItems} onChange={ev => setEItems(ev.target.value)} disabled={busy}
                                style={{ fontFamily: 'inherit', fontSize: 11 }} />
                            </label>
                          </div>
                          <div className="uapanelacts">
                            <button className="uaact go" disabled={busy} onClick={() => doEdit(s)}>{busy ? 'Saving…' : 'Save changes'}</button>
                            <button className="uaact" onClick={() => setPanel(null)}>Cancel</button>
                          </div>
                        </div>
                      )}

                      {open === 'deactivate' && (
                        <div className="uapanel" role="alertdialog" aria-label={`Confirm deactivation: ${s.setId}`}>
                          <span className="uaconfirm">
                            Deactivate <b>{s.name}</b>? Clinicians can no longer apply it; the definition
                            and its history are kept forever (never deleted).
                          </span>
                          <div className="uapanelacts">
                            <button className="uaact warn" disabled={busy} onClick={() => doDeactivate(s)}>{busy ? 'Deactivating…' : 'Confirm deactivation'}</button>
                            <button className="uaact" onClick={() => setPanel(null)}>Cancel</button>
                          </div>
                        </div>
                      )}

                      {rowError?.setId === s.setId && <div className="uaerr" role="alert">{rowError.error}</div>}
                    </div>
                  )
                })}
                {sets?.length === 0 && <div className="uaempty">No order sets.</div>}
              </div>
            </Card>

            <Card icon={<IconAdmit size={15} stroke="var(--cyan)" />} title="Create Order Set" aside="new sets are active immediately">
              <form className="uaform" onSubmit={ev => { ev.preventDefault(); void doCreate() }}>
                <div className="uafields">
                  <label>Set id (permanent — lowercase, digits, hyphen)
                    <input value={cSetId} onChange={ev => setCSetId(ev.target.value)} disabled={busy} placeholder="sepsis-bundle" autoComplete="off" />
                  </label>
                  <label>Name
                    <input value={cName} onChange={ev => setCName(ev.target.value)} disabled={busy} />
                  </label>
                  <label className="uawide">Description
                    <input value={cDescription} onChange={ev => setCDescription(ev.target.value)} disabled={busy} />
                  </label>
                  <label className="uawide">Items (JSON array of order templates)
                    <textarea rows={8} value={cItems} onChange={ev => setCItems(ev.target.value)} disabled={busy}
                      placeholder='[{"category":"Lab","summary":"Lactate now","testId":"Lactate","priority":"STAT","requiresImplementation":true}]'
                      style={{ fontFamily: 'inherit', fontSize: 11 }} />
                  </label>
                </div>
                {formError && <div className="uaerr" role="alert">{formError}</div>}
                <button className="uasubmit" type="submit"
                  disabled={busy || !cSetId.trim() || !cName.trim() || !cDescription.trim() || !cItems.trim()}>
                  {busy ? 'Creating…' : 'Create order set'}
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
