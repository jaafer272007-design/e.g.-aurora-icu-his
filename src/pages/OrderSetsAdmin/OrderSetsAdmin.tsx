import { useCallback, useEffect, useMemo, useState } from 'react'
import '../UsersAdmin/UsersAdmin.css'
import '../Formulary/Formulary.css'
import './OrderSetsAdmin.css'
import { AppHeader, type KpiSpec } from '../../components/AppHeader'
import { NavSidebar } from '../../components/NavSidebar'
import { Card } from '../../components/Card'
import { Toast, useToast } from '../../components/Toast'
import { IconAdmit, IconCheck, IconClock, IconPill } from '../../components/icons'
import {
  createOrderSet, deactivateOrderSet, getFormulary, getFrequencyVocabulary, getLabCatalog,
  getOrderSetDefs, reactivateOrderSet, updateOrderSet,
} from '../../lib/api'
import type { AdtWriteResult } from '../../lib/api'
import type {
  FormularyDrug, LabTest, OrderCategory, OrderPriority, OrderSetDef, OrderSetItemTemplate,
} from '../../lib/api/types'
import { getSession, initialsOf, profileOf } from '../../lib/session'

/** Order Sets management (/order-sets, Aurora Core Master Data).
 *  Protocol authorship — SENIOR MEDICAL authority (ordersets.manage on
 *  the SeniorDoctor profile; moved from the provisional Pharmacist
 *  stewardship 2026-07-20: an order set is a clinical protocol — sepsis
 *  bundle, DKA protocol. The drugs a set references still come from the
 *  Pharmacy-governed formulary). APPLYING a set is clinician authority
 *  and happens on the Orders screen — this screen only authors the
 *  definitions. Items are built with a FORM — category, a drug picker
 *  reading the formulary or a test picker reading the lab catalogue,
 *  priority, add/remove/reorder — the same kind of form the ordering
 *  screen uses to place a single order, just producing a reusable
 *  template. (The recorded items-as-JSON display debt is CLOSED — no
 *  JSON anywhere in authoring.) The server fully validates every item
 *  (shape, frequency vocabulary, known drug/test references)
 *  regardless. Writes are REAL-ONLY. */

const PRIORITIES: OrderPriority[] = ['Routine', 'Urgent', 'STAT']
const CATEGORIES: OrderCategory[] = ['Medication', 'Lab', 'Imaging', 'Nursing']

/** one row's human-readable content — what the template will order */
const itemLabel = (it: OrderSetItemTemplate) =>
  it.medication
    ? `${it.medication.drug} — ${it.medication.dose} ${it.medication.route} ${it.medication.frequency}${it.medication.prn ? ' PRN' : ''}`
    : it.testId
      ? `${it.summary || it.testId} · catalogue test ${it.testId}`
      : it.summary || '—'

interface ItemBuilderProps {
  items: OrderSetItemTemplate[]
  onChange: (items: OrderSetItemTemplate[]) => void
  formulary: FormularyDrug[]
  catalog: LabTest[]
  activeFreqs: string[] | null
  disabled: boolean
}

/** The form-based set-item builder: add order templates one at a time —
 *  category, then a drug picker (formulary) or test picker (lab
 *  catalogue) or free order text, plus priority — with remove/reorder
 *  on every row. Modeled on the single-order form (NewOrderCard /
 *  LabOrderCard): building a template uses the same kind of form as
 *  placing an order. */
