import { getImplementationQueue, getPatientOrdersAuthoritative, implementNursingOrder, type NursingWriteResult } from '../../lib/api'
import type { Order } from '../../lib/api/types'
import {
  localizeNursingStamps, newNursingAttemptId, nursingRoundState, nursingStampOf, settleNursingAttempt,
  type NursingPendingAttempt,
} from '../../lib/nursingRounds'
import { getSession, type Session } from '../../lib/session'
import type { ToastSink } from './marController'

/* ---------------- ORDERS TO IMPLEMENT — NURSING ROUNDS (contract §3.6 + Amendment 1 §9.2) ----------------
   One controller per tab (NurseCareProvider), so a Done in flight completes into it
   whatever screen is showing. Every rule is the server's round identity:
   - a round-contract order (nursing data) is completed with ONE attempt per
     deliberate Done: { roundId, attemptId }. A retry re-sends exactly that pair;
     the server answers a recorded attempt with the order as it is (N copies → 1
     completion), so a retry can never complete a round twice;
   - a LEGACY one-time order (no nursing data) keeps the existing empty request;
     its single completion makes a duplicate impossible;
   - the per-order lock is the immediate guard (a second click sees it before React
     re-renders) and keeps Done disabled through the save AND an authoritative read
     started after the answer; the order-ID-only "completed" set is gone — a
     repeating order is never suppressed, its next round is shown locked;
   - an UNANSWERED save stays unconfirmed. Only the authoritative per-patient order
     read settles it (settleNursingAttempt): a completion carrying the attempt id
     (confirmed), or its round completed by another completion / the order no longer
     active without it (not saved). Elapsed time, an absent row or a missing queue
     entry prove nothing. A REFUSED RETRY of an unconfirmed attempt does not prove the
     original failed (§9.2): the reason is shown, the attempt stays unconfirmed. */

export const NURSING_RECHECK_MS = 5_000
export const nursingPendingKey = (nurse: string) => `aurora.nursingUnconfirmed:${nurse}`

/** the empty-request Done of a legacy one-time order (no round identity) */
export interface LegacyDone {
  orderId: string
  patientId: string
  label: string
}

interface NursingLock {
  phase: 'saving' | 'settling' | 'unconfirmed'
  /** the round contract's attempt, or null for a legacy empty-request Done */
  attempt: NursingPendingAttempt | null
  legacy: LegacyDone | null
  afterSeq: number
}

export interface NursingBusy {
  phase: 'saving' | 'checking' | 'unconfirmed'
  /** the round this lock documents (null: legacy) */
  roundId: string | null
  legacy: boolean
}

export interface NursingSnapshot {
  /** the implementation queue as displayed: each order in its FRESHEST known
   *  version (a later read or a write answer), still active */
  orders: Order[] | null
  /** the patients the displayed queue read covered */
  covered: ReadonlySet<string>
  seq: number
  at: number | null
  busy: ReadonlyMap<string, NursingBusy>
  notices: Readonly<Record<string, string>>
}

export interface NursingDeps {
  implement: typeof implementNursingOrder
  readQueue: typeof getImplementationQueue
  readPatientOrders: typeof getPatientOrdersAuthoritative
  session: () => Session | null
  storage: () => Storage | null
  now: () => number
  setInterval: (fn: () => void, ms: number) => unknown
  clearInterval: (t: unknown) => void
}

const defaultDeps = (): NursingDeps => ({
  implement: implementNursingOrder,
  readQueue: getImplementationQueue,
  readPatientOrders: getPatientOrdersAuthoritative,
  session: getSession,
  storage: () => { try { return sessionStorage } catch { return null } },
  now: () => Date.now(),
  setInterval: (fn, ms) => window.setInterval(fn, ms),
  clearInterval: t => window.clearInterval(t as number),
})

const isImplementable = (o: Order) =>
  o.status === 'active' && !!o.requiresImplementation && o.category !== 'Lab' && o.category !== 'Imaging'

export class NursingRoundsController {
  private readonly deps: NursingDeps
  private owner: string | null = null
  private session: Session | null = null
  private locks = new Map<string, NursingLock>()
  /* one sequence for every read AND every write answer: an order's displayed
     version is the newest by START (a read) or by ARRIVAL (an answer) */
  private seq = 0
  private queue: { seq: number; ids: string[]; orders: Order[] } | null = null
  private fresh = new Map<string, { seq: number; order: Order }>()
  /** per patient: the start sequence of the last applied authoritative read */
  private appliedByPatient = new Map<string, number>()
  private views = new Map<number, readonly string[]>()
  private nextView = 1
  private listeners = new Set<() => void>()
  private recheck: unknown = null
  private snap: NursingSnapshot
  toast: ToastSink = () => {}

