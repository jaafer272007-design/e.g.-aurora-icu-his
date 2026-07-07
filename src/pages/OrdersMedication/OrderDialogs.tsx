import { useEffect, useRef, useState } from 'react'
import type { MedicationDetails, Order } from '../../lib/api/types'

/* Modify / Discontinue dialogs — both require a documented reason
   (locked to doctor RBAC; the reason lands in the order's audit history). */

interface ModifyDialogProps {
  order: Order
  onCancel: () => void
  onConfirm: (changes: Partial<MedicationDetails>, reason: string) => void
}

export function ModifyDialog({ order, onCancel, onConfirm }: ModifyDialogProps) {
  const m = order.medication!
  const [dose, setDose] = useState(m.dose)
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

  const changes: Partial<MedicationDetails> = {}
  if (dose !== m.dose) changes.dose = dose
  if (route !== m.route) changes.route = route
  if (frequency !== m.frequency) changes.frequency = frequency
  if (duration !== m.duration) changes.duration = duration
  const canSave = reason.trim().length > 0 && Object.keys(changes).length > 0

  return (
    <div className="omscrim" onClick={onCancel}>
      <div className="omdialog" role="dialog" aria-modal="true" aria-labelledby="modTitle" onClick={e => e.stopPropagation()}>
        <h2 id="modTitle">Modify Order · <span className="num">{order.orderId}</span></h2>
        <p className="omdsub">{m.drug} — changes are recorded in the audit history.</p>
        <div className="omgrid2">
          <div className="field"><label htmlFor="modDose">Dose</label><input ref={firstRef} id="modDose" value={dose} onChange={e => setDose(e.target.value)} /></div>
          <div className="field"><label htmlFor="modRoute">Route</label><input id="modRoute" value={route} onChange={e => setRoute(e.target.value)} /></div>
          <div className="field"><label htmlFor="modFreq">Frequency</label><input id="modFreq" value={frequency} onChange={e => setFrequency(e.target.value)} /></div>
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
