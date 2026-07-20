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
  onOrder: (study: ImagingStudyDef, region: string, contrast: boolean,
    detail: string, priority: OrderPriority, sign: boolean) => void
}

/** Imaging ordering on the CANONICAL ordering screen — the CORRECTED
 *  clinical model: the catalogue holds only the study (modality + name);
 *  the ORDER carries the specifics. The doctor picks the study, TYPES the
 *  body region free-text (head / chest / left knee — no rules, no managed
 *  list) and ticks ONE contrast checkbox (ticked = with contrast; no
 *  separate "without" option — absence IS plain). The order renders as
 *  the assembled description: "CT — head — with contrast". */
export function ImagingOrderCard({ studies, onOrder }: ImagingOrderCardProps) {
  const [studyId, setStudyId] = useState('')
  const [region, setRegion] = useState('')
  const [contrast, setContrast] = useState(false)
  const [detail, setDetail] = useState('')
  const [priority, setPriority] = useState<OrderPriority>('Routine')

  const selected = (studies ?? []).find(s => s.studyId === studyId)

  const place = (sign: boolean) => {
    if (!selected) return
    onOrder(selected, region.trim(), contrast, detail.trim(), priority, sign)
    setStudyId('')
    setRegion('')
    setContrast(false)
    setDetail('')
  }

  /* the assembled description, exactly as it will read on the order */
  const assembled = selected
    ? [selected.name, region.trim() || null, contrast ? 'with contrast' : null]
      .filter(Boolean).join(' — ')
    : ''

  return (
    <Card
      icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--violet)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="12" cy="12" r="4.5" /><path d="M12 7.5v-2M12 18.5v-2M7.5 12h-2M18.5 12h-2" /></svg>}
      title="Order Imaging"
      aside="study from the catalogue · specifics at order time"
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
                title={s.modality}
                onClick={() => setStudyId(cur => (cur === s.studyId ? '' : s.studyId))}
              >
                {s.name}
              </button>
            ))}
          </div>
          <div className="omlabrow">
            <input
              value={region} onChange={e => setRegion(e.target.value)}
              placeholder="Body region — e.g. head, chest, left knee"
              aria-label="Body region (free text)"
              className="omlabsearch"
            />
            <label className="omimgcontrast">
              <input
                type="checkbox" checked={contrast}
                onChange={e => setContrast(e.target.checked)}
                aria-label="With contrast"
              />
              {' '}with contrast
            </label>
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
                <b>{assembled}</b>
                <small className="omlabmeta"> · {selected.modality} · {priority}{detail.trim() ? ` · ${detail.trim()}` : ''}</small>
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
