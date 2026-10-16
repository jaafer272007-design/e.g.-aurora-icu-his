// Session 3 — deterministic checks of the EXTRACTED controllers (the real modules under
// src/features/nurse-care, not a mirror), under a FAKE clock with a controlled transport.
//   MAR: the "server" is the app's own mock adapter (src/lib/api/data/orders.ts applyAdministration +
//        deriveMarRows — the client-side mirror of the server's MAR rules), so attempt replay,
//        round identity and first-dose rules are the shipped ones.
//   Nursing rounds: the server is a CONTRACT SIMULATOR written here from contract §3.3/§3.4 +
//        Amendment 1 §9.1 (Session 1's server is not on this branch).
//   I&O: the save guard.
// Built by run-controller-harness.sh with esbuild, alias @app -> <tree>/src, where <tree> is either a
// scratch overlay (this branch + the contract stand-ins) or the integrated source.
import { fakeStorage } from './harness-globals'
import { MarController, marPendingKey, type MarAttempt, type MarDeps } from '@app/features/nurse-care/marController'
import { NursingRoundsController, nursingPendingKey, type NursingDeps } from '@app/features/nurse-care/nursingController'
import { IoSaveGuard } from '@app/features/nurse-care/ioController'
import { implementCounts } from '@app/pages/NurseWorkspace/OrdersCard'
import { allOrders, applyAdministration, deriveMarRows } from '@app/lib/api/data/orders'
import { setServerClock } from '@app/lib/time'
import { nursingRoundState } from '@app/lib/nursingRounds'
import type { AdministrationAction, MarRow, Order } from '@app/lib/api/types'
import type { Session } from '@app/lib/session'

setServerClock('Asia/Baghdad', 180)
let passes = 0, fails = 0
const check = (c: boolean, m: string) => { console.log((c ? '  PASS ' : '  FAIL ') + m); c ? passes++ : fails++ }
let fake = Date.parse('2026-10-15T07:00:00.000Z')
Date.now = () => fake
const advance = (ms: number) => { fake += ms }
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))
const flush = async (n = 20) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)) }

/* ---------- fake intervals (the 5 s rechecks) ---------- */
let nextTimer = 1
const timers = new Map<number, () => void>()
const fakeSetInterval = (fn: () => void) => { const id = nextTimer++; timers.set(id, fn); return id }
const fakeClearInterval = (id: unknown) => { timers.delete(id as number) }
const fireRechecks = async () => { for (const fn of [...timers.values()]) fn(); await flush() }

/* ---------- sessions ---------- */
let session: Session | null = { name: 'RN Synthetic Nurse', jobTitle: 'Staff Nurse' }
const toasts: string[] = []

/* =============================== MAR =============================== */
type MarPlan = 'commit' | 'commit-no-answer' | 'hold-no-answer' | 'drop' | 'reject-401' | 'reject-400' | 'defer'
const marPlans: MarPlan[] = []
const marRequests: { orderId: string; adminId: string; action: string; administeredAt?: string; attemptId?: string }[] = []
const heldCommits: (() => void)[] = []
const deferred: (() => void)[] = []
const marAnswer = (r: Order | string) =>
  (typeof r === 'string' ? { kind: 'rejected' as const, error: r, status: 409 } : { kind: 'ok' as const, order: clone(r) })
const marDocument: MarDeps['document'] = async (orderId, adminId, action, actor, _jobTitle, reason, administeredAt, attemptId) => {
  marRequests.push({ orderId, adminId, action, administeredAt, attemptId })
  const plan = marPlans.shift() ?? 'commit'
  const commit = () => applyAdministration(orderId, adminId, action, actor, reason, administeredAt, attemptId)
  switch (plan) {
    case 'commit': return marAnswer(commit())
    case 'commit-no-answer': commit(); return { kind: 'uncertain', error: 'the server did not answer' }
    case 'hold-no-answer': heldCommits.push(() => { commit() }); return { kind: 'uncertain', error: 'the server did not answer' }
    case 'drop': return { kind: 'uncertain', error: 'the server did not answer' }
    case 'reject-401': return { kind: 'rejected', error: 'your session has expired — sign in again; nothing was recorded', status: 401 }
    case 'reject-400': return { kind: 'rejected', error: 'administeredAt is after the server clock', status: 400 }
    case 'defer': return new Promise(res => deferred.push(() => res(marAnswer(commit()))))
  }
}
type ReadPlan = 'now' | 'hold' | 'null'
const marReadPlans: ReadPlan[] = []
const marReadLog: string[][] = []
const heldMarReads: (() => void)[] = []
const marRead: MarDeps['readAuthoritative'] = ids => {
  marReadLog.push([...ids].sort())
  const plan = marReadPlans.shift() ?? 'now'
  if (plan === 'null') return Promise.resolve(null)
  const rows = clone(deriveMarRows(ids))   // the record as of the read's START
  return plan === 'hold' ? new Promise(res => heldMarReads.push(() => res(rows))) : Promise.resolve(rows)
}
const marDeps = (): Partial<MarDeps> => ({
  document: marDocument, readAuthoritative: marRead, readDisplay: ids => marRead(ids).then(r => r ?? []),
  session: () => session, storage: () => fakeStorage, now: () => Date.now(),
  setInterval: fakeSetInterval, clearInterval: fakeClearInterval,
})
const newMar = () => { const c = new MarController(marDeps()); c.toast = (t, x) => { toasts.push(`${t}: ${x}`) }; return c }

