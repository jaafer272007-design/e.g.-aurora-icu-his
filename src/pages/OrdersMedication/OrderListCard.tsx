import { useEffect, useState } from 'react'
import { Card } from '../../components/Card'
import { Badge, type BadgeColor } from '../../components/Badge'
import { displayStamp, dueStateFor, useNow } from '../../lib/time'
import { formatInfusionDose, formatNormalised } from '../../lib/infusion'
import { nextExpectedDose } from '../../lib/marSchedule'
import {
  displayNursingTime, formatNursingInterval, lastNursingCompletion, nursingRoundState,
} from '../../lib/nursingRounds'
import type { Order, OrderPriority, OrderStatus } from '../../lib/api/types'
import type { NursingDoneBusy } from './useNursingDone'

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

/* ORDER-TYPE FILTER (owner's request, 2026-09-30 — docs/design/
   icu-update-batch-1.md §1): a second, separately labeled row that
   combines with the status tabs by AND. "All types" is every category,
   Nursing included; Laboratory is category 'Lab'. Nursing added
   2026-10-15 (icu-update-nursing-patient-chart.md §2). */
type TypeKey = 'all' | 'Medication' | 'Lab' | 'Imaging' | 'Nursing'
const TYPE_FILTERS: { key: TypeKey; label: string; noun: string }[] = [
  { key: 'all', label: 'All types', noun: '' },
  { key: 'Medication', label: 'Medication', noun: 'medication ' },
  { key: 'Lab', label: 'Laboratory', noun: 'laboratory ' },
  { key: 'Imaging', label: 'Imaging', noun: 'imaging ' },
  { key: 'Nursing', label: 'Nursing', noun: 'nursing ' },
]

interface OrderListCardProps {
  /** false = read-only list (no sign/modify/discontinue controls) */
  canManage: boolean
  /** orders.implement — a NURSING permission (implementation completes a
   *  task order; doctors correctly do not see this control) */
  canImplement: boolean
  orders: Order[]
  onSign: (orderId: string) => void
  onModify: (orderId: string) => void
  onDiscontinue: (orderId: string) => void
  /** the legacy empty-request implement (orders without nursing rounds) */
  onImplement: (orderId: string) => void
  /** NURSING ROUNDS: Done on an order's open current round, the retry of an
   *  unconfirmed completion, and their per-order state */
  onNursingDone: (order: Order) => void
  onNursingRetry: (orderId: string) => void
  nursingBusy: ReadonlyMap<string, NursingDoneBusy>
  nursingNotices: Record<string, string>
}

/** an order the implement action completes: an active TASK order flagged
 *  requiresImplementation. Lab/Imaging orders are excluded — they complete
 *  when a result is documented against them, never by a manual done. */
const implementable = (o: Order) =>
  o.status === 'active' && !!o.requiresImplementation
  && o.category !== 'Lab' && o.category !== 'Imaging'

/** Full per-patient order list with status + type filters, audit history, and
 *  doctor RBAC actions (sign / modify / discontinue) plus the nursing
 *  implement action on task orders. */
