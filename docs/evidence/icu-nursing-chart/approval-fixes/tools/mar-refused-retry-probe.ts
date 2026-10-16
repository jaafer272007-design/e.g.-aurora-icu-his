// MAR refused-retry probe (Codex review of 72a7894 / source 4f1009d) — the REAL MarController
// (src/features/nurse-care/marController.ts) over the SHIPPED mock store (src/lib/api/data/orders.ts
// applyAdministration + deriveMarRows, the client-side mirror of the server's MAR rules), under a fake
// clock with a CONTROLLED TRANSPORT. Not a deployed-server test: the 403 is the real server's
// Rbac.Deny answer shape ({ error: "Insufficient permissions" }, judged before the order lock and the
// attempt lookup), injected here; the client-side refusal is the shipped documentAdministration
// adapter's own permission check (no status). The probe is written once and run UNCHANGED against
// the published controller (expected to FAIL: the defect) and the corrected one (expected to pass).
// Built by run-probe.sh with esbuild, alias @app -> <tree>/src.
import { fakeStorage } from '../../session3/tools/harness-globals'
import { MarController, marPendingKey, type MarAttempt, type MarDeps } from '@app/features/nurse-care/marController'
import { documentAdministration } from '@app/lib/api'
import { allOrders, applyAdministration, deriveMarRows } from '@app/lib/api/data/orders'
import { setServerClock } from '@app/lib/time'
import type { MarRow, Order } from '@app/lib/api/types'
import type { Session } from '@app/lib/session'

setServerClock('Asia/Baghdad', 180)
let passes = 0, fails = 0
const check = (c: boolean, m: string) => { console.log((c ? '  PASS ' : '  FAIL ') + m); c ? passes++ : fails++ }
let fake = Date.parse('2026-10-16T07:00:00.000Z')
Date.now = () => fake
const advance = (ms: number) => { fake += ms }
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))
const flush = async (n = 20) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)) }
/* the shipped adapter answers through a real 120 ms timer (mock latency) */
const settle = async () => { await flush(); await new Promise(r => setTimeout(r, 200)); await flush() }

let nextTimer = 1
const timers = new Map<number, () => void>()
const fireRechecks = async () => { for (const fn of [...timers.values()]) fn(); await settle() }

const NURSE_A = 'RN Probe Nurse A', NURSE_B = 'RN Probe Nurse B'
let session: Session | null = { name: NURSE_A, jobTitle: 'Staff Nurse' }
const toasts: string[] = []

/* ---------- the controlled transport ---------- */
type Plan = 'commit' | 'hold' | 'reject-403' | 'reject-400' | 'reject-401' | 'reject-409' | 'adapter' | 'defer-403'
const plans: Plan[] = []
const requests: { orderId: string; adminId: string; action: string; administeredAt?: string; attemptId?: string; jobTitle: string }[] = []
/* held originals, by attempt id: each is delivered to the record explicitly */
const held = new Map<string, () => void>()
const deferred: (() => void)[] = []
const answer = (r: Order | string) =>
  (typeof r === 'string' ? { kind: 'rejected' as const, error: r, status: 409 } : { kind: 'ok' as const, order: clone(r) })
const transport: MarDeps['document'] = async (orderId, adminId, action, actor, jobTitle, reason, administeredAt, attemptId) => {
  requests.push({ orderId, adminId, action, administeredAt, attemptId, jobTitle })
  const plan = plans.shift() ?? 'commit'
  const commit = () => applyAdministration(orderId, adminId, action, actor, reason, administeredAt, attemptId)
  switch (plan) {
    case 'commit': return answer(commit())
    /* the request is lost on the way and reaches the record LATE (held(), later) */
    case 'hold': held.set(attemptId!, () => { commit() }); return { kind: 'uncertain', error: 'the server did not answer' }
    /* the real server's RBAC refusal — before the order lock and the attempt lookup */
    case 'reject-403': return { kind: 'rejected', error: 'Insufficient permissions', status: 403 }
    case 'defer-403': return new Promise(res => deferred.push(() => res({ kind: 'rejected', error: 'Insufficient permissions', status: 403 })))
    case 'reject-400': return { kind: 'rejected', error: 'administeredAt cannot be in the future', status: 400 }
    case 'reject-401': return { kind: 'rejected', error: 'your session has expired — sign in again; nothing was recorded', status: 401 }
    case 'reject-409': return { kind: 'rejected', error: `order '${orderId}' is discontinued — it is not in force, no dose is available from it`, status: 409 }
    /* the SHIPPED adapter (mock mode): its own client-side permission check, then the mock store */
    case 'adapter': return documentAdministration(orderId, adminId, action, actor, jobTitle, reason, administeredAt, attemptId)
  }
}
const read: MarDeps['readAuthoritative'] = ids => Promise.resolve(clone(deriveMarRows(ids)))
const newMar = () => {
  const c = new MarController({
    document: transport, readAuthoritative: read, readDisplay: ids => read(ids).then(r => r ?? []),
    session: () => session, storage: () => fakeStorage, now: () => Date.now(),
    setInterval: fn => { const id = nextTimer++; timers.set(id, fn); return id }, clearInterval: id => { timers.delete(id as number) },
  })
  c.toast = (t, x) => { toasts.push(`${t}: ${x}`) }
  return c
}

