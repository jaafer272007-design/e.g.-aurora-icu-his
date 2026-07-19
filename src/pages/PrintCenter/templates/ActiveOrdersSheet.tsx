import { Section, SignatureBlock } from '../primitives'
import type { ActiveOrdersData, PrintOrderLine } from '../types'
import { displayFullStamp } from '../../../lib/time'

function OrderTable({ orders, mark }: { orders: PrintOrderLine[]; mark: string }) {
  if (orders.length === 0) return <p className="pd-empty">None recorded.</p>
  return (
    <table className="pd-table">
      <thead>
        <tr><th>Order</th><th>Category</th><th>Priority</th><th>Ordered{mark}</th><th>Nursing impl.</th></tr>
      </thead>
      <tbody>
        {orders.map(o => (
          <tr key={o.orderId}>
            <td>{o.summary}<span className="pd-sub"> {o.orderId}</span></td>
            <td>{o.category}</td>
            <td>{o.priority}</td>
            <td>{displayFullStamp(o.orderedTime)} · {o.orderedBy}</td>
            <td>{o.requiresImplementation ? 'required' : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Contract #3 — Active Orders Sheet. Every ACTIVE physician order on
 *  the encounter — medication and non-medication alike — from the
 *  persisted order record (stored summary text; never a formulary
 *  lookup). Pending-signature orders print under their own heading:
 *  an unsigned order is never presented as in force. */
export function ActiveOrdersSheet({ data }: { data: ActiveOrdersData }) {
  const { context, activeOrders, pendingOrders } = data
  const mark = context.hasChartedTimes ? ' †' : ''
  return (
    <>
      <Section title={`Active orders${mark}`}>
        <OrderTable orders={activeOrders} mark={mark} />
      </Section>

      {pendingOrders.length > 0 && (
        <Section title={`Awaiting signature — NOT in force${mark}`}>
          <OrderTable orders={pendingOrders} mark={mark} />
        </Section>
      )}

      <Section title="Physician" keepTogether>
        <SignatureBlock role="Physician" />
      </Section>
    </>
  )
}