/* synthetic medication orders in the mock store (patients P-S3A / P-S3B) */
let n = 0
const signedUtc = () => new Date(Date.now() - 60_000).toISOString().slice(0, 16).replace('T', ' ')
function medOrder(pid: string, freq: string, prn: boolean): string {
  const orderId = `ORD-S3M${++n}`
  const t = signedUtc()
  allOrders().push({
    orderId, patientId: pid, bedId: pid === 'P-S3A' ? 'B-21' : 'B-22', patientName: pid, category: 'Medication',
    summary: `S3 drug ${n}`, priority: 'Routine', status: 'active', orderedBy: 'Dr. Synthetic', orderedTime: t,
    medication: { drugId: `s3m${n}`, drug: `S3 drug ${n}`, dose: '1 mg', route: 'IV', frequency: freq, duration: 'ongoing', prn, ...(prn ? { prnIndication: 'synthetic pain' } : {}) },
    history: [{ time: t, actor: 'Dr. Synthetic', action: 'created' }, { time: t, actor: 'Dr. Synthetic', action: 'signed' }],
  } as Order)
  return orderId
}
const marOrder = (oid: string) => allOrders().find(o => o.orderId === oid)!
const facts = (oid: string) => (marOrder(oid).administrations ?? []).filter(a => a.status !== 'scheduled')
const currentRow = (oid: string): MarRow => deriveMarRows([marOrder(oid).patientId]).find(r => r.orderId === oid && r.status === 'scheduled')!
const stored = (nurse: string): MarAttempt[] => JSON.parse(fakeStorage.getItem(marPendingKey(nurse)) ?? '[]')
const busyPhase = (c: MarController, oid: string) => c.getSnapshot().busy.get(oid)?.phase ?? 'none'

