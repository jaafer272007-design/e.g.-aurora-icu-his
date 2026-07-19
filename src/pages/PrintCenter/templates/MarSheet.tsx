import { Section, SignatureBlock } from '../primitives'
import type { MarCell, MarSheetData } from '../types'
import { displayFullStamp } from '../../../lib/time'

/* Contract #11 — Medication Administration Record (Stage 11).
   The record of doses ADMINISTERED — distinct from what was ordered.
   Rows = this encounter's medication orders that carry a dose schedule;
   each medication's own SCHEDULED times are its columns (a q8h drug → 3
   slots, a q4h → 6 — the validator's decision, no uniform grid). Every
   cell renders the PERSISTED administration event: status (given/held/
   refused), the actual documented time, the administering nurse, and
   the reason when a dose was not given (server-required for held/
   refused — the Q4 shape verification). Nothing is fabricated: an
   undocumented slot on an active order prints as awaiting
   documentation. */

const STATUS_LABEL: Record<MarCell['status'], string> = {
  given: 'GIVEN', held: 'HELD', refused: 'REFUSED', scheduled: 'not documented',
}

function Cell({ c }: { c: MarCell }) {
  return (
    <div className={`pd-mar-cell pd-mar-${c.status}`}>
      <div className="pd-mar-slot">{c.scheduledTime || 'PRN'}</div>
      <div className="pd-mar-status">{STATUS_LABEL[c.status]}</div>
      {c.documentedTime && <div className="pd-mar-meta">at {displayFullStamp(c.documentedTime)}</div>}
      {c.documentedBy && <div className="pd-mar-meta">{c.documentedBy}</div>}
      {c.reason && <div className="pd-mar-reason">“{c.reason}”</div>}
    </div>
  )
}

export function MarSheet({ data }: { data: MarSheetData }) {
  const { meds, unscheduledCount } = data
  return (
    <>
      <Section title="Medication administrations — this encounter">
        {meds.length === 0 ? (
          <p className="pd-empty">
            No medication order with a dose schedule exists this encounter — there are no
            administrations to record. (Prescriptions print on the Medication Orders sheet.)
          </p>
        ) : (
          meds.map(m => (
            <div className="pd-mar-med pd-keep" key={m.orderId}>
              <div className="pd-mar-head">
                <b>{m.drug}</b> {m.dose} · {m.route} · {m.prn ? `PRN — ${m.prnIndication ?? 'as required'}` : m.frequency}
                <span className="pd-sub"> {m.orderId}</span>
                {m.status !== 'active' && (
                  <span className="pd-mar-stopped"> · order {m.status}{m.stoppedReason ? ` — ${m.stoppedReason}` : ''}</span>
                )}
              </div>
              <div className="pd-mar-cells">
                {m.cells.length === 0
                  ? <p className="pd-empty">No doses were documented before this order stopped.</p>
                  : m.cells.map(c => <Cell key={c.adminId} c={c} />)}
              </div>
            </div>
          ))
        )}
        {unscheduledCount > 0 && (
          <p className="pd-footnote">
            {unscheduledCount} medication order{unscheduledCount === 1 ? '' : 's'} of this
            encounter carr{unscheduledCount === 1 ? 'ies' : 'y'} no dose schedule (unsigned
            prescription — not in force) and print{unscheduledCount === 1 ? 's' : ''} on the
            Medication Orders sheet, not the MAR.
          </p>
        )}
        <p className="pd-footnote">
          Each slot is the medication&apos;s own scheduled administration time; “PRN” slots are
          as-required availability. GIVEN/HELD/REFUSED cells show the actual documented time
          and the administering nurse exactly as persisted; a reason is recorded whenever a
          dose was held or refused. “not documented” on an active order is a dose still
          awaiting bedside documentation — never assumed given.
        </p>
      </Section>
      <SignatureBlock role="Nurse — shift verification" />
    </>
  )
}
