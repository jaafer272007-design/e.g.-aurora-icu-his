import { MedTable, Section, SignatureBlock, WriteIn } from '../primitives'
import type { SbarData } from '../types'

/** Contract #7 — Nursing Notes / SBAR. Handoff/receive sheet: real
 *  identity + encounter + active-medication context, the nursing events
 *  the aggregated feed carries, and ruled S/B/A/R write-ins — the
 *  canonical nursing-notes store is future scope (contract note), so
 *  narrative is written by hand, never fabricated. */
export function SbarSheet({ data }: { data: SbarData }) {
  const { context, activeMeds, nursingEvents } = data
  const mark = context.hasChartedTimes ? ' †' : ''
  return (
    <>
      <Section title="Situation" keepTogether>
        <p>{context.patient.name} · {context.patient.bedId} · {context.patient.diagnosis}</p>
        <WriteIn lines={2} />
      </Section>

      <Section title="Background">
        <WriteIn lines={3} />
      </Section>

      <Section title="Assessment">
        <WriteIn lines={4} />
      </Section>

      <Section title="Recommendation">
        <WriteIn lines={3} />
      </Section>

      <Section title={`Active medications (context)${mark}`}>
        <MedTable meds={activeMeds} chartedMark={mark} />
      </Section>

      <Section title={`Recent nursing documentation on record${mark}`}>
        {nursingEvents.length === 0 ? (
          <p className="pd-empty">None recorded — the canonical nursing-notes store is future scope (see the Print Center Contract).</p>
        ) : (
          <table className="pd-table">
            <thead><tr><th>Time{mark}</th><th>Entry</th><th>By</th></tr></thead>
            <tbody>
              {nursingEvents.map(e => (
                <tr key={e.id}>
                  <td>{e.time}</td>
                  <td>{e.categoryLabel}: {e.title}{e.detail ? ` — ${e.detail}` : ''}</td>
                  <td>{e.actor ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Handing over / receiving" keepTogether>
        <SignatureBlock role="Nurse handing over" />
        <SignatureBlock role="Nurse receiving" />
      </Section>
    </>
  )
}