function ItemBuilder({ items, onChange, formulary, catalog, activeFreqs, disabled }: ItemBuilderProps) {
  const [category, setCategory] = useState<OrderCategory>('Medication')
  const [priority, setPriority] = useState<OrderPriority>('Routine')
  const [implement, setImplement] = useState(false)
  const [summary, setSummary] = useState('')
  /* medication pick (formulary) */
  const [query, setQuery] = useState('')
  const [drug, setDrug] = useState<FormularyDrug | null>(null)
  const [dose, setDose] = useState('')
  const [route, setRoute] = useState('')
  const [frequency, setFrequency] = useState('')
  const [duration, setDuration] = useState('')
  const [prn, setPrn] = useState(false)
  const [prnIndication, setPrnIndication] = useState('')
  /* lab pick (catalogue) */
  const [labQuery, setLabQuery] = useState('')
  const [test, setTest] = useState<LabTest | null>(null)

  /* a RETIRED named frequency is filtered from the picker (the server
     400s it at save regardless); the structured q<n>h pattern is code */
  const selectableFreq = (f: string) =>
    activeFreqs === null || activeFreqs.includes(f) || /^q\d{1,2}h$/.test(f)

  const drugHits = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q || drug) return []
    return formulary
      .filter(d => d.active !== false)
      .filter(d => d.name.toLowerCase().includes(q) || d.drugClass.toLowerCase().includes(q)
        || d.brandNames.some(b => b.toLowerCase().includes(q)))
      .slice(0, 6)
  }, [query, formulary, drug])

  const labHits = useMemo(() => {
    const q = labQuery.trim().toLowerCase()
    if (!q || test) return []
    return catalog
      .filter(t => t.active !== false)
      .filter(t => t.name.toLowerCase().includes(q) || t.testId.toLowerCase().includes(q)
        || t.category.toLowerCase().includes(q))
      .slice(0, 5)
  }, [labQuery, catalog, test])

  const pickDrug = (d: FormularyDrug) => {
    setDrug(d)
    setDose(d.defaultDose ?? d.doses[0] ?? '')
    setRoute(d.routes[0] ?? '')
    setFrequency(d.frequencies.filter(selectableFreq)[0] ?? '')
    setDuration('')
    setPrn(false)
    setPrnIndication('')
  }

  const pickTest = (t: LabTest) => { setTest(t); setSummary(t.name) }

  const resetPick = () => {
    setQuery(''); setDrug(null); setLabQuery(''); setTest(null); setSummary('')
    setImplement(false); setPrn(false); setPrnIndication('')
  }

  const switchCategory = (c: OrderCategory) => { setCategory(c); resetPick() }

  const canAdd = category === 'Medication'
    ? !!drug && !!dose && !!route && !!frequency && (!prn || !!prnIndication.trim())
    : category === 'Lab'
      ? !!test && !!summary.trim()
      : !!summary.trim()

  const add = () => {
    if (!canAdd || disabled) return
    const item: OrderSetItemTemplate = category === 'Medication' && drug
      ? {
          category, priority,
          medication: {
            drugId: drug.drugId, drug: drug.name, dose, route, frequency,
            duration: duration.trim() || 'ongoing',
            prn, ...(prn ? { prnIndication: prnIndication.trim() } : {}),
          },
        }
      : {
          category, priority, summary: summary.trim(),
          ...(category === 'Lab' && test ? { testId: test.testId } : {}),
          ...(implement ? { requiresImplementation: true } : {}),
        }
    onChange([...items, item])
    resetPick()
  }

  const move = (i: number, d: -1 | 1) => {
    const next = [...items]
    const [row] = next.splice(i, 1)
    next.splice(i + d, 0, row)
    onChange(next)
  }

  const remove = (i: number) => onChange(items.filter((_, k) => k !== i))

  return (
    <div className="osb">
      <div className="osbrows" role="list" aria-label="Order templates in this set">
        {items.map((it, i) => (
          <div className="osbrow" role="listitem" key={`${i}-${itemLabel(it)}`}>
            <span className="osbnum num">{i + 1}</span>
            <span className="osbcat">{it.category}</span>
            <span className="osblabel">{itemLabel(it)}</span>
            <span className="osbprio">{it.priority}{it.requiresImplementation ? ' · nurse implements' : ''}</span>
            <span className="osbacts">
              <button type="button" className="uaact" aria-label={`Move item ${i + 1} up`}
                disabled={disabled || i === 0} onClick={() => move(i, -1)}>↑</button>
              <button type="button" className="uaact" aria-label={`Move item ${i + 1} down`}
                disabled={disabled || i === items.length - 1} onClick={() => move(i, 1)}>↓</button>
              <button type="button" className="uaact warn" aria-label={`Remove item ${i + 1}`}
                disabled={disabled} onClick={() => remove(i)}>✕</button>
            </span>
          </div>
        ))}
        {items.length === 0 && <div className="osbempty">No order templates yet — add the first item below.</div>}
      </div>

      <div className="osbadd" role="group" aria-label="Add an order template">
        <div className="osbline">
          <label>Category
            <select value={category} disabled={disabled} onChange={e => switchCategory(e.target.value as OrderCategory)}>
              {CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label>Priority
            <select value={priority} disabled={disabled} onChange={e => setPriority(e.target.value as OrderPriority)}>
              {PRIORITIES.map(p => <option key={p}>{p}</option>)}
            </select>
          </label>
          {category !== 'Medication' && (
            <label className="osbcheck">
              <input type="checkbox" checked={implement} disabled={disabled} onChange={e => setImplement(e.target.checked)} />
              Nurse implements
            </label>
          )}
        </div>

        {category === 'Medication' && !drug && (
          <>
            <input className="osbsearch" value={query} disabled={disabled}
              placeholder="Search the formulary — drug or class…" aria-label="Search medication formulary"
              onChange={e => setQuery(e.target.value)} />
            {drugHits.length > 0 && (
              <div className="osbhits" role="listbox" aria-label="Formulary matches">
                {drugHits.map(d => (
                  <button type="button" role="option" aria-selected={false} className="osbhit" key={d.drugId}
                    onClick={() => pickDrug(d)}>
                    <b>{d.name}</b><span>{d.drugClass}</span>
                  </button>
                ))}
              </div>
            )}
            {query.trim() && drugHits.length === 0 && <div className="osbempty">No formulary match for "{query}".</div>}
          </>
        )}
        {category === 'Medication' && drug && (
          <div className="osbmed">
            <div className="osbpicked">
              <b>{drug.name}</b><span>{drug.drugClass}</span>
              <button type="button" className="uaact" disabled={disabled} onClick={resetPick}>Change drug</button>
            </div>
            <div className="osbline">
              <label>Dose
                <select value={dose} disabled={disabled} onChange={e => setDose(e.target.value)}>
                  {drug.doses.map(d => <option key={d}>{d}</option>)}
                </select>
              </label>
              <label>Route
                <select value={route} disabled={disabled} onChange={e => setRoute(e.target.value)}>
                  {drug.routes.map(r => <option key={r}>{r}</option>)}
                </select>
              </label>
              <label>Frequency
                <select value={frequency} disabled={disabled || prn} onChange={e => setFrequency(e.target.value)}>
                  {drug.frequencies.filter(selectableFreq).map(f => <option key={f}>{f}</option>)}
                </select>
              </label>
              <label>Duration
                <input value={duration} disabled={disabled} placeholder="blank = ongoing"
                  onChange={e => setDuration(e.target.value)} />
              </label>
              {drug.prnCapable && (
                <label className="osbcheck">
                  <input type="checkbox" checked={prn} disabled={disabled} onChange={e => setPrn(e.target.checked)} />
                  PRN
                </label>
              )}
            </div>
            {prn && (
              <label className="osbwide">PRN indication (required)
                <input value={prnIndication} disabled={disabled} placeholder="e.g. temp ≥ 38.3 °C, pain score ≥ 4"
                  onChange={e => setPrnIndication(e.target.value)} />
              </label>
            )}
          </div>
        )}

        {category === 'Lab' && !test && (
          <>
            <input className="osbsearch" value={labQuery} disabled={disabled}
              placeholder="Search the lab catalogue — test or category…" aria-label="Search lab test catalogue"
              onChange={e => setLabQuery(e.target.value)} />
            {labHits.length > 0 && (
              <div className="osbhits" role="listbox" aria-label="Catalogue matches">
                {labHits.map(t => (
                  <button type="button" role="option" aria-selected={false} className="osbhit" key={t.testId}
                    onClick={() => pickTest(t)}>
                    <b>{t.name}</b><span>{t.category} · {t.specimen}</span>
                  </button>
                ))}
              </div>
            )}
            {labQuery.trim() && labHits.length === 0 && <div className="osbempty">No catalogue match for "{labQuery}".</div>}
          </>
        )}
        {category === 'Lab' && test && (
          <div className="osbmed">
            <div className="osbpicked">
              <b>{test.name}</b><span className="num">{test.testId}</span>
              <button type="button" className="uaact" disabled={disabled} onClick={resetPick}>Change test</button>
            </div>
            <label className="osbwide">Summary (as it appears on the order)
              <input value={summary} disabled={disabled} onChange={e => setSummary(e.target.value)} />
            </label>
          </div>
        )}

        {(category === 'Imaging' || category === 'Nursing') && (
          <label className="osbwide">Order text
            <input value={summary} disabled={disabled}
              placeholder={category === 'Imaging' ? 'e.g. Portable chest X-ray daily' : 'e.g. Capillary glucose q6h — notify if < 4 or > 12 mmol/L'}
              onChange={e => setSummary(e.target.value)} />
          </label>
        )}

        <div className="osbaddfoot">
          <button type="button" className="uaact go" disabled={disabled || !canAdd} onClick={add}>+ Add to set</button>
          {!canAdd && (
            <small className="osbhint">
              {category === 'Medication'
                ? (drug ? 'Complete dose, route and frequency (PRN needs an indication).' : 'Pick a drug from the formulary.')
                : category === 'Lab'
                  ? 'Pick a test from the catalogue.'
                  : 'Enter the order text.'}
            </small>
          )}
        </div>
      </div>
    </div>
  )
}