let n = 0
const signedUtc = () => new Date(Date.now() - 60_000).toISOString().slice(0, 16).replace('T', ' ')
function prnOrder(pid: string): string {
  const orderId = `ORD-PRB${++n}`
  const t = signedUtc()
  allOrders().push({
    orderId, patientId: pid, bedId: 'B-31', patientName: pid, category: 'Medication',
    summary: `Probe PRN drug ${n}`, priority: 'Routine', status: 'active', orderedBy: 'Dr. Synthetic', orderedTime: t,
    medication: { drugId: `prb${n}`, drug: `Probe PRN drug ${n}`, dose: '1 mg', route: 'IV', frequency: 'q6h', duration: 'ongoing', prn: true, prnIndication: 'synthetic pain' },
    history: [{ time: t, actor: 'Dr. Synthetic', action: 'created' }, { time: t, actor: 'Dr. Synthetic', action: 'signed' }],
  } as Order)
  return orderId
}
const order = (oid: string) => allOrders().find(o => o.orderId === oid)!
const facts = (oid: string) => (order(oid).administrations ?? []).filter(a => a.status !== 'scheduled')
const currentRow = (oid: string): MarRow => deriveMarRows([order(oid).patientId]).find(r => r.orderId === oid && r.status === 'scheduled')!
const stored = (nurse: string): MarAttempt[] => JSON.parse(fakeStorage.getItem(marPendingKey(nurse)) ?? '[]')
const phase = (c: MarController, oid: string) => c.getSnapshot().busy.get(oid)?.phase ?? 'none'
const notice = (c: MarController, oid: string) => c.getSnapshot().notices[oid] ?? ''
const last = () => requests[requests.length - 1]
/* wording: never advise giving (or documenting) the medication again */
const advisesAgain = (s: string) => /\b(give|administer|document)\b[^.]*\bagain\b/i.test(s.replace(/retry saving/gi, ''))

/** the shared steps after a refused retry: an authoritative EMPTY read, a nurse's click on the
 *  (supposedly locked) order, the original reaching the record late, then the read that confirms */
async function afterRefusal(tag: string, mar: MarController, oid: string, firstId: string) {
  await fireRechecks()   // an authoritative read started after the refusal: no fact yet
  check(facts(oid).length === 0, `${tag}: the record has no fact yet (the original is still held)`)
  check(phase(mar, oid) === 'unconfirmed', `${tag}: after the authoritative EMPTY read the order is still locked, unconfirmed (got '${phase(mar, oid)}')`)
  check(stored(NURSE_A).some(a => a.orderId === oid && a.attemptId === firstId), `${tag}: the SAME attempt is still stored for the nurse`)
  const k = requests.length
  mar.document(currentRow(oid), 'given', `${tag}-again`)   // what a nurse can do if the controls reopened
  await settle()
  check(requests.length === k, `${tag}: a Given click while unresolved sends nothing (sent ${requests.length - k} new request(s))`)
  const deliver = held.get(firstId); held.delete(firstId)
  deliver!()             // the ORIGINAL reaches the record late and commits
  check(phase(mar, oid) === 'unconfirmed', `${tag}: the commit alone unlocks nothing — only a read that shows it (got '${phase(mar, oid)}')`)
  await fireRechecks()
  const f = facts(oid)
  check(f.length === 1, `${tag}: exactly ONE fact on the record (got ${f.length}: ${f.map(x => x.attemptId).join(', ')})`)
  check(f.length === 1 && f[0].attemptId === firstId, `${tag}: it is the original attempt's fact`)
  check(phase(mar, oid) === 'none' && toasts.some(t => t.startsWith(`Saved — confirmed: ${tag}`)), `${tag}: unlocked only once confirmed from the record`)
  check(!stored(NURSE_A).some(a => a.orderId === oid), `${tag}: the stored attempt is gone once confirmed`)
  check(notice(mar, oid) === '', `${tag}: no stale refusal notice left on the row after confirmation (got '${notice(mar, oid)}')`)
}