async function marScenarios() {
  const A = 'P-S3A', B = 'P-S3B'
  console.log('[M1] delayed original + Retry saving: one fact, settled only by the record')
  {
    const mar = newMar(); const v = mar.registerView([A]); await mar.refresh(); await flush()
    const oid = medOrder(A, 'q6h', true)
    marPlans.push('hold-no-answer')
    mar.document(currentRow(oid), 'given', 'M1'); await flush()
    const first = marRequests[marRequests.length - 1]
    check(busyPhase(mar, oid) === 'unconfirmed', 'no answer -> unconfirmed (not failed)')
    check(stored('RN Synthetic Nurse').some(a => a.attemptId === first.attemptId && a.patientId === A), 'attempt stored with its captured patient')
    advance(30 * 60_000); await fireRechecks(); await fireRechecks()
    check(busyPhase(mar, oid) === 'unconfirmed', '30 min later + rechecks with no fact: still unconfirmed (elapsed time proves nothing)')
    mar.retry(oid); await flush()
    const retry = marRequests[marRequests.length - 1]
    check(retry.attemptId === first.attemptId && retry.action === 'given', 'Retry saving re-sends the SAME attempt id')
    check(busyPhase(mar, oid) === 'none', 'retry answered + authoritative read -> settled')
    heldCommits.shift()!(); await fireRechecks()
    check(facts(oid).length === 1 && facts(oid)[0].attemptId === first.attemptId, 'the original committing later records nothing more: exactly 1 fact')
    mar.unregisterView(v); mar.dispose()
  }
  console.log('[M2] out-of-order settlement reads: an older read applied later is discarded whole')
  {
    const mar = newMar(); const v = mar.registerView([A]); await mar.refresh(); await flush()
    const oid = medOrder(A, 'q6h', true)
    marPlans.push('hold-no-answer'); mar.document(currentRow(oid), 'given', 'M2'); await flush()
    const id = marRequests[marRequests.length - 1].attemptId
    marReadPlans.push('hold'); void mar.refreshAuthoritative(); await flush()     // R1 starts before the commit
    heldCommits.shift()!()                                                        // the original commits
    await mar.refreshAuthoritative(); await flush()                               // R2 sees the fact
    check(busyPhase(mar, oid) === 'none' && toasts.some(t => t.startsWith('Saved — confirmed: M2')), 'the newer read (R2) confirms it')
    heldMarReads.shift()!(); await flush()                                        // R1 arrives late
    check(mar.getSnapshot().rows.some(r => r.orderId === oid && r.attemptId === id), 'the late older read (R1) did not replace the newer rows')
    check(!toasts.some(t => t.includes('M2') && t.includes('NOT')), 'and produced no verdict')
    mar.unregisterView(v); mar.dispose()
  }
  console.log('[M3] lost original + same-tab reload: the attempt is restored and retried with its id')
  {
    const mar = newMar(); const v = mar.registerView([A]); await mar.refresh(); await flush()
    const oid = medOrder(A, 'q6h', true)
    marPlans.push('drop'); mar.document(currentRow(oid), 'given', 'M3'); await flush()
    const id = marRequests[marRequests.length - 1].attemptId
    mar.dispose(); mar.unregisterView(v)
    const reloaded = newMar()                                                     // the update reload: a new controller, same tab storage
    check(busyPhase(reloaded, oid) === 'unconfirmed', 'restored as unconfirmed after the reload')
    reloaded.retry(oid); await flush()
    check(marRequests[marRequests.length - 1].attemptId === id && busyPhase(reloaded, oid) === 'none' && facts(oid).length === 1, 'retry sent the stored id; 1 fact; settled')
    reloaded.dispose()
  }
  console.log('[M4] pinned-minute retry refused 400 -> the original request exactly')
  {
    const mar = newMar(); const v = mar.registerView([A]); await mar.refresh(); await flush()
    const oid = medOrder(A, 'q6h', true)
    marPlans.push('drop'); mar.document(currentRow(oid), 'given', 'M4'); await flush()
    const k = marRequests.length
    marPlans.push('reject-400', 'commit'); mar.retry(oid); await flush()
    const [pinned, original] = marRequests.slice(k)
    check(!!pinned?.administeredAt && original?.administeredAt === undefined && pinned.attemptId === original.attemptId, 'retry 1 pinned the documented minute; the 400 fallback re-sent the original (no administeredAt, same id)')
    check(busyPhase(mar, oid) === 'none' && facts(oid).length === 1, 'recorded once, settled')
    mar.unregisterView(v); mar.dispose()
  }
  console.log('[M5] route / patient switch during a pending save: the attempt keeps its patient')
  {
    const mar = newMar()
    const chartA = mar.registerView([A]); await mar.refresh(); await flush()
    const oid = medOrder(A, 'q6h', true)
    marPlans.push('hold-no-answer'); mar.document(currentRow(oid), 'given', 'M5'); await flush()
    mar.unregisterView(chartA)                                                    // leave A's chart …
    const chartB = mar.registerView([B]); await mar.refresh(); await flush()      // … open B's
    const last = marReadLog[marReadLog.length - 1]
    check(last.includes(A) && last.includes(B), `the read on B's chart still covers A's lock (ids ${last.join(',')})`)
    check(stored('RN Synthetic Nurse').find(a => a.orderId === oid)?.patientId === A, 'stored attempt still targets patient A')
    heldCommits.shift()!(); await fireRechecks()
    check(busyPhase(mar, oid) === 'none' && toasts.some(t => t.startsWith('Saved — confirmed: M5')), 'confirmed from a read made while B was showing')
    mar.unregisterView(chartB)
    console.log('     … a SAVING (unanswered) request when every screen unmounts')
    const oid2 = medOrder(A, 'q6h', true)
    const w = mar.registerView([A, B]); await mar.refresh(); await flush()
    marPlans.push('defer'); mar.document(currentRow(oid2), 'given', 'M5b'); await flush()
    check(busyPhase(mar, oid2) === 'saving', 'saving')
    mar.unregisterView(w)                                                          // e.g. the nurse opened Orders & Medication
    deferred.shift()!(); await flush()
    check(busyPhase(mar, oid2) === 'none' && toasts.some(t => t.startsWith('Documented: M5b')), 'the answer completed into the controller and an authoritative read settled it with no screen mounted')
    check(JSON.stringify(marReadLog[marReadLog.length - 1]) === JSON.stringify([A]), 'that read covered exactly the lock\'s patient')
    mar.dispose()
  }
  console.log('[M6] sign-out / another nurse: attempts stay with their nurse')
  {
    const mar = newMar(); const v = mar.registerView([A]); await mar.refresh(); await flush()
    const oid = medOrder(A, 'q6h', true)
    marPlans.push('drop'); mar.document(currentRow(oid), 'given', 'M6'); await flush()
    session = { name: 'RN Other Nurse', jobTitle: 'Staff Nurse' }; mar.syncSession()
    check(busyPhase(mar, oid) === 'none' && stored('RN Synthetic Nurse').some(a => a.orderId === oid), 'another nurse: not in memory, still stored under the first nurse')
    const before = marRequests.length
    mar.retry(oid); await flush()
    check(marRequests.length === before, 'the other nurse cannot send it (no lock to retry)')
    session = { name: 'RN Synthetic Nurse', jobTitle: 'Staff Nurse' }; mar.syncSession()
    check(busyPhase(mar, oid) === 'unconfirmed', 'signing back in restores it, unconfirmed')
    mar.retry(oid); await flush()
    check(busyPhase(mar, oid) === 'none' && facts(oid).length === 1, 'retried and settled: 1 fact')
    console.log('     … an answer arriving after sign-out updates only that nurse\'s stored copy')
    const oid2 = medOrder(A, 'q6h', true)
    marPlans.push('defer'); mar.document(currentRow(oid2), 'given', 'M6b'); await flush()
    check(stored('RN Synthetic Nurse').some(a => a.orderId === oid2), 'saving attempt stored (reload-safe)')
    session = null; mar.syncSession()
    deferred.shift()!(); await flush()
    check(!stored('RN Synthetic Nurse').some(a => a.orderId === oid2) && facts(oid2).length === 1, 'recorded; removed from the signed-out nurse\'s stored list')
    session = { name: 'RN Synthetic Nurse', jobTitle: 'Staff Nurse' }; mar.syncSession()
    check(busyPhase(mar, oid2) === 'none', 'not restored as unconfirmed')
    mar.unregisterView(v); mar.dispose()
  }
  console.log('[M7] an attempt stored by the PREVIOUS build (no patientId) settles once a read shows its order')
  {
    const oid = medOrder(A, 'q6h', true)
    const legacyAttempt = { attemptId: 'legacybuild0000000000000000000001', orderId: oid, adminId: 'prn', action: 'given', clickedAt: signedUtc(), round: null, onceStamp: null, label: 'M7' }
    applyAdministration(oid, 'prn', 'given', 'RN Synthetic Nurse', undefined, undefined, legacyAttempt.attemptId)   // it did land
    fakeStorage.setItem(marPendingKey('RN Legacy Nurse'), JSON.stringify([legacyAttempt]))
    session = { name: 'RN Legacy Nurse', jobTitle: 'Staff Nurse' }
    const mar = newMar()
    await fireRechecks()
    check(busyPhase(mar, oid) === 'unconfirmed', 'no screen, patient unknown: nothing read, stays unconfirmed (not failed)')
    const v = mar.registerView([A]); await mar.refresh(); await flush(); await mar.refresh(); await flush()
    check(busyPhase(mar, oid) === 'none' && toasts.some(t => t.startsWith('Saved — confirmed: M7')), 'the worklist read learned its patient and confirmed it')
    mar.unregisterView(v); mar.dispose()
    session = { name: 'RN Synthetic Nurse', jobTitle: 'Staff Nurse' }
  }
  console.log('[M8] a retry answered 401 stays unconfirmed ("sign in again, then retry saving")')
  {
    const mar = newMar(); const v = mar.registerView([A]); await mar.refresh(); await flush()
    const oid = medOrder(A, 'q6h', true)
    marPlans.push('drop'); mar.document(currentRow(oid), 'given', 'M8'); await flush()
    marPlans.push('reject-401'); mar.retry(oid); await flush()
    check(busyPhase(mar, oid) === 'unconfirmed' && toasts[toasts.length - 1].includes('sign in again, then retry saving'), 'unconfirmed, told to sign in again')
    mar.retry(oid); await flush()
    check(busyPhase(mar, oid) === 'none' && facts(oid).length === 1, 'retry after sign-in: recorded once')
    mar.unregisterView(v); mar.dispose()
  }
  console.log('[M9] double click / another screen clicking the same order: one request')
  {
    const mar = newMar(); const v = mar.registerView([A]); await mar.refresh(); await flush()
    const oid = medOrder(A, 'q6h', true)
    const k = marRequests.length
    marPlans.push('defer')
    const row = currentRow(oid)
    mar.document(row, 'given', 'M9'); mar.document(row, 'given', 'M9'); mar.document(row, 'held', 'M9', 'x')
    await flush()
    check(marRequests.length - k === 1, `${marRequests.length - k} request(s) for three clicks in one frame`)
    deferred.shift()!(); await flush()
    mar.unregisterView(v); mar.dispose()
  }
  console.log('[M10] the round documented by another documentation -> not saved, never twice')
  {
    const mar = newMar(); const v = mar.registerView([B]); await mar.refresh(); await flush()
    const oid = medOrder(B, 'q1h', false)
    const r = currentRow(oid)
    check(r.round === 1 && r.firstDose === true, 'q1h round 1 is the first dose (open on signing)')
    marPlans.push('drop'); mar.document(r, 'given', 'M10'); await flush()
    applyAdministration(oid, r.adminId, 'given', 'RN Another Station', undefined, undefined, 'otherstation000000000000000000001')
    await fireRechecks()
    check(busyPhase(mar, oid) === 'none' && (mar.getSnapshot().notices[oid] ?? '').startsWith('Not saved'), 'not saved, with the reason on the row')
    check(facts(oid).length === 1, 'exactly the other station\'s fact')
    mar.unregisterView(v); mar.dispose()
  }
}

