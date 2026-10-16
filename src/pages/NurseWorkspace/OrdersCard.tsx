import { useEffect, useState, type MouseEvent, type ReactNode } from 'react'
import { Card } from '../../components/Card'
import { Badge, type BadgeColor } from '../../components/Badge'
import { BedChip } from '../../components/Tag'
import { IconPencil } from '../../components/icons'
import type { Order, OrderPriority } from '../../lib/api/types'
import {
  displayNursingTime, formatNursingInterval, isRepeatingNursing, lastNursingCompletion, nursingRoundState,
  type NursingRoundState,
} from '../../lib/nursingRounds'
import { DUE_SOON_MINUTES, displayStamp, useNow } from '../../lib/time'
import type { NursingBusy } from '../../features/nurse-care/nursingController'

const PRIORITY_COLOR: Record<OrderPriority, BadgeColor> = {
  STAT: 'red',
  Urgent: 'amber',
  Routine: 'blue',
}

/* a round open this long past its due time reads OVERDUE (the MAR's due-soon
   window); it stays actionable however late — the clock never creates rounds */
const OVERDUE_AFTER_MS = DUE_SOON_MINUTES * 60_000

type RowState = 'overdue' | 'due' | 'upcoming' | 'closed'
const STATE_META: Record<RowState, { label: string; cls: string }> = {
  overdue: { label: 'OVERDUE', cls: 'st-overdue' },
  due: { label: 'DUE', cls: 'st-due' },
  upcoming: { label: 'UPCOMING', cls: 'st-upcoming' },
  closed: { label: 'NOT OPEN', cls: 'st-upcoming' },
}

const rowStateOf = (s: NursingRoundState, nowMs: number): RowState =>
  s.kind === 'legacy' ? 'due'
    : s.kind === 'open' ? (nowMs - s.dueMs >= OVERDUE_AFTER_MS ? 'overdue' : 'due')
      : s.kind === 'locked' ? 'upcoming' : 'closed'

