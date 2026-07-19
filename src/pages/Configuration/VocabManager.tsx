import { useState } from 'react'
import { Card } from '../../components/Card'
import { IconSettings } from '../../components/icons'
import type { AdtWriteResult } from '../../lib/api'
import type { FormularyEvent } from '../../lib/api/types'

/* ==================== VocabManager ====================
   ONE manager for every simple vocabulary tenant — the "coherent family"
   the Configuration Vocabularies design asks for (§6): code status,
   dispositions, isolation types, shifts, and named frequencies all
   render through THIS component, so the list pattern, the add form, the
   inline edit/retire/history panels, and the active/retired language
   cannot drift apart tenant by tenant. Everything is the proven ua*
   visual family (tokens only — no hardcoded colors or spacing).

   The tenants differ only in DATA (an adapter of API calls), WORDING,
   and small extras (the disposition's immutable isDeath at creation,
   reserved rows that hide Retire, the frequency's value-only identity
   with drug references). Those differences are props, never forks. */

/** one displayable vocabulary row, normalized across tenants */
export interface VocabRow {
  /** the permanent identity (code, or the frequency's value) */
  key: string
  /** display label (same as key for value-keyed tenants) */
  label: string
  active: boolean
  history: FormularyEvent[]
  /** small qualifier tags rendered beside the row ("Counts as death",
   *  "Reserved", "listed by 3 drugs") */
  tags?: string[]
  /** true hides the Retire action and explains why (a rule in code —
   *  the reserved 'died' disposition) */
  reserved?: string
}

export interface VocabSpec {
  /** singular noun for copy ("disposition", "isolation type", …) */
  noun: string
  /** where a NEW entry becomes selectable ("at discharge", …) */
  usedAt: string
  /** what retirement means here (one sentence for the confirm) */
  retireNote: string
  /** value-keyed tenant (frequencies): code === label, no edit action */
  valueKeyed?: boolean
  /** extra creation field: the disposition's immutable death attribute */
  createDeathAttr?: boolean
  /** placeholder examples for the add form */
  codePlaceholder: string
  labelPlaceholder?: string
}

export interface VocabApiAdapter {
  create(draft: { code: string; label: string; isDeath?: boolean }): Promise<AdtWriteResult<unknown>>
  update?(key: string, label: string): Promise<AdtWriteResult<unknown>>
  deactivate(key: string): Promise<AdtWriteResult<unknown>>
  reactivate(key: string): Promise<AdtWriteResult<unknown>>
}