/* ======================= NURSING ROUNDS (contract simulator) ======================= */
interface SimOrder { order: Order; signedMs: number; intervalMinutes?: number; completions: NonNullable<Order['nursing']>['completions']; legacy: boolean }
const sim = new Map<string, SimOrder>()
const iso = (ms: number) => new Date(ms).toISOString()
function derived(s: SimOrder): Order {
  const o = clone(s.order)
  if (s.legacy) return o
  const last = s.completions[s.completions.length - 1]
  const n = s.completions.length + 1
  const dueMs = last ? Date.parse(last.completedTime) + (s.intervalMinutes ?? 0) * 60_000 : Math.floor(s.signedMs / 60_000) * 60_000
  const cur = o.status === 'active' && (s.intervalMinutes !== undefined || !last) ? { roundId: `${iso(dueMs)}~r${n}`, number: n, dueTime: iso(dueMs) } : undefined
  o.nursing = { ...(s.intervalMinutes !== undefined ? { intervalMinutes: s.intervalMinutes } : {}), completions: clone(s.completions), ...(cur ? { currentRound: cur } : {}) }
  return o
}
let nn = 0
function nursingOrder(pid: string, kind: 'once' | 'legacy' | number, summary: string): string {
  const orderId = `ORD-S3N${++nn}`
  const t = new Date(Date.now()).toISOString().slice(0, 16).replace('T', ' ')
  sim.set(orderId, {
    signedMs: Date.now(), legacy: kind === 'legacy', intervalMinutes: typeof kind === 'number' ? kind : undefined, completions: [],
    order: {
      orderId, patientId: pid, bedId: 'B-21', patientName: pid, category: 'Nursing', summary, priority: 'Routine', status: 'active',
      orderedBy: 'Dr. Synthetic', orderedTime: t, requiresImplementation: true,
      history: [{ time: t, actor: 'Dr. Synthetic', action: 'created' }, { time: t, actor: 'Dr. Synthetic', action: 'signed' }],
    } as Order,
  })
  return orderId
}
type Answer = Awaited<ReturnType<NursingDeps['implement']>>
function simImplement(orderId: string, actor: string, req?: { roundId: string; attemptId: string }): Answer {
  const s = sim.get(orderId)
  if (!s) return { kind: 'rejected', error: 'not found', status: 404 }
  if (req) {
    const prior = s.completions.find(c => c.attemptId === req.attemptId)
    if (prior) return prior.roundId === req.roundId ? { kind: 'ok', order: derived(s) } : { kind: 'rejected', error: 'attempt reused for another round', status: 409 }
  }
  if (s.legacy) {
    if (req) return { kind: 'rejected', error: 'a legacy order has no rounds', status: 400 }
    if (s.order.status !== 'active') return { kind: 'rejected', error: 'Order is already completed', status: 409 }
    s.order.status = 'completed'; return { kind: 'ok', order: derived(s) }
  }
  if (s.intervalMinutes !== undefined && !req) return { kind: 'rejected', error: 'a repeating nursing order needs roundId and attemptId', status: 400 }
  if (s.order.status !== 'active') return { kind: 'rejected', error: `Order is ${s.order.status}`, status: 409 }
  const cur = derived(s).nursing!.currentRound!
  if (req && req.roundId !== cur.roundId) {
    const done = s.completions.find(c => c.roundId === req.roundId)
    return { kind: 'rejected', error: done ? `round ${done.round} was completed by ${done.completedBy} at ${done.completedTime}` : 'not the current round', status: 409 }
  }
  if (Date.now() < Date.parse(cur.dueTime)) return { kind: 'rejected', error: `not due yet — opens at ${cur.dueTime}`, status: 409 }
  s.completions.push({ round: cur.number, roundId: cur.roundId, dueTime: cur.dueTime, completedTime: iso(Math.ceil(Date.now())), completedBy: actor, ...(req ? { attemptId: req.attemptId } : {}) })
  if (s.intervalMinutes === undefined) s.order.status = 'completed'
  return { kind: 'ok', order: derived(s) }
}
type NPlan = 'commit' | 'commit-no-answer' | 'hold-no-answer' | 'drop' | 'reject-401' | 'defer'
const nPlans: NPlan[] = []
const nRequests: { orderId: string; body?: { roundId: string; attemptId: string } }[] = []
const nHeld: (() => void)[] = []
const nDeferred: (() => void)[] = []
const nImplement: NursingDeps['implement'] = async (orderId, actor, _jt, req) => {
  nRequests.push({ orderId, body: req ? clone(req) : undefined })
  const plan = nPlans.shift() ?? 'commit'
  switch (plan) {
    case 'commit': return simImplement(orderId, actor, req)
    case 'commit-no-answer': simImplement(orderId, actor, req); return { kind: 'uncertain', error: 'the server did not answer' }
    case 'hold-no-answer': nHeld.push(() => { simImplement(orderId, actor, req) }); return { kind: 'uncertain', error: 'the server did not answer' }
    case 'drop': return { kind: 'uncertain', error: 'the server did not answer' }
    case 'reject-401': return { kind: 'rejected', error: 'session expired — sign in again; nothing was recorded', status: 401 }
    case 'defer': return new Promise(res => nDeferred.push(() => res(simImplement(orderId, actor, req))))
  }
}
const nReadPlans: ReadPlan[] = []
const nHeldReads: (() => void)[] = []
const nDeps = (): Partial<NursingDeps> => ({
  implement: nImplement,
  readQueue: async ids => [...sim.values()].map(derived).filter(o => o.status === 'active' && ids.includes(o.patientId)),
  readPatientOrders: pid => {
    const plan = nReadPlans.shift() ?? 'now'
    if (plan === 'null') return Promise.resolve(null)
    const orders = [...sim.values()].map(derived).filter(o => o.patientId === pid)   // as of the read's START
    return plan === 'hold' ? new Promise(res => nHeldReads.push(() => res(orders))) : Promise.resolve(orders)
  },
  session: () => session, storage: () => fakeStorage, now: () => Date.now(),
  setInterval: fakeSetInterval, clearInterval: fakeClearInterval,
})
const newNursing = () => { const c = new NursingRoundsController(nDeps()); c.toast = (t, x) => { toasts.push(`${t}: ${x}`) }; return c }
const shown = (c: NursingRoundsController, oid: string) => c.getSnapshot().orders?.find(o => o.orderId === oid)
const nBusy = (c: NursingRoundsController, oid: string) => c.getSnapshot().busy.get(oid)?.phase ?? 'none'
const completions = (oid: string) => sim.get(oid)!.completions