export function OrderSetsAdmin() {
  const { toast, showToast } = useToast()
  const session = getSession()!

  const [sets, setSets] = useState<OrderSetDef[] | null>(null)
  const [formulary, setFormulary] = useState<FormularyDrug[]>([])
  const [catalog, setCatalog] = useState<LabTest[]>([])
  const [activeFreqs, setActiveFreqs] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [panel, setPanel] = useState<{ kind: 'edit' | 'deactivate' | 'history'; setId: string } | null>(null)
  const [rowError, setRowError] = useState<{ setId: string; error: string } | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const [cName, setCName] = useState('')
  const [cDescription, setCDescription] = useState('')
  const [cItems, setCItems] = useState<OrderSetItemTemplate[]>([])
  const [eName, setEName] = useState('')
  const [eDescription, setEDescription] = useState('')
  const [eItems, setEItems] = useState<OrderSetItemTemplate[]>([])

  const reload = useCallback(() => { getOrderSetDefs().then(setSets) }, [])
  useEffect(() => {
    reload()
    getFormulary().then(setFormulary).catch(() => setFormulary([]))
    getLabCatalog().then(setCatalog).catch(() => setCatalog([]))
    getFrequencyVocabulary().then(setActiveFreqs).catch(() => setActiveFreqs(null))
  }, [reload])

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
    await applyWrite(null, 'the set', () => createOrderSet({
      name: cName.trim(), description: cDescription.trim(), items: cItems,
    }), s => {
      showToast('Order set created', `${s.name} — ${s.items.length} order template(s)`)
      setCName(''); setCDescription(''); setCItems([])
    })
  }

  async function doEdit(s: OrderSetDef) {
    await applyWrite(s.setId, 'the change', () => updateOrderSet(s.setId, {
      name: eName.trim(), description: eDescription.trim(), items: eItems,
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
    if (kind === 'edit') { setEName(s.name); setEDescription(s.description); setEItems(s.items.map(it => ({ ...it }))) }
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
        <NavSidebar active="ordersets" alertCount={0} footerLines={['Role: Consultant', 'Master Data · Aurora Core']} />

        <main>
          <div className="uanote" role="note">
            Order sets are clinical protocols — a sepsis bundle, a DKA protocol — referencing the
            formulary and the lab catalogue. Authoring is senior medical governance; applying one is
            clinician authority on the Orders screen, and runs every item through the normal
            order-creation path — the same encounter, RBAC, reference-state and safety rules as a
            single order. Every generated order is an individual, separately-editable order; a set is
            a convenience, never a bypass or a locked bundle.
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
                          </div>
                          <ItemBuilder items={eItems} onChange={setEItems} formulary={formulary} catalog={catalog}
                            activeFreqs={activeFreqs} disabled={busy} />
                          <div className="uapanelacts">
                            <button className="uaact go" disabled={busy || eItems.length === 0} onClick={() => doEdit(s)}>{busy ? 'Saving…' : 'Save changes'}</button>
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
                  <label>Name (free text — the system keeps its own hidden identifier)
                    <input value={cName} onChange={ev => setCName(ev.target.value)} disabled={busy} />
                  </label>
                  <label className="uawide">Description
                    <input value={cDescription} onChange={ev => setCDescription(ev.target.value)} disabled={busy} />
                  </label>
                </div>
                <ItemBuilder items={cItems} onChange={setCItems} formulary={formulary} catalog={catalog}
                  activeFreqs={activeFreqs} disabled={busy} />
                {formError && <div className="uaerr" role="alert">{formError}</div>}
                <button className="uasubmit" type="submit"
                  disabled={busy || !cName.trim() || !cDescription.trim() || cItems.length === 0}>
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
