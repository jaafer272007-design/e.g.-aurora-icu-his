import { FactGrid, MedTable, pv, Section, SignatureBlock, WriteIn } from '../primitives'
import type { AdmissionNoteData } from '../types'

/** Template 1 — ICU Admission Note. Structured fields render from the
 *  stores; narrative sections the system has no canonical store for
 *  (past history, initial assessment, plan) print as ruled write-in
 *  areas rather than fabricated content. */
export function AdmissionNote({ data }: { data: AdmissionNoteData }) {
  const { context, vitals, medicationOrders, investigations } = data
  const mark = context.hasChartedTimes ? ' †' : ''
  return (
    <>
      <Section title="Reason for ICU admission">
        <WriteIn lines={2} prefill={`Admission diagnosis: ${context.patient.diagnosis}`} />
      </Section>

      <Section title="Past medical history">
        <WriteIn lines={4} />
      </Section>

      <Section title="Allergies" keepTogether>
        <p className="pd-allergy">{context.patient.allergies ?? '— not in the encounter record'}</p>
      </Section>

      <Section title="Vital signs on admission review (bedside snapshot as of printing)" keepTogether>
        {vitals ? (
          <FactGrid facts={[
            ['HR', pv(vitals.bedside.hr, '/min')],
            ['MAP', pv(vitals.bedside.map, 'mmHg')],
            ['BP', vitals.monitor.sys === null && vitals.monitor.dia === null
              ? '— not charted'
              : `${vitals.monitor.sys ?? '—'}/${vitals.monitor.dia ?? '—'} mmHg`],
            ['SpO₂', pv(vitals.bedside.spo2, '%')],
            ['RR', pv(vitals.monitor.rr, '/min')],
            ['Temp', pv(vitals.bedside.temp, '°C')],
            ['Urine output', pv(vitals.bedside.uo, 'mL')],
            ['Rhythm', vitals.rhythm],
            ['SOFA', vitals.sofa],
            ['EWS', vitals.ews],
            ['Support', vitals.flags.length ? vitals.flags.join(', ') : 'none'],
          ]} />
        ) : (
          <p className="pd-empty">No bedside snapshot — the patient is not on the active roster.</p>
        )}
      </Section>

      <Section title="Initial assessment">
        <WriteIn lines={5} />
      </Section>

      <Section title={`Medication orders this encounter${mark}`}>
        <MedTable meds={medicationOrders} chartedMark={mark} />
      </Section>

      <Section title={`Initial investigations ordered${mark}`}>
        {investigations.length === 0 ? <p className="pd-empty">None recorded.</p> : (
          <table className="pd-table">
            <thead><tr><th>Order</th><th>Category</th><th>Priority</th><th>Ordered{mark}</th><th>Status</th></tr></thead>
            <tbody>
              {investigations.map(o => (
                <tr key={o.orderId}>
                  <td>{o.summary}<span className="pd-sub"> {o.orderId}</span></td>
                  <td>{o.category}</td>
                  <td>{o.priority}</td>
                  <td>{o.orderedTime} · {o.orderedBy}</td>
                  <td>{o.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Plan">
        <WriteIn lines={6} />
      </Section>

      <Section title="Physician" keepTogether>
        <SignatureBlock role="Admitting physician" />
      </Section>
    </>
  )
}
