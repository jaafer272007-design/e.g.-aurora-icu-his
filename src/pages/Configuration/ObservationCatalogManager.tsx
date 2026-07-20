import { useState } from 'react'
import { Card } from '../../components/Card'
import { IconPulse, IconSettings } from '../../components/icons'
import {
  createObservationType, deactivateObservationType, reactivateObservationType,
  updateObservationType,
} from '../../lib/api'
import type { AdtWriteResult } from '../../lib/api'
import type { ObsCatalogGroup, ObservationType } from '../../lib/api/types'

/* ==================== Observations Catalogue manager ====================
   The most safety-sensitive Configuration tenant: what this hospital can
   OBSERVE at the bedside. The approved split —
   - ADD a custom numeric observation with plausibility bounds and optional
     flagging ranges: ✅ (free-text name; the obs_ key is internal, never
     shown).
   - EDIT the flagging ranges of any NON-SCORING numeric observation: ✅
     (ranges drive display flags only; scores never read them).
   - Anything on a NEWS2/SOFA score input: 🔴 LOCKED — the server answers
     409 and this UI offers no mutating action at all (an unlocked score
     input is a silently-breakable score). Derived types are computed,
     never edited. Seeded non-scoring types: ranges only (the clinical
     taxonomy's names/units/bounds are validated content).
   - Retire (never delete) non-scoring, non-derived types: history keeps
     rendering them; new charting refuses them.
   Range CLEARING is a recorded v1 deferral — a set bound can be moved,
   not blanked. */

const numOrUndef = (s: string): number | undefined => (s.trim() === '' ? undefined : Number(s))
const numStr = (v: number | undefined): string => (v === undefined || v === null ? '' : String(v))
const cleanNum = (s: string) => s.replace(/[^0-9.\-]/g, '')

/* != null throughout: the wire carries unset bounds as JSON null */
function rangeSummary(t: ObservationType): string | null {
  if (t.valueType !== 'numeric') return null
  const parts: string[] = []
  if (t.refLow != null || t.refHigh != null) parts.push(`normal ${t.refLow ?? '…'}–${t.refHigh ?? '…'}`)
  if (t.critLow != null) parts.push(`crit ≤${t.critLow}`)
  if (t.critHigh != null) parts.push(`crit ≥${t.critHigh}`)
  return parts.length > 0 ? parts.join(' · ') : null
}

