import type { MedAdministration, MedicationDetails, Order } from './api/types'
import { datedEpoch } from './time'

/* MAR derived-at-read schedule — the CLIENT mirror of the server's
   Core/Mar/MarSchedule.cs (the same relationship deriveMarRows had to
   MarLogic before this fix). Store only facts — the medication order and
   the documented administration events; expected dose instances are
   DERIVED from frequency + therapy start + the current clock, each with a
   DATED identity ("yyyy-MM-ddTHH:mm" documentable id, "yyyy-MM-dd HH:mm"
   scheduled stamp) so "the 23:00 dose on the 15th" can never become "the
   23:00 dose on the 16th". A late dose never shifts the grid — it derives
   from THERAPY START, not from the last documented dose; PRN derives from
   the last administration only; an unparseable frequency gets NO invented
   schedule. Used by the mock adapter's MAR derivation and the Orders
   screen's next-dose chip. */

export type ScheduleKind =
  | { kind: 'interval'; hours: number }
  | { kind: 'once' }
  | { kind: 'prn' }
  | { kind: 'underivable' }

/** the render horizon's past window: undocumented instances of the last
 *  24 h render individually; older missed instances aggregate into one
 *  explicit summary row (never silently truncated) */
export const PAST_WINDOW_HOURS = 24

export function parseFrequency(m: MedicationDetails): ScheduleKind {
  if (m.prn) return { kind: 'prn' }
  const q = /^q(\d+)h$/.exec(m.frequency)
  if (q) {
    const h = Number(q[1])
    if (h >= 1 && h <= 168) return { kind: 'interval', hours: h }
  }
  const named: Record<string, number> = { daily: 24, bid: 12, tid: 8, qid: 6 }
  if (m.frequency in named) return { kind: 'interval', hours: named[m.frequency] }
  if (m.frequency === 'once') return { kind: 'once' }
  return { kind: 'underivable' }
}

/** a stored stamp → epoch ms (UTC), per the three stored forms: dated
 *  "yyyy-MM-dd HH:mm"; "D-n HH:mm" (n days before today); bare "HH:mm"
 *  (treated as today, as always). null = no honest instant. */
export function stampEpoch(t: string | undefined, nowMs: number): number | null {
  if (!t) return null
  const dated = datedEpoch(t)
  if (dated !== null) return dated
  const m = /^(?:D-(\d+) )?(\d{2}):(\d{2})$/.exec(t)
  if (!m) return null
  const days = m[1] ? Number(m[1]) : 0
  const day = 86_400_000
  return (Math.floor(nowMs / day) - days) * day + Number(m[2]) * 3_600_000 + Number(m[3]) * 60_000
}

/** THERAPY START — the signing event's time (when the order came into
 *  force), falling back to the ordered time */
export function therapyStartEpoch(o: Order, nowMs: number): number | null {
  const signed = o.history.find(e => e.action === 'signed')
  return stampEpoch(signed?.time, nowMs) ?? stampEpoch(o.orderedTime, nowMs)
}

/** first expected dose: the next full hour after the anchor (the retired
 *  stub's first-dose semantics, preserved) */
export const firstDoseEpoch = (anchorMs: number): number =>
  (Math.floor(anchorMs / 3_600_000) + 1) * 3_600_000

const pad = (n: number) => String(n).padStart(2, '0')
export function instanceStamp(ms: number): string {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}
/** the documentable identity — the stamp's URL-safe "T" form */
export const instanceIdentity = (ms: number): string => instanceStamp(ms).replace(' ', 'T')

export interface DerivedInstances {
  /** undocumented instances older than the past window — the explicit
   *  remainder (count + oldest stamp), never silently truncated */
  aggregatedMissed: number
  oldestAggregatedMs: number | null
  /** each undocumented instance in the window, plus the NEXT one after
   *  now — doses never run out */
  renderableMs: number[]
}

/** every expected instance for an interval order, split per the horizon —
 *  pure arithmetic on the anchor grid (mirrors MarSchedule.IntervalInstances) */
export function intervalInstances(
  firstMs: number, hours: number, documentedStamps: Set<string>, nowMs: number,
): DerivedInstances {
  const step = hours * 3_600_000
  const windowStart = nowMs - PAST_WINDOW_HOURS * 3_600_000
  const k0 = firstMs >= windowStart ? 0 : Math.ceil((windowStart - firstMs) / step)
  let aggregatedMissed = 0
  let oldestAggregatedMs: number | null = null
  for (let k = 0; k < k0; k++) {
    const t = firstMs + k * step
    if (documentedStamps.has(instanceStamp(t))) continue
    aggregatedMissed++
    oldestAggregatedMs ??= t
  }
  const renderableMs: number[] = []
  for (let k = k0; ; k++) {
    const t = firstMs + k * step
    const documented = documentedStamps.has(instanceStamp(t))
    if (t <= nowMs) { if (!documented) renderableMs.push(t); continue }
    if (!documented) { renderableMs.push(t); break }
  }
  return { aggregatedMissed, oldestAggregatedMs, renderableMs }
}

export const documentedStampsOf = (o: Order): Set<string> =>
  new Set((o.administrations ?? []).filter(a => a.status !== 'scheduled').map(a => a.scheduledTime))

/** the Orders screen's "next dose" — the earliest underivable-free expected
 *  instance still awaiting documentation (dated stamp), or null when the
 *  order has no derivable grid / is not in force */
export function nextExpectedDose(o: Order, nowMs: number): string | null {
  if (!o.medication || o.status !== 'active' || o.medication.prn) return null
  const kind = parseFrequency(o.medication)
  if (kind.kind !== 'interval' && kind.kind !== 'once') return null
  const anchor = therapyStartEpoch(o, nowMs)
  if (anchor === null) return null
  const first = firstDoseEpoch(anchor)
  const documented = documentedStampsOf(o)
  if (kind.kind === 'once')
    return documented.has(instanceStamp(first)) ? null : instanceStamp(first)
  const { aggregatedMissed, oldestAggregatedMs, renderableMs } =
    intervalInstances(first, kind.hours, documented, nowMs)
  if (aggregatedMissed > 0 && oldestAggregatedMs !== null) return instanceStamp(oldestAggregatedMs)
  return renderableMs.length ? instanceStamp(renderableMs[0]) : null
}

/** a stored administration row that is a FACT (the retired stub's
 *  'scheduled' rows are artefacts of the removed plan — never facts) */
export const isFact = (a: MedAdministration): boolean => a.status !== 'scheduled'
