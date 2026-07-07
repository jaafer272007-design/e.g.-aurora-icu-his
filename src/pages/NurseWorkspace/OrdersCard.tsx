import { Card } from '../../components/Card'
import { Badge, type BadgeColor } from '../../components/Badge'
import { BedChip } from '../../components/Tag'
import { IconPencil } from '../../components/icons'
import type { ImplementOrder, OrderPriority } from '../../lib/api/types'

const PRIORITY_COLOR: Record<OrderPriority, BadgeColor> = {
  STAT: 'red',
  Urgent: 'amber',
  Routine: 'blue',
}

interface OrdersCardProps {
  orders: ImplementOrder[]
  onComplete: (orderId: string) => void
}

/** Orders to Implement — physician orders awaiting nursing action.
 *  Mark-as-done only: orders are not editable and cannot be originated here. */
export function OrdersCard({ orders, onComplete }: OrdersCardProps) {
  const pending = orders.filter(o => !o.done)
  return (
    <Card
      icon={<IconPencil size={15} stroke="var(--amber)" />}
      title="Orders to Implement"
      aside={`${pending.length} pending · mark done only`}
    >
      <div className="ordlist">
        {orders.length === 0 && <div className="nwempty">No orders awaiting implementation.</div>}
        {orders.map(o => (
          <div className={`ordrow${o.done ? ' done' : ''}`} key={o.orderId}>
            <Badge color={PRIORITY_COLOR[o.priority]}>{o.priority.toUpperCase()}</Badge>
            <div className="ordtext">
              {o.text}
              <small className="num">{o.time} · {o.orderedBy} · <BedChip bedId={o.bedId} className="bedchip ordbed" /></small>
            </div>
            {o.done ? (
              <span className="orddone">✓ Done</span>
            ) : (
              <button className="ordbtn" onClick={() => onComplete(o.orderId)} aria-label={`Mark done: ${o.text}`}>✓ Done</button>
            )}
          </div>
        ))}
      </div>
    </Card>
  )
}
