import { useState } from 'react'
import { Card } from '../../components/Card'
import { Badge, type BadgeColor } from '../../components/Badge'
import { dueStateFor, useNow } from '../../lib/time'
import { formatInfusionDose, formatNormalised } from '../../lib/infusion'
import type { Order, OrderPriority, OrderStatus } from '../../lib/api/types'

const PRIORITY_COLOR: Record<OrderPriority, BadgeColor> = { STAT: 'red', Urgent: 'amber', Routine: 'blue' }
const CATEGORY_COLOR: Record<string, BadgeColor> = { Medication: 'green', Lab: 'blue', Imaging: 'blue', Nursing: 'amber' }

const STATUS_META: Record<OrderStatus, { label: string; cls: string }> = {
  pending: { label: 'PENDING SIGNATURE', cls: 'os-pending' },
  active: { label: 'ACTIVE', cls: 'os-active' },
  completed: { label: 'COMPLETED', cls: 'os-completed' },
  discontinued: { label: 'DISCONTINUED', cls: 'os-discontinued' },
}

type FilterKey = 'all' | OrderStatus
const FILTERS: FilterKey[] = ['all', 'pending', 'active', 'completed', 'discontinued']

interface OrderListCardProps {
  /** false = read-only list (no sign/modify/discontinue controls) */
  canManage: boolean
  orders: Order[]
  onSign: (orderId: string) => void
  onModify: (orderId: string) => void
  onDiscontinue: (orderId: string) => void
}

/** Full per-patient order list with status filters, audit history, and
 *  doctor RBAC actions (sign / modify / discontinue). */
export function OrderListCard({ orders, canManage, onSign, onModify, onDiscontinue }: OrderListCardProps) {
  const now = useNow()
  const [filter, setFilter] = useState<FilterKey>('all')
  const [openHistory, setOpenHistory] = useState<Set<string>>(new Set())

  const toggleHistory = (id: string) =>
    setOpenHistory(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const count = (f: FilterKey) => (f === 'all' ? orders.length : orders.filter(o => o.status === f).length)
  const shown = filter === 'all' ? orders : orders.filter(o => o.status === filter)
  const rank: Record<OrderStatus, number> = { pending: 0, active: 1, completed: 2, discontinued: 3 }
  const sorted = [...shown].sort((a, b) => rank[a.status] - rank[b.status])

  const nextAdmin = (o: Order) =>
    o.status === 'active' ? o.administrations?.find(a => a.status === 'scheduled' && a.scheduledTime) : undefined

  return (
    <Card
      icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" /><path d="M9 12h6M9 16h4" /></svg>}
      title="Order List"
      aside="canonical record · full audit"
    >
      <div className="oftabs" role="tablist">
        {FILTERS.map(f => (
          <button key={f} role="tab" aria-selected={filter === f} className={`oftab${filter === f ? ' on' : ''}`} onClick={() => setFilter(f)}>
            {f === 'all' ? 'All' : f[0].toUpperCase() + f.slice(1)}<span className="n">{count(f)}</span>
          </button>
        ))}
      </div>

      <div className="orderlist">
        {sorted.length === 0 && <div className="omempty">No {filter === 'all' ? '' : filter + ' '}orders for this patient.</div>}
        {sorted.map(o => {
          const st = STATUS_META[o.status]
          const adm = nextAdmin(o)
          const admState = adm ? dueStateFor(adm.scheduledTime, now) : null
          const historyOpen = openHistory.has(o.orderId)
          return (
            <div className={`oorow ${st.cls}`} key={o.orderId}>
              <div className="oor1">
                <Badge color={CATEGORY_COLOR[o.category] ?? 'blue'}>{o.category.toUpperCase()}</Badge>
                <span className="oosum">{o.summary}</span>
                <Badge color={PRIORITY_COLOR[o.priority]}>{o.priority.toUpperCase()}</Badge>
                <span className={`oostatus ${st.cls}`}>{st.label}</span>
              </div>
              <div className="oor2 num">
                {o.orderId} · ordered {o.orderedTime} · {o.orderedBy}
                {o.medication && <> · {o.medication.duration}{o.medication.prn && ' · PRN'}</>}
                {adm && admState && (
                  <span className={`oonext oo-${admState}`}>
                    next dose {adm.scheduledTime}{admState === 'overdue' ? ' · OVERDUE' : admState === 'due' ? ' · DUE' : ''}
                  </span>
                )}
              </div>
              {o.medication?.infusion && (
                <div className="ooinfusion num">
                  ⚗ structured infusion · {formatInfusionDose(o.medication.infusion)} (per kg, as
                  ordered) · normalised {formatNormalised(o.medication.infusion)}
                </div>
              )}
              {o.status === 'discontinued' && o.statusReason && (
                <div className="ooreason">⛔ Discontinued: {o.statusReason}</div>
              )}
              <div className="ooacts">
                {canManage && o.status === 'pending' && (
                  <button className="oab sign" onClick={() => onSign(o.orderId)} aria-label={`Sign order ${o.orderId}`}>✓ Sign</button>
                )}
                {canManage && (o.status === 'pending' || o.status === 'active') && o.medication && (
                  <button className="oab modify" onClick={() => onModify(o.orderId)} aria-label={`Modify order ${o.orderId}`}>✎ Modify</button>
                )}
                {canManage && (o.status === 'pending' || o.status === 'active') && (
                  <button className="oab dc" onClick={() => onDiscontinue(o.orderId)} aria-label={`Discontinue order ${o.orderId}`}>⊘ Discontinue</button>
                )}
                <button
                  className="oab hist" aria-expanded={historyOpen}
                  onClick={() => toggleHistory(o.orderId)}
                >
                  History ({o.history.length}) {historyOpen ? '▴' : '▾'}
                </button>
              </div>
              {historyOpen && (
                <div className="oohist">
                  {o.history.map((e, i) => (
                    <div className="oohrow" key={i}>
                      <span className="oht num">{e.time}</span>
                      <span className={`oha oha-${e.action}`}>{e.action.toUpperCase()}</span>
                      <span className="ohd">{e.actor}{e.detail ? ` — ${e.detail}` : ''}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}
