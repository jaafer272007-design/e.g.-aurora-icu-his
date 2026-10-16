// Deterministic check of the owner's decisions + SAFE RETRY (2026-10-05, ### F) over the REAL
// client modules under a FAKE clock (Date.now is replaced) — one-action-per-round's
// oneaction-harness.ts pattern: src/lib/marSchedule.ts (isFirstDose, documentableAt),
// src/lib/api/data/orders.ts (the mock adapter's applyAdministration + deriveMarRows — the
// mirror of the server), src/pages/NurseWorkspace/marDays.ts (unlocksAt / isEligibleNow, the
// daily cards), src/lib/time.ts (hospital clock = Asia/Baghdad, UTC+3; the wire stays UTC).
// Synthetic orders only, pushed into the mock store with a DATED signing event.
import { setServerClock, localStamp } from '/home/user/e.g.-aurora-icu-his/src/lib/time.ts'
import { allOrders, applyAdministration, applyDiscontinue, deriveMarRows } from '/home/user/e.g.-aurora-icu-his/src/lib/api/data/orders.ts'
import { groupMarDays, isActionable, isEligibleNow, unlocksAt } from '/home/user/e.g.-aurora-icu-his/src/pages/NurseWorkspace/marDays.ts'
import type { AdministrationAction, MarRow, MedAdministration, Order } from '/home/user/e.g.-aurora-icu-his/src/lib/api/types.ts'

setServerClock('Asia/Baghdad', 180)
let passes = 0, fails = 0
const check = (c: boolean, m: string) => { console.log((c ? '  PASS ' : '  FAIL ') + m); c ? passes++ : fails++ }
let fake = 0
Date.now = () => fake
const H = (wall: string) => Date.parse(wall.replace(' ', 'T') + (wall.length === 16 ? ':00' : '') + '+03:00')
const at = (wall: string) => { fake = H(wall) }
const PID = 'P-SYNF'
let n = 0
function order(freq: string, signedUtc: string, prn = false, administrations?: MedAdministration[]): string {
  const orderId = `ORD-SYNF${++n}`
  allOrders().push({
    orderId, patientId: PID, bedId: 'B-02', patientName: 'Synthetic', category: 'Medication',
    summary: `SynF${n}`, priority: 'Routine', status: 'active', orderedBy: 'Dr. Synthetic', orderedTime: signedUtc,
    medication: { drugId: `synf${n}`, drug: `Syn F drug ${n}`, dose: '1 mg', route: 'IV', frequency: freq, duration: 'ongoing', prn, ...(prn ? { prnIndication: 'pain' } : {}) },
    history: [{ time: signedUtc, actor: 'Dr. Synthetic', action: 'created' }, { time: signedUtc, actor: 'Dr. Synthetic', action: 'signed' }],
    ...(administrations ? { administrations } : {}),
  } as Order)
  return orderId
}
const ord = (oid: string) => allOrders().find(o => o.orderId === oid)!
const cur = (oid: string): MarRow | undefined => deriveMarRows([PID]).find(r => r.orderId === oid && isActionable(r))
const nFacts = (oid: string) => (ord(oid).administrations ?? []).filter(a => a.status !== 'scheduled').length
const snap = (oid: string) => JSON.stringify([ord(oid).administrations ?? [], ord(oid).history, ord(oid).status])
const doc = (oid: string, aid: string, action: AdministrationAction, reason?: string, administeredAt?: string, attemptId?: string) =>
  applyAdministration(oid, aid, action, 'RN Synthetic', reason, administeredAt, attemptId)
const hosp = (r: MarRow | undefined) => (r ? localStamp(Date.parse(r.scheduledTime.replace(' ', 'T') + ':00Z')) : '-')
function refusedEarly(oid: string, label: string) {
  const r = cur(oid)!
  const s0 = snap(oid)
  const res = (['given', 'held', 'refused'] as const).map(a => doc(oid, r.adminId, a, a === 'given' ? undefined : 'synthetic probe'))
  check(res.every(x => typeof x === 'string' && x.includes('is not due until')), `${label}: Given / Held / Refused refused by the mock`)
  check(snap(oid) === s0, `${label}: nothing written`)
  check(!r.firstDose && !isEligibleNow(r, Date.now()) && unlocksAt(r) === Date.parse(r.scheduledTime.replace(' ', 'T') + ':00Z'),
    `${label}: locked until ${hosp(r)} (hospital), no firstDose flag`)
}

