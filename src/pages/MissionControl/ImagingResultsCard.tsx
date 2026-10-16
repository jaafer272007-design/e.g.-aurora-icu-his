import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card } from '../../components/Card'
import { Badge, type BadgeColor } from '../../components/Badge'
import { DataAge } from '../../components/DataAge'
import { getImagingStudies } from '../../lib/api'
import type { ImagingStatus, ImagingStudy, ResultFlag } from '../../lib/api/types'
import { displayStamp } from '../../lib/time'
import { patientImagingStudies } from './chartResults'
import { useChartRead } from './useChartRead'

/* IMAGING RESULTS (ICU update 2026-10-15, owner's plan §3): the patient's
   recorded studies — GET /api/icu/results/imaging?patientId, the same
   read the Labs & Imaging screen uses — newest first, with their dates,
   status, clinician-marked flag, findings and impression. View only:
   acknowledging, documenting and correcting stay on the existing results
   screen with their existing authorities (results.acknowledge /
   results.document / results.correct), one click away. Gated by the
   caller on results.view — the server's own gate on this read. */

const STATUS_LABEL: Record<ImagingStatus, string> = {
  ordered: 'Ordered', 'in-progress': 'In progress', preliminary: 'Preliminary', final: 'Final',
}
const FLAG_BADGE: Record<ResultFlag, { color: BadgeColor; label: string }> = {
  normal: { color: 'green', label: 'NORMAL' },
  abnormal: { color: 'amber', label: 'ABNORMAL' },
  critical: { color: 'red', label: 'CRITICAL' },
}
const FIRST = 4

export function ImagingResultsCard({ patientId }: { patientId: string }) {
  const navigate = useNavigate()
  const read = useChartRead(patientId, getImagingStudies)
  const [all, setAll] = useState(false)
  const studies = read.state === 'ok' ? patientImagingStudies(read.data, patientId) : []
  const shown = all ? studies : studies.slice(0, FIRST)

  return (
    <Card id="imaging"
      icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--violet)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M8 4v16M3 12h5m8-4c-2 1-2 7 0 8m-3-6h2" /></svg>}
      title="Imaging Results"
      aside={<DataAge at={read.state === 'ok' ? read.at : null} unavailable={read.state === 'error'} what="Imaging results" />}>
      {read.state === 'loading' && <p className="mednone" aria-busy="true">Reading imaging studies…</p>}
      {read.state === 'error' && (
        <p className="chartreaderr" role="status">Imaging results could not be read — this is not a statement that none exist.</p>
      )}
      {read.state === 'ok' && studies.length === 0 && (
        <p className="mednone">No imaging studies recorded for this patient.</p>
      )}
      {shown.length > 0 && (
        <ul className="imlist">
          {shown.map(s => <ImagingRow key={s.studyId} study={s} />)}
        </ul>
      )}
      <div className="cardfoot">
        {studies.length > FIRST
          ? <button className="imall" aria-expanded={all} onClick={() => setAll(a => !a)}>
              {all ? `Show latest ${FIRST}` : `Show all ${studies.length} studies`}
            </button>
          : <span />}
        <button className="obclink" onClick={() => navigate(`/labs/${patientId}`)}>Labs &amp; Imaging →</button>
      </div>
    </Card>
  )
}

function ImagingRow({ study: s }: { study: ImagingStudy }) {
  const [open, setOpen] = useState(false)
  const hasReport = !!(s.report || s.impression)
  const flag = s.flag ? FLAG_BADGE[s.flag] : null
  const reportId = `imr-${s.studyId}`
  return (
    <li className="imrow">
      <div className="imtop">
        <span className="immod">{s.modality}</span>
        <span className="imdesc">{s.description}</span>
        <span className={`imstat st-${s.status}`}>{STATUS_LABEL[s.status]}</span>
        {flag && <Badge color={flag.color}>{flag.label}</Badge>}
      </div>
      <div className="imdates num">
        {s.orderedAt ? <>ordered {displayStamp(s.orderedAt)}</> : <>unlinked report</>}
        {s.performedAt && <> · performed {displayStamp(s.performedAt)}</>}
        {s.reportedAt && <> · reported {displayStamp(s.reportedAt)}</>}
        {s.acknowledged
          ? <> · acknowledged{s.acknowledgedBy ? ` by ${s.acknowledgedBy}` : ''}</>
          : s.reportedAt ? <> · not yet acknowledged</> : null}
      </div>
      {s.impression && <p className="imimp"><b>Impression</b> {s.impression}</p>}
      {!hasReport && <p className="imnone">No report yet.</p>}
      {s.report && (
        <>
          <button className="imtoggle" aria-expanded={open} aria-controls={reportId} onClick={() => setOpen(o => !o)}>
            {open ? 'Hide findings' : 'Read findings'}
          </button>
          {open && (
            <div className="imreport" id={reportId}>
              <p><b>Findings</b> {s.report}</p>
              {s.reportingRadiologist && <p className="imby">Reporting radiologist: {s.reportingRadiologist}</p>}
              {(s.amendments?.length ?? 0) > 0 && <p className="imby">Corrected ×{s.amendments!.length} — see the results screen for the history.</p>}
            </div>
          )}
        </>
      )}
    </li>
  )
}
