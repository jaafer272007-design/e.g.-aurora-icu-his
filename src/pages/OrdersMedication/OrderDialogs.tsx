import { useEffect, useRef, useState } from 'react'
import { formatNormalised } from '../../lib/infusion'
import type { InfusionDose, MedicationDetails, Order } from '../../lib/api/types'

/* Modify / Discontinue dialogs — both require a documented reason
   (locked to doctor RBAC; the reason lands in the order's audit history). */

interface ModifyDialogProps {
  order: Order
  onCancel: () => void
  onConfirm: (changes: Partial<MedicationDetails>, reason: string) => void
}

export function ModifyDialog({ order, onCancel, onConfirm }: ModifyDialogProps) {
  const m = order.medication!
  /* STRUCTURED INFUSION: an order that carries a structured dose is
     modified through the SAME structured fields — the display dose text
     derives from them server-side (a free-text dose change on such an
     order is rejected; frequency stays 'continuous'). */
  const inf = m.infusion ?? null
  const [dose, setDose] = useState(m.dose)
  const [infValue, setInfValue] = useState(inf ? String(inf.value) : '')
  const [infUnit, setInfUnit] = useState<'mcg' | 'mg'>(inf?.massUnit ?? 'mcg')
  const [infTime, setInfTime] = useState<'min' | 'hour'>(inf?.timeBasis ?? 'min')
  const [route, setRoute] = useState(m.route)
  const [frequency, setFrequency] = useState(m.frequency)
  const [duration, setDuration] = useState(m.duration)
  const [reason, setReason] = useState('')
  const firstRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    firstRef.current?.focus()
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onCancel])

  const infParsed = /^\d+(\.\d{1,4})?$/.test(infValue.trim()) ? Number(infValue.trim()) : NaN
  const infOk = Number.isFinite(infParsed) && infParsed > 0 && infParsed <= 100000
  const newInf: InfusionDose | null = inf && infOk
    ? { value: infParsed, massUnit: infUnit, timeBasis: infTime }
    : null
  const infChanged = !!inf && !!newInf
    && (newInf.value !== inf.value || newInf.massUnit !== inf.massUnit || newInf.timeBasis !== inf.timeBasis)

  const changes: Partial<MedicationDetails> = {}
  if (!inf && dose !== m.dose) changes.dose = dose
  if (infChanged && newInf) changes.infusion = newInf
  if (route !== m.route) changes.route = route
  if (frequency !== m.frequency) changes.frequency = frequency
  if (duration !== m.duration) changes.duration = duration
  const canSave = reason.trim().length > 0 && Object.keys(changes).length > 0
    && (!inf || infOk)

  return (
    <div className="omscrim" onClick={onCancel}>
      <div className="omdialog" role="dialog" aria-modal="true" aria-labelledby="modTitle" onClick={e => e.stopPropagation()}>
        <h2 id="modTitle">Modify Order · <span className="num">{order.orderId}</span></h2>
        <p className="omdsub">{m.drug} — changes are recorded in the audit history.</p>
        <div className="omgrid2">
          {inf ? (
            <div className="field omspan2">
              <label htmlFor="modInfVal">Infusion dose (structured — per kg)</label>
              <div className="ominfrow">
                <input ref={firstRef} className="ominfval num" id="modInfVal" value={infValue} inputMode="decimal"
                  onChange={e => setInfValue(e.target.value)} aria-label="Infusion dose value (up to 4 decimals)" />
                <select value={infUnit} onChange={e => setInfUnit(e.target.value as 'mcg' | 'mg')} aria-label="Mass unit">
                  <option value="mcg">µg</option>
                  <option value="mg">mg</option>
                </select>
                <span className="ominfper">/ kg /</span>
                <select value={infTime} onChange={e => setInfTime(e.target.value as 'min' | 'hour')} aria-label="Time basis">
                  <option value="min">min</option>
                  <option value="hour">hour</option>
                </select>
                {newInf && <span className="ominfnorm num">normalised {formatNormalised(newInf)}</span>}
              </div>
            </div>
          ) : (
            <div className="field"><label htmlFor="modDose">Dose</label><input ref={firstRef} id="modDose" value={dose} onChange={e => setDose(e.target.value)} /></div>
          )}
          <div className="field"><label htmlFor="modRoute">Route</label><input id="modRoute" value={route} onChange={e => setRoute(e.target.value)} /></div>
          <div className="field"><label htmlFor="modFreq">Frequency</label><input id="modFreq" value={frequency} disabled={!!inf} onChange={e => setFrequency(e.target.value)} /></div>
          <div className="field"><label htmlFor="modDur">Duration</label><input id="modDur" value={duration} onChange={e => setDuration(e.target.value)} /></div>
        </div>
        <div className="field">
          <label htmlFor="modReason">Reason for change (required)</label>
          <textarea id="modReason" value={reason} placeholder="e.g. MAP persistently < 65 despite current dose…" onChange={e => setReason(e.target.value)} />
        </div>
        <div className="omdfoot">
          <button className="btn ghost" onClick={onCancel}>Cancel</button>
          <button className="btn primary" disabled={!canSave} onClick={() => onConfirm(changes, reason)}>
            Save Changes
          </button>
        </div>
        {!canSave && <p className="omhint">A field change and a reason are both required.</p>}
      </div>
    </div>
  )
}

interface DiscontinueDialogProps {
  order: Order
  onCancel: () => void
  onConfirm: (reason: string) => void
}

export function DiscontinueDialog({ order, onCancel, onConfirm }: DiscontinueDialogProps) {
  const [reason, setReason] = useState('')
  const taRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    taRef.current?.focus()
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onCancel])

  return (
    <div className="omscrim" onClick={onCancel}>
      <div className="omdialog" role="dialog" aria-modal="true" aria-labelledby="dcTitle" onClick={e => e.stopPropagation()}>
        <h2 id="dcTitle">Discontinue Order · <span className="num">{order.orderId}</span></h2>
        <p className="omdsub">{order.summary}</p>
        <p className="omdwarn">⚠ Remaining scheduled administrations will be cancelled. This is recorded in the audit history.</p>
        <div className="field">
          <label htmlFor="dcReason">Reason for discontinuation (required)</label>
          <textarea ref={taRef} id="dcReason" value={reason} placeholder="e.g. Culture sensitivities returned — de-escalating…" onChange={e => setReason(e.target.value)} />
        </div>
        <div className="omdfoot">
          <button className="btn ghost" onClick={onCancel}>Cancel</button>
          <button className="btn danger" disabled={!reason.trim()} onClick={() => onConfirm(reason)}>
            ⊘ Discontinue Order
          </button>
        </div>
      </div>
    </div>
  )
}