console.log('[1] FIRST DOSE open on signing: q1h signed 05:30 -> round 1 scheduled 06:00; documented at 05:40')
const A = order('q1h', '2026-10-05 02:30')
at('2026-10-05 05:40')
let r = cur(A)!
check(r.round === 1 && hosp(r) === '2026-10-05 06:00' && r.firstDose === true, `round 1 still scheduled ${hosp(r)} (identity unchanged), firstDose=${r.firstDose}`)
check(unlocksAt(r) === null && isEligibleNow(r, Date.now()), '05:40: open — 20 min before its scheduled time')
check(typeof doc(A, r.adminId, 'given', undefined, undefined, 'syn-attempt-a1') !== 'string', '05:40: Given -> accepted')
r = cur(A)!
check(r.round === 2 && hosp(r) === '2026-10-05 06:40' && r.timerRule === 'given' && !r.firstDose, `round 2 due ${hosp(r)} = the actual 05:40 + 1 h (rolling timer unchanged)`)
at('2026-10-05 06:39:59.999'); refusedEarly(A, '06:39:59.999, round 2')
at('2026-10-05 06:40')
check(isEligibleNow(cur(A)!, Date.now()) && typeof doc(A, cur(A)!.adminId, 'held', 'synthetic: SBP 84') !== 'string', '06:40:00.000: round 2 open; Held -> accepted')
r = cur(A)!
check(hosp(r) === '2026-10-05 07:40' && r.timerRule === 'skipped' && !isEligibleNow(r, Date.now()), `round 3 due ${hosp(r)} = the held round's scheduled 06:40 + 1 h, locked`)

console.log('\n[2] the owner\'s one-action example as a SUBSEQUENT round (unchanged): round 1 Given 06:05 -> round 2 locked until 07:05')
const B = order('q1h', '2026-10-05 02:30')
at('2026-10-05 06:05')
check(typeof doc(B, cur(B)!.adminId, 'given') !== 'string' && hosp(cur(B)) === '2026-10-05 07:05', 'round 1 Given 06:05 -> round 2 due 07:05')
refusedEarly(B, '06:05, straight after the Given')
at('2026-10-05 06:40'); refusedEarly(B, '06:40 (due-soon window)')
at('2026-10-05 07:04:59.999'); refusedEarly(B, '07:04:59.999')
at('2026-10-05 07:05')
check(isEligibleNow(cur(B)!, Date.now()) && typeof doc(B, cur(B)!.adminId, 'refused', 'synthetic: declined') !== 'string', '07:05:00.000: open; Refused -> accepted')
check(hosp(cur(B)) === '2026-10-05 08:05' && !isEligibleNow(cur(B)!, Date.now()), 'round 3 due 08:05, locked')
const C = order('q1h', '2026-10-05 02:30')
at('2026-10-05 09:30')
check(typeof doc(C, cur(C)!.adminId, 'given', 'synthetic: delayed', '2026-10-05 04:10') !== 'string' && hosp(cur(C)) === '2026-10-05 08:10' && isEligibleNow(cur(C)!, Date.now()),
  'an already-due next round (08:10, from a late Given at 07:10) is open at once — no cooldown')

console.log('\n[3] once orders: the single dose is the first dose')
const O = order('once', '2026-10-05 07:20')   // signed 10:20 hospital -> the dose at 11:00 hospital
at('2026-10-05 10:30')
r = cur(O)!
check(r.firstDose === true && isEligibleNow(r, Date.now()) && hosp(r) === '2026-10-05 11:00', `10:30: the once dose (scheduled ${hosp(r)}) is open`)
check(typeof doc(O, r.adminId, 'held', 'synthetic: NPO', undefined, 'syn-attempt-o1') !== 'string' && cur(O) === undefined, '10:30: Held -> accepted; nothing further')
check(String(doc(O, r.adminId, 'given', undefined, undefined, 'syn-attempt-o2')).includes('already documented'), 'a different attempt on it -> already documented')