  constructor(deps: Partial<NursingDeps> = {}) {
    this.deps = { ...defaultDeps(), ...deps }
    this.snap = { orders: null, covered: new Set(), seq: 0, at: null, busy: new Map(), notices: {} }
    this.syncSession()
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }
  getSnapshot = (): NursingSnapshot => this.snap
  startedSeq = (): number => this.seq
  private emit(patch: Partial<NursingSnapshot>) {
    this.snap = { ...this.snap, ...patch }
    for (const fn of [...this.listeners]) fn()
  }

  registerView(patientIds: readonly string[]): number {
    const t = this.nextView++
    this.views.set(t, patientIds)
    return t
  }
  updateView(token: number, patientIds: readonly string[]) { this.views.set(token, patientIds) }
  unregisterView(token: number) { this.views.delete(token) }
  get viewCount(): number { return this.views.size }

  /* ---------- the signed-in nurse (same rule as the MAR controller) ---------- */
  syncSession(): void {
    const s = this.deps.session()
    const name = s?.name ?? null
    this.session = s
    if (name === this.owner) return
    this.owner = name
    this.locks = new Map()
    this.queue = null
    this.fresh = new Map()
    this.appliedByPatient = new Map()
    if (name !== null) {
      try {
        for (const a of JSON.parse(this.deps.storage()?.getItem(nursingPendingKey(name)) ?? '[]') as NursingPendingAttempt[])
          if (a && typeof a.attemptId === 'string' && typeof a.patientId === 'string')
            this.locks.set(a.orderId, { phase: 'unconfirmed', attempt: a, legacy: null, afterSeq: 0 })
      } catch { /* storage unavailable or unreadable — nothing to restore */ }
    }
    this.emit({ orders: null, covered: new Set(), at: null, notices: {}, busy: this.busyOf() })
    this.armRecheck()
  }

  private busyOf(): Map<string, NursingBusy> {
    return new Map([...this.locks].map(([id, l]) => [id, {
      phase: l.phase === 'settling' ? 'checking' : l.phase,
      roundId: l.attempt?.roundId ?? null,
      legacy: l.attempt === null,
    } satisfies NursingBusy] as const))
  }
  private sync() {
    if (this.owner !== null) this.persist(this.owner, this.openAttempts())
    this.emit({ busy: this.busyOf() })
    this.armRecheck()
  }
  private openAttempts(): NursingPendingAttempt[] {
    return [...this.locks.values()].filter(l => l.phase !== 'settling' && l.attempt).map(l => l.attempt!)
  }
  private persist(owner: string, open: NursingPendingAttempt[]) {
    try {
      const st = this.deps.storage()
      if (!st) return
      if (open.length) st.setItem(nursingPendingKey(owner), JSON.stringify(open)); else st.removeItem(nursingPendingKey(owner))
    } catch { /* private mode — in-memory only */ }
  }
  private setNotice(orderId: string, text: string | null) {
    const next = { ...this.snap.notices }
    if (text === null) delete next[orderId]; else next[orderId] = text
    this.emit({ notices: next })
  }

  /* ---------- display: the queue, each order in its freshest version ---------- */
  private recompute() {
    if (!this.queue) return
    const q = this.queue
    const orders = q.orders.map(o => {
      const f = this.fresh.get(o.orderId)
      return f && f.seq > q.seq ? f.order : o
    }).filter(isImplementable)
    this.emit({ orders, covered: new Set(q.ids), seq: q.seq })
  }

  private viewIds(): string[] {
    const ids = new Set<string>()
    for (const v of this.views.values()) for (const id of v) ids.add(id)
    return [...ids]
  }

