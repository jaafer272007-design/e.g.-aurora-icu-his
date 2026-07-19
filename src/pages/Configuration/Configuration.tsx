import { useCallback, useEffect, useMemo, useState } from 'react'
import '../UsersAdmin/UsersAdmin.css'
import { AppHeader, type KpiSpec } from '../../components/AppHeader'
import { NavSidebar } from '../../components/NavSidebar'
import { Card } from '../../components/Card'
import { Toast, useToast } from '../../components/Toast'
import { IconCheck, IconClock, IconPulse, IconSettings } from '../../components/icons'
import {
  createCodeStatus, deactivateCodeStatus, getCodeStatuses, reactivateCodeStatus, updateCodeStatus,
} from '../../lib/api'
import type { AdtWriteResult } from '../../lib/api'
import type { CodeStatusEntry } from '../../lib/api/types'
import { getSession, initialsOf, profileOf } from '../../lib/session'

/* ==================== Configuration (/config) ====================
   The per-hospital CONFIGURATION AREA — what varies from one hospital to
   the next is editable, governed DATA here, never a code change (one
   codebase, many configurations, zero forks).

   FIRST TENANT: the Code Status vocabulary — pulled ahead of the rest of
   the configurability work because it is a SAFETY FIX (a resuscitation
   instruction was an ungoverned free-text string). This page is the
   MINIMAL config home that tenant needs — deliberately a section layout
   so the later config-home work EXTENDS it (adds sections) rather than
   duplicates it. Route + nav gate: codestatus.manage (SeniorDoctor —
   clinical governance, the observations.configure precedent; NEVER the
   office Administrator). When non-clinical tenants land (hospital
   identity, beds), gating becomes per-section — recorded flag.

   The manager is the formulary/lab-catalogue pattern verbatim: natural
   key, Active flag, append-only audit, deactivate-never-delete,
   REAL-ONLY writes. */
