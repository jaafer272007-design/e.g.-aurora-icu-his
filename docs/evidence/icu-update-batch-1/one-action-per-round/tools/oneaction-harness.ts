// Deterministic check of ONE ACTION PER ROUND over the REAL client modules
// under a FAKE clock (Date.now is replaced): src/lib/marSchedule.ts
// (documentableAt), src/lib/api/data/orders.ts (the mock adapter's
// applyAdministration + deriveMarRows — the eligibility mirror),
// src/pages/NurseWorkspace/marDays.ts (isEligibleNow / unlocksAt, the
// daily cards) and src/lib/time.ts (hospital clock = Asia/Baghdad, UTC+3,
// as the server reports it; the wire stays UTC). Synthetic orders only,
// pushed into the mock store with a DATED signing event (the therapy start).
import { setServerClock, dueStateFor, localStamp } from '/home/user/e.g.-aurora-icu-his/src/lib/time.ts'
import { documentableAt } from '/home/user/e.g.-aurora-icu-his/src/lib/marSchedule.ts'
import { allOrders, applyAdministration, deriveMarRows } from '/home/user/e.g.-aurora-icu-his/src/lib/api/data/orders.ts'
import { groupMarDays, isActionable, isEligibleNow, unlocksAt } from '/home/user/e.g.-aurora-icu-his/src/pages/NurseWorkspace/marDays.ts'
import type { MarRow, Order } from '/home/user/e.g.-aurora-icu-his/src/lib/api/types.ts'

setServerClock('Asia/Baghdad', 180)
let passes = 0, fails = 0
const check = (c: boolean, m: string) => { console.log((c ? '  PASS ' : '  FAIL ') + m); c ? passes++ : fails++ }
/* the fake clock: hospital wall time "yyyy-MM-dd HH:mm[:ss.mmm]" (UTC+3) -> epoch */
let fake = 0
Date.now = () => fake
const H = (wall: string) => Date.parse(wall.replace(' ', 'T') + (wall.length === 16 ? ':00' : '') + '+03:00')
const at = (wall: string) => { fake = H(wall) }
const PID = 'P-SYN1'
let n = 0
function order(freq: string, signedUtc: string, prn = false): string {
  const orderId = `ORD-SYN${++n}`
  const o: Order = {
    orderId, patientId: PID, bedId: 'B-01', patientName: 'Synthetic', category: 'Medication',
    summary: `Syn${n}`, priority: 'Routine', status: 'active', orderedBy: 'Dr. Synthetic', orderedTime: signedUtc,
    medication: { drugId: `syn${n}`, drug: `Syn drug ${n}`, dose: '1 mg', route: 'IV', frequency: freq, duration: 'ongoing', prn, ...(prn ? { prnIndication: 'pain' } : {}) },
    history: [{ time: signedUtc, actor: 'Dr. Synthetic', action: 'created' }, { time: signedUtc, actor: 'Dr. Synthetic', action: 'signed' }],
  } as Order
  allOrders().push(o)
  return orderId
}
const cur = (oid: string): MarRow | undefined => deriveMarRows([PID]).find(r => r.orderId === oid && isActionable(r))
const nFacts = (oid: string) => (allOrders().find(o => o.orderId === oid)!.administrations ?? []).length
const nHist = (oid: string) => allOrders().find(o => o.orderId === oid)!.history.length
const doc = (oid: string, aid: string, action: 'given' | 'held' | 'refused', reason?: string, administeredAt?: string) =>
  applyAdministration(oid, aid, action, 'RN Synthetic', reason, administeredAt)
const hosp = (r: MarRow | undefined) => (r ? localStamp(Date.parse(r.scheduledTime.replace(' ', 'T') + ':00Z')) : '-')
function refusedEarly(oid: string, label: string) {
  const r = cur(oid)!
  const f0 = nFacts(oid), h0 = nHist(oid)
  const res = (['given', 'held', 'refused'] as const).map(a => doc(oid, r.adminId, a, a === 'given' ? undefined : 'synthetic probe'))
  check(res.every(x => typeof x === 'string' && x.includes('is not due until') && x.includes('one action per dose round')),
    `${label}: Given / Held / Refused all refused by the mock ("${typeof res[0] === 'string' ? res[0].slice(0, 70) : 'ACCEPTED'}…")`)
  check(nFacts(oid) === f0 && nHist(oid) === h0, `${label}: no fact, no audit entry added`)
  check(!isEligibleNow(r, Date.now()) && unlocksAt(r) === Date.parse(r.scheduledTime.replace(' ', 'T') + ':00Z'),
    `${label}: the row is current but NOT eligible now; it unlocks at ${hosp(r)} (hospital)`)
}

console.log('[1] the owner\'s example: q1h, round 1 due 06:00, Given at 06:05 -> round 2 at 07:05, locked until 07:05, then ONE action')
const A = order('q1h', '2026-10-05 02:30')                 // signed 05:30 hospital -> round 1 due 06:00 hospital (03:00Z)
at('2026-10-05 05:50')
check(!isEligibleNow(cur(A)!, Date.now()) && dueStateFor(cur(A)!.scheduledTime, new Date(Date.now())) === 'due',
  `05:50: round 1 (${hosp(cur(A))}) is in the 30-min DUE-SOON window and still LOCKED — the reminder is not permission`)
