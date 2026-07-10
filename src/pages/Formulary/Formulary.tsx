import { useCallback, useEffect, useMemo, useState } from 'react'
import '../UsersAdmin/UsersAdmin.css'
import './Formulary.css'
import { AppHeader, type KpiSpec } from '../../components/AppHeader'
import { NavSidebar } from '../../components/NavSidebar'
import { Card } from '../../components/Card'
import { Toast, useToast } from '../../components/Toast'
import { IconCheck, IconClock, IconPill, IconAdmit } from '../../components/icons'
import {
  createFormularyDrug, deactivateFormularyDrug, getFormulary, getFrequencyVocabulary,
  reactivateFormularyDrug, updateFormularyDrug,
} from '../../lib/api'
import type { AdtWriteResult } from '../../lib/api'
import type { CreateDrugDraft, DoseLimits, EditDrugDraft, FormularyDrug } from '../../lib/api/types'
import { getSession, initialsOf, profileOf } from '../../lib/session'

/** Layer 4 — Formulary management (/formulary, Aurora Core Master Data).
 *  Pharmacy profile only (formulary.manage — the route guard renders
 *  Access Restricted for everyone else; the server re-enforces it on
 *  every mutation). Removing a drug is DEACTIVATION, never deletion: a
 *  drug that has ever been prescribed must stay resolvable forever or
 *  historical orders become unreadable — an inactive drug cannot be
 *  selected for a NEW order (server 409), existing orders keep
 *  rendering. Writes are REAL-ONLY — the formulary is the durable
 *  reference layer, never mutated against local mock state. */

/* comma-separated list input helpers — reference lists are short */
const joinList = (l: string[]) => l.join(', ')
const splitList = (s: string): string[] => s.split(',').map(x => x.trim()).filter(Boolean)

interface DrugFields {
  name: string; brandNames: string; drugClass: string; form: string
  strengths: string; doses: string; defaultDose: string
  routes: string; frequencies: string
  prnCapable: boolean
  allergyBlock: string; allergyWarn: string
  limMin: string; limMax: string; limMaxDaily: string; limPerKg: string
}

const emptyFields: DrugFields = {
  name: '', brandNames: '', drugClass: '', form: '', strengths: '', doses: '',
  defaultDose: '', routes: '', frequencies: '', prnCapable: false,
  allergyBlock: '', allergyWarn: '', limMin: '', limMax: '', limMaxDaily: '', limPerKg: '',
}

const fieldsOf = (d: FormularyDrug): DrugFields => ({
  name: d.name, brandNames: joinList(d.brandNames), drugClass: d.drugClass, form: d.form,
  strengths: joinList(d.strengths), doses: joinList(d.doses), defaultDose: d.defaultDose,
  routes: joinList(d.routes), frequencies: joinList(d.frequencies), prnCapable: d.prnCapable,
  allergyBlock: joinList(d.allergyBlock), allergyWarn: joinList(d.allergyWarn),
  limMin: d.doseLimits?.min ?? '', limMax: d.doseLimits?.max ?? '',
  limMaxDaily: d.doseLimits?.maxDaily ?? '', limPerKg: d.doseLimits?.perKg ?? '',
})

function limitsOf(f: DrugFields): DoseLimits | undefined {
  const limits: DoseLimits = {
    ...(f.limMin.trim() ? { min: f.limMin.trim() } : {}),
    ...(f.limMax.trim() ? { max: f.limMax.trim() } : {}),
    ...(f.limMaxDaily.trim() ? { maxDaily: f.limMaxDaily.trim() } : {}),
    ...(f.limPerKg.trim() ? { perKg: f.limPerKg.trim() } : {}),
  }
  return Object.keys(limits).length ? limits : undefined
}

function draftOf(f: DrugFields): Omit<CreateDrugDraft, 'drugId'> {
  return {
    name: f.name.trim(), brandNames: splitList(f.brandNames), drugClass: f.drugClass.trim(),
    form: f.form.trim(), strengths: splitList(f.strengths), doses: splitList(f.doses),
    defaultDose: f.defaultDose.trim(),
    ...(limitsOf(f) ? { doseLimits: limitsOf(f) } : {}),
    routes: splitList(f.routes), frequencies: splitList(f.frequencies),
    prnCapable: f.prnCapable, allergyBlock: splitList(f.allergyBlock), allergyWarn: splitList(f.allergyWarn),
  }
}