export function Configuration() {
  const { toast, showToast } = useToast()
  const session = getSession()!

  const [entries, setEntries] = useState<CodeStatusEntry[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [panel, setPanel] = useState<{ kind: 'edit' | 'retire' | 'history'; code: string } | null>(null)
  const [rowError, setRowError] = useState<{ code: string; error: string } | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const [cCode, setCCode] = useState('')
  const [cLabel, setCLabel] = useState('')
  const [eLabel, setELabel] = useState('')

  const reload = useCallback(() => { getCodeStatuses().then(setEntries) }, [])
  useEffect(() => { reload() }, [reload])

  const stats = useMemo(() => {
    const all = entries ?? []
    return { total: all.length, active: all.filter(e => e.active).length, retired: all.filter(e => !e.active).length }
  }, [entries])

  const kpis: KpiSpec[] = [
    { icon: <IconPulse size={14} stroke="var(--red)" />, iconBg: 'rgba(var(--red-rgb),.13)', value: entries ? stats.total : '—', label: 'Code Statuses' },
    { icon: <IconCheck size={12} stroke="var(--green)" />, iconBg: 'rgba(var(--green-rgb),.13)', value: entries ? stats.active : '—', label: 'Active' },
    { icon: <IconClock size={14} stroke="var(--amber)" />, iconBg: 'rgba(var(--amber-rgb),.14)', value: entries ? stats.retired : '—', label: 'Retired' },
  ]

  const offlineMsg = (what: string) => `Configuration changes require the live server — ${what} was NOT saved`

  async function applyWrite(code: string | null, what: string,
    run: () => Promise<AdtWriteResult<CodeStatusEntry>>, onOk: (e: CodeStatusEntry) => void) {
    setBusy(true); setRowError(null); setFormError(null)
    const res = await run()
    setBusy(false)
    if (res.kind === 'ok') { onOk(res.data); reload(); return }
    const error = res.kind === 'rejected' ? res.error : offlineMsg(what)
    if (code) setRowError({ code, error })
    else setFormError(error)
  }

  async function doCreate() {
    await applyWrite(null, 'the entry', () => createCodeStatus({ code: cCode.trim(), label: cLabel.trim() }), e => {
      showToast('Code status added', `${e.label} (${e.code}) is selectable at the bedside`)
      setCCode(''); setCLabel('')
    })
  }

  async function doEdit(e: CodeStatusEntry) {
    await applyWrite(e.code, 'the change', () => updateCodeStatus(e.code, { label: eLabel.trim() }), upd => {
      showToast('Code status updated', `${upd.label} — the change is on the entry's audit history`)
      setPanel(null)
    })
  }

  async function doRetire(e: CodeStatusEntry) {
    await applyWrite(e.code, 'the retirement', () => deactivateCodeStatus(e.code), upd => {
      showToast('Code status retired', `${upd.label} cannot be newly assigned (patients carrying it keep rendering)`)
      setPanel(null)
    })
  }

  async function doReactivate(e: CodeStatusEntry) {
    await applyWrite(e.code, 'the reactivation', () => reactivateCodeStatus(e.code), upd => {
      showToast('Code status reactivated', `${upd.label} is selectable again`)
    })
  }

  function openPanel(kind: 'edit' | 'retire' | 'history', e: CodeStatusEntry) {
    setRowError(null)
    if (panel?.kind === kind && panel.code === e.code) { setPanel(null); return }
    if (kind === 'edit') setELabel(e.label)
    setPanel({ kind, code: e.code })
  }

  return (
    <div className="app-frame ua">
      <AppHeader
        subtitle="Configuration · Aurora Core"
        kpis={kpis}
        user={{ initials: initialsOf(session.name), name: session.name, role: `${session.jobTitle} · ${profileOf(session.jobTitle)} profile` }}
      />
      <div className="shell">
        <NavSidebar active="config" footerLines={['Clinical governance', 'Configuration · Aurora Core']} />

        <main>
          <div className="uanote" role="note">
            <b>Configuration</b> — what varies per hospital is editable, governed data, never a code
            change. First section: the <b>Code Status vocabulary</b>. A resuscitation instruction is
            <b> selected from this list, never typed</b>; retiring an entry is a status change, never
            a delete (patients carrying it keep rendering it — it just cannot be newly assigned);
            every change lands on the entry&apos;s permanent audit history; an unset patient always
            reads an explicit <b>&ldquo;Not recorded&rdquo;</b> — never a default.
          </div>

          <div className="uacols">
            <Card icon={<IconPulse size={15} stroke="var(--red)" />} title="Code Status Vocabulary"
              aside={entries ? `${stats.active} active · ${stats.retired} retired` : '—'}>
              <div className="uarows">
                {(entries ?? []).map(e => {
                  const open = panel?.code === e.code ? panel.kind : null
                  return (
                    <div className={`uarow${e.active ? '' : ' off'}`} key={e.code}>
                      <div className="uamain">
                        <span className="uawho">
                          <b>{e.label}</b>
                          <small className="num">{e.code}</small>
                        </span>
                        <span className="uarole">
                          <span>Resuscitation instruction</span>
                          <small className="uaprofile">selected at admission / bedside — never typed</small>
                        </span>
                        <span className={`uastatus ${e.active ? 'on' : 'offed'}`}>{e.active ? 'Active' : 'Retired'}</span>
                        <span className="uaacts">
                          <button className="uaact" onClick={() => openPanel('history', e)} aria-expanded={open === 'history'}>
                            History ({e.history.length})
                          </button>
                          <button className="uaact" onClick={() => openPanel('edit', e)} aria-expanded={open === 'edit'}>Edit</button>
                          {e.active && (
                            <button className="uaact warn" onClick={() => openPanel('retire', e)} aria-expanded={open === 'retire'}>Retire</button>
                          )}
                          {!e.active && (
                            <button className="uaact" disabled={busy} onClick={() => doReactivate(e)}>Reactivate</button>
                          )}
                        </span>
                      </div>

                      {open === 'history' && (
                        <div className="uapanel" role="region" aria-label={`History: ${e.code}`}>
                          {e.history.length === 0 && (
                            <span className="uaconfirm">No recorded events — a seeded entry (historical data carries no invented audit).</span>
                          )}
                          {e.history.map((ev, i) => (
                            <div className="uaevent" key={i}>
                              <span className="num">{ev.time}</span> · {ev.actor} · {ev.action}{ev.detail ? ` — ${ev.detail}` : ''}
                            </div>
                          ))}
                        </div>
                      )}

                      {open === 'edit' && (
                        <div className="uapanel" role="region" aria-label={`Edit code status: ${e.code}`}>
                          <div className="uafields">
                            <label>Label (the code <span className="num">{e.code}</span> is permanent)
                              <input value={eLabel} onChange={ev => setELabel(ev.target.value)} disabled={busy} maxLength={60} />
                            </label>
                          </div>
                          <div className="uapanelacts">
                            <button className="uaact go" disabled={busy || eLabel.trim().length === 0} onClick={() => doEdit(e)}>
                              {busy ? 'Saving…' : 'Save change'}
                            </button>
                            <button className="uaact" onClick={() => setPanel(null)}>Cancel</button>
                          </div>
                        </div>
                      )}

                      {open === 'retire' && (
                        <div className="uapanel" role="alertdialog" aria-label={`Confirm retirement: ${e.code}`}>
                          <span className="uaconfirm">
                            Retire <b>{e.label}</b>? It can no longer be newly assigned — admission and
                            bedside selection exclude it and the server refuses it. Every patient
                            currently carrying it keeps rendering it (never deleted). Reversible via
                            Reactivate.
                          </span>
                          <div className="uapanelacts">
                            <button className="uaact warn" disabled={busy} onClick={() => doRetire(e)}>
                              {busy ? 'Retiring…' : 'Confirm retirement'}
                            </button>
                            <button className="uaact" onClick={() => setPanel(null)}>Cancel</button>
                          </div>
                        </div>
                      )}

                      {rowError?.code === e.code && <div className="uaerr" role="alert">{rowError.error}</div>}
                    </div>
                  )
                })}
                {entries?.length === 0 && <div className="uaempty">No vocabulary entries — add the hospital&apos;s resuscitation categories.</div>}
              </div>
            </Card>

            <Card icon={<IconSettings size={15} stroke="var(--cyan)" />} title="Add Code Status" aside="new entries are selectable immediately">
              <form className="uaform" onSubmit={ev => { ev.preventDefault(); void doCreate() }}>
                <div className="uafields">
                  <label>Code (permanent — lowercase, digits, underscore)
                    <input value={cCode} onChange={e => setCCode(e.target.value)} disabled={busy}
                      placeholder="dnr_dni" autoComplete="off" maxLength={40} />
                  </label>
                  <label>Label (shown at the bedside and on every record)
                    <input value={cLabel} onChange={e => setCLabel(e.target.value)} disabled={busy}
                      placeholder="DNR / DNI" maxLength={60} />
                  </label>
                </div>
                {formError && <div className="uaerr" role="alert">{formError}</div>}
                <button className="uasubmit" type="submit"
                  disabled={busy || !cCode.trim() || !cLabel.trim()}>
                  {busy ? 'Adding…' : 'Add to vocabulary'}
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
