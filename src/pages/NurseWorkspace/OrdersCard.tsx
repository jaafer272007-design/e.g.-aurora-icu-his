import { Card } from '../../components/Card'
import { Badge, type BadgeColor } from '../../components/Badge'
import { BedChip } from '../../components/Tag'
import { IconPencil } from '../../components/icons'
import type { Order, OrderPriority } from '../../lib/api/types'

const PRIORITY_COLOR: Record<OrderPriority, BadgeColor> = {
  STAT: 'red',
  Urgent: 'amber',
  Routine: 'blue',
}

interface OrdersCardProps {
  /** active orders flagged requiresImplementation, from the canonical Order model */
  orders: Order[]
  /** locally completed this session (kept visible with a ✓ until refresh) */
  completedIds: Set<string>
  onComplete: (orderId: string) => void
}

/** Orders to Implement — a derived view over the canonical Order model.
 *  Mark-as-done only: orders are not editable and cannot be originated here. */
export function OrdersCard({ orders, completedIds, onComplete }: OrdersCardProps) {
  const pending = orders.filter(o => !completedIds.has(o.orderId))
  return (
    <Card
      icon={<IconPencil size={15} stroke="var(--amber)" />}
      title="Orders to Implement"
      aside={`${pending.length} pending · mark done only`}
    >
      <div className="ordlist">
        {orders.length === 0 && <div className="nwempty">No orders awaiting implementation.</div>}
        {orders.map(o => {
          const done = completedIds.has(o.orderId)
          return (
            <div className={`ordrow${done ? ' done' : ''}`} key={o.orderId}>
              <Badge color={PRIORITY_COLOR[o.priority]}>{o.priority.toUpperCase()}</Badge>
              <div className="ordtext">
                {o.summary}
                <small className="num">{o.orderedTime} · {o.orderedBy} · <BedChip bedId={o.bedId} className="bedchip ordbed" /></small>
              </div>
              {done ? (
                <span className="orddone">✓ Done</span>
              ) : (
                <button className="ordbtn" onClick={() => onComplete(o.orderId)} aria-label={`Mark done: ${o.summary}`}>✓ Done</button>
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}
