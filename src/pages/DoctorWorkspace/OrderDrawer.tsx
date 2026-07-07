import { useEffect, useRef, useState } from 'react'
import type { OrderSetsResponse, OrderType, RoundingPatient } from '../../lib/api/types'

const ORDER_TYPES: OrderType[] = ['Medication', 'Lab', 'Imaging', 'Nursing']

interface OrderDrawerProps {
  open: boolean
  patients: RoundingPatient[]
  orderSets: OrderSetsResponse | null
  /** patient name to pre-select (from a rounding-card "+ Order" button) */
  forName?: string
  onClose: () => void
  onSign: (orderType: OrderType, patientLabel: string) => void
}

/** Quick-order slide-in drawer (RBAC: physicians only — full order authority). */
export function OrderDrawer({ open, patients, orderSets, forName, onClose, onSign }: OrderDrawerProps) {
  const [orderType, setOrderType] = useState<OrderType>('Medication')
  const [patient, setPatient] = useState('')
  const [detail, setDetail] = useState('')
  const [priority, setPriority] = useState('Routine')
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const preset = patients.find(x => x.name === forName) ?? patients[0]
    if (preset) setPatient(`${preset.name} — ${preset.bedId}`)
    closeRef.current?.focus()
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [open, forName, patients, onClose])

  const appendSet = (s: string) => setDetail(v => (v ? `${v}\n${s}` : s).trim())

  return (
    <>
      <div className={`scrim${open ? ' show' : ''}`} onClick={onClose} />
      <div className={`drawer${open ? ' show' : ''}`} role="dialog" aria-labelledby="drawerTitle" aria-modal="true" aria-hidden={!open}>
        <div className="dhead">
          <h2 id="drawerTitle">New Order</h2>
          <button ref={closeRef} className="x" aria-label="Close new order panel" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="dbody">
          <div className="field">
            <label htmlFor="ordPatient">Patient</label>
            <select id="ordPatient" value={patient} onChange={e => setPatient(e.target.value)}>
              {patients.map(x => <option key={x.bedId}>{x.name} — {x.bedId}</option>)}
            </select>
          </div>
          <div className="field">
            <label id="otLabel">Order Type</label>
            <div className="ordertype" role="group" aria-labelledby="otLabel">
              {ORDER_TYPES.map(t => (
                <button key={t} className={`otbtn${t === orderType ? ' on' : ''}`} aria-pressed={t === orderType} onClick={() => setOrderType(t)}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label id="qsLabel">Quick Order Sets</label>
            <div className="qsets" role="group" aria-labelledby="qsLabel">
              {(orderSets?.[orderType] ?? []).map(s => (
                <button key={s} className="qset" onClick={() => appendSet(s)}>{s}</button>
              ))}
            </div>
          </div>
          <div className="field">
            <label htmlFor="ordDetail">Order Detail</label>
            <textarea
              id="ordDetail" placeholder="e.g. Noradrenaline titrate to MAP ≥65, max 0.5 µg/kg/min"
              value={detail} onChange={e => setDetail(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="ordPriority">Priority</label>
            <select id="ordPriority" value={priority} onChange={e => setPriority(e.target.value)}>
              <option>Routine</option><option>Urgent</option><option>STAT</option>
            </select>
          </div>
        </div>
        <div className="dfoot">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={() => { onSign(orderType, patient || 'patient'); setDetail('') }}>
            Sign &amp; Submit
          </button>
        </div>
      </div>
    </>
  )
}
