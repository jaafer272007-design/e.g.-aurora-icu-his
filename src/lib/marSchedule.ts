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
   screen's next-dose chip.
   [SUPERSEDED 2026-09-30 by the project owner — mar-derived-schedule.md
   Amendment A: a GIVEN dose later than its scheduled instant on a
   repeating order RE-TIMES the grid (next = actual + interval). Mirrors
   the server's re-timing section in MarSchedule.cs exactly — the same
   explicit scheduleAnchor metadata, the same floor rule, the same
   segmented grid; see retimingState below.] */

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

/* ---------------- LATE-DOSE RE-TIMING (owner's rule, 2026-09-30) ----------------
   The client mirror of MarSchedule.cs's re-timing section — read the
   server comment for the full rationale. In short: a GIVEN fact carrying a
   dated scheduleAnchor (stamped by the server only when it re-times)
   restarts the repeating grid at anchor + interval; the FLOOR RULE (actual
   later than its own instance AND than every earlier fact's dated instance
   and every earlier effective anchor) decides, replayed in recording
   order, so an older dose recorded later never rewinds a newer schedule
   and no documented instance ever falls off the grid. Earlier-segment
   instances before a re-timing instant stay (historical misses); those at
   or after it are superseded. */

/** THE FLOOR RULE's single predicate (mirrors MarSchedule.Retimes) */
export const retimes = (scheduledMs: number, actualMs: number, floorMs: number | null): boolean =>
  actualMs > scheduledMs && (floorMs === null || actualMs > floorMs)

/** replay the facts IN RECORDING ORDER → effective anchors (strictly
 *  increasing) + the floor a new fact is judged against
 *  (mirrors MarSchedule.RetimingState) */
export function retimingState(factsInRecordingOrder: MedAdministration[]): { anchorsMs: number[]; floorMs: number | null } {
  const anchorsMs: number[] = []
  let floorMs: number | null = null
  for (const a of factsInRecordingOrder) {
    if (a.status === 'scheduled') continue
    const s = datedEpoch(a.scheduledTime)
    const anchor = a.scheduleAnchor ? datedEpoch(a.scheduleAnchor) : null
    if (a.status === 'given' && s !== null && anchor !== null && retimes(s, anchor, floorMs)) {
      anchorsMs.push(anchor)
      floorMs = anchor
    } else if (s !== null && (floorMs === null || s > floorMs)) floorMs = s
  }
  return { anchorsMs, floorMs }
}

/** the derived grid — strictly increasing, unbounded (mirrors MarSchedule.Grid) */
export function* grid(firstMs: number, hours: number, anchorsMs: number[]): Generator<number> {
  const step = hours * 3_600_000
  let start = firstMs
  for (let seg = 0; ; seg++) {
    const cutoff = seg < anchorsMs.length ? anchorsMs[seg] : null
    for (let t = start; cutoff === null || t < cutoff; t += step) yield t
    start = (cutoff as number) + step
  }
}

/** is t an instance of the derived grid? arithmetic per segment (mirrors MarSchedule.OnGrid) */
export function onGrid(t: number, firstMs: number, hours: number, anchorsMs: number[]): boolean {
  const step = hours * 3_600_000
  let seg = 0
  while (seg < anchorsMs.length && anchorsMs[seg] <= t) seg++
  const segStart = seg === 0 ? firstMs : anchorsMs[seg - 1] + step
  return t >= segStart && (t - segStart) % step === 0
}

/** the re-timing instant that superseded t, or null (mirrors MarSchedule.SupersededBy) */
export function supersededBy(t: number, firstMs: number, hours: number, anchorsMs: number[]): number | null {
  const step = hours * 3_600_000
  for (let seg = 0; seg < anchorsMs.length; seg++) {
    const segStart = seg === 0 ? firstMs : anchorsMs[seg - 1] + step
    if (t >= anchorsMs[seg] && t >= segStart && (t - segStart) % step === 0) {
      /* name the re-timing currently in force at t */
      const inForce = anchorsMs.filter(a => a <= t)
      return inForce[inForce.length - 1]
    }
  }
  return null
}

export interface DerivedInstances {
  /** undocumented instances older than the past window — the explicit
   *  remainder (count + oldest stamp), never silently truncated */
  aggregatedMissed: number
  oldestAggregatedMs: number | null
  /** each undocumented instance in the window, plus the NEXT one after
   *  now — doses never run out */
  renderableMs: number[]
}

/** every expected instance for an interval order, split per the horizon,
 *  over the RE-TIMED grid (mirrors MarSchedule.IntervalInstances) */
export function intervalInstances(
  firstMs: number, hours: number, anchorsMs: number[], documentedStamps: Set<string>, nowMs: number,
): DerivedInstances {
  const windowStart = nowMs - PAST_WINDOW_HOURS * 3_600_000
  let aggregatedMissed = 0
  let oldestAggregatedMs: number | null = null
  const renderableMs: number[] = []
  for (const t of grid(firstMs, hours, anchorsMs)) {
    const documented = documentedStamps.has(instanceStamp(t))
    if (t < windowStart) { if (!documented) { aggregatedMissed++; oldestAggregatedMs ??= t } continue }
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
  const { anchorsMs } = retimingState(o.administrations ?? [])
  const { aggregatedMissed, oldestAggregatedMs, renderableMs } =
    intervalInstances(first, kind.hours, anchorsMs, documented, nowMs)
  if (aggregatedMissed > 0 && oldestAggregatedMs !== null) return instanceStamp(oldestAggregatedMs)
  return renderableMs.length ? instanceStamp(renderableMs[0]) : null
}

/** a stored administration row that is a FACT (the retired stub's
 *  'scheduled' rows are artefacts of the removed plan — never facts) */
export const isFact = (a: MedAdministration): boolean => a.status !== 'scheduled'