console.log('\n[4] LEGACY order (a fact without a round): not a first dose — round 1 is its LegacyEntry slot, unchanged and locked')
const L = order('q1h', '2026-10-05 05:30', false,
  [{ adminId: 'ADM-SYNL1', scheduledTime: '2026-10-05 06:00', status: 'given', documentedTime: '2026-10-05 06:20', documentedBy: 'RN Synthetic Legacy' }])
at('2026-10-05 09:30')
r = cur(L)!
check(r.round === 1 && hosp(r) === '2026-10-05 10:00' && !r.firstDose, `round 1 = ${hosp(r)} (the slot after the legacy fact's 09:00), no firstDose`)
refusedEarly(L, '09:30, the legacy order\'s round 1')

console.log('\n[5] hospital midnight (unchanged): a subsequent q8h round due 00:00 sits on tomorrow\'s card, locked until 00:00')
const Mo = order('q8h', '2026-10-05 07:30')
at('2026-10-05 16:00')
check(typeof doc(Mo, cur(Mo)!.adminId, 'given') !== 'string', '16:00: round 1 Given -> round 2 due 00:00 hospital')
at('2026-10-05 23:59:59')
const rm = cur(Mo)!
const cards = groupMarDays(deriveMarRows([PID]).filter(x => x.orderId === Mo), Date.now())
check(hosp(rm) === '2026-10-06 00:00' && !isEligibleNow(rm, Date.now()) && !!cards.find(c => c.relation === 'tomorrow')?.rows.some(x => x.adminId === rm.adminId),
  "23:59:59: locked, on tomorrow's card")
at('2026-10-06 00:00')
check(isEligibleNow(rm, Date.now()), '00:00:00: open')

console.log('\n[6] SAFE RETRY in the mock (mirrors the server): a resend of a recorded attempt changes nothing')
const Pr = order('q6h', '2026-10-05 02:30', true), Co = order('continuous', '2026-10-05 02:30')
at('2026-10-06 00:10')
for (const [oid, aid, label] of [[Pr, 'prn', 'PRN'], [Co, 'ondemand', 'continuous']] as const) {
  const row = cur(oid)!
  check(unlocksAt(row) === null && isEligibleNow(row, Date.now()), `${label}: available as needed (no lock, no interval)`)
  check(typeof doc(oid, aid, 'given', undefined, undefined, `syn-${label}-x`) !== 'string' && nFacts(oid) === 1, `${label}: Given with attempt x -> one fact`)
  const s0 = snap(oid)
  const again = doc(oid, aid, 'given', undefined, undefined, `syn-${label}-x`)
  check(typeof again !== 'string' && snap(oid) === s0, `${label}: attempt x resent -> the order returned, nothing written`)
  check(String(doc(oid, aid, 'held', 'synthetic', undefined, `syn-${label}-x`)).includes('different documentation') && snap(oid) === s0, `${label}: attempt x as Held -> refused, nothing written`)
  check(typeof doc(oid, aid, 'given', undefined, undefined, `syn-${label}-y`) !== 'string' && nFacts(oid) === 2, `${label}: a new attempt y (a later intentional dose) -> a second fact`)
}
const s1 = snap(A)
check(typeof doc(A, '2026-10-05T03:00~r1', 'given', undefined, undefined, 'syn-attempt-a1') !== 'string' && snap(A) === s1,
  'round 1\'s attempt resent after rounds 2-3 moved on -> the order returned (not "already documented"), nothing written')
applyDiscontinue(Pr, 'synthetic: course complete', 'Dr. Synthetic')
const s2 = snap(Pr)
check(typeof doc(Pr, 'prn', 'given', undefined, undefined, 'syn-PRN-y') !== 'string' && snap(Pr) === s2, 'after discontinuation: the recorded attempt resent -> the order returned, nothing written')
check(String(doc(Pr, 'prn', 'given', undefined, undefined, 'syn-PRN-z')).includes('discontinued'), 'after discontinuation: a new attempt -> refused (not in force)')
const facts = deriveMarRows([PID]).filter(x => x.orderId === Co && x.status === 'given')
check(facts.length === 2 && facts.every(x => x.attemptId?.startsWith('syn-continuous-')), 'deriveMarRows: fact rows carry their attemptId (the page\'s confirmation)')

console.log(`\nRESULT ${passes} passed, ${fails} failed (device zone ${Intl.DateTimeFormat().resolvedOptions().timeZone})`)
process.exit(fails ? 1 : 0)