  /** the shared poll: the implementation queue for the mounted screens, plus
   *  the authoritative per-patient reads while anything is in progress */
  async refresh(): Promise<void> {
    this.syncSession()
    const ids = this.viewIds()
    const pending = this.lockPatients()
    const work: Promise<void>[] = []
    if (ids.length) {
      const seq = ++this.seq
      work.push(this.deps.readQueue(ids).then(orders => {
        if (this.queue && seq <= this.queue.seq) return   // an older read than the one shown — discarded whole
        this.queue = { seq, ids, orders }
        this.emit({ at: this.deps.now() })
        this.recompute()
      }))
    }
    if (pending.length) work.push(this.refreshPatients(pending))
    await Promise.all(work)
  }

  private lockPatients(): string[] {
    return [...new Set([...this.locks.values()].map(l => l.attempt?.patientId ?? l.legacy?.patientId).filter((p): p is string => !!p))]
  }

  /** the SETTLING read: one authoritative per-patient order list per patient
   *  (it keeps completed and discontinued orders — the queue drops them) */
  async refreshPatients(patientIds: string[] = this.lockPatients()): Promise<void> {
    await Promise.all(patientIds.map(async pid => {
      const seq = ++this.seq
      const orders = await this.deps.readPatientOrders(pid)
      if (!orders) return                                         // unreadable: nothing settles
      if (seq <= (this.appliedByPatient.get(pid) ?? 0)) return   // stale: discarded whole
      this.appliedByPatient.set(pid, seq)
      for (const o of orders) {
        const f = this.fresh.get(o.orderId)
        if (!f || seq > f.seq) this.fresh.set(o.orderId, { seq, order: o })
      }
      this.settleFrom(pid, seq, orders)
      this.recompute()
    }))
  }

  private settleFrom(pid: string, seq: number, orders: Order[]) {
    let changed = false
    for (const [orderId, l] of this.locks) {
      if (l.phase === 'saving') continue
      const lockPid = l.attempt?.patientId ?? l.legacy?.patientId
      if (lockPid !== pid) continue
      if (l.phase === 'settling') {
        if (seq > l.afterSeq) { this.locks.delete(orderId); changed = true }
        continue
      }
      if (l.attempt) {
        const verdict = settleNursingAttempt(l.attempt, orders)
        if (verdict.kind === 'confirmed') {
          this.locks.delete(orderId); changed = true
          this.setNotice(orderId, null)
          this.toast('Saved — confirmed', `${l.attempt.label}: your Done is on the record`)
        } else if (verdict.kind === 'not-saved') {
          this.locks.delete(orderId); changed = true
          const why = localizeNursingStamps(verdict.reason)
          this.toast('Done NOT saved', `${l.attempt.label}: ${why}`, 6000)
          this.setNotice(orderId, `Not saved — ${why}.`)
        }
        /* otherwise unconfirmed: an absent completion is not proof */
      } else if (l.legacy) {
        /* a legacy one-time order completes once: no longer active on the
           record = completed (by this Done or another) — nothing to repeat */
        const o = orders.find(x => x.orderId === orderId)
        if (o && o.status !== 'active') {
          this.locks.delete(orderId); changed = true
          this.setNotice(orderId, null)
          this.toast('Order no longer open', `${l.legacy.label}: the record shows it ${o.status}`)
        }
      }
    }
    if (changed) this.sync()
  }

  /* ---------- Done ---------- */
  isLocked = (orderId: string): boolean => this.locks.has(orderId)

  /** the newest version of an order this controller knows (a later read or
   *  a write answer), or the one given */
  private freshest(order: Order): Order {
    const f = this.fresh.get(order.orderId)
    const q = this.queue?.orders.find(o => o.orderId === order.orderId)
    if (f && (!q || f.seq > this.queue!.seq)) return f.order
    return q ?? order
  }

  /** a deliberate Done on the order as displayed — re-checked against the
   *  newest known version of the order and the real clock, never only the
   *  last render */
  done(shown: Order, label: string): void {
    this.syncSession()
    if (!this.session || this.locks.has(shown.orderId)) return   // immediate: one Done per order at a time
    const order = this.freshest(shown)
    if (!isImplementable(order)) return
    const state = nursingRoundState(order, this.deps.now())
    if (state.kind === 'legacy') {
      void this.send({ phase: 'saving', attempt: null, legacy: { orderId: order.orderId, patientId: order.patientId, label }, afterSeq: Infinity }, false)
      return
    }
    if (state.kind !== 'open') return
    void this.send({
      phase: 'saving', legacy: null, afterSeq: Infinity,
      attempt: {
        attemptId: newNursingAttemptId(), orderId: order.orderId, patientId: order.patientId,
        roundId: state.round.roundId, label, clickedAt: nursingStampOf(this.deps.now()),
      },
    }, false)
  }