function DrugForm({ fields, setFields, busy, vocab }: {
  fields: DrugFields; setFields: (f: DrugFields) => void; busy: boolean; vocab: string[] | null
}) {
  const set = (patch: Partial<DrugFields>) => setFields({ ...fields, ...patch })
  return (
    <div className="uafields">
      <label>Generic name
        <input value={fields.name} onChange={e => set({ name: e.target.value })} disabled={busy} />
      </label>
      <label>Brand names (comma-separated)
        <input value={fields.brandNames} onChange={e => set({ brandNames: e.target.value })} disabled={busy} />
      </label>
      <label>Drug class
        <input value={fields.drugClass} onChange={e => set({ drugClass: e.target.value })} disabled={busy} />
      </label>
      <label>Form
        <input value={fields.form} onChange={e => set({ form: e.target.value })} disabled={busy} placeholder="powder for injection" />
      </label>
      <label>Strengths (comma-separated)
        <input value={fields.strengths} onChange={e => set({ strengths: e.target.value })} disabled={busy} />
      </label>
      <label>Doses offered (comma-separated)
        <input value={fields.doses} onChange={e => set({ doses: e.target.value })} disabled={busy} />
      </label>
      <label>Default dose
        <input value={fields.defaultDose} onChange={e => set({ defaultDose: e.target.value })} disabled={busy} />
      </label>
      <label>Routes (comma-separated)
        <input value={fields.routes} onChange={e => set({ routes: e.target.value })} disabled={busy} />
      </label>
      <label className="uawide">Frequencies (comma-separated)
        <input value={fields.frequencies} onChange={e => set({ frequencies: e.target.value })} disabled={busy} />
      </label>
      {vocab && (
        <div className="fmvocab uawide">
          Valid frequencies: <b>{vocab.join(' · ')}</b> or <b>q1h–q48h</b> — anything else is rejected at ordering.
        </div>
      )}
      <label>Dose limit — min
        <input value={fields.limMin} onChange={e => set({ limMin: e.target.value })} disabled={busy} placeholder="optional" />
      </label>
      <label>Dose limit — max/dose
        <input value={fields.limMax} onChange={e => set({ limMax: e.target.value })} disabled={busy} placeholder="optional" />
      </label>
      <label>Dose limit — max/day
        <input value={fields.limMaxDaily} onChange={e => set({ limMaxDaily: e.target.value })} disabled={busy} placeholder="optional" />
      </label>
      <label>Dose limit — per kg
        <input value={fields.limPerKg} onChange={e => set({ limPerKg: e.target.value })} disabled={busy} placeholder="optional" />
      </label>
      <label>Allergy tags — hard block (comma-separated)
        <input value={fields.allergyBlock} onChange={e => set({ allergyBlock: e.target.value })} disabled={busy} placeholder="penicillin" />
      </label>
      <label>Allergy tags — cross-reactivity warning
        <input value={fields.allergyWarn} onChange={e => set({ allergyWarn: e.target.value })} disabled={busy} placeholder="sulfa" />
      </label>
      <label className="uawide" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" checked={fields.prnCapable} onChange={e => set({ prnCapable: e.target.checked })} disabled={busy}
          style={{ width: 16, height: 16 }} />
        PRN-capable (may be ordered as-needed)
      </label>
    </div>
  )
}

