import { documentAdministration, getMarRows, getMarRowsAuthoritative } from '../../lib/api'
import type { AdministrationAction, MarRow } from '../../lib/api/types'
import { getSession, type Session } from '../../lib/session'
import { instanceStamp } from '../../lib/marSchedule'
import { datedEpoch, displayFullStamp, displayStamp, nowHm } from '../../lib/time'

/* ---------------- THE SHARED MAR CONTROLLER (ICU nursing/patient-chart update, contract §4) ----------------
   Extracted from NurseWorkspace.tsx (MarAttempt, MarLock, settleFrom, sendAttempt,
   retryMar, the read sequence) WITHOUT changing a rule, so the Nurse Workspace and
   the patient chart's PatientNurseCarePanel document through ONE controller per tab:
   - it is created once by NurseCareProvider (App.tsx, inside the router, outside the
     routes) and outlives route changes, patient switching and either screen's
     unmounting; in-flight requests complete INTO it, never into an unmounted page;
   - locks are per orderId and global across screens;
   - outcomes (toast + the per-order notice) are shown by whichever consumer is mounted;
   - it follows the signed-in nurse (sign-out / another nurse: the previous nurse's
     attempts leave memory unsettled and stay stored under that nurse's key).

   [2026-10-05, SAFE RETRY — mar-derived-schedule.md ### F: the former
   UNCERTAIN_SETTLE_MS rule (an empty server read 15 s after a failure
   declared the dose NOT recorded and reopened it) is retired. Codex
   reproduced it recording a dose twice when the original request committed
   after that read, and settling on a stale read that arrived after a newer
   one. Elapsed time plus an absent fact proves nothing; see MarLock.] */

/* while a save is unconfirmed (or awaiting its refresh), the record is
   re-read this often — the shared poll is 20 s */
export const MAR_RECHECK_MS = 5_000

