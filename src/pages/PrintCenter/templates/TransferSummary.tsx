import { FactGrid, MedTable, Section, SignatureBlock, WriteIn } from '../primitives'
import type { TransferSummaryData } from '../types'

/** Contract #9 — Transfer / Referral Summary. For moving the patient to
 *  another unit or hospital: identity through the canonical resolver,
 *  the encounter's ADT record, active medications at the moment of
 *  printing, the latest result per lab panel, and ruled write-ins for
 *  the clinical narrative the receiving team needs (reason, condition
 *  at transfer, report given to). */
export function TransferSummary({ data }: { data: TransferSummaryData }) {
  const { context, activeMeds, latestLabs, adtEvents } = data
  const p = context.patient
  const mark = context.hasChartedTimes ? ' †' : ''
  return (
    <>
      <Section title="Patient & current admission" keepTogether>
        <FactGrid facts={[
          ['Name', p.name],
          ['MRN', p.mrn ?? '—'],
          ['Age / Sex', `${p.age ?? '—'} / ${p.sex ?? '—'}`],
          ['Allergies', p.allergies ?? '—'],
          ['Diagnosis', p.diagnosis],
          ['Attending', p.attending],
          ['Bed', p.bedId],
          ['Code status', p.codeStatus ?? 'Not recorded'],
        ]} />
      </Section>

      <Section title="Reason for transfer / referral">
        <WriteIn lines={3} />
      </Section>

      <Section title="Receiving unit / hospital & accepting clinician">
        <WriteIn lines={2} />
      </Section>

      <Section title={`Active medications at transfer${mark}`}>
        <MedTable meds={activeMeds} chartedMark={mark} />
      </Section>

      <Section title={`Latest laboratory results (per panel)${mark}`}>
        {latestLabs.length === 0 ? <p className="pd-empty">No results recorded this encounter.</p> : (
          <table className="pd-table">
            <thead><tr><th>Panel</th><th>Resulted{mark}</th><th>Flag</th><th>Key values</th></tr></thead>
            <tbody>
              {latestLabs.map(d => (
                <tr key={d.labId}>
                  <td>{d.panel}<span className="pd-sub"> {d.labId}</span></td>
                  <td>{d.resultedAt}</td>
                  <td className={d.flag !== 'normal' ? 'pd-flag' : undefined}>{d.flag}</td>
                  <td>
                    {(d.items.filter(i => i.flag !== 'normal').length ? d.items.filter(i => i.flag !== 'normal') : d.items)
                      .slice(0, 5)
                      .map(i => `${i.analyte} ${i.value} ${i.unit}`.trim())
                      .join(' · ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title={`ADT record this encounter${mark}`} keepTogether>
        {adtEvents.length === 0 ? <p className="pd-empty">No ADT events recorded.</p> : (
          <ul className="pd-list">
            {adtEvents.map((ev, i) => (
              <li key={i}>{ev.time || '—'} — {ev.action}{ev.detail ? ` (${ev.detail})` : ''} · {ev.actor || '—'}</li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Condition at transfer">
        <WriteIn lines={3} />
      </Section>

      <Section title="Report given to / handover" keepTogether>
        <WriteIn lines={2} />
        <SignatureBlock role="Transferring physician" />
      </Section>
    </>
  )
}