export function VocabManager({ title, icon, accent, spec, rows, api, onChanged, showToast }: {
  title: string
  icon: React.ReactNode
  accent: string
  spec: VocabSpec
  rows: VocabRow[] | null
  api: VocabApiAdapter
  onChanged: () => void
  showToast: (title: string, body: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [panel, setPanel] = useState<{ kind: 'edit' | 'retire' | 'history'; key: string } | null>(null)
  const [rowError, setRowError] = useState<{ key: string; error: string } | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [cCode, setCCode] = useState('')
  const [cLabel, setCLabel] = useState('')
  const [cDeath, setCDeath] = useState(false)
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

  const doCreate = () => run(null, 'the entry', () =>
    api.create({
      code: cCode.trim(),
      label: spec.valueKeyed ? cCode.trim() : cLabel.trim(),
      ...(spec.createDeathAttr && cDeath ? { isDeath: true } : {}),
    }), () => {
    showToast(`${title} — added`, `${spec.valueKeyed ? cCode.trim() : cLabel.trim()} is selectable ${spec.usedAt} immediately`)
    setCCode(''); setCLabel(''); setCDeath(false)
  })

  const doEdit = (r: VocabRow) => run(r.key, 'the change', () =>
    api.update!(r.key, eLabel.trim()), () => {
    showToast(`${title} — updated`, `${eLabel.trim()} — the change is on the entry's audit history`)
    setPanel(null)
  })

  const doRetire = (r: VocabRow) => run(r.key, 'the retirement', () =>
    api.deactivate(r.key), () => {
    showToast(`${title} — retired`, `${r.label} cannot be newly selected (records carrying it keep rendering)`)
    setPanel(null)
  })

  const doReactivate = (r: VocabRow) => run(r.key, 'the reactivation', () =>
    api.reactivate(r.key), () => showToast(`${title} — reactivated`, `${r.label} is selectable ${spec.usedAt} again`))

  function openPanel(kind: 'edit' | 'retire' | 'history', r: VocabRow) {
    setRowError(null)
    if (panel?.kind === kind && panel.key === r.key) { setPanel(null); return }
    if (kind === 'edit') setELabel(r.label)
    setPanel({ kind, key: r.key })
  }

  const nActive = rows?.filter(r => r.active).length ?? 0
  const nRetired = rows?.filter(r => !r.active).length ?? 0

  return (
    <div className="uacols">
      <Card icon={icon} title={title}
        aside={rows ? `${nActive} active · ${nRetired} retired` : '—'}>
        <div className="uarows">
          {rows === null && <div className="uaempty">Loading the vocabulary…</div>}
          {(rows ?? []).map(r => {
            const open = panel?.key === r.key ? panel.kind : null
            return (
              <div className={`uarow${r.active ? '' : ' off'}`} key={r.key}>
                <div className="uamain">
                  <span className="uawho">
                    <b>{r.label}</b>
                    {!spec.valueKeyed && <small className="num">{r.key}</small>}
                  </span>
                  <span className="uarole">
                    <span>{spec.noun.charAt(0).toUpperCase() + spec.noun.slice(1)}</span>
                    <small className="uaprofile">
                      {r.tags && r.tags.length > 0 ? r.tags.join(' · ') : `selected ${spec.usedAt} — never typed`}
                    </small>
                  </span>
                  <span className={`uastatus ${r.active ? 'on' : 'offed'}`}>{r.active ? 'Active' : 'Retired'}</span>
                  <span className="uaacts">
                    <button className="uaact" onClick={() => openPanel('history', r)} aria-expanded={open === 'history'}>
                      History ({r.history.length})
                    </button>
                    {!spec.valueKeyed && api.update && (
                      <button className="uaact" onClick={() => openPanel('edit', r)} aria-expanded={open === 'edit'}>Edit</button>
                    )}
                    {r.active && !r.reserved && (
                      <button className="uaact warn" onClick={() => openPanel('retire', r)} aria-expanded={open === 'retire'}>Retire</button>
                    )}
                    {r.active && r.reserved && (
                      <span className="uareserved" title={r.reserved}>Reserved</span>
                    )}
                    {!r.active && (
                      <button className="uaact" disabled={busy} onClick={() => void doReactivate(r)}>Reactivate</button>
                    )}
                  </span>
                </div>

                {open === 'history' && (
                  <div className="uapanel" role="region" aria-label={`History: ${r.key}`}>
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

                {open === 'edit' && api.update && (
                  <div className="uapanel" role="region" aria-label={`Edit ${spec.noun}: ${r.key}`}>
                    <div className="uafields">
                      <label>Label (the code <span className="num">{r.key}</span> is permanent)
                        <input value={eLabel} onChange={ev => setELabel(ev.target.value)} disabled={busy} maxLength={60} />
                      </label>
                    </div>
                    <div className="uapanelacts">
                      <button className="uaact go" disabled={busy || eLabel.trim().length === 0} onClick={() => void doEdit(r)}>
                        {busy ? 'Saving…' : 'Save change'}
                      </button>
                      <button className="uaact" onClick={() => setPanel(null)}>Cancel</button>
                    </div>
                  </div>
                )}

                {open === 'retire' && (
                  <div className="uapanel" role="alertdialog" aria-label={`Confirm retirement: ${r.key}`}>
                    <span className="uaconfirm">
                      Retire <b>{r.label}</b>? {spec.retireNote} Records carrying it keep
                      rendering it forever (never deleted). Reversible via Reactivate.
                      {r.tags?.some(t => t.startsWith('listed by')) && (
                        <> <b>Note:</b> {r.tags.find(t => t.startsWith('listed by'))} — those
                        per-drug lists keep showing it, but it will not be newly orderable.</>
                      )}
                    </span>
                    <div className="uapanelacts">
                      <button className="uaact warn" disabled={busy} onClick={() => void doRetire(r)}>
                        {busy ? 'Retiring…' : 'Confirm retirement'}
                      </button>
                      <button className="uaact" onClick={() => setPanel(null)}>Cancel</button>
                    </div>
                  </div>
                )}

                {rowError?.key === r.key && <div className="uaerr" role="alert">{rowError.error}</div>}
              </div>
            )
          })}
          {rows?.length === 0 && <div className="uaempty">No entries — add the hospital&apos;s own below.</div>}
        </div>
      </Card>

      <Card icon={<IconSettings size={15} stroke={accent} />} title={`Add ${spec.noun}`}
        aside={`selectable ${spec.usedAt} immediately`}>
        <form className="uaform" onSubmit={ev => { ev.preventDefault(); void doCreate() }}>
          <div className="uafields">
            {spec.valueKeyed ? (
              <label>Value (permanent — appears verbatim on orders)
                <input value={cCode} onChange={e => setCCode(e.target.value)} disabled={busy}
                  placeholder={spec.codePlaceholder} autoComplete="off" maxLength={40} />
              </label>
            ) : (
              <>
                <label>Code (permanent — lowercase, digits, underscore)
                  <input value={cCode} onChange={e => setCCode(e.target.value)} disabled={busy}
                    placeholder={spec.codePlaceholder} autoComplete="off" maxLength={40} />
                </label>
                <label>Label (shown at the bedside and on every record)
                  <input value={cLabel} onChange={e => setCLabel(e.target.value)} disabled={busy}
                    placeholder={spec.labelPlaceholder} maxLength={60} />
                </label>
              </>
            )}
            {spec.createDeathAttr && (
              <label className="uacheck">
                <input type="checkbox" checked={cDeath} onChange={e => setCDeath(e.target.checked)} disabled={busy} />
                <span>Counts as <b>death</b> — arms the deceased re-admission guard and the
                mortality statistics. <b>Immutable once created</b> (a vocabulary edit can
                never rewrite a recorded outcome).</span>
              </label>
            )}
          </div>
          {formError && <div className="uaerr" role="alert">{formError}</div>}
          <button className="uasubmit" type="submit"
            disabled={busy || !cCode.trim() || (!spec.valueKeyed && !cLabel.trim())}>
            {busy ? 'Adding…' : 'Add to vocabulary'}
          </button>
        </form>
      </Card>
    </div>
  )
}
