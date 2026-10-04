import { datedEpoch, formatHm, hmOf, localDayNumber, localYmd } from '../../lib/time'
import type { MarRow } from '../../lib/api/types'

/* ---------------- DAILY PRESCRIPTION CARDS (owner's request, 2026-10-04) ----------------
   docs/design/icu-update-sidebar-mar-daily-cards.md §2. A PRESENTATION of
   the MAR rows the server already returns: one card per patient +
   prescription (orderId) + HOSPITAL-calendar day. Nothing is generated:
   a card holds only recorded rows and the single current round /
   availability row the MAR interface sends. Pure (no React) so the rules
   run under a fake clock in the evidence harness.

   Which day a row belongs to — always on the display (hospital) clock,
   through localYmd/localDayNumber over datedEpoch, never the browser zone
   and never a sliced UTC string:
   - a scheduled round (current or documented): its SCHEDULED day — a dose
     due 23:00 and given 00:20 stays in the earlier day's card, and its
     actual administration date shows on the row;
   - a PRN / on-demand documented dose (no scheduled time): its
     DOCUMENTATION day;
   - the PRN / on-demand AVAILABILITY row (and its controls): today;
   - a legacy fact with no dated stamp to place it: "Date unavailable"
     (no date is ever invented — "D-n HH:mm" is relative to whenever it
     was seeded, so it is not a date either).
   Today's card exists for every prescription with an actionable row,
   even when that row lives on another day: it then carries a REFERENCE
   to that card (yesterday's outstanding round, or a current round
   scheduled tomorrow) — never a second set of controls. */

export type DayRelation = 'tomorrow' | 'today' | 'yesterday' | 'past' | 'future' | 'undated'

export interface MarDayCard {
  /** stable across polls and refreshed server rows */
  key: string
  /** DOM id (scroll target for the today-card reference) */
  domId: string
  patientId: string
  orderId: string
  /** "yyyy-MM-dd" on the hospital clock; null = Date unavailable */
  day: string | null
  relation: DayRelation
  medication: string
  dose: string
  /** the MAR's route line: "<route> · <frequency>" (or "PRN — …") */
  route: string
  rows: MarRow[]
  /** today, or holds the current actionable round (or an unresolved one):
   *  always open, no collapse control */
  pinnedOpen: boolean
  /** today's card only: the actionable row this prescription has on ANOTHER day */
  reference?: { row: MarRow; targetKey: string; targetDomId: string; day: string; direction: 'earlier' | 'later' }
}

const UNDATED = 'undated'

/** the action controls belong to exactly these rows: the current round of
 *  a scheduled order, or the PRN / on-demand availability row */
export const isActionable = (r: MarRow): boolean => r.status === 'scheduled'

/** availability = an actionable row with no schedule (PRN / on-demand) */
const isAvailability = (r: MarRow): boolean => isActionable(r) && datedEpoch(r.scheduledTime) === null

/** the hospital day a row belongs to (see above), or null */
export function rowDay(r: MarRow, nowMs: number): string | null {
  if (isAvailability(r)) return localYmd(nowMs)
  const scheduled = datedEpoch(r.scheduledTime)
  if (scheduled !== null) return localYmd(scheduled)
  if (r.scheduledTime === '') {
    const documented = datedEpoch(r.documentedTime ?? '')
    return documented === null ? null : localYmd(documented)
  }
  return null
}

const dayNumberOf = (ymd: string): number => {
  const [y, m, d] = ymd.split('-').map(Number)
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000)
}

function relationOf(day: string | null, today: number): DayRelation {
  if (day === null) return 'undated'
  const diff = dayNumberOf(day) - today
  return diff === 0 ? 'today' : diff === -1 ? 'yesterday' : diff === 1 ? 'tomorrow' : diff < 0 ? 'past' : 'future'
}

const domIdOf = (patientId: string, orderId: string, day: string | null) =>
  `mar-${patientId}-${orderId}-${day ?? UNDATED}`.replace(/[^A-Za-z0-9_-]/g, '-')

