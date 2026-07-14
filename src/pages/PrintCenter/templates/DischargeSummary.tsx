import { FactGrid, MedTable, Section, SignatureBlock, WriteIn } from '../primitives'
import type { DischargeSummaryData } from '../types'
import { dispositionLabel } from '../../../lib/api'

/** Template 3 — Discharge Summary. The medication sections are the
 *  historical-rendering guarantee in action: "medications at discharge"
 *  are identified purely from the persisted discharge-cascade audit
 *  reason on each order (or still-active orders when printed before
 *  discharge), and every drug renders from the order's own stored text.
 *  The live formulary is NEVER consulted — deactivating a drug after
 *  discharge must not change this document. */
export function DischargeSummary({ data }: { data: DischargeSummaryData }) {
  const {
    context, admissionDiagnosis, dischargeMeds, stoppedMeds, medicationChanges,
    labCount, imagingCount, medOrderCount, encounterEvents,
  } = data
  const mark = context.hasChartedTimes ? ' †' : ''
  const enc = context.encounter
  return (
    <>
      <Section title="Admission diagnosis" keepTogether>
        <p>{admissionDiagnosis}</p>
      </Section>

      <Section title="Final diagnosis">
        <WriteIn lines={2} prefill={`Working diagnosis at discharge: ${context.patient.diagnosis}`} />
      </Section>

      <Section title={`Hospital course${mark}`}>
        <FactGrid facts={[
          ['Admitted', `${enc?.admittedAt || '—'}${enc?.admittedBy ? ` · ${enc.admittedBy}` : ''}`],
          ['Discharged', enc?.status === 'discharged' ? `${enc.dischargedAt || '—'}${enc.dischargedBy ? ` · ${enc.dischargedBy}` : ''}` : 'encounter still open — printed before discharge'],
          /* the recorded stay OUTCOME — honest when absent (pre-feature
             discharges recorded none; a value is never fabricated) */
          ['Disposition', enc?.status === 'discharged'
            ? (dispositionLabel(enc.disposition) || 'not recorded')
            : 'encounter still open'],
          ['Medication orders', medOrderCount],
          ['Laboratory results', labCount],
          ['Imaging studies', imagingCount],
        ]} />
        {encounterEvents.length > 0 && (
          <table className="pd-table">
            <thead><tr><th>Time{mark}</th><th>Encounter event</th><th>By</th></tr></thead>
            <tbody>
              {encounterEvents.map((e, i) => (
                <tr key={i}><td>{e.time || '—'}</td><td>{e.action}{e.detail ? ` — ${e.detail}` : ''}</td><td>{e.actor || '—'}</td></tr>
              ))}
            </tbody>
          </table>
        )}
        <WriteIn lines={5} />
      </Section>

      <Section title="Major procedures">
        <WriteIn lines={2} />
      </Section>

      <Section title={`Medications at discharge${mark}`}>
        <p className="pd-sub">
          Orders active at the moment of discharge, identified from the persisted discharge-cascade
          audit record on each order{enc?.status === 'open' ? ' (encounter still open: currently active orders shown)' : ''} —
          rendered from the order record as originally written, never from the live formulary.
        </p>
        <MedTable meds={dischargeMeds} chartedMark={mark} />
      </Section>

      <Section title={`Medications stopped during admission${mark}`}>
        <MedTable meds={stoppedMeds} showStopped chartedMark={mark} />
      </Section>

      <Section title={`Medication changes during admission${mark}`}>
        {medicationChanges.length === 0 ? <p className="pd-empty">None recorded.</p> : (
          <table className="pd-table">
            <thead><tr><th>Time{mark}</th><th>Medication</th><th>Change</th><th>By</th></tr></thead>
            <tbody>
              {medicationChanges.map((c, i) => (
                <tr key={i}><td>{c.time}</td><td>{c.drug}<span className="pd-sub"> {c.orderId}</span></td><td>{c.detail}</td><td>{c.actor}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Follow-up recommendations">
        <WriteIn lines={3} />
      </Section>

      <Section title="Condition and destination at discharge" keepTogether>
        <WriteIn lines={2} />
      </Section>

      <Section title="Responsible physician" keepTogether>
        <p>{context.patient.attending}</p>
        <SignatureBlock role="Responsible physician" />
      </Section>
    </>
  )
}
