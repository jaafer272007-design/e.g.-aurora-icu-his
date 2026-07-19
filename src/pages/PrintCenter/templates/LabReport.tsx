import { Section, SignatureBlock } from '../primitives'
import type { LabReportData } from '../types'
import { displayFullStamp } from '../../../lib/time'

/** Contract #5 — Laboratory Report. Every lab result on the encounter,
 *  oldest → newest, with reference ranges, flags, and the acknowledgment
 *  record exactly as persisted (never-destroy audit: a reversed
 *  acknowledgment shows as unacknowledged with its history retained
 *  server-side). */
export function LabReport({ data }: { data: LabReportData }) {
  const { context, draws } = data
  const mark = context.hasChartedTimes ? ' †' : ''
  return (
    <>
      {draws.length === 0 && (
        <Section title="Laboratory results">
          <p className="pd-empty">No laboratory results recorded this encounter.</p>
        </Section>
      )}
      {draws.map(d => (
        <Section key={d.labId} title={`${d.panel} — collected ${displayFullStamp(d.collectedAt)}${mark} · resulted ${displayFullStamp(d.resultedAt)}${mark}`}>
          <table className="pd-table">
            <thead><tr><th>Analyte</th><th>Value</th><th>Unit</th><th>Reference</th><th>Flag</th></tr></thead>
            <tbody>
              {d.items.map(i => (
                <tr key={i.analyte}>
                  <td>{i.analyte}</td>
                  <td>{i.value}</td>
                  <td>{i.unit || '—'}</td>
                  <td>{i.refRange || '—'}</td>
                  <td className={i.flag !== 'normal' ? 'pd-flag' : undefined}>{i.flag}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="pd-sub">
            {d.labId} · overall flag: {d.flag}
            {d.note ? ` · note: ${d.note}` : ''}
            {' · '}
            {d.acknowledged
              ? `acknowledged by ${d.acknowledgedBy ?? '—'} at ${d.acknowledgedAt ?? '—'}${mark}`
              : 'NOT acknowledged'}
          </p>
        </Section>
      ))}

      <Section title="Reviewed by" keepTogether>
        <SignatureBlock role="Physician" />
      </Section>
    </>
  )
}