export function OrderListCard({
  orders, canManage, canImplement, onSign, onModify, onDiscontinue, onImplement,
  onNursingDone, onNursingRetry, nursingBusy, nursingNotices,
}: OrderListCardProps) {
  const now = useNow()
  /* EXACT UNLOCK: a locked nursing round opens at its due instant to the
     millisecond — a timer re-renders then, without a reload */
  const [, setWake] = useState(0)
  useEffect(() => {
    const t = Date.now()
    const next = orders
      .map(o => nursingRoundState(o, t))
      .flatMap(st => (st.kind === 'locked' ? [st.dueMs] : []))
      .sort((a, b) => a - b)[0]
    if (next === undefined) return
    const id = window.setTimeout(() => setWake(w => w + 1), Math.min(next - t + 1, 2_147_000_000))
    return () => window.clearTimeout(id)
  })
  const [filter, setFilter] = useState<FilterKey>('all')
  const [typeFilter, setTypeFilter] = useState<TypeKey>('all')
  const [openHistory, setOpenHistory] = useState<Set<string>>(new Set())

  const toggleHistory = (id: string) =>
    setOpenHistory(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  /* type first, then status (AND) — the status counts describe the
     selected type, so every count matches what its tab would show */
  const typed = typeFilter === 'all' ? orders : orders.filter(o => o.category === typeFilter)
  const count = (f: FilterKey) => (f === 'all' ? typed.length : typed.filter(o => o.status === f).length)
  const shown = filter === 'all' ? typed : typed.filter(o => o.status === filter)
  const typeNoun = TYPE_FILTERS.find(t => t.key === typeFilter)?.noun ?? ''
  const rank: Record<OrderStatus, number> = { pending: 0, active: 1, completed: 2, discontinued: 3 }
  const sorted = [...shown].sort((a, b) => rank[a.status] - rank[b.status])

  /* next expected dose — DERIVED from frequency + therapy start (the MAR
     safety fix: no schedule is stored; the dated stamp cannot roll over) */
  const nextAdmin = (o: Order) => {
    const t = nextExpectedDose(o, now.getTime())
    return t ? { scheduledTime: t } : undefined
  }

  return (
    <Card
      icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" /><path d="M9 12h6M9 16h4" /></svg>}
      title="Order List"
      aside="canonical record · full audit"
    >
      <div className="oftabs" role="tablist" aria-label="Filter orders by status">
        {FILTERS.map(f => (
          <button key={f} role="tab" aria-selected={filter === f} className={`oftab${filter === f ? ' on' : ''}`} onClick={() => setFilter(f)}>
            {f === 'all' ? 'All' : f[0].toUpperCase() + f.slice(1)}<span className="n">{count(f)}</span>
          </button>
        ))}
      </div>
      <div className="oftypes" role="group" aria-labelledby="ofTypeLbl">
        <span className="oftypelbl" id="ofTypeLbl">Type</span>
        {TYPE_FILTERS.map(t => (
          <button
            key={t.key} type="button" aria-pressed={typeFilter === t.key}
            className={`oftype${typeFilter === t.key ? ' on' : ''}`} onClick={() => setTypeFilter(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="orderlist">
        {sorted.length === 0 && <div className="omempty">No {filter === 'all' ? '' : filter + ' '}{typeNoun}orders for this patient.</div>}
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
                {o.orderId} · ordered {displayStamp(o.orderedTime)} · {o.orderedBy}
                {o.medication && <> · {o.medication.duration}{o.medication.prn && ' · PRN'}</>}
                {adm && admState && (
                  <span className={`oonext oo-${admState}`}>
                    next dose {displayStamp(adm.scheduledTime)}{admState === 'overdue' ? ' · OVERDUE' : admState === 'due' ? ' · DUE' : ''}
                  </span>
                )}
              </div>
              {o.medication?.infusion && (
                <div className="ooinfusion num">
                  ⚗ structured infusion · {formatInfusionDose(o.medication.infusion)} (per kg, as
                  ordered) · normalised {formatNormalised(o.medication.infusion)}
                </div>
              )}
              {o.nursing && <NursingLine order={o} nowMs={Date.now()} />}
              {nursingNotices[o.orderId] && <div className="oonursenote" role="status">{nursingNotices[o.orderId]}</div>}
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
                {canImplement && implementable(o) && !o.nursing && (
                  <button className="oab impl" onClick={() => onImplement(o.orderId)} aria-label={`Implement order ${o.orderId}`}>✓ Implement</button>
                )}
                {canImplement && implementable(o) && o.nursing && (() => {
                  const st = nursingRoundState(o, Date.now())
                  const b = nursingBusy.get(o.orderId)
                  if (st.kind === 'legacy' || st.kind === 'inactive') return null
                  if (b) return (
                    <>
                      <button className="oab impl" disabled aria-label={`Completing round ${st.round.number} of order ${o.orderId}`}>
                        {b.phase === 'saving' ? 'Saving…' : b.phase === 'checking' ? 'Checking…' : 'Not confirmed'}
                      </button>
                      {b.phase === 'unconfirmed' && (
                        <button className="oab impl" onClick={() => onNursingRetry(o.orderId)} aria-label={`Retry saving the completion of order ${o.orderId}`}>↻ Retry saving</button>
                      )}
                    </>
                  )
                  return st.kind === 'open' ? (
                    <button className="oab impl" onClick={() => onNursingDone(o)} aria-label={`Done: round ${st.round.number} of order ${o.orderId}`}>✓ Done · round {st.round.number}</button>
                  ) : (
                    <button className="oab impl" disabled aria-label={`Round ${st.round.number} of order ${o.orderId} opens at ${displayNursingTime(st.round.dueTime)}`}>
                      Opens {displayNursingTime(st.round.dueTime)}
                    </button>
                  )
                })()}
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
                      <span className="oht num">{displayStamp(e.time)}</span>
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

/** a nursing order's schedule and round state: one-time / repeat interval,
 *  the current round's due time (open, overdue or opening), the last
 *  completion. Times are hospital clock, to the second (§9.1). */
function NursingLine({ order, nowMs }: { order: Order; nowMs: number }) {
  const n = order.nursing!
  const st = nursingRoundState(order, nowMs)
  const last = lastNursingCompletion(order)
  return (
    <div className="oonurse num">
      <span>{n.intervalMinutes === undefined ? 'One-time' : `Repeats ${formatNursingInterval(n.intervalMinutes)}`}</span>
      {(st.kind === 'open' || st.kind === 'locked') && (
        <span className={`oonext ${st.kind === 'locked' ? 'oo-upcoming' : 'oo-due'}`}>
          round {st.round.number} {st.kind === 'locked' ? 'opens' : 'due'} {displayNursingTime(st.round.dueTime)}
          {st.kind === 'open' ? ' · OPEN' : ''}
        </span>
      )}
      {last && <span>last done {displayNursingTime(last.completedTime)} · {last.completedBy}</span>}
    </div>
  )
}
