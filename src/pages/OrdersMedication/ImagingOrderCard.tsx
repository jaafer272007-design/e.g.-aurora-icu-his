import { useState } from 'react'
import { Card } from '../../components/Card'
import type { OrderPriority } from '../../lib/api/types'

interface ImagingOrderCardProps {
  /** the study vocabulary — the SAME list the Doctor Workspace "+ Order"
   *  drawer offers (getOrderSets().Imaging: Portable CXR / CT
   *  Abdomen-Pelvis / Bedside Echo), so the two entry points never drift */
  studies: string[]
  onOrder: (study: string, detail: string, priority: OrderPriority, sign: boolean) => void
}

/** Imaging ordering on the CANONICAL ordering screen (hands-on-testing
 *  gap: the dashboard "+ Order" drawer offered Imaging but Orders & Meds
 *  did not — a doctor at the canonical screen could not order imaging).
 *  Places a REAL Imaging-category order through the same createOrders →
 *  POST /api/icu/orders path medications and labs use: full lifecycle
 *  (pending → sign → active → discontinue), audit history, encounter
 *  scoping — the shared Order model, not the drawer's toast-only demo
 *  interaction (that finding is recorded in 02). Study + free-text
 *  indication/detail + urgency, mirroring the drawer's form. */
export function ImagingOrderCard({ studies, onOrder }: ImagingOrderCardProps) {
  const [study, setStudy] = useState('')
  const [detail, setDetail] = useState('')
  const [priority, setPriority] = useState<OrderPriority>('Routine')

  const place = (sign: boolean) => {
    if (!study) return
    onOrder(study, detail.trim(), priority, sign)
    setStudy('')
    setDetail('')
  }

  return (
    <Card
      icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--violet)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="12" cy="12" r="4.5" /><path d="M12 7.5v-2M12 18.5v-2M7.5 12h-2M18.5 12h-2" /></svg>}
      title="Order Imaging"
      aside="same authority as med/lab orders"
    >
      <div className="omimgstudies" role="group" aria-label="Imaging study">
        {studies.map(s => (
          <button
            key={s}
            className={`omimgchip${study === s ? ' on' : ''}`}
            aria-pressed={study === s}
            onClick={() => setStudy(cur => (cur === s ? '' : s))}
          >
            {s}
          </button>
        ))}
      </div>
      <div className="omlabrow">
        <input
          value={detail} onChange={e => setDetail(e.target.value)}
          placeholder="Indication / order detail — e.g. ?consolidation, worsening hypoxia"
          aria-label="Imaging indication or order detail"
          className="omlabsearch"
        />
        <select value={priority} onChange={e => setPriority(e.target.value as OrderPriority)} aria-label="Priority">
          {(['Routine', 'Urgent', 'STAT'] as const).map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      {study ? (
        <div className="omlabhit">
          <span>
            <b>{study}</b>
            <small className="omlabmeta"> · {priority}{detail.trim() ? ` · ${detail.trim()}` : ''}</small>
          </span>
          <span className="omlabacts">
            <button className="btn ghost" onClick={() => place(false)}>Pending</button>
            <button className="btn primary" onClick={() => place(true)}>Sign &amp; order</button>
          </span>
        </div>
      ) : (
        <div className="omempty">Pick a study to order imaging.</div>
      )}
    </Card>
  )
}