/* server refusals carry UTC wire stamps — the nurse reads hospital time */
export const localizeStamps = (s: string) =>
  s.replace(/(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/g, (_m, d: string, t: string) => displayFullStamp(`${d} ${t}`))

/** ONE documentation attempt: its identity and the documentation it
 *  carries, unchanged until the server's record settles it. Stored as-is
 *  under aurora.marUnconfirmed:<nurse> (the pre-extraction shape, plus the
 *  optional patientId — attempts stored by the previous build lack it and
 *  learn it from the first MAR row of their order). */
export interface MarAttempt {
  attemptId: string
  orderId: string
  adminId: string
  action: AdministrationAction
  reason?: string
  administeredAt?: string
  /** the minute it was documented (UTC wire) — a retry of an on-time Given
   *  sends it as the actual administration time, so saving late never
   *  moves when the dose was given */
  clickedAt: string
  /** what it documents: the round number, or the 'once' dose's stamp
   *  (null for PRN / on-demand, which have no round to settle on) */
  round: number | null
  onceStamp: string | null
  label: string
  /** the patient captured at the click: every settling read covers it,
   *  whichever screen or patient is showing — a route or patient switch
   *  never retargets an attempt */
  patientId?: string
}

/** one order's documentation, from the click until the server's record settles it:
 *  - 'saving': the attempt's request is in flight;
 *  - 'settling': answered (recorded, or a FIRST send refused) — held until a server read
 *    STARTED AFTER the answer, covering this order's patient, is applied
 *    (afterSeq), so the controls never reopen on rows older than the answer;
 *  - 'unconfirmed': no answer. Only the record settles it: a fact carrying
 *    this attempt's id (recorded), or its round / 'once' dose documented by
 *    another fact (it can never be recorded — a round takes one). Elapsed
 *    time and an absent fact prove nothing — the original request may
 *    still commit. The nurse may RETRY SAVING the same attempt: same id,
 *    same documentation, which the server answers with the existing record
 *    if either copy already landed. A REFUSED retry leaves it unconfirmed:
 *    the refusal may precede the server's attempt lookup. */
interface MarLock {
  phase: 'saving' | 'settling' | 'unconfirmed'
  attempt: MarAttempt
  afterSeq: number
}

/** what a card shows for an order with a documentation in progress */
export interface MarBusy {
  phase: 'saving' | 'checking' | 'unconfirmed'
  action: AdministrationAction
  /** the documented minute, display clock */
  at: string
}

export type ToastSink = (title: string, text: string, ms?: number) => void

/** the controller's collaborators — the real adapters by default; the
 *  evidence harness injects a controlled transport and clock */
export interface MarDeps {
  document: typeof documentAdministration
  readAuthoritative: typeof getMarRowsAuthoritative
  readDisplay: typeof getMarRows
  session: () => Session | null
  storage: () => Storage | null
  now: () => number
  setInterval: (fn: () => void, ms: number) => unknown
  clearInterval: (t: unknown) => void
}

const defaultDeps = (): MarDeps => ({
  document: documentAdministration,
  readAuthoritative: getMarRowsAuthoritative,
  readDisplay: getMarRows,
  session: getSession,
  storage: () => { try { return sessionStorage } catch { return null } },
  now: () => Date.now(),
  setInterval: (fn, ms) => window.setInterval(fn, ms),
  clearInterval: t => window.clearInterval(t as number),
})

export interface MarSnapshot {
  /** the last APPLIED read (display or authoritative), filtered to `covered` */
  rows: MarRow[]
  /** the patients that read covered */
  covered: ReadonlySet<string>
  /** its start sequence — a view shows rows only from a read started after it asked */
  seq: number
  /** epoch ms the read was applied (the DataAge chip) */
  at: number | null
  busy: ReadonlyMap<string, MarBusy>
  /** the last refusal per order, shown on its current row until it is documented again */
  notices: Readonly<Record<string, string>>
}

/** a fresh attempt id — 32 hex chars from getRandomValues (randomUUID needs
 *  a secure context; the appliance may be served over plain LAN http) */
export const newAttemptId = (): string =>
  [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('')

export const marPendingKey = (nurse: string) => `aurora.marUnconfirmed:${nurse}`

export class MarController {
  private readonly deps: MarDeps
  private owner: string | null = null
  private session: Session | null = null
  private locks = new Map<string, MarLock>()
  /* MAR reads are applied in the order they STARTED: a poll that began
     before a documentation committed can never overwrite the fresher read
     that settled it (which would re-show a resolved round as current) */
  private seq = { started: 0, applied: 0 }
  private views = new Map<number, readonly string[]>()
  private nextView = 1
  private patientOfOrder = new Map<string, string>()
  private listeners = new Set<() => void>()
  private recheck: unknown = null
  private snap: MarSnapshot
  /** set by the provider; only delivered while a consumer is mounted */
  toast: ToastSink = () => {}

  constructor(deps: Partial<MarDeps> = {}) {
    this.deps = { ...defaultDeps(), ...deps }
    this.snap = { rows: [], covered: new Set(), seq: 0, at: null, busy: new Map(), notices: {} }
    this.syncSession()
  }

  /* ---------- store plumbing (useSyncExternalStore) ---------- */
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }
  getSnapshot = (): MarSnapshot => this.snap
  private emit(patch: Partial<MarSnapshot>) {
    this.snap = { ...this.snap, ...patch }
    for (const fn of [...this.listeners]) fn()
  }

  /** the sequence a view must see exceeded before it shows rows (its
   *  registration or patient change) — a read started earlier is never shown */
  startedSeq = (): number => this.seq.started

  /** a mounted screen's patients (display + read scope); returns its token */
  registerView(patientIds: readonly string[]): number {
    const token = this.nextView++
    this.views.set(token, patientIds)
    return token
  }
  updateView(token: number, patientIds: readonly string[]) { this.views.set(token, patientIds) }
  unregisterView(token: number) { this.views.delete(token) }
  get viewCount(): number { return this.views.size }

  /* ---------- the signed-in nurse ---------- */
  /** follow getSession(): another name (sign-out, re-authentication as
   *  someone else) drops the previous nurse's attempts from memory — they
   *  stay stored under that nurse's key, unsettled — and restores the new
   *  nurse's own; another nurse never sees or sends them */
  syncSession(): void {
    const s = this.deps.session()
    const name = s?.name ?? null
    this.session = s
    if (name === this.owner) return
    this.owner = name
    this.locks = new Map()
    if (name !== null) {
      try {
        for (const a of JSON.parse(this.deps.storage()?.getItem(marPendingKey(name)) ?? '[]') as MarAttempt[])
          this.locks.set(a.orderId, { phase: 'unconfirmed', attempt: a, afterSeq: 0 })
      } catch { /* storage unavailable or unreadable — nothing to restore */ }
    }
    this.emit({ rows: [], covered: new Set(), at: null, notices: {}, busy: this.busyOf() })
    this.armRecheck()
  }

  private busyOf(): Map<string, MarBusy> {
    return new Map([...this.locks].map(([id, l]) => [id, {
      phase: l.phase === 'settling' ? 'checking' : l.phase,
      action: l.attempt.action,
      at: displayStamp(l.attempt.administeredAt ?? l.attempt.clickedAt),
    } satisfies MarBusy] as const))
  }

  /** publish the busy state and keep every attempt whose outcome is not
   *  known yet across a reload (this tab, this nurse) */
  private sync(): void {
    if (this.owner !== null) this.persist(this.owner, [...this.locks.values()].filter(l => l.phase !== 'settling').map(l => l.attempt))
    this.emit({ busy: this.busyOf() })
    this.armRecheck()
  }
  private persist(owner: string, open: MarAttempt[]) {
    try {
      const st = this.deps.storage()
      if (!st) return
      if (open.length) st.setItem(marPendingKey(owner), JSON.stringify(open)); else st.removeItem(marPendingKey(owner))
    } catch { /* private mode — in-memory only */ }
  }

  private setNotice(orderId: string, text: string | null) {
    const next = { ...this.snap.notices }
    if (text === null) delete next[orderId]; else next[orderId] = text
    this.emit({ notices: next })
  }

  /* ---------- reads ---------- */
  /** every mounted screen's patients plus the patient of every lock — a
   *  settling read must cover the locks, not only the patient on screen */
  private readIds(): string[] {
    const ids = new Set<string>()
    for (const v of this.views.values()) for (const id of v) ids.add(id)
    for (const l of this.locks.values()) {
      const pid = l.attempt.patientId ?? this.patientOfOrder.get(l.attempt.orderId)
      if (pid) ids.add(pid)
    }
    return [...ids]
  }

  /** the shared poll's read: with a documentation in progress it reads the
   *  server's own record (the only read that settles one); otherwise the
   *  display read */
  async refresh(): Promise<void> {
    this.syncSession()
    if (this.locks.size) return this.refreshAuthoritative()
    const ids = this.readIds()
    if (!ids.length) return
    const seq = ++this.seq.started
    const rows = await this.deps.readDisplay(ids)
    this.apply(seq, ids, rows, false)
  }

  /** start a server read now (null result: unreadable — locks stay) */
  async refreshAuthoritative(): Promise<void> {
    const ids = this.readIds()
    if (!ids.length) return
    const seq = ++this.seq.started
    const rows = await this.deps.readAuthoritative(ids)
    if (rows) this.apply(seq, ids, rows, true)
  }

  /* a read older than one already applied is discarded WHOLE — neither
     shown nor used to settle anything (Codex's out-of-order case); only a
     server read (authoritative) settles a documentation */
  private apply(seq: number, ids: string[], rows: MarRow[], authoritative: boolean) {
    if (seq <= this.seq.applied) return
    this.seq.applied = seq
    for (const r of rows) this.patientOfOrder.set(r.orderId, r.patientId)
    this.emit({ rows, covered: new Set(ids), seq, at: this.deps.now() })
    if (authoritative) this.settleFrom(seq, ids, rows)
  }

  /** settle what an applied SERVER read can settle (called only for a read
   *  newer than every read already applied) */
  private settleFrom(seq: number, ids: string[], rows: MarRow[]) {
    let changed = false
    for (const [orderId, l] of this.locks) {
      if (l.phase === 'saving') continue
      const pid = l.attempt.patientId ?? this.patientOfOrder.get(orderId)
      /* a read that did not cover this order's patient proves nothing about it */
      if (!pid || !ids.includes(pid)) continue
      if (l.phase === 'settling') {
        if (seq > l.afterSeq) { this.locks.delete(orderId); changed = true }
        continue
      }
      const a = l.attempt
      const facts = rows.filter(r => r.orderId === orderId && r.status !== 'scheduled')
      if (facts.some(r => r.attemptId === a.attemptId)) {
        this.locks.delete(orderId); changed = true
        this.setNotice(orderId, null)   // a refused retry's notice no longer applies
        this.toast('Saved — confirmed', `${a.label}: your ${a.action} documentation (${displayStamp(a.administeredAt ?? a.clickedAt)}) is on the record`)
        continue
      }
      const other = a.round !== null ? facts.find(r => r.round === a.round)
        : a.onceStamp !== null ? facts.find(r => r.scheduledTime === a.onceStamp) : undefined
      if (other) {
        this.locks.delete(orderId); changed = true
        const why = `this dose was already documented as ${other.status} by another documentation — your ${a.action} was not saved, and cannot be`
        this.toast('Documentation NOT saved', `${a.label}: ${why}`, 6000)
        this.setNotice(orderId, `Not saved — ${why}.`)
      }
      /* otherwise it stays unconfirmed: an absent fact is not proof */
    }
    if (changed) this.sync()
  }

  /* ---------- documentation ---------- */
  /* MAR: documentation APPENDS an administration fact on the canonical
     order (derived schedule — nothing stored is consumed), so the honest
     next state is a fresh derivation: re-fetch rather than patch rows.
     ONE ACTION PER ROUND — SUBMISSION PROTECTION (owner's correction,
     2026-10-05): an order with a documentation in flight, or whose outcome
     a fresh SERVER read has not yet settled, accepts nothing — Given,
     Held, Refused and the reason dialog's confirm alike stay disabled
     through the save AND the authoritative refresh. The lock map is the
     immediate guard (a second click in the same frame sees it before
     React re-renders); the snapshot drives the disabled buttons and their
     "saving / checking" line. A refusal is shown with the server's reason.
     SAFE RETRY (2026-10-05, ### F): every documentation is one ATTEMPT with
     its own id, sent with it and stored on the fact it creates. An
     UNANSWERED save stays unconfirmed until the record settles it
     (MarLock) — never by elapsed time — and is never re-sent blindly: the
     nurse may retry SAVING the same attempt, which can never record twice.
     Unconfirmed attempts survive a page reload (sessionStorage, this tab,
     this nurse). Documenting again later is a new attempt. */
  isLocked = (orderId: string): boolean => this.locks.has(orderId)

  document(row: MarRow, action: AdministrationAction, label: string, reason?: string, administeredAt?: string): void {
    this.syncSession()
    if (!this.session || this.locks.has(row.orderId)) return   // immediate: one documentation per order at a time
    void this.sendAttempt({
      attemptId: newAttemptId(), orderId: row.orderId, adminId: row.adminId, action, reason, administeredAt,
      clickedAt: instanceStamp(Math.floor(this.deps.now() / 60_000) * 60_000),
      round: row.round ?? null,
      onceStamp: row.round == null && datedEpoch(row.scheduledTime) !== null ? row.scheduledTime : null,
      label, patientId: row.patientId,
    }, false)
  }

  /** "Retry saving": the SAME attempt again — only while it is unconfirmed */
  retry(orderId: string): void {
    this.syncSession()
    const l = this.locks.get(orderId)
    if (l?.phase === 'unconfirmed') void this.sendAttempt(l.attempt, true)
  }

  /** send one attempt (first time, or a retry of the same attempt) */
  private async sendAttempt(a: MarAttempt, retry: boolean): Promise<void> {
    const session = this.session
    const owner = this.owner
    if (!session || owner === null) return
    const lock: MarLock = { phase: 'saving', attempt: a, afterSeq: Infinity }
    this.locks.set(a.orderId, lock)
    this.setNotice(a.orderId, null)
    this.sync()
    /* a retried on-time Given carries the minute it was documented as its
       actual time (Held/Refused carry no administration time) */
    const pinned = retry && a.action === 'given' && !a.administeredAt
    const send = (at?: string) =>
      this.deps.document(a.orderId, a.adminId, a.action, session.name, session.jobTitle, a.reason, at, a.attemptId)
    let res = await send(pinned ? a.clickedAt : a.administeredAt)
    /* only the pinned time can make a retry fail validation where the
       original would pass (a device clock ahead of the server, or a day
       gone by): a 400 then re-sends the ORIGINAL request exactly. Its
       refusal is still a refused retry — the original may still be in
       flight — so it settles nothing (below) */
    if (pinned && res.kind === 'rejected' && res.status === 400 && this.locks.get(a.orderId) === lock) res = await send(undefined)
    if (this.locks.get(a.orderId) !== lock) {
      /* the nurse signed out (or another nurse signed in) meanwhile: the
         outcome updates only that nurse's stored copy */
      if (this.owner !== owner) this.settleOrphan(owner, a, res.kind === 'ok' || (res.kind === 'rejected' && !retry))
      return
    }
    if (res.kind === 'ok') {
      const all = res.order.administrations ?? []
      const fact = all.find(f => f.attemptId === a.attemptId) ?? all.filter(f => f.status === a.action).pop()
      this.toast(retry ? 'Saved — confirmed' : 'Documented', `${a.label} — ${a.action} ${displayStamp(fact?.documentedTime) || nowHm()}`)
      lock.phase = 'settling'
    } else if (res.kind === 'rejected' && !retry) {
      /* the server refused the ONLY request (a first send): nothing was
         recorded */
      const why = localizeStamps(res.error)
      this.toast('Dose NOT recorded', `${a.label}: ${why}`, 6000)
      this.setNotice(a.orderId, `Not recorded — ${why}`)
      lock.phase = 'settling'
    } else {
      /* no answer — or a REFUSED RETRY of an unconfirmed attempt (Codex
         review of 72a7894): a refusal can come before the server looks for
         the attempt (401, 403, a client-side check, request validation —
         the pinned-minute fallback's included), and an absent fact proves
         nothing, so it never shows that the original failed: the original
         may still be in flight and commit later. The attempt stays
         unconfirmed with its stored copy; only the record settles it
         (settleFrom — its fact, or its round / 'once' dose documented by
         another fact). Same rule as the nursing rounds (Amendment 1 §9.2). */
      lock.phase = 'unconfirmed'
      /* the actual reason: a 401 keeps its sign-in wording; any other
         refusal (403, a client-side check, validation) shows its own */
      const expired = res.kind === 'rejected' && res.status === 401
      const what = res.kind !== 'rejected' ? res.error
        : expired ? 'your session has expired — sign in again, then retry saving'
          : `the retry was refused — ${localizeStamps(res.error)}`
      if (res.kind === 'rejected')
        this.setNotice(a.orderId, `Retry refused — ${expired ? 'your session has expired — sign in again, then retry saving' : localizeStamps(res.error)}. `
          + `Your original ${a.action} documentation may already be on the record; checking.`)
      this.toast(res.kind === 'rejected' && !expired ? 'Retry refused' : 'Save not confirmed',
        `${a.label}: ${what} — your ${a.action} documentation is kept and may already be on the record. `
        + 'It is confirmed from the server\'s record; "Retry saving" re-sends the same documentation and can never record it twice.', 8000)
    }
    lock.afterSeq = this.seq.started
    this.sync()
    await this.refreshAuthoritative()
  }

  /** an answered attempt of a nurse no longer signed in: an answer that
   *  settles it (recorded, or a refused FIRST send) removes it from that
   *  nurse's stored copy; no answer or a refused retry keeps it there,
   *  unconfirmed */
  private settleOrphan(owner: string, a: MarAttempt, answered: boolean) {
    if (!answered) return
    try {
      const st = this.deps.storage()
      const stored = JSON.parse(st?.getItem(marPendingKey(owner)) ?? '[]') as MarAttempt[]
      this.persist(owner, stored.filter(x => x.attemptId !== a.attemptId))
    } catch { /* storage unavailable */ }
  }

  /* ---------- the 5 s recheck ---------- */
  /* while anything is unconfirmed or awaiting its refresh, re-read the
     record more often than the shared poll — whichever screen is mounted,
     or none */
  private armRecheck() {
    const waiting = [...this.locks.values()].some(l => l.phase !== 'saving')
    if (waiting && this.recheck === null) this.recheck = this.deps.setInterval(() => void this.refreshAuthoritative(), MAR_RECHECK_MS)
    else if (!waiting && this.recheck !== null) { this.deps.clearInterval(this.recheck); this.recheck = null }
  }

  /** stop timers (provider unmount); a later sync re-arms them */
  dispose() {
    if (this.recheck !== null) { this.deps.clearInterval(this.recheck); this.recheck = null }
  }
  resume() { this.armRecheck() }
}