async function nursingScenarios() {
  const A = 'P-S3A'
  console.log('[N1] repeating every 1 min: completion time + interval, to the millisecond')
  {
    fake = Date.parse('2026-10-15T07:00:00.000Z')
    const oid = nursingOrder(A, 1, 'Reposition patient')
    const c = newNursing(); const v = c.registerView([A]); await c.refresh()
    const o1 = shown(c, oid)!
    check(nursingRoundState(o1, Date.now()).kind === 'open' && o1.nursing!.currentRound!.number === 1, 'round 1 open on signing')
    fake = Date.parse('2026-10-15T07:00:59.900Z')
    c.done(o1, 'N1'); await flush()
    const o2 = shown(c, oid)!
    check(o2?.nursing?.currentRound?.number === 2 && o2.nursing.currentRound.dueTime === '2026-10-15T07:01:59.900Z', `next round due ${o2?.nursing?.currentRound?.dueTime} (Done 07:00:59.900 + 1 min)`)
    check(nBusy(c, oid) === 'none', 'Done reopened only after the authoritative read (settling released)')
    fake = Date.parse('2026-10-15T07:01:59.899Z')
    const k = nRequests.length
    check(nursingRoundState(o2, Date.now()).kind === 'locked', '07:01:59.899: locked')
    c.done(o2, 'N1'); await flush()
    check(nRequests.length === k, 'a Done 1 ms early sends nothing')
    fake = Date.parse('2026-10-15T07:01:59.900Z')
    check(nursingRoundState(o2, Date.now()).kind === 'open', '07:01:59.900: open exactly')
    c.done(o2, 'N1'); await flush()
    check(nRequests.length === k + 1 && completions(oid).length === 2 && shown(c, oid)?.nursing?.currentRound?.number === 3, 'round 2 completed; round 3 shown (the order is never suppressed)')
    console.log('     … a late round keeps its identity; the clock creates no rounds')
    fake += 5 * 3600_000
    await c.refresh()
    const late = shown(c, oid)!
    check(late.nursing!.currentRound!.number === 3 && nursingRoundState(late, Date.now()).kind === 'open', '5 h later: still round 3, open (overdue, actionable)')
    c.unregisterView(v); c.dispose()
  }
  console.log('[N2] one-time: completes once and leaves the list; a second Done sends nothing')
  {
    const oid = nursingOrder(A, 'once', 'Remove urinary catheter')
    const c = newNursing(); const v = c.registerView([A]); await c.refresh()
    const o = shown(c, oid)!
    check(!!o.nursing && o.nursing.intervalMinutes === undefined && o.nursing.currentRound?.number === 1, 'one-time order with round 1')
    c.done(o, 'N2'); await flush()
    check(shown(c, oid) === undefined && completions(oid).length === 1, 'completed: gone from Orders to Implement, 1 completion')
    const k = nRequests.length
    c.done(o, 'N2'); await flush()   // a stale row object
    check(nRequests.length === k, 'a Done on the stale row sends nothing (freshest version: completed)')
    c.unregisterView(v); c.dispose()
  }
  console.log('[N3] double click: one request')
  {
    const oid = nursingOrder(A, 120, 'Mouth care')
    const c = newNursing(); const v = c.registerView([A]); await c.refresh()
    const o = shown(c, oid)!
    const k = nRequests.length
    nPlans.push('defer'); c.done(o, 'N3'); c.done(o, 'N3'); c.done(o, 'N3'); await flush()
    check(nRequests.length === k + 1, `${nRequests.length - k} request for three clicks`)
    nDeferred.shift()!(); await flush()
    check(completions(oid).length === 1 && nBusy(c, oid) === 'none', '1 completion, settled')
    c.unregisterView(v); c.dispose()
  }
  console.log('[N4] no answer -> unconfirmed; Retry saving re-sends the same round + attempt (server replay)')
  {
    const oid = nursingOrder(A, 60, 'Check pressure areas')
    const c = newNursing(); const v = c.registerView([A]); await c.refresh()
    nPlans.push('commit-no-answer'); nReadPlans.push('null')   // the answer and the first settling read are both lost
    c.done(shown(c, oid)!, 'N4'); await flush()
    const first = nRequests[nRequests.length - 1].body!
    check(nBusy(c, oid) === 'unconfirmed', 'unconfirmed (a lost read settles nothing)')
    c.retry(oid); await flush()
    const again = nRequests[nRequests.length - 1].body!
    check(again.roundId === first.roundId && again.attemptId === first.attemptId, 'retry body identical: { roundId, attemptId }')
    check(completions(oid).length === 1 && nBusy(c, oid) === 'none', 'server replayed: 1 completion, confirmed')
    c.unregisterView(v); c.dispose()
  }
  console.log('[N5] Amendment 1 §9.2 required check: delayed original, 401 retry stays unconfirmed, original commits -> confirmed, 1 completion')
  {
    const oid = nursingOrder(A, 60, 'Neuro observations')
    const c = newNursing(); const v = c.registerView([A]); await c.refresh()
    nPlans.push('hold-no-answer'); c.done(shown(c, oid)!, 'N5'); await flush()
    const first = nRequests[nRequests.length - 1].body!
    nPlans.push('reject-401'); c.retry(oid); await flush()
    check(nBusy(c, oid) === 'unconfirmed' && (c.getSnapshot().notices[oid] ?? '').includes('sign in again'), 'refused retry (401): kept unconfirmed, told to sign in again')
    const st = JSON.parse(fakeStorage.getItem(nursingPendingKey('RN Synthetic Nurse')) ?? '[]')
    check(st.some((a: { attemptId: string }) => a.attemptId === first.attemptId), 'its stored copy is kept')
    nHeld.shift()!(); await fireRechecks()
    check(nBusy(c, oid) === 'none' && toasts.some(t => t.startsWith('Saved — confirmed: N5')), 'the original committed -> confirmed from the per-patient read')
    check(completions(oid).length === 1 && completions(oid)[0].attemptId === first.attemptId, 'exactly one completion, carrying the attempt id')
    c.unregisterView(v); c.dispose()
  }
  console.log('[N6] absent reads and elapsed time prove nothing; a missing queue row proves nothing')
  {
    const oid = nursingOrder(A, 'once', 'Change dressing')
    const c = newNursing(); const v = c.registerView([A]); await c.refresh()
    nPlans.push('commit-no-answer'); nReadPlans.push('null', 'null', 'null', 'null')   // the post-answer read + 3 rechecks
    c.done(shown(c, oid)!, 'N6'); await flush()
    check(shown(c, oid) === undefined, 'the queue no longer lists it (completed server-side)…')
    advance(2 * 3600_000); await fireRechecks(); await fireRechecks(); await fireRechecks()
    check(nBusy(c, oid) === 'unconfirmed', '…yet with the per-patient read unavailable it stays unconfirmed after 2 h')
    await fireRechecks()
    check(nBusy(c, oid) === 'none' && toasts.some(t => t.startsWith('Saved — confirmed: N6')), 'the first readable per-patient read confirms it')
    c.unregisterView(v); c.dispose()
  }
  console.log('[N7] the round completed by another completion -> not saved')
  {
    const oid = nursingOrder(A, 60, 'Eye care')
    const c = newNursing(); const v = c.registerView([A]); await c.refresh()
    const o = shown(c, oid)!
    nPlans.push('drop'); nReadPlans.push('null'); c.done(o, 'N7'); await flush()
    simImplement(oid, 'RN Another Station', { roundId: o.nursing!.currentRound!.roundId, attemptId: 'anotherstation00000000000000000001' })
    await fireRechecks()
    check(nBusy(c, oid) === 'none' && (c.getSnapshot().notices[oid] ?? '').startsWith('Not saved'), 'not saved, reason on the row')
    check(completions(oid).length === 1, '1 completion (the other station\'s)')
    c.unregisterView(v); c.dispose()
  }
  console.log('[N8] out-of-order per-patient reads: the older one is discarded')
  {
    const oid = nursingOrder(A, 60, 'Suction')
    const c = newNursing(); const v = c.registerView([A]); await c.refresh()
    nPlans.push('hold-no-answer'); nReadPlans.push('null'); c.done(shown(c, oid)!, 'N8'); await flush()
    nReadPlans.push('hold'); void c.refreshPatients([A]); await flush()   // R1 starts before the commit
    nHeld.shift()!()
    await c.refreshPatients([A]); await flush()                            // R2 sees it
    check(nBusy(c, oid) === 'none' && shown(c, oid)?.nursing?.currentRound?.number === 2, 'R2 confirmed; round 2 shown')
    nHeldReads.shift()!(); await flush()
    check(shown(c, oid)?.nursing?.currentRound?.number === 2 && !toasts.some(t => t.includes('N8') && t.includes('NOT')), 'late R1 discarded: still round 2, no verdict')
    c.unregisterView(v); c.dispose()
  }
  console.log('[N9] legacy one-time order: the existing empty request; no answer settles when the record shows it completed')
  {
    const oid = nursingOrder(A, 'legacy', 'Legacy: weigh patient')
    const c = newNursing(); const v = c.registerView([A]); await c.refresh()
    const o = shown(c, oid)!
    check(o.nursing === undefined && nursingRoundState(o, Date.now()).kind === 'legacy', 'no nursing data: legacy')
    nPlans.push('commit-no-answer'); c.done(o, 'N9'); await flush()
    check(nRequests[nRequests.length - 1].body === undefined, 'sent with no body')
    check(nBusy(c, oid) === 'none' && toasts.some(t => t.startsWith('Order no longer open: N9')), 'the per-patient read shows it completed -> settled')
    c.unregisterView(v); c.dispose()
  }
  console.log('[N10] stored shape + reload recovery + another nurse')
  {
    const oid = nursingOrder(A, 60, 'Turn q1h')
    const c = newNursing(); const v = c.registerView([A]); await c.refresh()
    nPlans.push('drop'); nReadPlans.push('null'); c.done(shown(c, oid)!, 'N10'); await flush()
    const st = JSON.parse(fakeStorage.getItem(nursingPendingKey('RN Synthetic Nurse')) ?? '[]') as Record<string, string>[]
    const a = st.find(x => x.orderId === oid)!
    check(JSON.stringify(Object.keys(a).sort()) === JSON.stringify(['attemptId', 'clickedAt', 'label', 'orderId', 'patientId', 'roundId']), `stored as NursingPendingAttempt: ${Object.keys(a).sort().join(',')}`)
    check(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(a.clickedAt), `clickedAt in the nursing stamp form (${a.clickedAt})`)
    c.unregisterView(v); c.dispose()
    session = { name: 'RN Other Nurse', jobTitle: 'Staff Nurse' }
    const other = newNursing()
    check(nBusy(other, oid) === 'none', 'another nurse does not see it')
    session = { name: 'RN Synthetic Nurse', jobTitle: 'Staff Nurse' }
    const reloaded = newNursing()
    check(nBusy(reloaded, oid) === 'unconfirmed', 'the same nurse after a reload: unconfirmed')
    reloaded.retry(oid); await flush()
    const body = nRequests[nRequests.length - 1].body!
    check(body.attemptId === a.attemptId && body.roundId === a.roundId && nBusy(reloaded, oid) === 'none' && completions(oid).length === 1, 'retried with the stored pair; 1 completion')
    reloaded.dispose(); other.dispose()
  }
  console.log('[N11] counts: actionable due work vs upcoming work')
  {
    for (const k of [...sim.keys()]) sim.delete(k)
    fake = Date.parse('2026-10-15T09:00:00.000Z')
    const a = nursingOrder(A, 'once', 'Due now (one-time)')
    const b = nursingOrder(A, 60, 'Upcoming (repeating)')
    nursingOrder(A, 'legacy', 'Legacy one-time')
    const c = newNursing(); const v = c.registerView([A]); await c.refresh()
    c.done(shown(c, b)!, 'N11'); await flush()
    const counts = implementCounts(c.getSnapshot().orders!, Date.now())
    check(counts.due === 2 && counts.upcoming === 1, `due ${counts.due} (one-time + legacy), upcoming ${counts.upcoming} (the repeating order's next round)`)
    check(!!shown(c, a) && !!shown(c, b), 'the upcoming round stays visible')
    c.unregisterView(v); c.dispose()
  }
}

/* ============================== I&O guard ============================== */
async function ioScenarios() {
  console.log('[I1] the I&O save guard: one save per patient + admission in flight')
  let calls = 0
  const release: (() => void)[] = []
  const guard = new IoSaveGuard({ record: () => { calls++; return new Promise(res => release.push(() => res({ kind: 'ok', observations: [] }))) } })
  const p1 = guard.save('P-S3A', 'ENC-1', { intakeMl: 500 }, 'Staff Nurse')
  const p2 = guard.save('P-S3A', 'ENC-1', { intakeMl: 500 }, 'Staff Nurse')
  check(await p2 === null && calls === 1 && guard.isSaving('P-S3A', 'ENC-1'), 'a second save of the same admission is refused locally (nothing sent)')
  const p3 = guard.save('P-S3A', 'ENC-2', { intakeMl: 0 }, 'Staff Nurse')
  check(calls === 2, 'another admission is independent')
  release.forEach(r => r()); await p1; await p3
  check(!guard.isSaving('P-S3A', 'ENC-1'), 'released when answered')
}

await marScenarios()
await nursingScenarios()
await ioScenarios()
console.log(`\nRESULT: ${passes} passed, ${fails} failed`)
if (fails) process.exitCode = 1
