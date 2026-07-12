import { FactGrid, Section, SignatureBlock, WriteIn } from '../primitives'
import type { FaceSheetData } from '../types'

/** Contract #1 — Patient Face Sheet. Registration-style identity +
 *  encounter summary: the file-open / transfer banner document. Identity
 *  comes from the shared resolver (roster → patient-identity read →
 *  labeled snapshot); registration fields the system has no store for
 *  (next of kin, contacts, payer) are ruled write-ins, never fabricated. */
export function FaceSheet({ data }: { data: FaceSheetData }) {
  const { context, adtEvents } = data
  const p = context.patient
  const e = context.encounter
  const mark = context.hasChartedTimes ? ' †' : ''
  return (
    <>
      <Section title="Patient identity" keepTogether>
        <FactGrid facts={[
          ['Name', p.name],
          ['Patient ID', p.patientId],
          ['MRN', p.mrn ?? '—'],
          ['Age / Sex', `${p.age ?? '—'} / ${p.sex ?? '—'}`],
          ['Allergies', p.allergies ?? '—'],
          ['Code status', p.codeStatus ?? '—'],
        ]} />
      </Section>

      <Section title="Current encounter" keepTogether>
        {e ? (
          <FactGrid facts={[
            ['Encounter', e.encounterId],
            ['Status', e.status],
            ['Bed', p.bedId],
            ['Admission diagnosis', p.diagnosis],
            ['Attending', p.attending],
            ['Admitted', e.admittedAt ? `${e.admittedAt}${mark} · ${e.admittedBy || '—'}` : '—'],
            ...(e.status === 'discharged'
              ? [['Discharged', `${e.dischargedAt ?? '—'}${mark} · ${e.dischargedBy ?? '—'}`] as [string, string]]
              : []),
          ]} />
        ) : (
          <p className="pd-empty">No encounter resolved for this patient.</p>
        )}
      </Section>

      <Section title={`Encounter events (ADT record)${mark}`}>
        {adtEvents.length === 0 ? <p className="pd-empty">No ADT events recorded (historical seed encounters carry none).</p> : (
          <table className="pd-table">
            <thead><tr><th>Time{mark}</th><th>Event</th><th>By</th><th>Detail</th></tr></thead>
            <tbody>
              {adtEvents.map((ev, i) => (
                <tr key={i}>
                  <td>{ev.time || '—'}</td>
                  <td>{ev.action}</td>
                  <td>{ev.actor || '—'}</td>
                  <td>{ev.detail ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Next of kin / emergency contact (not recorded by the system)">
        <WriteIn lines={3} />
      </Section>

      <Section title="Payer / insurance (not recorded by the system)">
        <WriteIn lines={2} />
      </Section>

      <Section title="Completed by" keepTogether>
        <SignatureBlock role="Staff member" />
      </Section>
    </>
  )
}
