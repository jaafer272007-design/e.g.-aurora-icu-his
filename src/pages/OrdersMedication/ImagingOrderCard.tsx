import { useState } from 'react'
import { Card } from '../../components/Card'
import type { ImagingStudyDef, OrderPriority } from '../../lib/api/types'

interface ImagingOrderCardProps {
  /** ACTIVE studies from the REAL Imaging Catalogue (the third
   *  Configuration tenant) — the retired ORDER_SETS.Imaging mock nulled
   *  out in production and blocked production imaging ordering entirely.
   *  null = the catalogue service is unreachable (honest unavailable —
   *  never a fabricated list). */
  studies: ImagingStudyDef[] | null
  onOrder: (study: ImagingStudyDef, detail: string, priority: OrderPriority, sign: boolean) => void
}

/** Imaging ordering on the CANONICAL ordering screen. Places a REAL
 *  Imaging-category order through the same createOrders → POST
 *  /api/icu/orders path medications and labs use — now CODED: the order
 *  carries the catalogue studyId (the order half of the order→report
 *  linkage; #105 built the report half) and its summary snapshots the
 *  study name at order time. Study + free-text indication + urgency. */
export function ImagingOrderCard({ studies, onOrder }: ImagingOrderCardProps) {
  const [studyId, setStudyId] = useState('')
  const [detail, setDetail] = useState('')
  const [priority, setPriority] = useState<OrderPriority>('Routine')

  const selected = (studies ?? []).find(s => s.studyId === studyId)

  const place = (sign: boolean) => {
    if (!selected) return
    onOrder(selected, detail.trim(), priority, sign)
    setStudyId('')
    setDetail('')
  }

  return (
    <Card
      icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--violet)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="12" cy="12" r="4.5" /><path d="M12 7.5v-2M12 18.5v-2M7.5 12h-2M18.5 12h-2" /></svg>}
      title="Order Imaging"
      aside="same authority as med/lab orders"
    >
      {studies === null ? (
        <div className="omempty">
          The imaging catalogue is unavailable — check the AURORA service. Imaging is ordered from
          the hospital&apos;s managed catalogue (Configuration), never a typed study.
        </div>
      ) : studies.length === 0 ? (
        <div className="omempty">
          No active imaging studies in the catalogue — add the hospital&apos;s studies in
          Configuration.
        </div>
      ) : (
        <>
          <div className="omimgstudies" role="group" aria-label="Imaging study">
            {studies.map(s => (
              <button
                key={s.studyId}
                className={`omimgchip${studyId === s.studyId ? ' on' : ''}`}
                aria-pressed={studyId === s.studyId}
                title={`${s.modality}${s.region ? ` · ${s.region}` : ''}${s.contrast ? ' · contrast' : ''}${s.portable ? ' · portable' : ''}`}
                onClick={() => setStudyId(cur => (cur === s.studyId ? '' : s.studyId))}
              >
                {s.name}
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
          {selected ? (
            <div className="omlabhit">
              <span>
                <b>{selected.name}</b>
                <small className="omlabmeta"> · {selected.modality}{selected.contrast ? ' · contrast' : ''}{selected.portable ? ' · portable' : ''} · {priority}{detail.trim() ? ` · ${detail.trim()}` : ''}</small>
              </span>
              <span className="omlabacts">
                <button className="btn ghost" onClick={() => place(false)}>Pending</button>
                <button className="btn primary" onClick={() => place(true)}>Sign &amp; order</button>
              </span>
            </div>
          ) : (
            <div className="omempty">Pick a study to order imaging.</div>
          )}
        </>
      )}
    </Card>
  )
}
