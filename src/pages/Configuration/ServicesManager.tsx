import { useState } from 'react'
import { Card } from '../../components/Card'
import { IconSettings } from '../../components/icons'
import {
  createService, deactivateService, reactivateService, updateService,
} from '../../lib/api'
import type { AdtWriteResult } from '../../lib/api'
import type { DepartmentEntry, ServiceEntry } from '../../lib/api/types'

/* ==================== ServicesManager ====================
   The ONE hierarchical tenant in Configuration, and therefore the one that
   does NOT render through the shared VocabManager.

   WHY IT IS SEPARATE, since "just add a prop" is the obvious wrong answer:
   VocabManager's row is Code/Label/Active/History and its create adapter
   takes only a label — a service carries an IMMUTABLE PARENT chosen at
   creation, which neither has a place for. Threading departmentCode through
   the shared contract would widen it for exactly one tenant, which is the
   fork VocabManager's props exist to prevent. The precedent is settled and
   three-for-three: the imaging catalogue, the bed registry and hospital
   identity are all specialised sections inside the SAME frame — same rail,
   same Card layout, same ua* visual family — never a bent VocabManager.

   The seam is in the same place on both sides of the wire. The server maps
   three flat tenants through MapVocab<TRow> and gives services their own POST
   for the same reason (see VocabApi.cs). When two layers split at the same
   joint under the same cause, the joint is real.

   THE PARENT IS IMMUTABLE, ENFORCED BY THE SHAPE OF THE CONTRACT rather than
   by a guard here: the edit path sends only a label, because the server's edit
   contract has no departmentCode member at all and rejects a payload naming
   one with a binding 400. This form therefore has no reparenting control to
   disable — there is nothing to disable, which is the stronger version.

   A CODE IS IDENTITY, NEVER MEANING. This screen renders department LABELS
   resolved at read time and never switches, compares or styles on a code. */