/** rows inside a card: legacy facts (no round) first by time, then rounds
 *  in round order (a round given early can be due later than the round it
 *  started — the round order is the order they happened), then the
 *  availability row; ties keep the server's order */
function sortRows(rows: MarRow[]): MarRow[] {
  const keyed = rows.map((r, i) => {
    const t = datedEpoch(r.scheduledTime) ?? datedEpoch(r.documentedTime ?? '') ?? Number.MAX_SAFE_INTEGER
    const k: [number, number] = isAvailability(r) ? [2, 0] : r.round != null ? [1, r.round] : [0, t]
    return { r, i, k }
  })
  keyed.sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.i - b.i)
  return keyed.map(x => x.r)
}

/** group ONE patient's MAR rows into daily prescription cards, ordered:
 *  open cards (newest day first), then completed history (newest first),
 *  then Date unavailable; same day → medication name, then order id */
export function groupMarDays(rows: MarRow[], nowMs: number): MarDayCard[] {
  const today = localDayNumber(nowMs)
  const todayYmd = localYmd(nowMs)
  const cards = new Map<string, MarDayCard>()
  const cardFor = (r: MarRow, day: string | null): MarDayCard => {
    const key = `${r.patientId}|${r.orderId}|${day ?? UNDATED}`
    let c = cards.get(key)
    if (!c) {
      c = {
        key, domId: domIdOf(r.patientId, r.orderId, day), patientId: r.patientId, orderId: r.orderId,
        day, relation: relationOf(day, today), medication: r.medication, dose: r.dose, route: r.route,
        rows: [], pinnedOpen: false,
      }
      cards.set(key, c)
    }
    return c
  }
  for (const r of rows) cardFor(r, rowDay(r, nowMs)).rows.push(r)
  /* today's card for every prescription with an actionable row elsewhere */
  for (const r of rows) {
    if (!isActionable(r)) continue
    const day = rowDay(r, nowMs)
    if (day === null || day === todayYmd) continue
    const target = cardFor(r, day)
    cardFor(r, todayYmd).reference = {
      row: r, targetKey: target.key, targetDomId: target.domId, day,
      direction: dayNumberOf(day) < today ? 'earlier' : 'later',
    }
  }
  const list = [...cards.values()]
  for (const c of list) {
    c.rows = sortRows(c.rows)
    c.pinnedOpen = c.relation === 'today' || c.rows.some(r => isActionable(r) || r.status === 'missed-earlier')
  }
  const dayNum = (c: MarDayCard) => (c.day === null ? Number.NEGATIVE_INFINITY : dayNumberOf(c.day))
  const tier = (c: MarDayCard) => (c.pinnedOpen ? 0 : c.day === null ? 2 : 1)
  list.sort((a, b) =>
    tier(a) - tier(b) || dayNum(b) - dayNum(a)
    || a.medication.localeCompare(b.medication) || a.orderId.localeCompare(b.orderId))
  return list
}

/** a stamp on a card's row: the hospital time, plus its hospital date when
 *  that differs from the card's day (an after-midnight administration, a
 *  PRN dose, or anything in the Date-unavailable card); a legacy undated
 *  stamp passes through exactly as stored */
export function stampOnCard(stamp: string | undefined, cardDay: string | null): string {
  if (!stamp) return ''
  const ms = datedEpoch(stamp)
  if (ms === null) return stamp
  const day = localYmd(ms)
  return day === cardDay ? formatHm(hmOf(stamp)) : `${day} ${formatHm(hmOf(stamp))}`
}

/** the card header's date label */
export function dayLabel(c: Pick<MarDayCard, 'day' | 'relation'>): string {
  if (c.day === null) return 'Date unavailable'
  const word = c.relation === 'today' ? 'Today' : c.relation === 'yesterday' ? 'Yesterday' : c.relation === 'tomorrow' ? 'Tomorrow' : ''
  return word ? `${word} · ${c.day}` : c.day
}
