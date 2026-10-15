import type { NursingCompletion, NursingRound, Order } from './api/types'
import { displayFullStamp, displayStamp } from './time'
import { instanceStamp } from './marSchedule'

/* Nursing orders — the client mirror of server/Core/Orders/NursingRounds.cs
   (docs/design/icu-update-nursing-patient-chart-contracts.md §3.3/§3.5 and
   Amendment 1, §9.1/§9.2). Pure: the current round arrives DERIVED on the
   order (`nursing.currentRound`) from the server or the mock store; this
   module answers "can it be completed now, and from when", formats nursing
   times, and holds the ONE settlement rule every Done control uses.

   PRECISION (§9.1): round due times, completion times and round identities
   use the NURSING stamp form — UTC with milliseconds,
   'yyyy-MM-ddTHH:mm:ss.fffZ' — so a repeating round reopens at exactly the
   recorded completion + the full interval. Medication stamps, MAR rounds
   and audit stamps keep the minute wire form; nothing here touches them. */

export const NURSING_INTERVAL_MIN_MINUTES = 1
export const NURSING_INTERVAL_MAX_MINUTES = 48 * 60

const NURSING_STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const NURSING_STAMP_IN_TEXT = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g

/** 'yyyy-MM-ddTHH:mm:ss.fffZ' → epoch ms; null for any other form */
export function parseNursingStamp(stamp: string): number | null {
  if (!NURSING_STAMP.test(stamp)) return null
  const ms = Date.parse(stamp)
  return Number.isNaN(ms) ? null : ms
}

/** epoch ms → 'yyyy-MM-ddTHH:mm:ss.fffZ' */
export const nursingStampOf = (ms: number): string => new Date(ms).toISOString()

const secondsOf = (ms: number) => String(new Date(ms).getUTCSeconds()).padStart(2, '0')
const minuteWire = (ms: number) => instanceStamp(Math.floor(ms / 60_000) * 60_000)

/** hospital clock, to the second, 12h/24h aware — "10:01:59" today,
 *  "D-1 10:01:59" earlier, "2:05:59 PM" with the 12h preference. (Seconds
 *  do not depend on the zone: every real offset is whole minutes.) */
export function displayNursingTime(stamp: string): string {
  const ms = parseNursingStamp(stamp)
  if (ms === null) return stamp
  return displayStamp(minuteWire(ms)).replace(/(\d{1,2}:\d{2})(?!.*\d{1,2}:\d{2})/, `$1:${secondsOf(ms)}`)
}

/** a server refusal text with its nursing stamps in hospital time
 *  ("yyyy-MM-dd HH:mm:ss" on the display clock) */
export const localizeNursingStamps = (text: string): string =>
  text.replace(NURSING_STAMP_IN_TEXT, s => {
    const ms = parseNursingStamp(s)
    return ms === null ? s : `${displayFullStamp(minuteWire(ms))}:${secondsOf(ms)}`
  })

export type NursingRoundState =
  /** no nursing data: a one-time legacy order, completed with the empty request */
  | { kind: 'legacy' }
  /** nursing data but no current round (pending, completed or discontinued) */
  | { kind: 'inactive' }
  /** the current round can be completed now */
  | { kind: 'open'; round: NursingRound; dueMs: number }
  /** the current round opens at dueMs exactly (millisecond-exact; not before) */
  | { kind: 'locked'; round: NursingRound; dueMs: number }

export function nursingRoundState(order: Order, nowMs: number): NursingRoundState {
  if (!order.nursing) return { kind: 'legacy' }
  const round = order.nursing.currentRound
  if (!round || order.status !== 'active') return { kind: 'inactive' }
  const dueMs = parseNursingStamp(round.dueTime)
  if (dueMs === null) return { kind: 'inactive' }
  return nowMs >= dueMs ? { kind: 'open', round, dueMs } : { kind: 'locked', round, dueMs }
}

export const isRepeatingNursing = (order: Order): boolean => order.nursing?.intervalMinutes !== undefined

export const lastNursingCompletion = (order: Order): NursingCompletion | undefined => {
  const c = order.nursing?.completions
  return c && c.length > 0 ? c[c.length - 1] : undefined
}

/** "every 45 min" · "every 2 h" · "every 1 h 30 min" */
export function formatNursingInterval(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `every ${m} min`
  return m === 0 ? `every ${h} h` : `every ${h} h ${m} min`
}

/** "2026-10-15T10:01:59.900Z~r3" → { dueMs, number }; null when malformed */
export function parseNursingRoundId(id: string): { dueMs: number; number: number } | null {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)~r([1-9]\d{0,5})$/.exec(id)
  if (!m) return null
  const dueMs = parseNursingStamp(m[1])
  return dueMs === null ? null : { dueMs, number: Number(m[2]) }
}

/** a fresh attempt id — 32 hex chars from getRandomValues (randomUUID needs
 *  a secure context; the appliance may be served over plain LAN http) */
export const newNursingAttemptId = (): string =>
  [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('')

/** the form's whole-number interval + unit → minutes, or null when outside
 *  1 minute … 48 hours (or not a positive whole number) */
export function nursingIntervalMinutes(value: string, unit: 'minutes' | 'hours'): number | null {
  if (!/^[1-9]\d*$/.test(value.trim())) return null
  const n = Number(value.trim()) * (unit === 'hours' ? 60 : 1)
  return n >= NURSING_INTERVAL_MIN_MINUTES && n <= NURSING_INTERVAL_MAX_MINUTES ? n : null
}

/* ---------------- SETTLEMENT (Amendment 1, §9.2) ----------------
   One Done = one attempt. An answered FIRST send settles it (ok → recorded;
   a refusal → the only request was refused). An UNANSWERED attempt — and a
   retry the server refused (401 included) while it was unresolved — stays
   unconfirmed: the original request may still be in flight. Only an
   authoritative read of the order settles it:
   - confirmed: a completion carries the attempt's id;
   - not saved: the attempt's round was completed by another completion, or
     the order is no longer active and nothing carries the attempt — the
     server replays a recorded attempt before any state check and refuses a
     stale round, so the original can never commit afterwards;
   - otherwise unconfirmed (order absent from the read, its round still
     current). Elapsed time and an absent read prove nothing. */

export interface NursingPendingAttempt {
  attemptId: string
  orderId: string
  patientId: string
  roundId: string
  label: string
  /** nursing stamp form, when Done was clicked */
  clickedAt: string
}

export type NursingSettlement =
  | { kind: 'confirmed'; completion: NursingCompletion }
  | { kind: 'not-saved'; reason: string }
  | { kind: 'unconfirmed' }

/** `orders` = ONE authoritative per-patient read (getPatientOrdersAuthoritative);
 *  never a fallback/mock list in API mode, never the implementation queue */
export function settleNursingAttempt(attempt: NursingPendingAttempt, orders: Order[]): NursingSettlement {
  const o = orders.find(x => x.orderId === attempt.orderId)
  if (!o) return { kind: 'unconfirmed' }
  const completions = o.nursing?.completions ?? []
  const mine = completions.find(c => c.attemptId === attempt.attemptId)
  if (mine) return { kind: 'confirmed', completion: mine }
  const other = completions.find(c => c.roundId === attempt.roundId)
  if (other)
    return { kind: 'not-saved', reason: `this round was already completed by ${other.completedBy} at ${displayNursingTime(other.completedTime)}` }
  if (o.status !== 'active')
    return { kind: 'not-saved', reason: `the order is ${o.status} — this completion can no longer be recorded` }
  return { kind: 'unconfirmed' }
}
