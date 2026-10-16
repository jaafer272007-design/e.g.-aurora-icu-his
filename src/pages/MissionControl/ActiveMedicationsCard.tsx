import { useNavigate } from 'react-router-dom'
import { Card } from '../../components/Card'
import { DataAge } from '../../components/DataAge'
import { getPatientOrders } from '../../lib/api'
import { displayStamp } from '../../lib/time'
import { activeMedicationOrders, KIND_LABEL, KIND_ORDER, medicationKind, signedTimeOf } from './chartResults'
import { useChartRead } from './useChartRead'

/* ACTIVE MEDICATION ORDERS (ICU update 2026-10-15, owner's plan §3 —
   replaces "Active Infusions"): the patient's canonical ACTIVE medication
   prescriptions from the orders domain (GET /api/icu/orders?patientId —
   the same canonical store Orders & Meds and the MAR derive from).
   Scheduled, PRN and continuous medicines, each ORDER its own row with
   its ordered dose, route and frequency — two orders for the same drug
   stay two rows. Pending (unsigned), completed and discontinued
   prescriptions are not active and are not listed.

   Ordered facts only: no pump rate, no running state, no trend — those
   are device facts with no source until the Device Adapter (the retired
   card's demo pump fixture is not carried over). A read that fails says
   so; it never becomes "no active medications".

   This is the chart's medication SUMMARY for the roles that view it; it is
   not the nurse's administration card (the nurse documents doses on the
   MAR cards, never here). Gated by the caller on orders.view — the
   server's own gate on this read. */
export function ActiveMedicationsCard({ patientId }: { patientId: string }) {
  const navigate = useNavigate()
  const read = useChartRead(patientId, getPatientOrders)
  const rows = read.state === 'ok' ? activeMedicationOrders(read.data, patientId) : []

  return (
    <Card id="meds"
      icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="7" y="2" width="10" height="20" rx="4" /><path d="M7 9h10M7 15h10" /></svg>}
      title="Active Medication Orders"
      aside={<DataAge at={read.state === 'ok' ? read.at : null} unavailable={read.state === 'error'} what="Medication orders" />}>
      {read.state === 'loading' && <p className="mednone" aria-busy="true">Reading medication orders…</p>}
      {read.state === 'error' && (
        <p className="chartreaderr" role="status">Medication orders could not be read — this is not a statement that none are active.</p>
      )}
      {read.state === 'ok' && rows.length === 0 && (
        /* a REAL empty — the orders domain answered and holds no active
           medication prescription for this patient */
        <p className="mednone">No active medication orders for this patient.</p>
      )}
      {read.state === 'ok' && rows.length > 0 && (
        <div className="amlist">
          {KIND_ORDER.map(kind => {
            const group = rows.filter(o => medicationKind(o) === kind)
            if (group.length === 0) return null
            return (
              <div className="amgroup" key={kind}>
                <div className="amghead">{KIND_LABEL[kind]} <span className="num">{group.length}</span></div>
                <ul>
                  {group.map(o => {
                    const m = o.medication!
                    const signed = signedTimeOf(o)
                    return (
                      <li className="amrow" key={o.orderId}>
                        <div className="amtop">
                          <span className="amdrug">{m.drug}</span>
                          <span className={`amkind k-${kind}`}>{KIND_LABEL[kind]}</span>
                          {o.priority !== 'Routine' && <span className="ampri">{o.priority}</span>}
                        </div>
                        <div className="amdose num">
                          {m.dose} · {m.route} · {m.prn ? `PRN${m.prnIndication ? ` — ${m.prnIndication}` : ''}` : m.frequency}
                          {m.duration && m.duration !== 'ongoing' && m.duration !== m.frequency ? ` · ${m.duration}` : ''}
                        </div>
                        <div className="ammeta">
                          {o.orderedBy}{signed ? ` · signed ${displayStamp(signed)}` : ''} · <span className="num">{o.orderId}</span>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })}
        </div>
      )}
      <div className="cardfoot">
        <span>Prescribed facts only — pump rates appear with device integration.</span>
        <button className="obclink" onClick={() => navigate(`/orders/${patientId}`)}>Orders &amp; Meds →</button>
      </div>
    </Card>
  )
}
