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
   segmented grid; see retimingState below.]
   [SUPERSEDED AGAIN 2026-09-30 by the project owner — Amendment B: the
   ROLLING TIMER. A repeating order has no grid: one current round, the
   next due from the fact that resolved the last. Mirrors MarSchedule.cs's
   rolling-timer section exactly; see currentRound below.] */

export type ScheduleKind =
  | { kind: 'interval'; hours: number }
  | { kind: 'once' }
  | { kind: 'prn' }
  | { kind: 'underivable' }

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

/* ---------------- THE ROLLING TIMER (owner's rule, 2026-09-30) ----------------
   The client mirror of MarSchedule.cs's rolling-timer section (Amendment B)
   — read the server comment for the full rationale. In short: a repeating
   order has ONE current round; the fact that resolves it carries `round`,
   and the next round is due at TIMER + interval, where the timer instant
   is the actual administration time of a GIVEN (early, on time or late)
   and the scheduled time of a HELD/REFUSED round. Rounds are replayed in
   order with ACTION chronology (a Given's actual time, a Held/Refused's
   documenting time) kept apart from scheduled due identity: a Given no
   older than every earlier action restarts the timer, even after a
   Held/Refused left a later scheduled timer (corrected 2026-09-30); a
   genuinely older backdated Given never rewinds it.
   The clock never creates a round. Facts without `round` are legacy: shown
   as stored, never timing anything; they only locate round 1 of an order
   documented before this rule (legacyEntry). */

export interface Round {
  number: number
  dueMs: number
  /** what timed this round (null on round 1) */
  timerFromMs: number | null
  timerRule: 'given' | 'skipped' | null
}

/** the round's documentable identity "yyyy-MM-ddTHH:mm~r<n>" (mirrors MarSchedule.RoundIdentity) */
export const roundIdentity = (r: Round): string => `${instanceIdentity(r.dueMs)}~r${r.number}`

export function parseRoundIdentity(id: string): { dueMs: number; number: number } | null {
  const m = /^([0-9]{4}-[0-9]{2}-[0-9]{2})T([0-9]{2}:[0-9]{2})~r([1-9][0-9]{0,8})$/.exec(id)
  if (!m) return null
  const due = datedEpoch(`${m[1]} ${m[2]}`)
  return due === null ? null : { dueMs: due, number: Number(m[3]) }
}

/** a round-resolving fact's timer instant (mirrors MarSchedule.TimerInstant) */
export const timerInstant = (a: MedAdministration): number | null =>
  a.status === 'given' ? datedEpoch(a.documentedTime ?? '') : datedEpoch(a.scheduledTime)

/** a round-resolving fact's action instant — its actual administration
 *  time (Given) or documenting time (Held/Refused) (mirrors MarSchedule.ActionInstant) */
export const actionInstant = (a: MedAdministration): number | null => datedEpoch(a.documentedTime ?? '')

/** THE rule (mirrors MarSchedule.CurrentRound) — `facts` in recording
 *  order; the resolving facts are replayed in round order */
export function currentRound(firstMs: number, hours: number, facts: MedAdministration[], nowMs: number): Round {
  const step = hours * 3_600_000
  const resolved = facts.filter(a => a.round != null && isFact(a))
    .map((a, i) => ({ a, i }))
    .sort((x, y) => (x.a.round as number) - (y.a.round as number) || x.i - y.i)
    .map(x => x.a)
  let timer: number | null = null
  let rule: Round['timerRule'] = null
  let latestAction: number | null = null
  for (const a of resolved) {
    const t = timerInstant(a)
    if (a.status === 'given') {
      // a subsequent Given restarts the interval; an older backdated one never rewinds it
      if (t !== null && (latestAction === null || t >= latestAction || timer === null || t > timer)) {
        timer = t
        rule = 'given'
      }
    } else if (t !== null) {
      timer = t // the skipped round's scheduled time
      rule = 'skipped'
    }
    const act = actionInstant(a)
    if (act !== null && (latestAction === null || act > latestAction)) latestAction = act
  }
  const number = resolved.length === 0 ? 1 : Math.max(...resolved.map(a => a.round as number)) + 1
  return timer === null
    ? { number, dueMs: legacyEntry(firstMs, step, facts, nowMs), timerFromMs: null, timerRule: null }
    : { number, dueMs: timer + step, timerFromMs: timer, timerRule: rule }
}

/** LEGACY ACTIVATION — round 1 of an order whose facts all predate the
 *  rule: the first therapy-start slot at or after the slot containing
 *  the latest legacy fact's recorded time that no legacy fact documents
 *  (the first dose when none) (mirrors MarSchedule.LegacyEntry) */
export function legacyEntry(firstMs: number, step: number, facts: MedAdministration[], nowMs: number): number {
  const legacy = facts.filter(a => a.round == null && isFact(a))
  let latest: number | null = null
  for (const a of legacy) {
    const t = stampEpoch(a.documentedTime, nowMs) ?? stampEpoch(a.scheduledTime, nowMs)
    if (t !== null && (latest === null || t > latest)) latest = t
  }
  if (latest === null) return firstMs
  const documented = new Set(legacy.map(a => stampEpoch(a.scheduledTime, nowMs)).filter((t): t is number => t !== null))
  let slot = latest <= firstMs ? firstMs : firstMs + Math.floor((latest - firstMs) / step) * step
  while (documented.has(slot)) slot += step // bounded by the legacy facts
  return slot
}

/** ONE ACTION PER ROUND (owner's correction, 2026-10-05; mirrors
 *  MarSchedule.NotYetDue): a scheduled dose — a repeating order's current
 *  round or a 'once' dose — is documentable (given, held or refused) from
 *  its EXACT scheduled instant, never before. The due-soon window is a
 *  reminder only; PRN/on-demand doses have no scheduled instant. */
export const documentableAt = (dueMs: number, nowMs: number): boolean => nowMs >= dueMs

/** the refusal wording for a dose opened too early (mirrors the server's) */
export const notYetDueMessage = (dueMs: number): string =>
  `is not due until ${instanceStamp(dueMs)} — one action per dose round: it can be documented (given, held or refused) from its scheduled time, not before`

/** the Orders screen's "next dose" — the current round's due stamp (a
 *  repeating order) or the single expected dose (once), or null when the
 *  order has no derivable schedule / is not in force */
export function nextExpectedDose(o: Order, nowMs: number): string | null {
  if (!o.medication || o.status !== 'active' || o.medication.prn) return null
  const kind = parseFrequency(o.medication)
  if (kind.kind !== 'interval' && kind.kind !== 'once') return null
  const anchor = therapyStartEpoch(o, nowMs)
  if (anchor === null) return null
  const first = firstDoseEpoch(anchor)
  const facts = (o.administrations ?? []).filter(isFact)
  if (kind.kind === 'once')
    return facts.some(a => a.scheduledTime === instanceStamp(first)) ? null : instanceStamp(first)
  return instanceStamp(currentRound(first, kind.hours, facts, nowMs).dueMs)
}

/** a stored administration row that is a FACT (the retired stub's
 *  'scheduled' rows are artefacts of the removed plan — never facts) */
export const isFact = (a: MedAdministration): boolean => a.status !== 'scheduled'