export function Formulary() {
  const { toast, showToast } = useToast()
  const session = getSession()!

  const [drugs, setDrugs] = useState<FormularyDrug[] | null>(null)
  const [vocab, setVocab] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [panel, setPanel] = useState<{ kind: 'edit' | 'deactivate' | 'history'; drugId: string } | null>(null)
  const [rowError, setRowError] = useState<{ drugId: string; error: string } | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const [cDrugId, setCDrugId] = useState('')
  const [cFields, setCFields] = useState<DrugFields>(emptyFields)
  const [eFields, setEFields] = useState<DrugFields>(emptyFields)

  const reload = useCallback(() => { getFormulary().then(setDrugs) }, [])
  useEffect(() => { reload(); getFrequencyVocabulary().then(setVocab) }, [reload])

  const stats = useMemo(() => {
    const all = drugs ?? []
    return {
      total: all.length,
      active: all.filter(d => d.active !== false).length,
      inactive: all.filter(d => d.active === false).length,
      prn: all.filter(d => d.prnCapable && d.active !== false).length,
    }
  }, [drugs])

  const kpis: KpiSpec[] = [
    { icon: <IconPill size={14} stroke="var(--blue)" />, iconBg: 'rgba(77,163,255,.15)', value: drugs ? stats.total : '—', label: 'Drugs' },
    { icon: <IconCheck size={12} stroke="var(--green)" />, iconBg: 'rgba(61,232,160,.13)', value: drugs ? stats.active : '—', label: 'Active' },
    { icon: <IconClock size={14} stroke="var(--amber)" />, iconBg: 'rgba(255,180,84,.14)', value: drugs ? stats.inactive : '—', label: 'Inactive' },
    { icon: <IconAdmit size={14} stroke="var(--violet)" />, iconBg: 'rgba(167,139,250,.14)', value: drugs ? stats.prn : '—', label: 'PRN-capable' },
  ]

  const offlineMsg = (what: string) => `Formulary management requires the live server — ${what} was NOT saved`

  async function applyWrite(drugId: string | null, what: string, run: () => Promise<AdtWriteResult<FormularyDrug>>, onOk: (d: FormularyDrug) => void) {
    setBusy(true); setRowError(null); setFormError(null)
    const res = await run()
    setBusy(false)
    if (res.kind === 'ok') { onOk(res.data); reload(); return }
    const error = res.kind === 'rejected' ? res.error : offlineMsg(what)
    if (drugId) setRowError({ drugId, error })
    else setFormError(error)
  }

  async function doCreate() {
    await applyWrite(null, 'the drug', () => createFormularyDrug({ drugId: cDrugId.trim(), ...draftOf(cFields) }), d => {
      showToast('Drug added', `${d.name} (${d.drugId}) is active in the formulary`)
      setCDrugId(''); setCFields(emptyFields)
    })
  }

  async function doEdit(d: FormularyDrug) {
    const draft: EditDrugDraft = draftOf(eFields)
    await applyWrite(d.drugId, 'the change', () => updateFormularyDrug(d.drugId, draft), upd => {
      showToast('Drug updated', `${upd.name} — changes recorded in the audit history`)
      setPanel(null)
    })
  }

  async function doDeactivate(d: FormularyDrug) {
    await applyWrite(d.drugId, 'the deactivation', () => deactivateFormularyDrug(d.drugId), upd => {
      showToast('Drug deactivated', `${upd.name} cannot be selected for new orders (existing orders keep rendering)`)
      setPanel(null)
    })
  }

  async function doReactivate(d: FormularyDrug) {
    await applyWrite(d.drugId, 'the reactivation', () => reactivateFormularyDrug(d.drugId), upd => {
      showToast('Drug reactivated', `${upd.name} is orderable again`)
    })
  }

  function openPanel(kind: 'edit' | 'deactivate' | 'history', d: FormularyDrug) {
    setRowError(null)
    if (panel?.kind === kind && panel.drugId === d.drugId) { setPanel(null); return }
    if (kind === 'edit') setEFields(fieldsOf(d))
    setPanel({ kind, drugId: d.drugId })
  }

  return (
    <div className="app-frame ua">
      <AppHeader
        subtitle="Formulary · Master Data · Aurora Core"
        kpis={kpis}
        user={{ initials: initialsOf(session.name), name: session.name, role: `${session.jobTitle} · ${profileOf(session.jobTitle)} profile` }}
      />
      <div className="shell">
        <NavSidebar active="formulary" alertCount={0} footerLines={['Role: Pharmacy', 'Master Data · Aurora Core']} />

        <main>
          <div className="uanote" role="note">
            The formulary is the reference layer prescribing reads from. Removing a drug is a status
            change, never a delete — an inactive drug cannot be selected for a new order, but every
            existing order referencing it keeps rendering forever. Every change here is recorded on the
            drug&apos;s permanent audit history.
          </div>

          <div className="uacols">
            <Card icon={<IconPill size={15} stroke="var(--blue)" />} title="Formulary Drugs" aside={drugs ? `${stats.active} active · ${stats.inactive} inactive` : '—'}>
              <div className="uarows">
                {(drugs ?? []).map(d => {
                  const active = d.active !== false
                  const open = panel?.drugId === d.drugId ? panel.kind : null
                  const events = d.history ?? []
                  return (
                    <div className={`uarow${active ? '' : ' off'}`} key={d.drugId}>
                      <div className="uamain">
                        <span className="uawho">
                          <b>{d.name}</b>
                          <small className="num">{d.drugId}{d.brandNames.length > 0 ? ` · ${d.brandNames.join(' · ')}` : ''}</small>
                        </span>
                        <span className="uarole">
                          <span>{d.drugClass}</span>
                          <small className="uaprofile">{d.form} · default {d.defaultDose}</small>
                        </span>
                        <span className={`uastatus ${active ? 'on' : 'offed'}`}>{active ? 'Active' : 'Inactive'}</span>
                        <span className="uaacts">
                          <button className="uaact" onClick={() => openPanel('history', d)} aria-expanded={open === 'history'}>
                            History ({events.length})
                          </button>
                          <button className="uaact" onClick={() => openPanel('edit', d)} aria-expanded={open === 'edit'}>Edit</button>
                          {active && (
                            <button className="uaact warn" onClick={() => openPanel('deactivate', d)} aria-expanded={open === 'deactivate'}>Deactivate</button>
                          )}
                          {!active && (
                            <button className="uaact" disabled={busy} onClick={() => doReactivate(d)}>Reactivate</button>
                          )}
                        </span>
                      </div>

                      <div className="fmtags" style={{ marginTop: 6 }}>
                        {d.routes.map(r => <span className="fmtag" key={`r-${r}`}>{r}</span>)}
                        {d.frequencies.map(f => <span className="fmtag num" key={`f-${f}`}>{f}</span>)}
                        {d.allergyBlock.map(t => <span className="fmtag block" key={`b-${t}`}>⛔ {t}</span>)}
                        {d.allergyWarn.map(t => <span className="fmtag warn" key={`w-${t}`}>⚠ {t}</span>)}
                      </div>
                      {d.doseLimits && (
                        <div className="fmlimits" style={{ marginTop: 4 }}>
                          {d.doseLimits.min && <span>min {d.doseLimits.min}</span>}
                          {d.doseLimits.max && <span>max {d.doseLimits.max}</span>}
                          {d.doseLimits.maxDaily && <span>max daily {d.doseLimits.maxDaily}</span>}
                          {d.doseLimits.perKg && <span>per kg {d.doseLimits.perKg}</span>}
                        </div>
                      )}

                      {open === 'history' && (
                        <div className="uapanel" role="region" aria-label={`Audit history: ${d.drugId}`}>
                          {events.length === 0 && <div className="uaempty">No management events — this drug predates Layer 4 formulary management.</div>}
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
                        <div className="uapanel" role="region" aria-label={`Edit drug: ${d.drugId}`}>
                          <DrugForm fields={eFields} setFields={setEFields} busy={busy} vocab={vocab} />
                          <div className="uapanelacts">
                            <button className="uaact go" disabled={busy} onClick={() => doEdit(d)}>{busy ? 'Saving…' : 'Save changes'}</button>
                            <button className="uaact" onClick={() => setPanel(null)}>Cancel</button>
                          </div>
                        </div>
                      )}

                      {open === 'deactivate' && (
                        <div className="uapanel" role="alertdialog" aria-label={`Confirm deactivation: ${d.drugId}`}>
                          <span className="uaconfirm">
                            Deactivate <b>{d.name}</b>? It can no longer be selected for new orders;
                            every existing order referencing it keeps rendering (the drug is never deleted).
                          </span>
                          <div className="uapanelacts">
                            <button className="uaact warn" disabled={busy} onClick={() => doDeactivate(d)}>{busy ? 'Deactivating…' : 'Confirm deactivation'}</button>
                            <button className="uaact" onClick={() => setPanel(null)}>Cancel</button>
                          </div>
                        </div>
                      )}

                      {rowError?.drugId === d.drugId && <div className="uaerr" role="alert">{rowError.error}</div>}
                    </div>
                  )
                })}
                {drugs?.length === 0 && <div className="uaempty">The formulary is empty.</div>}
              </div>
            </Card>

            <Card icon={<IconAdmit size={15} stroke="var(--cyan)" />} title="Add Drug" aside="new drugs are active immediately">
              <form className="uaform" onSubmit={ev => { ev.preventDefault(); void doCreate() }}>
                <div className="uafields">
                  <label>Drug id (permanent — lowercase, digits, hyphen)
                    <input value={cDrugId} onChange={e => setCDrugId(e.target.value)} disabled={busy}
                      placeholder="drug-name" autoComplete="off" />
                  </label>
                </div>
                <DrugForm fields={cFields} setFields={setCFields} busy={busy} vocab={vocab} />
                {formError && <div className="uaerr" role="alert">{formError}</div>}
                <button className="uasubmit" type="submit"
                  disabled={busy || !cDrugId.trim() || !cFields.name.trim() || !cFields.drugClass.trim()
                    || !cFields.form.trim() || !cFields.strengths.trim() || !cFields.doses.trim()
                    || !cFields.defaultDose.trim() || !cFields.routes.trim() || !cFields.frequencies.trim()}>
                  {busy ? 'Adding…' : 'Add to formulary'}
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
