import { FactGrid, Section, SignatureBlock } from '../primitives'
import type { ImagingReportData } from '../types'
import { displayFullStamp } from '../../../lib/time'

/** Contract #6 — Imaging Report. Every imaging study on the encounter
 *  with its report/impression text exactly as persisted, its status
 *  progression, and the acknowledgment record. A study without a report
 *  yet prints its status honestly — text is never fabricated. */
export function ImagingReport({ data }: { data: ImagingReportData }) {
  const { context, studies } = data
  const mark = context.hasChartedTimes ? ' †' : ''
  return (
    <>
      {studies.length === 0 && (
        <Section title="Imaging studies">
          <p className="pd-empty">No imaging studies recorded this encounter.</p>
        </Section>
      )}
      {studies.map(x => (
        <Section key={x.studyId} title={`${x.modality} — ${x.description}`}>
          <FactGrid facts={[
            ['Study', x.studyId],
            ['Status', x.status],
            ['Ordered', `${x.orderedAt}${mark}`],
            ['Performed', x.performedAt ? `${displayFullStamp(x.performedAt)}${mark}` : '—'],
            ['Reported', x.reportedAt ? `${x.reportedAt}${mark}` : '—'],
            ['Flag', x.flag],
          ]} />
          {x.report && <p className="pd-body">{x.report}</p>}
          {x.impression && <p className="pd-body"><b>Impression:</b> {x.impression}</p>}
          {!x.report && !x.impression && <p className="pd-empty">No report text yet ({x.status}).</p>}
          <p className="pd-sub">
            {x.acknowledged
              ? `acknowledged by ${x.acknowledgedBy ?? '—'} at ${x.acknowledgedAt ?? '—'}${mark}`
              : 'NOT acknowledged'}
            {x.note ? ` · note: ${x.note}` : ''}
          </p>
        </Section>
      ))}

      <Section title="Reviewed by" keepTogether>
        <SignatureBlock role="Physician" />
      </Section>
    </>
  )
}