  /** "Retry saving": the SAME { roundId, attemptId } — only while unconfirmed */
  retry(orderId: string): void {
    this.syncSession()
    const l = this.locks.get(orderId)
    if (l?.phase !== 'unconfirmed') return
    void this.send({ phase: 'saving', attempt: l.attempt, legacy: l.legacy, afterSeq: Infinity }, true)
  }

  private async send(lock: NursingLock, retry: boolean): Promise<void> {
    const session = this.session
    const owner = this.owner
    if (!session || owner === null) return
    const orderId = lock.attempt?.orderId ?? lock.legacy!.orderId
    const label = lock.attempt?.label ?? lock.legacy!.label
    this.locks.set(orderId, lock)
    this.setNotice(orderId, null)
    this.sync()
    const res: NursingWriteResult = await this.deps.implement(orderId, session.name, session.jobTitle,
      lock.attempt ? { roundId: lock.attempt.roundId, attemptId: lock.attempt.attemptId } : undefined)
    if (this.locks.get(orderId) !== lock) {
      if (this.owner !== owner && lock.attempt) this.settleOrphan(owner, lock.attempt, res, retry)
      return
    }
    if (res.kind === 'ok') {
      const seq = ++this.seq
      this.fresh.set(orderId, { seq, order: res.order })
      this.recompute()
      this.toast(retry ? 'Saved — confirmed' : 'Order implemented', `${label}${res.order.status === 'active' ? ' — this round is done' : ''}`)
      lock.phase = 'settling'
    } else if (res.kind === 'rejected' && !retry) {
      /* the server refused the ONLY request (a first send): nothing was
         recorded */
      const why = localizeNursingStamps(res.error)
      this.toast('Done NOT recorded', `${label}: ${why}`, 6000)
      this.setNotice(orderId, `Not recorded — ${why}`)
      lock.phase = 'settling'
    } else {
      /* no answer — or a REFUSED RETRY of an unresolved attempt (Amendment 1
         §9.2): the original may still be in flight and commit later, so it
         stays unconfirmed with its stored copy; only the record settles it
         (a legacy one-time order: the record showing it no longer active) */
      lock.phase = 'unconfirmed'
      if (res.kind === 'rejected') {
        const why = res.status === 401 ? 'your session has expired — sign in again, then retry saving' : localizeNursingStamps(res.error)
        this.setNotice(orderId, `Retry refused — ${why}. Your original Done may still be on the record; checking.`)
        this.toast('Retry refused', `${label}: ${why}`, 6000)
      } else {
        this.toast('Save not confirmed',
          `${label}: ${res.error} — your Done is kept and may already be on the record. `
          + 'It is confirmed from the server\'s record; "Retry saving" re-sends the same Done and can never complete the round twice.', 8000)
      }
    }
    lock.afterSeq = this.seq
    this.sync()
    /* the queue for the screens, and the authoritative read of every locked
       patient (this one included) — only that read reopens the control. A
       production queue read that cannot be served has already raised the
       API-unavailable overlay; the 5 s recheck keeps reading the record. */
    try { await this.refresh() } catch { /* see above */ }
  }

  private settleOrphan(owner: string, a: NursingPendingAttempt, res: NursingWriteResult, retry: boolean) {
    /* only an answer that settles it leaves the signed-out nurse's stored copy */
    const settles = res.kind === 'ok' || (res.kind === 'rejected' && !retry)
    if (!settles) return
    try {
      const stored = JSON.parse(this.deps.storage()?.getItem(nursingPendingKey(owner)) ?? '[]') as NursingPendingAttempt[]
      this.persist(owner, stored.filter(x => x.attemptId !== a.attemptId))
    } catch { /* storage unavailable */ }
  }

  private armRecheck() {
    const waiting = [...this.locks.values()].some(l => l.phase !== 'saving')
    if (waiting && this.recheck === null) this.recheck = this.deps.setInterval(() => void this.refreshPatients(), NURSING_RECHECK_MS)
    else if (!waiting && this.recheck !== null) { this.deps.clearInterval(this.recheck); this.recheck = null }
  }
  dispose() {
    if (this.recheck !== null) { this.deps.clearInterval(this.recheck); this.recheck = null }
  }
  resume() { this.armRecheck() }
}