async function main() {
  const A = 'P-PRB-A'
  console.log('[R1] PRN Given: original held (no answer) -> retry refused 403 before the order lock -> empty read -> delayed original')
  {
    const mar = newMar(); const v = mar.registerView([A]); await mar.refresh(); await settle()
    const oid = prnOrder(A)
    plans.push('hold'); mar.document(currentRow(oid), 'given', 'R1'); await settle()
    const first = last()
    check(phase(mar, oid) === 'unconfirmed', 'R1: no answer -> unconfirmed')
    plans.push('reject-403'); mar.retry(oid); await settle()
    check(last().attemptId === first.attemptId, 'R1: the retry carried the SAME attempt id')
    check(phase(mar, oid) === 'unconfirmed', `R1: a refused retry does not by itself settle the attempt (got '${phase(mar, oid)}')`)
    const t = toasts[toasts.length - 1] ?? '', no = notice(mar, oid)
    check(/Insufficient permissions/.test(no) && /Insufficient permissions/.test(t), `R1: the actual refusal reason is shown (notice '${no}')`)
    check(!/session has expired/i.test(no + t), 'R1: a 403 is not labelled as an expired session')
    check(!advisesAgain(no) && !advisesAgain(t), 'R1: the wording never advises giving the medication again')
    await afterRefusal('R1', mar, oid, first.attemptId!)
    console.log('     … an intentional later PRN Given is a NEW attempt (documented again on purpose)')
    plans.push('commit'); mar.document(currentRow(oid), 'given', 'R1-later'); await settle()
    const f = facts(oid)
    check(f.length === 2 && f[1].attemptId !== first.attemptId && phase(mar, oid) === 'none', 'R1: the later deliberate Given records a second fact with its own attempt id')
    mar.unregisterView(v); mar.dispose()
  }
  console.log('[R2] PRN Given: original held -> retry refused CLIENT-SIDE (the shipped adapter\'s permission check, no status)')
  {
    const mar = newMar(); const v = mar.registerView([A]); await mar.refresh(); await settle()
    const oid = prnOrder(A)
    plans.push('hold'); mar.document(currentRow(oid), 'given', 'R2'); await settle()
    const first = last()
    /* the same display name now signed in under a title without meds.administer: the controller keeps
       the nurse's attempts (same owner) and the shipped adapter refuses before any request */
    session = { name: NURSE_A, jobTitle: 'Receptionist' }
    plans.push('adapter'); mar.retry(oid); await settle()
    check(last().attemptId === first.attemptId && last().jobTitle === 'Receptionist', 'R2: the retry reached the shipped adapter with the same attempt id')
    check(phase(mar, oid) === 'unconfirmed', `R2: a client-side refusal does not settle the attempt (got '${phase(mar, oid)}')`)
    const no = notice(mar, oid)
    check(/Insufficient permissions/.test(no) && !/session has expired/i.test(no), `R2: the actual reason is shown (notice '${no}')`)
    session = { name: NURSE_A, jobTitle: 'Staff Nurse' }
    await afterRefusal('R2', mar, oid, first.attemptId!)
    mar.unregisterView(v); mar.dispose()
  }
  console.log('[R3] the pinned-minute fallback: pinned retry 400 -> the ORIGINAL body re-sent -> refused 403')
  {
    const mar = newMar(); const v = mar.registerView([A]); await mar.refresh(); await settle()
    const oid = prnOrder(A)
    plans.push('hold'); mar.document(currentRow(oid), 'given', 'R3'); await settle()
    const first = last(), k = requests.length
    plans.push('reject-400', 'reject-403'); mar.retry(oid); await settle()
    const [pinned, original] = requests.slice(k)
    check(!!pinned?.administeredAt && original?.administeredAt === undefined && pinned.attemptId === first.attemptId && original.attemptId === first.attemptId,
      'R3: retry pinned the documented minute; the 400 fallback re-sent the original body (same attempt id)')
    check(phase(mar, oid) === 'unconfirmed', `R3: the fallback's refusal does not settle the unresolved original (got '${phase(mar, oid)}')`)
    await afterRefusal('R3', mar, oid, first.attemptId!)
    mar.unregisterView(v); mar.dispose()
  }
  console.log('[R4] sign-out while the refused retry is in flight; another nurse\'s stored attempt stays isolated')
  {
    const oidB = prnOrder(A)
    session = { name: NURSE_B, jobTitle: 'Staff Nurse' }
    const mar = newMar(); const v = mar.registerView([A]); await mar.refresh(); await settle()
    plans.push('hold'); mar.document(currentRow(oidB), 'given', 'R4-B'); await settle()
    const bId = last().attemptId
    session = { name: NURSE_A, jobTitle: 'Staff Nurse' }; mar.syncSession(); await settle()
    const oid = prnOrder(A)
    plans.push('hold'); mar.document(currentRow(oid), 'given', 'R4'); await settle()
    const first = last()
    plans.push('defer-403'); mar.retry(oid); await settle()
    check(phase(mar, oid) === 'saving', 'R4: the retry is in flight')
    session = null; mar.syncSession()                                              // A signs out …
    session = { name: NURSE_B, jobTitle: 'Staff Nurse' }; mar.syncSession()        // … B signs in
    check(phase(mar, oidB) === 'unconfirmed' && phase(mar, oid) === 'none', 'R4: B sees only B\'s own unresolved attempt')
    deferred.shift()!(); await settle()                                            // A's retry is refused now
    check(stored(NURSE_A).some(a => a.orderId === oid && a.attemptId === first.attemptId), 'R4: A\'s unresolved attempt is still stored under A after the refused retry')
    check(stored(NURSE_B).length === 1 && stored(NURSE_B)[0].attemptId === bId && phase(mar, oidB) === 'unconfirmed', 'R4: B\'s stored attempt and lock are untouched')
    session = null; mar.syncSession()
    session = { name: NURSE_A, jobTitle: 'Staff Nurse' }; mar.syncSession()        // A signs back in
    check(phase(mar, oid) === 'unconfirmed', `R4: A's attempt is restored, unconfirmed (got '${phase(mar, oid)}')`)
    await afterRefusal('R4', mar, oid, first.attemptId!)
    held.get(bId!)!(); held.delete(bId!)   // B's own original lands too (cleanup — B is not signed in)
    mar.unregisterView(v); mar.dispose()
  }
  console.log('[R5] controls: a 401 retry stays locked (as before); a FIRST-send refusal still settles')
  {
    const mar = newMar(); const v = mar.registerView([A]); await mar.refresh(); await settle()
    const oid = prnOrder(A)
    plans.push('hold'); mar.document(currentRow(oid), 'given', 'R5'); await settle()
    const first = last()
    plans.push('reject-401'); mar.retry(oid); await settle()
    check(phase(mar, oid) === 'unconfirmed' && toasts[toasts.length - 1].includes('sign in again, then retry saving'), 'R5: 401 retry -> unconfirmed, told to sign in again')
    await afterRefusal('R5', mar, oid, first.attemptId!)
    const oid2 = prnOrder(A)
    plans.push('reject-409'); mar.document(currentRow(oid2), 'given', 'R5-first'); await settle()
    check(phase(mar, oid2) === 'none' && notice(mar, oid2).startsWith('Not recorded'), `R5: a refused FIRST send is definitive: settled, "Not recorded" (got '${phase(mar, oid2)}', '${notice(mar, oid2)}')`)
    check(facts(oid2).length === 0, 'R5: nothing recorded')
    mar.unregisterView(v); mar.dispose()
  }
  advance(0)
  console.log(`RESULT ${passes} passed, ${fails} failed`)
  process.exit(fails ? 1 : 0)
}
void main()