export function ServicesManager({
  services, departments, activeDepartments, departmentLabel, onChanged, showToast,
}: {
  services: ServiceEntry[] | null
  departments: DepartmentEntry[] | null
  activeDepartments: DepartmentEntry[]
  departmentLabel: (code: string) => string
  onChanged: () => void
  showToast: (title: string, body: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [panel, setPanel] = useState<{ kind: 'edit' | 'retire' | 'history'; key: string } | null>(null)
  const [rowError, setRowError] = useState<{ key: string; error: string } | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [cLabel, setCLabel] = useState('')
  const [cDept, setCDept] = useState('')
  const [eLabel, setELabel] = useState('')

  const offlineMsg = (what: string) => `Configuration changes require the live server — ${what} was NOT saved`

  async function run(key: string | null, what: string,
    op: () => Promise<AdtWriteResult<unknown>>, ok: () => void) {
    setBusy(true); setRowError(null); setFormError(null)
    const res = await op()
    setBusy(false)
    if (res.kind === 'ok') { ok(); onChanged(); return }
    const error = res.kind === 'rejected' ? res.error : offlineMsg(what)
    if (key) setRowError({ key, error })
    else setFormError(error)
  }

  const doCreate = () => run(null, 'the service', () =>
    createService({ label: cLabel.trim(), departmentCode: cDept }), () => {
    showToast('Services — added',
      `${cLabel.trim()} is selectable under ${departmentLabel(cDept)} on the admission form immediately`)
    setCLabel(''); setCDept('')
  })

  const doEdit = (r: ServiceEntry) => run(r.code, 'the change', () =>
    updateService(r.code, { label: eLabel.trim() }), () => {
    showToast('Services — updated', `${eLabel.trim()} — the change is on the entry's audit history`)
    setPanel(null)
  })

  const doRetire = (r: ServiceEntry) => run(r.code, 'the retirement', () =>
    deactivateService(r.code), () => {
    showToast('Services — retired', `${r.label} cannot be newly selected (records carrying it keep rendering)`)
    setPanel(null)
  })

  const doReactivate = (r: ServiceEntry) => run(r.code, 'the reactivation', () =>
    reactivateService(r.code), () => showToast('Services — reactivated',
      `${r.label} is selectable on the admission form again`))

  function openPanel(kind: 'edit' | 'retire' | 'history', r: ServiceEntry) {
    setRowError(null)
    if (panel?.kind === kind && panel.key === r.code) { setPanel(null); return }
    if (kind === 'edit') setELabel(r.label)
    setPanel({ kind, key: r.code })
  }

  const nActive = services?.filter(s => s.active).length ?? 0
  const nRetired = services?.filter(s => !s.active).length ?? 0
  /* THE BLOCKED STATE: a service cannot exist without a parent, so with no
     active department the add form has nothing to offer. It says so instead
     of rendering an empty dropdown the user has to reason about. */
  const noParents = departments !== null && activeDepartments.length === 0

  return (
    <div className="uacols">
      <Card icon={<IconSettings size={15} stroke="var(--green)" />} title="Services"
        aside={services ? `${nActive} active · ${nRetired} retired` : '—'}>
        <div className="uarows">
          {services === null && <div className="uaempty">Loading the vocabulary…</div>}
          {(services ?? []).map(r => {
            const open = panel?.key === r.code ? panel.kind : null
            return (
              <div className={`uarow${r.active ? '' : ' off'}`} key={r.code}>
                <div className="uamain">
                  <span className="uawho"><b>{r.label}</b></span>
                  <span className="uarole">
                    <span>{departmentLabel(r.departmentCode)}</span>
                    <small className="uaprofile">
                      parent department — fixed at creation, never reassigned
                    </small>
                  </span>
                  <span className={`uastatus ${r.active ? 'on' : 'offed'}`}>{r.active ? 'Active' : 'Retired'}</span>
                  <span className="uaacts">
                    <button className="uaact" onClick={() => openPanel('history', r)} aria-expanded={open === 'history'}>
                      History ({r.history.length})
                    </button>
                    <button className="uaact" onClick={() => openPanel('edit', r)} aria-expanded={open === 'edit'}>Edit</button>
                    {r.active && (
                      <button className="uaact warn" onClick={() => openPanel('retire', r)} aria-expanded={open === 'retire'}>Retire</button>
                    )}
                    {!r.active && (
                      <button className="uaact" disabled={busy} onClick={() => void doReactivate(r)}>Reactivate</button>
                    )}
                  </span>
                </div>

                {open === 'history' && (
                  <div className="uapanel" role="region" aria-label={`History: ${r.code}`}>
                    {r.history.length === 0 && (
                      <span className="uaconfirm">No recorded events — a seeded entry (historical data carries no invented audit).</span>
                    )}
                    {r.history.map((ev, i) => (
                      <div className="uaevent" key={i}>
                        <span className="num">{ev.time}</span> · {ev.actor} · {ev.action}{ev.detail ? ` — ${ev.detail}` : ''}
                      </div>
                    ))}
                  </div>
                )}

                {open === 'edit' && (
                  <div className="uapanel" role="region" aria-label={`Edit service: ${r.code}`}>
                    <div className="uafields">
                      <label>Label (free text — records carrying the old label keep their history)
                        <input value={eLabel} onChange={ev => setELabel(ev.target.value)} disabled={busy} />
                      </label>
                    </div>
                    {/* NO department control here, and deliberately not a
                        disabled one: the parent is immutable, the server's edit
                        contract has no field for it, and a greyed-out picker
                        would imply a permission problem rather than a rule. */}
                    <span className="uaconfirm">
                      Parent department: <b>{departmentLabel(r.departmentCode)}</b> — <b>permanent</b>.
                      A service cannot be moved between departments; one that belongs
                      elsewhere is a new entry under that department plus a retirement here,
                      so every admission already filed keeps meaning what it meant.
                    </span>
                    <div className="uapanelacts">
                      <button className="uaact go" disabled={busy || eLabel.trim().length === 0} onClick={() => void doEdit(r)}>
                        {busy ? 'Saving…' : 'Save change'}
                      </button>
                      <button className="uaact" onClick={() => setPanel(null)}>Cancel</button>
                    </div>
                  </div>
                )}

                {open === 'retire' && (
                  <div className="uapanel" role="alertdialog" aria-label={`Confirm retirement: ${r.code}`}>
                    <span className="uaconfirm">
                      Retire <b>{r.label}</b>? It can no longer be newly selected when
                      registering an admission and the server refuses it. Records carrying it
                      keep rendering it forever (never deleted). Reversible via Reactivate.
                    </span>
                    <div className="uapanelacts">
                      <button className="uaact warn" disabled={busy} onClick={() => void doRetire(r)}>
                        {busy ? 'Retiring…' : 'Confirm retirement'}
                      </button>
                      <button className="uaact" onClick={() => setPanel(null)}>Cancel</button>
                    </div>
                  </div>
                )}

                {rowError?.key === r.code && <div className="uaerr" role="alert">{rowError.error}</div>}
              </div>
            )
          })}
          {services?.length === 0 && (
            <div className="uaempty" role="note">
              Nothing is configured yet. <b>Service is required on every admission</b>, so
              reception cannot register a patient until this list has at least one active
              entry. Every service belongs to a <b>department</b>, so configure Departments
              first — the rail lists it above this one for that reason.
            </div>
          )}
        </div>
      </Card>

      <Card icon={<IconSettings size={15} stroke="var(--green)" />} title="Add service"
        aside={noParents ? 'blocked — no department' : 'selectable on the admission form immediately'}>
        {noParents ? (
          <div className="uaempty" role="note">
            <b>Add a department first.</b> A service is defined under exactly one department
            and cannot exist without a parent, so there is nothing to add it to yet. Open
            <b> Departments</b> in the rail above, add the hospital&apos;s departments, then
            return here.
          </div>
        ) : (
          <form className="uaform" onSubmit={ev => { ev.preventDefault(); void doCreate() }}>
            <div className="uafields">
              <label>Name (free text — shown on the admission form and on every record; the
                system keeps its own hidden identifier)
                <input value={cLabel} onChange={e => setCLabel(e.target.value)} disabled={busy}
                  placeholder="Upper GI" />
              </label>
              <label>Department (chosen once — <b>permanent</b>; a service is never moved
                between departments)
                <select value={cDept} onChange={e => setCDept(e.target.value)} disabled={busy}>
                  <option value="">Select a department…</option>
                  {activeDepartments.map(d => (
                    <option key={d.code} value={d.code}>{d.label}</option>
                  ))}
                </select>
              </label>
            </div>
            {formError && <div className="uaerr" role="alert">{formError}</div>}
            <button className="uasubmit" type="submit" disabled={busy || !cLabel.trim() || !cDept}>
              {busy ? 'Adding…' : 'Add to vocabulary'}
            </button>
          </form>
        )}
      </Card>
    </div>
  )
}