export function ObservationCatalogManager({ groups, onChanged, showToast }: {
  groups: ObsCatalogGroup[] | null
  onChanged: () => void
  showToast: (title: string, detail: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [panel, setPanel] = useState<{ kind: 'edit' | 'retire' | 'history'; code: string } | null>(null)
  const [rowError, setRowError] = useState<{ code: string; error: string } | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  /* add form (free-text name; the obs_ key is generated, never shown) */
  const [aName, setAName] = useState('')
  const [aGroup, setAGroup] = useState('vitals')
  const [aUnit, setAUnit] = useState('')
  const [aMin, setAMin] = useState(''); const [aMax, setAMax] = useState('')
  const [aRefLow, setARefLow] = useState(''); const [aRefHigh, setARefHigh] = useState('')
  const [aCritLow, setACritLow] = useState(''); const [aCritHigh, setACritHigh] = useState('')

  /* edit panel fields */
  const [eName, setEName] = useState(''); const [eUnit, setEUnit] = useState('')
  const [eMin, setEMin] = useState(''); const [eMax, setEMax] = useState('')
  const [eRefLow, setERefLow] = useState(''); const [eRefHigh, setERefHigh] = useState('')
  const [eCritLow, setECritLow] = useState(''); const [eCritHigh, setECritHigh] = useState('')

  const allTypes = (groups ?? []).flatMap(g => g.types.map(t => ({ t, group: g })))
  const activeCount = allTypes.filter(x => x.t.active).length

  const offlineMsg = (what: string) => `Configuration changes require the live server — ${what} was NOT saved`

  async function applyWrite(code: string | null, what: string,
    run: () => Promise<AdtWriteResult<ObservationType>>, onOk: (t: ObservationType) => void) {
    setBusy(true); setRowError(null); setFormError(null)
    const res = await run()
    setBusy(false)
    if (res.kind === 'ok') { onOk(res.data); onChanged(); return }
    const error = res.kind === 'rejected' ? res.error : offlineMsg(what)
    if (code) setRowError({ code, error })
    else setFormError(error)
  }

  const doCreate = () => applyWrite(null, 'the observation', () => createObservationType({
    name: aName.trim(), group: aGroup,
    ...(aUnit.trim() ? { unit: aUnit.trim() } : {}),
    min: Number(aMin), max: Number(aMax),
    ...(aRefLow.trim() ? { refLow: Number(aRefLow) } : {}),
    ...(aRefHigh.trim() ? { refHigh: Number(aRefHigh) } : {}),
    ...(aCritLow.trim() ? { critLow: Number(aCritLow) } : {}),
    ...(aCritHigh.trim() ? { critHigh: Number(aCritHigh) } : {}),
  }), t => {
    showToast('Observation added', `${t.displayName} is chartable immediately`)
    setAName(''); setAUnit(''); setAMin(''); setAMax('')
    setARefLow(''); setARefHigh(''); setACritLow(''); setACritHigh('')
  })

  function doEdit(t: ObservationType) {
    /* send only what CHANGED (the server refuses an empty edit); a blank
       range field on a set bound is left out — moving, never clearing */
    const draft: Parameters<typeof updateObservationType>[1] = {}
    if (t.custom) {
      if (eName.trim() && eName.trim() !== t.displayName) draft.name = eName.trim()
      if (eUnit.trim() && eUnit.trim() !== t.unit) draft.unit = eUnit.trim()
      const mn = numOrUndef(eMin); const mx = numOrUndef(eMax)
      if (mn !== undefined && mn !== t.min) draft.min = mn
      if (mx !== undefined && mx !== t.max) draft.max = mx
    }
    const rl = numOrUndef(eRefLow); const rh = numOrUndef(eRefHigh)
    const cl = numOrUndef(eCritLow); const ch = numOrUndef(eCritHigh)
    if (rl !== undefined && rl !== t.refLow) draft.refLow = rl
    if (rh !== undefined && rh !== t.refHigh) draft.refHigh = rh
    if (cl !== undefined && cl !== t.critLow) draft.critLow = cl
    if (ch !== undefined && ch !== t.critHigh) draft.critHigh = ch
    if (Object.keys(draft).length === 0) {
      setRowError({ code: t.typeCode, error: 'nothing changed — edit a field first' })
      return
    }
    return applyWrite(t.typeCode, 'the change', () => updateObservationType(t.typeCode, draft),
      upd => { showToast('Observation updated', `${upd.displayName} — the change is on the type's audit history`); setPanel(null) })
  }

  const doRetire = (t: ObservationType) => applyWrite(t.typeCode, 'the retirement', () => deactivateObservationType(t.typeCode),
    upd => { showToast('Observation retired', `${upd.displayName} is off new charting (historical records keep rendering it)`); setPanel(null) })
  const doReactivate = (t: ObservationType) => applyWrite(t.typeCode, 'the reactivation', () => reactivateObservationType(t.typeCode),
    upd => showToast('Observation reactivated', `${upd.displayName} is chartable again`))

  function openPanel(kind: 'edit' | 'retire' | 'history', t: ObservationType) {
    setRowError(null)
    if (panel?.kind === kind && panel.code === t.typeCode) { setPanel(null); return }
    if (kind === 'edit') {
      setEName(t.displayName); setEUnit(t.unit)
      setEMin(numStr(t.min)); setEMax(numStr(t.max))
      setERefLow(numStr(t.refLow)); setERefHigh(numStr(t.refHigh))
      setECritLow(numStr(t.critLow)); setECritHigh(numStr(t.critHigh))
    }
    setPanel({ kind, code: t.typeCode })
  }

  const numField = (label: string, val: string, set: (s: string) => void, ph = '') => (
    <label>{label}
      <input value={val} onChange={e => set(cleanNum(e.target.value))} disabled={busy}
        placeholder={ph} inputMode="decimal" autoComplete="off" />
    </label>
  )

  return (
    <div className="uacols">
      <Card icon={<IconPulse size={15} stroke="var(--green)" />} title="Observations Catalogue"
        aside={groups ? `${activeCount} active · ${allTypes.length - activeCount} retired` : '—'}>
        <div className="uarows">
          {groups === null && (
            <div className="uaempty">observation catalogue unavailable — requires the live server (nothing fabricated)</div>
          )}
          {(groups ?? []).map(g => (
            <div key={g.groupCode}>
              <div className="cfggrouptitle">{g.displayName}{!g.enabled && ' (group disabled)'}</div>
              {g.types.map(t => {
                const open = panel?.code === t.typeCode ? panel.kind : null
                const locked = t.scoreInput || t.isDerived
                const rangeEditable = !locked && t.valueType === 'numeric'
                const lifecycleEditable = !locked
                const ranges = rangeSummary(t)
                return (
                  <div className={`uarow${t.active ? '' : ' off'}`} key={t.typeCode}>
                    <div className="uamain">
                      <span className="uawho">
                        <b>{t.displayName}</b>
                        {t.unit && <small>{t.unit}</small>}
                      </span>
                      <span className="uarole">
                        <span>
                          {t.scoreInput && <span className="uastatus offed" title="A validated NEWS2/SOFA score input — every part of its definition is locked; an unlocked score input is a silently-breakable score">🔒 LOCKED — score input</span>}
                          {t.isDerived && !t.scoreInput && <span className="uastatus offed">Derived — computed, never edited</span>}
                          {t.custom && <span className="uastatus on">Custom</span>}
                          {!t.scoreInput && !t.isDerived && !t.custom && <span>seeded — ranges editable</span>}
                        </span>
                        <small className="uaprofile">
                          {t.valueType === 'numeric' && t.min != null && t.max != null
                            ? `plausible ${t.min}–${t.max}${ranges ? ` · ${ranges}` : ' · no flagging ranges set'}`
                            : t.valueType}
                        </small>
                      </span>
                      <span className={`uastatus ${t.active ? 'on' : 'offed'}`}>{t.active ? 'Active' : 'Retired'}</span>
                      <span className="uaacts">
                        <button className="uaact" onClick={() => openPanel('history', t)} aria-expanded={open === 'history'}>
                          History ({t.history.length})
                        </button>
                        {rangeEditable && (
                          <button className="uaact" onClick={() => openPanel('edit', t)} aria-expanded={open === 'edit'}>Edit</button>
                        )}
                        {lifecycleEditable && t.active && (
                          <button className="uaact warn" onClick={() => openPanel('retire', t)} aria-expanded={open === 'retire'}>Retire</button>
                        )}
                        {lifecycleEditable && !t.active && (
                          <button className="uaact" disabled={busy} onClick={() => void doReactivate(t)}>Reactivate</button>
                        )}
                      </span>
                    </div>

                    {open === 'history' && (
                      <div className="uapanel" role="region" aria-label={`History: ${t.displayName}`}>
                        {t.history.length === 0 && (
                          <span className="uaconfirm">No recorded events — a seeded observation (historical data carries no invented audit).</span>
                        )}
                        {t.history.map((ev, i) => (
                          <div className="uaevent" key={i}>
                            <span className="num">{ev.time}</span> · {ev.actor} · {ev.action}{ev.detail ? ` — ${ev.detail}` : ''}
                          </div>
                        ))}
                      </div>
                    )}

                    {open === 'edit' && (
                      <div className="uapanel" role="region" aria-label={`Edit observation: ${t.displayName}`}>
                        {t.custom ? (
                          <div className="uafields">
                            <label>Name (free text — whatever the hospital calls it)
                              <input value={eName} onChange={ev => setEName(ev.target.value)} disabled={busy} />
                            </label>
                            <label>Unit (free text; optional)
                              <input value={eUnit} onChange={ev => setEUnit(ev.target.value)} disabled={busy} />
                            </label>
                            {numField('Plausible minimum (charting refuses values below)', eMin, setEMin)}
                            {numField('Plausible maximum (charting refuses values above)', eMax, setEMax)}
                          </div>
                        ) : (
                          <span className="uaconfirm">
                            <b>{t.displayName}</b> is part of the seeded clinical taxonomy — its name, unit
                            and plausibility bounds are validated content. Only the <b>flagging ranges</b> below
                            are this hospital&apos;s to set.
                          </span>
                        )}
                        <div className="uafields">
                          {numField('Normal range — low (below → abnormal flag)', eRefLow, setERefLow, 'none set')}
                          {numField('Normal range — high (above → abnormal flag)', eRefHigh, setERefHigh, 'none set')}
                          {numField('Critical low (at or below → critical flag)', eCritLow, setECritLow, 'none set')}
                          {numField('Critical high (at or above → critical flag)', eCritHigh, setECritHigh, 'none set')}
                        </div>
                        <span className="uaconfirm">
                          Flags are display-only — <b>NEWS2/SOFA never read these ranges</b> (score bands are
                          validated code). A set bound can be moved, not cleared.
                        </span>
                        <div className="uapanelacts">
                          <button className="uaact go" disabled={busy} onClick={() => void doEdit(t)}>
                            {busy ? 'Saving…' : 'Save change'}
                          </button>
                          <button className="uaact" onClick={() => setPanel(null)}>Cancel</button>
                        </div>
                      </div>
                    )}

                    {open === 'retire' && (
                      <div className="uapanel" role="alertdialog" aria-label={`Confirm retirement: ${t.displayName}`}>
                        <span className="uaconfirm">
                          Retire <b>{t.displayName}</b>? It leaves new charting and the server refuses new
                          entries for it. Every historical record carrying it keeps rendering (never
                          deleted). Reversible via Reactivate.
                        </span>
                        <div className="uapanelacts">
                          <button className="uaact warn" disabled={busy} onClick={() => void doRetire(t)}>
                            {busy ? 'Retiring…' : 'Confirm retirement'}
                          </button>
                          <button className="uaact" onClick={() => setPanel(null)}>Cancel</button>
                        </div>
                      </div>
                    )}

                    {rowError?.code === t.typeCode && <div className="uaerr" role="alert">{rowError.error}</div>}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </Card>

      <Card icon={<IconSettings size={15} stroke="var(--green)" />} title="Add Observation"
        aside="chartable immediately (numeric, with plausibility bounds)">
        <form className="uaform" onSubmit={ev => { ev.preventDefault(); void doCreate() }}>
          <div className="uafields">
            <label>Name (free text — whatever the hospital calls it)
              <input value={aName} onChange={e => setAName(e.target.value)} disabled={busy}
                placeholder="Abdominal girth" autoComplete="off" />
            </label>
            <label>Group (where it appears on the charting form)
              <select value={aGroup} onChange={e => setAGroup(e.target.value)} disabled={busy}>
                {(groups ?? []).map(g => (
                  <option key={g.groupCode} value={g.groupCode}>
                    {g.displayName}{!g.enabled ? ' (disabled — enable the group to chart)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>Unit (free text; optional — e.g. cm, mmHg)
              <input value={aUnit} onChange={e => setAUnit(e.target.value)} disabled={busy}
                placeholder="cm" autoComplete="off" />
            </label>
            <label>Plausible minimum (charting refuses values below — a typo guard, not a flag)
              <input value={aMin} onChange={e => setAMin(cleanNum(e.target.value))} disabled={busy}
                placeholder="0" inputMode="decimal" autoComplete="off" />
            </label>
            <label>Plausible maximum (charting refuses values above)
              <input value={aMax} onChange={e => setAMax(cleanNum(e.target.value))} disabled={busy}
                placeholder="200" inputMode="decimal" autoComplete="off" />
            </label>
            <label>Normal range — low (optional; below → abnormal flag)
              <input value={aRefLow} onChange={e => setARefLow(cleanNum(e.target.value))} disabled={busy}
                inputMode="decimal" autoComplete="off" />
            </label>
            <label>Normal range — high (optional; above → abnormal flag)
              <input value={aRefHigh} onChange={e => setARefHigh(cleanNum(e.target.value))} disabled={busy}
                inputMode="decimal" autoComplete="off" />
            </label>
            <label>Critical low (optional; at or below → critical flag)
              <input value={aCritLow} onChange={e => setACritLow(cleanNum(e.target.value))} disabled={busy}
                inputMode="decimal" autoComplete="off" />
            </label>
            <label>Critical high (optional; at or above → critical flag)
              <input value={aCritHigh} onChange={e => setACritHigh(cleanNum(e.target.value))} disabled={busy}
                inputMode="decimal" autoComplete="off" />
            </label>
          </div>
          <span className="uaconfirm">
            Ranges are optional and drive <b>display flagging only</b> — nothing is fabricated when
            unset, and NEWS2/SOFA never read them. The internal identifier is system-generated.
          </span>
          {formError && <div className="uaerr" role="alert">{formError}</div>}
          <button className="uasubmit" type="submit"
            disabled={busy || !aName.trim() || !aMin.trim() || !aMax.trim()}>
            {busy ? 'Adding…' : 'Add to catalogue'}
          </button>
        </form>
      </Card>
    </div>
  )
}
