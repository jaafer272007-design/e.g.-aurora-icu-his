import { Section, SignatureBlock, WriteIn } from '../primitives'
import type { ConsultReportData } from '../types'
import { displayFullStamp } from '../../../lib/time'

/** Contract #8 — Consultation Report. Specialist consultations in
 *  chronological order, exactly as the aggregated feed carries them —
 *  the canonical consultation store is future scope (contract note), so
 *  the document also rules a write-in for consultations documented on
 *  paper. Nothing is fabricated. */
export function ConsultReport({ data }: { data: ConsultReportData }) {
  const { context, consultEvents } = data
  const mark = context.hasChartedTimes ? ' †' : ''
  return (
    <>
      <Section title={`Consultations on record (chronological)${mark}`}>
        {consultEvents.length === 0 ? (
          <p className="pd-empty">None recorded — the canonical consultation store is future scope (see the Print Center Contract).</p>
        ) : (
          <table className="pd-table">
            <thead><tr><th>Time{mark}</th><th>Consultation</th><th>By</th></tr></thead>
            <tbody>
              {consultEvents.map(e => (
                <tr key={e.id}>
                  <td>{displayFullStamp(e.time)}</td>
                  <td>{e.title}{e.detail ? ` — ${e.detail}` : ''}</td>
                  <td>{e.actor ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Additional consultations (documented on paper)">
        <WriteIn lines={6} />
      </Section>

      <Section title="Compiled by" keepTogether>
        <SignatureBlock role="Physician" />
      </Section>
    </>
  )
}
