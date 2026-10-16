/* [SESSION-3 CONTRACT STAND-IN — NOT SESSION 1'S IMPLEMENTATION]
   src/lib/nursingRounds.ts as frozen by docs/design/icu-update-nursing-patient-chart-contracts.md
   §3.5 + Amendment 1 §9.1/§9.2, written by Session 3 only so its branch can be type-checked and
   exercised before Session 1's branch exists. It is overlaid onto a scratch copy, never committed
   at this path; Session 1's real module replaces it at integration. */
import type { NursingCompletion, NursingRound, Order } from './api/types'
import { formatHm, localDayNumber, localStamp } from './time'

export const NURSING_INTERVAL_MIN_MINUTES = 1
export const NURSING_INTERVAL_MAX_MINUTES = 2880

export type NursingRoundState =
  | { kind: 'legacy' }
  | { kind: 'inactive' }
  | { kind: 'open'; round: NursingRound; dueMs: number }
  | { kind: 'locked'; round: NursingRound; dueMs: number }

const NURSING_STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

export function parseNursingStamp(stamp: string): number | null {
  if (!NURSING_STAMP.test(stamp)) return null
  const ms = Date.parse(stamp)
  return Number.isNaN(ms) ? null : ms
}

export const nursingStampOf = (ms: number): string => new Date(ms).toISOString()

export function parseNursingRoundId(id: string): { dueMs: number; number: number } | null {
  const m = /^(.+)~r(\d+)$/.exec(id)
  if (!m) return null
  const dueMs = parseNursingStamp(m[1])
  return dueMs === null ? null : { dueMs, number: Number(m[2]) }
}

export function nursingRoundState(order: Order, nowMs: number): NursingRoundState {
  if (!order.nursing) return { kind: 'legacy' }
  const round = order.nursing.currentRound
  if (!round || order.status !== 'active') return { kind: 'inactive' }
  const dueMs = parseNursingStamp(round.dueTime) ?? parseNursingRoundId(round.roundId)?.dueMs ?? null
  if (dueMs === null) return { kind: 'inactive' }
  return nowMs >= dueMs ? { kind: 'open', round, dueMs } : { kind: 'locked', round, dueMs }
}

export const isRepeatingNursing = (order: Order): boolean => order.nursing?.intervalMinutes !== undefined

export const lastNursingCompletion = (order: Order): NursingCompletion | undefined => {
  const c = order.nursing?.completions ?? []
  return c[c.length - 1]
}

export function formatNursingInterval(minutes: number): string {
  if (minutes < 60) return `every ${minutes} min`
  const h = Math.floor(minutes / 60), m = minutes % 60
  return m ? `every ${h} h ${m} min` : `every ${h} h`
}

export const newNursingAttemptId = (): string =>
  [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('')

const secondsOf = (ms: number) => String(new Date(ms).getUTCSeconds()).padStart(2, '0')
/** hospital clock to the second; "D-1 …" for earlier days */
export function displayNursingTime(stamp: string): string {
  const ms = parseNursingStamp(stamp)
  if (ms === null) return stamp
  const hm = localStamp(ms).slice(11, 16)
  const f = formatHm(hm)
  const t = f === hm ? `${hm}:${secondsOf(ms)}` : f.replace(/^(\d{1,2}:\d{2})/, `$1:${secondsOf(ms)}`)
  const off = localDayNumber(ms) - localDayNumber(Date.now())
  return off === 0 ? t : `D${off} ${t}`
}

export const localizeNursingStamps = (text: string): string =>
  text.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, s => {
    const ms = parseNursingStamp(s)
    return ms === null ? s : `${localStamp(ms)}:${secondsOf(ms)}`
  })

export interface NursingPendingAttempt {
  attemptId: string
  orderId: string
  patientId: string
  roundId: string
  label: string
  clickedAt: string
}
export type NursingSettlement =
  | { kind: 'confirmed'; completion: NursingCompletion }
  | { kind: 'not-saved'; reason: string }
  | { kind: 'unconfirmed' }

export function settleNursingAttempt(attempt: NursingPendingAttempt, orders: Order[]): NursingSettlement {
  const order = orders.find(o => o.orderId === attempt.orderId)
  if (!order) return { kind: 'unconfirmed' }
  const completions = order.nursing?.completions ?? []
  const mine = completions.find(c => c.attemptId === attempt.attemptId)
  if (mine) return { kind: 'confirmed', completion: mine }
  const other = completions.find(c => c.roundId === attempt.roundId)
  if (other) return { kind: 'not-saved', reason: `this round was already completed by ${other.completedBy} at ${other.completedTime}` }
  if (order.status !== 'active') return { kind: 'not-saved', reason: `the order is ${order.status}` }
  return { kind: 'unconfirmed' }
}