refusedEarly(A, '05:50, round 1 before 06:00')
at('2026-10-05 06:05')
const g = doc(A, cur(A)!.adminId, 'given')
check(typeof g !== 'string', '06:05: round 1 Given -> accepted')
let r2 = cur(A)!
check(r2.round === 2 && hosp(r2) === '2026-10-05 07:05' && r2.timerRule === 'given', `round 2 due ${hosp(r2)} (hospital) — from the actual time 06:05 + 1 h`)
at('2026-10-05 06:05'); refusedEarly(A, '06:05, straight after the Given')
at('2026-10-05 06:40'); refusedEarly(A, '06:40 (due-soon window)')
check(dueStateFor(r2.scheduledTime, new Date(Date.now())) === 'due' && !isEligibleNow(r2, Date.now()), '06:40: DUE SOON shown, controls locked')
at('2026-10-05 07:04:59.999'); refusedEarly(A, '07:04:59.999')
at('2026-10-05 07:05')
check(isEligibleNow(r2, Date.now()) && documentableAt(unlocksAt(r2)!, Date.now()), '07:05:00.000: round 2 eligible')
const h1 = doc(A, r2.adminId, 'held', 'synthetic: SBP 84')
check(typeof h1 !== 'string', '07:05: Held -> accepted (one action)')
const dup = (['given', 'refused', 'held'] as const).map(a => doc(A, r2.adminId, a, 'synthetic'))
check(dup.every(x => typeof x === 'string' && x.includes('already documented')), `07:05: a second action on round 2 (given/refused/held) -> refused as already documented`)
const r3 = cur(A)!
check(r3.round === 3 && hosp(r3) === '2026-10-05 08:05' && r3.timerRule === 'skipped' && !isEligibleNow(r3, Date.now()),
  `round 3 due ${hosp(r3)} = the held round's scheduled 07:05 + 1 h, and LOCKED — recording a dose opened no future round`)
check(nFacts(A) === 2, 'exactly two facts on the order (round 1 Given, round 2 Held)')

console.log('\n[2] Refused at due: the next round = scheduled time + interval, locked')
at('2026-10-05 08:05')
check(typeof doc(A, cur(A)!.adminId, 'refused', 'synthetic: declined') !== 'string', '08:05: round 3 Refused -> accepted')
check(hosp(cur(A)) === '2026-10-05 09:05' && !isEligibleNow(cur(A)!, Date.now()), `round 4 due ${hosp(cur(A))}, locked`)

console.log('\n[3] an already-due next round stays eligible (no cooldown)')
const B = order('q1h', '2026-10-05 02:30')   // round 1 due 06:00 hospital
at('2026-10-05 09:30')
check(typeof doc(B, cur(B)!.adminId, 'given', 'synthetic: delayed', '2026-10-05 04:10') !== 'string', '09:30: round 1 Given late with actual time 07:10 (hospital)')
check(hosp(cur(B)) === '2026-10-05 08:10' && isEligibleNow(cur(B)!, Date.now()), `round 2 due ${hosp(cur(B))} — already past, eligible immediately`)

console.log('\n[4] once order')
const O = order('once', '2026-10-05 07:20')                // signed 10:20 hospital -> the dose at 11:00 hospital
at('2026-10-05 10:59:59')
refusedEarly(O, '10:59:59, the once dose (11:00)')
at('2026-10-05 11:00')
check(typeof doc(O, cur(O)!.adminId, 'given') !== 'string' && cur(O) === undefined, '11:00: the once dose Given; nothing further expected')

console.log('\n[5] hospital midnight: a q8h round due 00:00 (21:00Z the previous UTC day)')
const M = order('q8h', '2026-10-05 07:30')                 // signed 10:30 hospital -> round 1 11:00 hospital
at('2026-10-05 16:00')
check(typeof doc(M, cur(M)!.adminId, 'given') !== 'string', '16:00: round 1 Given -> round 2 due 00:00 hospital')
at('2026-10-05 23:59:59')
const rm = cur(M)!
const cards = groupMarDays(deriveMarRows([PID]).filter(r => r.orderId === M), Date.now())
const today = cards.find(c => c.relation === 'today'), tomorrow = cards.find(c => c.relation === 'tomorrow')
check(hosp(rm) === '2026-10-06 00:00' && !isEligibleNow(rm, Date.now()), '23:59:59: round 2 (00:00 tomorrow) locked')
check(!!tomorrow && tomorrow.pinnedOpen && tomorrow.rows.some(r => r.adminId === rm.adminId) && today?.reference?.direction === 'later',
  "23:59:59: the round sits on TOMORROW's open card; today's card references it — no second set of controls")
at('2026-10-06 00:00')
const cards2 = groupMarDays(deriveMarRows([PID]).filter(r => r.orderId === M), Date.now())
check(isEligibleNow(rm, Date.now()) && cards2.find(c => c.relation === 'today')!.rows.some(r => r.adminId === rm.adminId),
  "00:00:00: the round is eligible and on TODAY's card (the new hospital day)")

console.log('\n[6] PRN and on-demand availability: no scheduled time -> no lock (unresolved: no source defines a next round)')
const Pr = order('q6h', '2026-10-05 02:30', true), C = order('continuous', '2026-10-05 02:30')
at('2026-10-06 00:10')
const pr = cur(Pr)!, cc = cur(C)!
check(pr.adminId === 'prn' && unlocksAt(pr) === null && isEligibleNow(pr, Date.now()), 'PRN availability: unlocksAt = null, eligible')
check(cc.adminId === 'ondemand' && unlocksAt(cc) === null && isEligibleNow(cc, Date.now()), 'continuous (on demand): unlocksAt = null, eligible')
const three = [doc(C, 'ondemand', 'given'), doc(C, 'ondemand', 'given'), doc(C, 'ondemand', 'given')]
check(three.every(x => typeof x !== 'string') && nFacts(C) === 3, 'three Given on the continuous order in the same minute -> three facts (the screenshot; only the page\'s submission guard prevents double clicks)')

console.log(`\nRESULT ${passes} passed, ${fails} failed (device zone ${Intl.DateTimeFormat().resolvedOptions().timeZone})`)
process.exit(fails ? 1 : 0)