/** "in 42 min" / "in 2 h 05 min" / "in 40 s" until an opening */
const untilLabel = (ms: number): string => {
  if (ms < 60_000) return `in ${Math.max(1, Math.ceil(ms / 1000))} s`
  const min = Math.ceil(ms / 60_000)
  return min < 60 ? `in ${min} min` : `in ${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`
}
const lateLabel = (ms: number): string => {
  const min = Math.floor(ms / 60_000)
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`
}

interface OrdersCardProps {
  /** active orders flagged requiresImplementation, each in its freshest known version */
  orders: Order[]
  /** orders with a Done saving, awaiting the read that settles it, or UNCONFIRMED */
  busy: ReadonlyMap<string, NursingBusy>
  /** the last refusal / outcome per order, shown on its row */
  notices: Readonly<Record<string, string>>
  onDone: (order: Order) => void
  /** re-send the order's UNCONFIRMED Done — the same round + attempt id */
  onRetry: (orderId: string) => void
  /** the card's data-age chip */
  dataAge?: ReactNode
}

/** the counts the header KPI and the card share: actionable now vs upcoming */
export function implementCounts(orders: Order[], nowMs: number): { due: number; upcoming: number } {
  let due = 0, upcoming = 0
  for (const o of orders) {
    const st = rowStateOf(nursingRoundState(o, nowMs), nowMs)
    if (st === 'due' || st === 'overdue') due++
    else if (st === 'upcoming') upcoming++
  }
  return { due, upcoming }
}

/** Orders to Implement — a derived view over the canonical Order model.
 *  Mark-as-done only: orders are not editable and cannot be originated here.
 *  NURSING ROUNDS (ICU nursing/patient-chart update): one row per order, showing
 *  its ONE current round — a repeating order's next round is shown with its
 *  opening time and Done stays disabled until exactly then (a timer opens it, no
 *  reload); an overdue round stays actionable; the completion history and the
 *  interval are on the row. One-time orders complete once and leave the list.
 *  Only Done — no Held/Refused for nursing rounds. */
export function OrdersCard({ orders, busy, notices, onDone, onRetry, dataAge }: OrdersCardProps) {
  const tickNow = useNow()
  const [unlockTick, setUnlockTick] = useState(0)
  const nowMs = Math.max(tickNow.getTime(), unlockTick)
  const states = new Map(orders.map(o => [o.orderId, nursingRoundState(o, nowMs)] as const))
  /* the exact opening of the next locked round — and the overdue flip */
  const nextChange = orders.reduce<number | null>((soonest, o) => {
    const s = states.get(o.orderId)!
    const at = s.kind === 'locked' ? s.dueMs : s.kind === 'open' && nowMs - s.dueMs < OVERDUE_AFTER_MS ? s.dueMs + OVERDUE_AFTER_MS : null
    return at !== null && at > nowMs && (soonest === null || at < soonest) ? at : soonest
  }, null)
  useEffect(() => {
    if (nextChange === null) return
    const t = window.setTimeout(() => setUnlockTick(Date.now()), Math.min(Math.max(0, nextChange - Date.now()) + 1, 3_600_000))
    return () => window.clearTimeout(t)
  }, [nextChange, unlockTick])

  const order = (o: Order) => {
    const s = states.get(o.orderId)!
    const st = rowStateOf(s, nowMs)
    return st === 'overdue' ? 0 : st === 'due' ? 1 : st === 'upcoming' ? 2 : 3
  }
  const dueOf = (o: Order) => { const s = states.get(o.orderId)!; return s.kind === 'open' || s.kind === 'locked' ? s.dueMs : 0 }
  const sorted = [...orders].sort((a, b) => order(a) - order(b) || dueOf(a) - dueOf(b) || a.orderedTime.localeCompare(b.orderedTime))
  const { due, upcoming } = implementCounts(orders, nowMs)

  return (
    <Card
      className="ordcard"
      icon={<IconPencil size={15} stroke="var(--amber)" />}
      title="Orders to Implement"
      aside={<span className="ordaside"><span>{due} due now · {upcoming} upcoming</span>{dataAge}</span>}
    >
      <div className="ordlist">
        {orders.length === 0 && <div className="nwempty">No orders awaiting implementation.</div>}
        {sorted.map(o => {
          const s = states.get(o.orderId)!
          const st = rowStateOf(s, nowMs)
          const meta = STATE_META[st]
          const saving = busy.get(o.orderId)
          const open = s.kind === 'legacy' || s.kind === 'open'
          const locked = !open || saving !== undefined
          const repeating = isRepeatingNursing(o)
          const last = lastNursingCompletion(o)
          const completions = o.nursing?.completions ?? []
          const lineId = `ord-${o.orderId}-line`.replace(/[^A-Za-z0-9_-]/g, '-')
          /* the click is re-checked by the controller against the real clock
             and its lock; the 2nd/3rd click of a multi-click is ignored */
          const click = (e: MouseEvent) => { if (e.detail <= 1 && !busy.has(o.orderId)) onDone(o) }
          return (
            <div className={`ordrow ${meta.cls}`} key={o.orderId} data-order={o.orderId}>
              <Badge color={PRIORITY_COLOR[o.priority]}>{o.priority.toUpperCase()}</Badge>
              <div className="ordtext">
                {o.summary}
                <small className="num">
                  {displayStamp(o.orderedTime)} · {o.orderedBy} · <BedChip bedId={o.bedId} className="bedchip ordbed" />
                  {o.nursing && <span className="ordfreq">{repeating ? formatNursingInterval(o.nursing.intervalMinutes!) : 'one-time'}</span>}
                </small>
                {(s.kind === 'open' || s.kind === 'locked') && (
                  <span className="ordround num">
                    {repeating ? `Round ${s.round.number} · ` : ''}
                    {s.kind === 'locked'
                      ? <>Next due {displayNursingTime(s.round.dueTime)} <span className="ordwhen">({untilLabel(s.dueMs - nowMs)})</span></>
                      : <>Due {displayNursingTime(s.round.dueTime)}{st === 'overdue' && <span className="ordlate"> · overdue {lateLabel(nowMs - s.dueMs)}</span>}</>}
                  </span>
                )}
                {last && (
                  <span className="ordlast num">Last done {displayNursingTime(last.completedTime)} by {last.completedBy}</span>
                )}
                {completions.length > 0 && (
                  <details className="ordhist">
                    <summary>Completion history ({completions.length})</summary>
                    <ol>
                      {[...completions].reverse().map(c => (
                        <li key={c.roundId} className="num">
                          {repeating ? `Round ${c.round}: ` : ''}done {displayNursingTime(c.completedTime)} by {c.completedBy}
                          <span className="orddue"> (due {displayNursingTime(c.dueTime)})</span>
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
              </div>
              <span className={`ordstate ${meta.cls}`}>{meta.label}</span>
              <button className="ordbtn" disabled={locked} aria-describedby={locked ? lineId : undefined}
                onClick={click} aria-label={`Mark done: ${o.summary}`}>✓ Done</button>
              {(locked || notices[o.orderId]) && (
                <div className="ordline" id={lineId}>
                  {saving?.phase === 'saving' ? <span className="ordbusy">Saving…</span>
                    : saving?.phase === 'checking' ? <span className="ordbusy">Checking the record — Done reopens once the server confirms</span>
                      : saving?.phase === 'unconfirmed' ? (
                        <span className="ordwarn" role="status">
                          ⚠ Not confirmed — your Done may already be saved; checking the record.{' '}
                          <button type="button" className="ordretry" onClick={e => { if (e.detail <= 1) onRetry(o.orderId) }}>Retry saving</button>
                          {' '}{saving.legacy ? '(re-sends the Done — the order completes only once)' : '(sends the same Done for the same round — it can never be recorded twice)'}
                        </span>
                      )
                        : s.kind === 'locked'
                          ? <span className="ordlock">🔒 Opens {displayNursingTime(s.round.dueTime)} ({untilLabel(s.dueMs - nowMs)}) — {repeating ? 'completion time + interval' : 'not open yet'}</span>
                          : s.kind === 'inactive' ? <span className="ordlock">Not open for completion</span> : null}
                  {notices[o.orderId] && <span className="ordnotice" role="alert">{notices[o.orderId]}</span>}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}
